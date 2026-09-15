import { log, getConfiguration, formatMoney, formatRam, formatNumberShort, parseShortNumber, getErrorInfo } from "./helpers.js";
import { AGENT_FILES, AIR_GAP_ROWS, FILES, LABS, PORT_DEFAULT, WORKER_RAM, decodeMsg, emptyState, isLabHost, safeParse } from "./darknet/lib.js";

/* The darknet controller. Runs on home, owns `darknet/state.txt`, drains the report port,
 * plans loot / labyrinth work and pushes `darknet/passwords.txt` + `darknet/cmd.txt` to every
 * online cracked server. Agents never plan; they only execute the pushed command file.
 *
 * Static RAM budget (target: under 8 GB):
 *   base 1.60 | getResetInfo 1.00 | getPlayer 0.50 | exec 1.30 | scp 0.60 | kill 0.50
 *   dnet.getServerDetails 0.10 | fileExists 0.10 | isRunning 0.10 | dnet.connectToSession 0.05
 *   getServerMaxRam 0.05 | getServerUsedRam 0.05
 *   dnet.getStasisLinkLimit 0 | dnet.getStasisLinkedServers 0 | read/write/readPort/print/tprint/
 *   toast/flags/getScriptName/disableLog/sleep 0                          => 5.95 GB
 *
 * NOTE: object keys that collide with an NS function name are written as quoted strings
 * (e.g. "share", which would otherwise cost 4 GB). Same convention as darknet/lib.js.
 */

const argsSchema = [
    ["mode", "balanced"],           // balanced | loot | labyrinth. Re-read every loop, so it can change at runtime.
    ["port", PORT_DEFAULT],         // netscript port the agents report on
    ["interval", 10000],            // ms between controller loops
    ["crack-threads", 6],           // threads each agent may give one crack.js worker
    ["realloc-threads", 50],        // threads each agent may give one realloc.js worker
    ["lab-walkers", 3],             // most darknet/lab.js walkers to keep alive on the current lab
    ["lab-threads", 6],             // threads per labyrinth walker (threads shorten the auth delay)
    ["allow-webstorm", false],      // permit unleashStormSeed when the frontier has gone stale
    ["no-promote", false],          // never hand stock symbols to promote.js
    ["status", false],              // print a summary and exit
    ["kill", false],                // stop every agent and exit
];

export function autocomplete(data) {
    data.flags(argsSchema);
    return ["balanced", "loot", "labyrinth"];
}

const STOCK_PROBABILITIES = "/Temp/stock-probabilities.txt";
const CLAIM_LIFETIME = 120000;      // a crack claim by another agent expires after 2 minutes
const RESET_CHECK_INTERVAL = 300000;// getResetInfo costs 1 GB of static RAM but is free to call; poll every 5 min
const STALE_FRONTIER = 3600000;     // no new server for an hour => the frontier is stale
const STORM_COOLDOWN = 1800000;     // the game's global STORM_SEED cooldown is 30 minutes
const KILL_GRACE = 5000;            // ms to let agents notice the stop flag before killing them
const MIGRATE_THREADS = 10;
const PROMOTE_THREADS = 8;
const MAX_PROMOTE_SYMBOLS = 3;
const LAB_DEPTH_SLACK = 6;          // balanced mode flips to labyrinth within this many rows of the lab
const MIGRATION_CHARGE_TTL = 600000; // a migration charge counts as "in flight" for 10 minutes
const SERVER_TTL = 300000;          // a known server nothing has confirmed for 5 minutes is presumed gone
const MAX_PORT_DRAIN = 5000;        // hard stop so a flooded port cannot hang the loop
const MONEY_PATTERN = /\$([\d.]+)([kmbtq]?)/i;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    let options = getConfiguration(ns, argsSchema);
    if (!options) return;

    let resetTime = ns.getResetInfo().lastAugReset;
    let resetCheckedAt = Date.now();
    let state = loadState(ns, resetTime);

    if (options.status) return printStatus(ns, state);
    if (options["kill"]) return await stopEverything(ns, state, options);

    log(ns, `INFO: darknet controller started on port ${options.port} (mode ${options.mode}).`, false, "info");
    while (true) {
        try {
            const reloaded = getConfiguration(ns, argsSchema);
            if (reloaded) options = reloaded;

            drainPort(ns, options.port, state);

            if (Date.now() - resetCheckedAt >= RESET_CHECK_INTERVAL) {
                resetCheckedAt = Date.now();
                const latest = ns.getResetInfo().lastAugReset;
                if (latest !== resetTime) {
                    log(ns, "WARN: darknet detected a prestige; wiping state.", true, "warning");
                    resetTime = latest;
                    state = emptyState(resetTime);
                }
            }
            recomputeCompleted(state);

            const charisma = ns.getPlayer().skills.charisma;
            const mode = chooseMode(ns, state, options, charisma);
            state.mode = mode;
            const plan = mode === "labyrinth"
                ? planLabyrinth(ns, state, options, charisma)
                : planLoot(ns, state, options, charisma);
            plan.stormHost = planStorm(state, options, plan);

            state.plan.stasisTargets = plan.stasisTargets;
            state.plan.migrationTargets = plan.migrationTargets;
            state.plan.promoteSymbols = plan.promoteSymbols;
            state.plan.charismaGoal = plan.charismaGoal;
            state.plan.shareActive = plan.shareActive;

            bootstrap(ns, state, plan, options);
            pushFiles(ns, state, plan);
            state.labs.current = plan.lab ? plan.lab.host : null;
            // Walkers are launched after pushFiles: a winning walker copies its own host's
            // passwords.txt and cmd.txt onto the lab so the agent it starts there has a
            // command file, and those two files only exist on that host once the push ran.
            if (mode === "labyrinth") launchWalkers(ns, state, plan, options);
            if (plan.stormHost) state.plan.lastStormAt = Date.now();

            ns.write(FILES.charismaGoal, String(plan.charismaGoal), "w");
            saveState(ns, state);
        } catch (err) {
            log(ns, `ERROR: darknet controller loop failed: ${getErrorInfo(err)}`, false, "error");
        }
        await ns.sleep(options.interval);
    }
}

// ---------------------------------------------------------------- state

/** Read `state.txt`, falling back to `state.bak.txt`, then to a fresh state.
 * `resetTime` is `ns.getResetInfo().lastAugReset`; a mismatch means a prestige wiped the darknet.
 * @param {NS} ns */
export function loadState(ns, resetTime) {
    for (const path of [FILES.state, FILES.stateBak]) {
        const parsed = safeParse(ns.read(path), null);
        if (!parsed || typeof parsed !== "object" || parsed.version !== 1) continue;
        if (parsed.resetTime !== resetTime) {
            log(ns, "INFO: darknet state is from a previous reset; starting fresh.");
            return emptyState(resetTime);
        }
        return fillState(parsed, resetTime);
    }
    return emptyState(resetTime);
}

/** Merge a loaded state over a fresh one so a truncated/older file cannot crash the planner. */
function fillState(parsed, resetTime) {
    const fresh = emptyState(resetTime);
    const merged = { ...fresh, ...parsed };
    merged.version = 1;
    merged.resetTime = resetTime;
    merged.passwords = parsed.passwords ?? fresh.passwords;
    merged.servers = parsed.servers ?? fresh.servers;
    merged.labs = { ...fresh.labs, ...(parsed.labs ?? {}) };
    if (!Array.isArray(merged.labs.walkers)) merged.labs.walkers = [];
    if (!Array.isArray(merged.labs.completed)) merged.labs.completed = [];
    merged.plan = { ...fresh.plan, ...(parsed.plan ?? {}) };
    merged.stats = { ...fresh.stats, ...(parsed.stats ?? {}) };
    if (!merged.stats.cracks || typeof merged.stats.cracks !== "object") merged.stats.cracks = {};
    return merged;
}

/** Write tmp, then the live file, keeping the previous live file as the backup.
 * @param {NS} ns */
export function saveState(ns, state) {
    const text = JSON.stringify(state);
    const previous = ns.read(FILES.state);
    ns.write(FILES.stateTmp, text, "w");
    ns.write(FILES.state, text, "w");
    if (previous) ns.write(FILES.stateBak, previous, "w");
}

// ---------------------------------------------------------------- port

/** Drain every queued agent report into `state`. Returns the number of messages applied.
 * @param {NS} ns */
export function drainPort(ns, port, state) {
    let applied = 0;
    for (let drained = 0; drained < MAX_PORT_DRAIN; drained++) {
        const line = ns.readPort(port);
        if (line === "NULL PORT DATA") break;
        const msg = typeof line === "string" ? decodeMsg(line) : (line && typeof line === "object" ? line : null);
        if (!msg || typeof msg.type !== "string") continue;
        applied++;
        try {
            applyMessage(state, msg);
        } catch (err) {
            log(ns, `WARN: darknet dropped a malformed ${msg.type} report: ${getErrorInfo(err)}`);
        }
    }
    return applied;
}

function blankServer() {
    return {
        depth: 0, difficulty: 0, modelId: "", maxRam: 0, blockedRam: 0, chaReq: 0,
        neighbours: [], online: true, lastSeen: 0, stasis: false,
    };
}

/** Create or update `state.servers[host]`. Fields that are `undefined` are left untouched. */
function upsertServer(state, host, fields, ts) {
    let entry = state.servers[host];
    if (!entry) {
        entry = blankServer();
        state.servers[host] = entry;
        state.plan.lastDiscoveryAt = ts;
    }
    for (const key of Object.keys(fields)) {
        if (fields[key] !== undefined) entry[key] = fields[key];
    }
    entry.lastSeen = ts;
    return entry;
}

function bumpCrackStats(state, modelId, won, attempts) {
    const key = modelId || "unknown";
    const row = state.stats.cracks[key] ?? { won: 0, failed: 0, attempts: 0 };
    if (won) row.won++; else row.failed++;
    row.attempts += Number(attempts) || 0;
    state.stats.cracks[key] = row;
}

function applyMessage(state, msg) {
    const ts = Number(msg.ts) || Date.now();
    const host = msg.host ?? msg.from;
    switch (msg.type) {
        case "hello": {
            const entry = upsertServer(state, host, {
                depth: msg.depth, difficulty: msg.difficulty, maxRam: msg.maxRam, online: true,
            }, ts);
            entry.agentPid = msg.pid;
            if (Array.isArray(msg.exes)) entry.exes = msg.exes;
            break;
        }
        case "server": {
            const details = msg.details ?? {};
            if (details.isOnline === false) {
                upsertServer(state, host, { online: false }, ts);
                break;
            }
            const entry = upsertServer(state, host, {
                depth: details.depth, difficulty: details.difficulty, modelId: details.modelId,
                blockedRam: details.blockedRam, chaReq: details.requiredCharismaSkill, online: true,
            }, ts);
            // Only the agent running ON a host reports that host's neighbours; reports about a
            // neighbour carry `neighbours: null`, so an untouched [] means "never scanned", not
            // "island". `neighboursAt` is what tells the two apart.
            if (Array.isArray(msg.neighbours)) {
                // Keep the last non-empty list: an island reports no neighbours, but migration
                // still needs the hosts that used to sit next to it (design doc section 7).
                if (msg.neighbours.length === 0 && entry.neighbours.length > 0) entry.prevNeighbours = entry.neighbours;
                entry.neighbours = msg.neighbours;
                entry.neighboursAt = ts;
                // A host the agent's probe still returns is provably alive right now, even
                // when nothing has cracked it and so no report ever names it as `host`.
                // Without this stamp, uncracked deep neighbours age past SERVER_TTL and
                // silently drop out of the frontier (and out of the walker candidates).
                for (const neighbour of msg.neighbours) {
                    if (typeof neighbour === "string" && neighbour !== host) upsertServer(state, neighbour, {}, ts);
                }
            }
            break;
        }
        case "gone": {
            // Not emitted by the current agent (it reports `server` with isOnline false) but
            // accepted so an older agent build cannot desynchronise the state.
            upsertServer(state, host, { online: false }, ts);
            break;
        }
        case "crack": {
            // Always a crack.js result (or agent.js's session failure). A claim is a worker
            // message with kind "crack"; the envelope keeps the two apart.
            const entry = upsertServer(state, host, {
                modelId: msg.modelId, difficulty: msg.difficulty, chaReq: msg.chaReq,
            }, ts);
            if (msg.success) {
                state.passwords[host] = {
                    password: msg.password, modelId: msg.modelId ?? entry.modelId,
                    difficulty: msg.difficulty ?? entry.difficulty, solvedAt: ts,
                };
                entry.crackClaimBy = undefined;
                entry.crackClaimAt = 0;
            } else if (msg.stale && state.passwords[host]) {
                state.passwords[host].stale = true;
            }
            if (String(msg.reason ?? "").includes("charisma") && msg.chaReq !== undefined) entry.chaReq = msg.chaReq;
            bumpCrackStats(state, msg.modelId ?? entry.modelId, !!msg.success, msg.attempts);
            break;
        }
        case "freed": {
            const entry = upsertServer(state, host, {}, ts);
            const reported = Number(msg.gb) || 0;
            const previous = entry.freedReported ?? 0;
            state.stats.ramFreed += Math.max(0, reported >= previous ? reported - previous : reported);
            entry.freedReported = msg.done ? 0 : reported;
            if (msg.remaining !== undefined) entry.blockedRam = Number(msg.remaining) || 0;
            break;
        }
        case "cache": {
            if (msg.success === false) break;
            state.stats.cachesOpened++;
            const found = String(msg.message ?? "").match(MONEY_PATTERN);
            if (found) {
                const amount = parseShortNumber(found[1] + found[2]);
                if (Number.isFinite(amount)) state.stats.moneyFromCaches += amount;
            }
            break;
        }
        case "clue": {
            const found = msg.passwords ?? {};
            for (const name of Object.keys(found)) {
                if (name === "unknown") continue;
                const existing = state.passwords[name];
                if (existing && !existing.stale) continue;
                state.passwords[name] = { password: found[name], modelId: "clue", solvedAt: ts };
            }
            break;
        }
        case "worker": {
            applyWorkerMessage(state, msg, ts, host);
            break;
        }
        case "walker": {
            // darknet/lab.js reports every 25 steps, and once more when it wins, gives up or
            // hits the charisma gate. These reports only decorate the roster: whether a walker
            // is still alive is decided by ns.isRunning in launchWalkers, because a walker that
            // dies with its server never gets to send a final message.
            const lab = msg.lab;
            const previous = (state.labs.walkers ?? []).find(row => row.pid === msg.pid);
            const walkers = (state.labs.walkers ?? []).filter(row => row.pid !== msg.pid);
            if (!msg.done) {
                walkers.push({
                    host: msg.from, pid: msg.pid, lab, steps: Number(msg.steps) || 0,
                    startedAt: previous ? previous.startedAt : ts, lastSeen: ts, reason: msg.reason,
                });
            }
            state.labs.walkers = walkers;
            if (msg.reason === "charisma") {
                state.labs.charismaBlocked = { lab, at: ts, chaReq: msg.chaReq };
            }
            if (msg.done && lab) {
                // Winning queues the reward augmentation; the *next* labyrinth only appears
                // once that augmentation is installed, and installing it wipes this state.
                // So `completed` is not touched here -- rewardQueuedAt is what stops the
                // controller relaunching walkers on an already-solved lab for this reset.
                state.labs.rewardQueuedAt = ts;
                if (msg.password !== undefined) {
                    state.passwords[lab] = { password: msg.password, modelId: "lab", difficulty: 10, solvedAt: ts };
                }
            }
            break;
        }
        default: break;
    }
}

/** Worker reports: one envelope type, the worker's own name in `kind`. */
function applyWorkerMessage(state, msg, ts, host) {
    switch (msg.kind) {
        case "agent": {
            const entry = upsertServer(state, host, { online: true }, ts);
            if (msg.workerPid) entry.agentPid = msg.workerPid;
            break;
        }
        case "crack": {
            // A claim: this agent has started cracking `host`, so nobody else should.
            const entry = upsertServer(state, host, {}, ts);
            entry.crackClaimBy = msg.from;
            entry.crackClaimAt = ts;
            break;
        }
        case "stasis": {
            upsertServer(state, host, { stasis: !!msg.success }, ts);
            break;
        }
        case "migrate": {
            // migrate.js reports once, when the worker stops; `calls` is that worker's total.
            const entry = upsertServer(state, host, {}, ts);
            entry.migrationCharge = (Number(entry.migrationCharge) || 0) + (Number(msg.calls) || 0);
            entry.migrationChargeAt = ts;
            break;
        }
        case "phish": {
            // phish.js reports a running total every 20 calls, so only the delta is new.
            const entry = upsertServer(state, host, {}, ts);
            const total = Number(msg.successes) || 0;
            const seen = Number(entry.phishReported) || 0;
            state.stats.phishSuccesses = (Number(state.stats.phishSuccesses) || 0) + Math.max(0, total >= seen ? total - seen : total);
            entry.phishReported = total;
            break;
        }
        case "promote": {
            const entry = upsertServer(state, host, {}, ts);
            const total = Number(msg.calls) || 0;
            const seen = Number(entry.promoteReported) || 0;
            state.stats.promoteCalls = (Number(state.stats.promoteCalls) || 0) + Math.max(0, total >= seen ? total - seen : total);
            entry.promoteReported = total;
            break;
        }
        case "storm": {
            if (msg.success) state.plan.lastStormAt = ts;
            break;
        }
        default: {
            upsertServer(state, host, {}, ts);
            break;
        }
    }
}

// ---------------------------------------------------------------- planning

/** Darknet servers vanish silently: the agent only reports hosts `probe` still returns, so a
 * deleted server keeps its last `online: true`. Anything unconfirmed for SERVER_TTL is presumed
 * gone; `pushFiles` refreshes `lastSeen` whenever a session proves a host is still there. */
function isLive(entry, now) {
    return !!entry && entry.online && now - (Number(entry.lastSeen) || 0) <= SERVER_TTL;
}

function frontierDepth(state) {
    let deepest = 0;
    const now = Date.now();
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!isLive(entry, now) || isLabHost(name)) continue;
        deepest = Math.max(deepest, Number(entry.depth) || 0);
    }
    return deepest;
}

/** Hosts we can actually deliver a command file to (online, non-lab, live password). */
function commandable(state) {
    const out = [];
    const now = Date.now();
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!isLive(entry, now) || isLabHost(name)) continue;
        const known = state.passwords[name];
        if (!known || known.stale || known.password === undefined) continue;
        out.push(name);
    }
    return out;
}

/** Up to 3 held stock symbols to promote, strongest forecast first. Empty when nothing is held. */
function planPromotions(ns, options) {
    if (options["no-promote"]) return [];
    const parsed = safeParse(ns.read(STOCK_PROBABILITIES), null);
    if (!parsed || typeof parsed !== "object") return [];
    // stockmaster.js writes { SYM: { prob, sharesLong, sharesShort } }; an array of rows is also accepted.
    const rows = Array.isArray(parsed)
        ? parsed.map(row => ({ sym: row?.sym, prob: row?.prob, held: (row?.sharesLong ?? 0) + (row?.sharesShort ?? 0) }))
        : Object.entries(parsed).map(([sym, row]) => ({ sym, prob: row?.prob, held: (row?.sharesLong ?? 0) + (row?.sharesShort ?? 0) }));
    // Only symbols the player actually holds: promoting a stock we own nothing of pays nothing.
    const usable = rows.filter(row => typeof row.sym === "string" && row.sym && Number.isFinite(row.prob) && row.held > 0);
    usable.sort((a, b) => Math.abs(b.prob - 0.5) - Math.abs(a.prob - 0.5));
    return usable.slice(0, MAX_PROMOTE_SYMBOLS).map(row => row.sym);
}

/** The cheapest charisma level that unlocks a currently blocked action. */
function planCharismaGoal(state, charisma, lab) {
    let goal = 0;
    const consider = (value) => {
        const required = Number(value) || 0;
        if (required > charisma && (goal === 0 || required < goal)) goal = required;
    };
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!entry.online || isLabHost(name)) continue;
        if (state.passwords[name] && !state.passwords[name].stale) continue;
        consider(entry.chaReq);
    }
    if (lab) consider(lab.cha);
    return goal;
}

/** Keep existing stasis links where they are still wanted, then fill the remaining slots. */
function assignStasis(ns, candidates) {
    const limit = ns.dnet.getStasisLinkLimit();
    const linked = ns.dnet.getStasisLinkedServers().filter(name => !isLabHost(name));
    const kept = linked.filter(name => candidates.includes(name));
    const wasted = linked.length - kept.length;    // links the game still holds on servers we no longer want
    const budget = Math.max(0, limit - wasted);
    const rest = candidates.filter(name => !kept.includes(name));
    return [...kept, ...rest].slice(0, budget);
}

function basePlan(ns, state, options, charisma) {
    return {
        mode: "loot",
        stasisTargets: [],
        migrationTargets: {},
        promoteSymbols: planPromotions(ns, options),
        charismaGoal: 0,
        shareActive: String(ns.read(FILES.shareActive) ?? "").trim() === "true",
        crackThreads: Math.max(1, Math.floor(Number(options["crack-threads"]) || 1)),
        reallocThreads: Math.max(1, Math.floor(Number(options["realloc-threads"]) || 1)),
        stormHost: null,
        lab: null,
        charisma,
        frontierDepth: frontierDepth(state),
    };
}

/** Loot mode: stasis-pin the biggest freed servers, migrate only stranded islands, phish the rest.
 * @param {NS} ns */
export function planLoot(ns, state, options, charisma = 0) {
    const plan = basePlan(ns, state, options, charisma);
    plan.mode = "loot";

    const liveNow = Date.now();
    const freed = Object.entries(state.servers)
        .filter(([name, entry]) => isLive(entry, liveNow) && !isLabHost(name) && (Number(entry.blockedRam) || 0) === 0 && (Number(entry.maxRam) || 0) > 0)
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    plan.stasisTargets = assignStasis(ns, freed);

    const reachable = commandable(state);
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!entry.online || isLabHost(name)) continue;
        if (!entry.neighboursAt) continue;                                   // never scanned itself
        if (!Array.isArray(entry.neighbours) || entry.neighbours.length > 0) continue;
        // An island: it scanned itself and found nothing. Charge from whoever last saw it.
        const chargers = new Set(entry.prevNeighbours ?? []);
        for (const [other, row] of Object.entries(state.servers)) {
            if (other !== name && row.online && (row.neighbours ?? []).includes(name)) chargers.add(other);
        }
        const usable = [...chargers].filter(charger => reachable.includes(charger));
        if (usable.length) plan.migrationTargets[name] = usable;
    }

    // The charisma goal is "the lowest charisma that unlocks the next blocked action" (spec
    // section 7), so the lab gate counts even while we are looting.
    plan.charismaGoal = planCharismaGoal(state, charisma, currentLab(ns, state));
    return plan;
}

/** The labyrinth an agent has actually seen wired into the darknet, or null.
 *
 * All eight labyrinth servers exist at once (NetworkGenerator.addLabyrinth adds every one of
 * them to AllServers, so `getServerDetails(anyLab).isOnline` is always true and tells us
 * nothing), but only the labyrinth the player is currently working on is *connected* into the
 * graph. So the one lab that turns up in some live server's probe IS the current one. */
function observedLab(state) {
    const now = Date.now();
    for (const entry of Object.values(state.servers ?? {})) {
        if (!isLive(entry, now)) continue;
        for (const neighbour of entry.neighbours ?? []) {
            if (isLabHost(neighbour)) return neighbour;
        }
    }
    return null;
}

/** Recompute `state.labs.completed` from what the network shows. Cheap and pure, so the loop
 * runs it every pass rather than only at startup.
 *
 * The labs are gated on installed augmentations and unlock strictly in LABS order, so
 * `completed` is always a prefix of LABS. Primary signal: whichever lab an agent has probed
 * is the current one, so every earlier LABS entry is done. Fallback, before any agent has
 * reached a lab: a lab counts as completed when its password is known and no reward is still
 * queued -- a queued reward means the win happened during *this* reset and the augmentation
 * that unlocks the next lab has not been installed yet. */
export function recomputeCompleted(state) {
    const seen = observedLab(state);
    if (seen) {
        const index = LABS.findIndex(row => row.host === seen);
        if (index >= 0) {
            state.labs.completed = LABS.slice(0, index).map(row => row.host);
            return state.labs.completed;
        }
    }
    if (state.labs.rewardQueuedAt) return state.labs.completed;
    const done = [];
    for (const lab of LABS) {
        if (!state.passwords[lab.host]) break;
        done.push(lab.host);
    }
    state.labs.completed = done;
    return done;
}

/** The labyrinth the player is currently working on, or null when there is none (no SF15/BN15).
 * @param {NS} ns */
export function currentLab(ns, state) {
    const done = state.labs?.completed ?? [];
    const seen = observedLab(state);
    const lab = seen ? LABS.find(row => row.host === seen) : LABS[Math.min(done.length, LABS.length - 1)];
    if (!lab) return null;
    const details = ns.dnet.getServerDetails(lab.host);
    if (!details || !details.isOnline) return null;
    // Labyrinths are created with depth -1 and only get a real depth once they are wired in.
    const depth = Number(details.depth) > 0 ? Number(details.depth) : lab.depth;
    return { host: lab.host, cha: lab.cha, depth };
}

/** Labyrinth mode: pin the chain next to the lab and push migrations across the air gaps.
 * @param {NS} ns */
export function planLabyrinth(ns, state, options, charisma = 0) {
    const plan = basePlan(ns, state, options, charisma);
    plan.mode = "labyrinth";
    const lab = currentLab(ns, state);
    plan.lab = lab;
    if (!lab) {
        plan.charismaGoal = planCharismaGoal(state, charisma, null);
        return plan;
    }

    const liveNow = Date.now();
    const online = Object.entries(state.servers).filter(([name, entry]) => isLive(entry, liveNow) && !isLabHost(name));
    const adjacent = online
        .filter(([, entry]) => (entry.neighbours ?? []).includes(lab.host))
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    const deepest = online
        .slice()
        .sort((a, b) => (Number(b[1].depth) || 0) - (Number(a[1].depth) || 0))
        .map(([name]) => name);
    plan.stasisTargets = assignStasis(ns, adjacent.length ? adjacent : deepest);

    const reachable = commandable(state);
    for (const row of AIR_GAP_ROWS) {
        if (row >= lab.depth) continue;
        if (online.some(([, entry]) => (Number(entry.depth) || 0) > row)) continue;   // gap already crossed
        for (const [name, entry] of online) {
            if ((Number(entry.depth) || 0) !== row - 1) continue;
            const chargers = (entry.neighbours ?? []).filter(charger => reachable.includes(charger));
            if (chargers.length) plan.migrationTargets[name] = chargers;
        }
    }
    // Crack priority (depth desc, then difficulty desc) is deliberately not expressed: the agent
    // ignores priority and RAM is not yet scarce enough for the controller to withhold claims. YAGNI.

    plan.charismaGoal = planCharismaGoal(state, charisma, lab);
    return plan;
}

/** Resolve the effective mode; `balanced` flips to labyrinth once the lab is in reach.
 * @param {NS} ns */
export function chooseMode(ns, state, options, charisma = 0) {
    const wanted = String(options.mode ?? "balanced");
    if (wanted === "loot" || wanted === "labyrinth") return wanted;
    const lab = currentLab(ns, state);
    if (!lab) return "loot";
    // This reset's labyrinth is already solved: the reward augmentation is queued and the next
    // lab only appears once it is installed, so there is nothing left to walk toward.
    if (state.labs.rewardQueuedAt) return "loot";
    if (charisma < lab.cha) return "loot";
    if (frontierDepth(state) >= lab.depth - LAB_DEPTH_SLACK) return "labyrinth";
    // "a migration toward it is charging": a recently charged server sitting just above an air
    // gap that still separates us from the lab. Island migrations in loot mode do not qualify.
    const now = Date.now();
    const charging = Object.entries(state.servers).some(([name, entry]) => entry.online && !isLabHost(name)
        && (Number(entry.migrationCharge) || 0) > 0
        && now - (Number(entry.migrationChargeAt) || 0) < MIGRATION_CHARGE_TTL
        && AIR_GAP_ROWS.some(row => row < lab.depth && (Number(entry.depth) || 0) === row - 1));
    return charging ? "labyrinth" : "loot";
}

/** The one server allowed to unleash a webstorm this loop, or null. */
function planStorm(state, options, plan) {
    if (!options["allow-webstorm"] || plan.mode !== "loot") return null;
    const now = Date.now();
    const discovered = Number(state.plan.lastDiscoveryAt) || 0;
    if (discovered === 0 || now - discovered < STALE_FRONTIER) return null;
    const lastStorm = Number(state.plan.lastStormAt) || 0;
    if (lastStorm && now - lastStorm < STORM_COOLDOWN) return null;
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!entry.online || isLabHost(name)) continue;
        if ((entry.exes ?? []).some(file => String(file).toUpperCase().includes("STORM_SEED"))) return name;
    }
    return null;
}

// ---------------------------------------------------------------- commands and file push

/** The complete command object for one host. Every field of `parseCmd`'s schema is present,
 * because `parseCmd` merges shallowly: a missing field would silently keep the agent default. */
export function buildCmd(state, plan, host) {
    const now = Date.now();
    const claimed = [];
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!entry.crackClaimBy || entry.crackClaimBy === host) continue;
        if (now - (Number(entry.crackClaimAt) || 0) > CLAIM_LIFETIME) continue;
        claimed.push(name);
    }
    let migrateTarget = null;
    for (const [name, chargers] of Object.entries(plan.migrationTargets ?? {})) {
        if (chargers.includes(host)) { migrateTarget = name; break; }
    }
    return {
        mode: plan.mode,
        claimed,
        threads: {
            crack: plan.crackThreads,
            realloc: plan.reallocThreads,
            phish: plan.shareActive ? 0 : 1,
            migrate: migrateTarget ? MIGRATE_THREADS : 0,
            promote: plan.promoteSymbols.length ? PROMOTE_THREADS : 0,
        },
        migrateTarget,
        promoteSymbols: plan.promoteSymbols,
        stasis: plan.stasisTargets.includes(host),
        "share": plan.shareActive,
        storm: plan.stormHost === host,
        stop: false,
    };
}

function agentPayload(ns) {
    // ns.scp throws on a missing source file, so never hand it a path home does not have.
    return AGENT_FILES.filter(file => ns.fileExists(file, "home"));
}

/** Make sure `darkweb` (home's only darknet neighbour) is running an agent.
 * @param {NS} ns */
export function bootstrap(ns, state, plan, options) {
    if (ns.isRunning("darknet/agent.js", "darkweb", "--port", options.port)) return false;
    const files = agentPayload(ns);
    if (!files.includes("darknet/agent.js")) {
        log(ns, "ERROR: darknet/agent.js is missing from home; cannot bootstrap.", true, "error");
        return false;
    }
    ns.scp(files, "darkweb", "home");
    // pushFiles writes passwords.txt, but on the very first loop it has not run yet and
    // ns.scp throws on a missing source file.
    if (!ns.fileExists(FILES.passwords, "home")) ns.write(FILES.passwords, "{}", "w");
    ns.write(FILES.cmd, JSON.stringify(buildCmd(state, plan, "darkweb")), "w");
    ns.scp([FILES.passwords, FILES.cmd], "darkweb", "home");
    const started = ns.exec("darknet/agent.js", "darkweb", { threads: 1, preventDuplicates: true }, "--port", options.port);
    if (started) {
        upsertServer(state, "darkweb", { online: true }, Date.now()).agentPid = started;
        log(ns, `SUCCESS: darknet bootstrapped an agent on darkweb (pid ${started}).`, false, "success");
    } else {
        log(ns, "WARN: darknet could not exec the agent on darkweb.");
    }
    return !!started;
}

/** Push `passwords.txt` and a per-host `cmd.txt` to every online cracked server.
 * @param {NS} ns */
export function pushFiles(ns, state, plan) {
    const live = {};
    for (const [name, entry] of Object.entries(state.passwords)) {
        if (!entry || entry.stale || entry.password === undefined) continue;
        live[name] = entry.password;
    }
    ns.write(FILES.passwords, JSON.stringify(live), "w");

    let delivered = 0;
    const seen = new Set();
    for (const host of ["darkweb", ...Object.keys(state.servers)]) {
        if (seen.has(host) || isLabHost(host)) continue;   // never connectToSession a labyrinth
        seen.add(host);
        if (host !== "darkweb") {
            // darkweb is directly connected to home and needs no session.
            const entry = state.servers[host];
            if (!entry || !entry.online) continue;
            const secret = live[host];
            if (secret === undefined) continue;
            const session = ns.dnet.connectToSession(host, secret);
            if (!session.success) {
                // 401: the password no longer works (the server was replaced). 503: the server
                // is gone entirely -- nothing else ever tells us that, since a deleted host
                // simply stops appearing in its neighbours' probes.
                if (session.code === 401 && state.passwords[host]) state.passwords[host].stale = true;
                if (session.code === 503) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
            entry.lastSeen = Date.now();   // a live session is proof the host still exists
        }
        ns.write(FILES.cmd, JSON.stringify(buildCmd(state, plan, host)), "w");
        if (ns.scp([FILES.passwords, FILES.cmd], host, "home")) delivered++;
    }
    return delivered;
}

// ---------------------------------------------------------------- labyrinth walkers

/** @param {NS} ns */
function freeRam(ns, host) {
    // A darknet server folds its blocked RAM into ramUsed (NetscriptWorker.ts), so this is
    // the RAM ns.exec can actually use, blocked RAM already deducted.
    return ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
}

/** Keep up to `--lab-walkers` copies of darknet/lab.js running on servers that neighbour the
 * current labyrinth, and prune the roster of the ones that have stopped.
 *
 * Only servers directly connected to the lab qualify: labreport/labradar/authenticate all
 * require it. One walker per host, because `preventDuplicates` plus identical exec args means
 * a second one on the same host could never start anyway -- which is also what makes
 * `ns.isRunning` with those same args an exact aliveness test.
 *
 * A candidate must also be somewhere the controller can ns.exec at all. ns.exec on a darknet
 * server demands a direct connection *from home* (NetscriptFunctions.ts), which only darkweb
 * has -- unless the target is backdoored, and setStasisLink sets backdoorInstalled. So the
 * candidates are the stasis-linked lab neighbours, which is exactly what planLabyrinth pins:
 * the first loops in labyrinth mode hand out the links, and walkers follow once they exist.
 * (ns.scp needs no direct connection, only a session, which is why pushFiles reaches everyone.)
 *
 * The lab itself is never given a session here: connectToSession on a labyrinth corrupts the
 * walker's tracked position (see darknet/lab.js). Sessions are only opened on the *neighbour*
 * the walker runs on, exactly as pushFiles does.
 *
 * @param {NS} ns
 * @returns {number} walkers started this loop */
export function launchWalkers(ns, state, plan, options) {
    const lab = plan.lab;
    if (!lab) return 0;
    const port = options.port;

    // Prune first: a walker that exited (won, gave up, or died with its server) may never
    // have managed a final report, so the script itself is the only trustworthy signal.
    const alive = (state.labs.walkers ?? []).filter(walker => walker.lab === lab.host
        && typeof walker.host === "string"
        && ns.isRunning("darknet/lab.js", walker.host, lab.host, "--port", port));
    state.labs.walkers = alive;

    // One win per reset: the reward augmentation has to be installed before the next lab
    // appears, and installing it wipes this state anyway.
    if (state.labs.rewardQueuedAt) return 0;
    if (state.labs.completed.includes(lab.host)) return 0;

    const wanted = Math.max(0, Math.floor(Number(options["lab-walkers"]) || 0));
    if (alive.length >= wanted) return 0;
    const threads = Math.max(1, Math.floor(Number(options["lab-threads"]) || 1));
    const needed = threads * WORKER_RAM.lab;

    const files = agentPayload(ns);
    if (!files.includes("darknet/lab.js")) {
        log(ns, "ERROR: darknet/lab.js is missing from home; cannot walk the labyrinth.", true, "error");
        return 0;
    }
    const busy = new Set(alive.map(walker => walker.host));
    const reachable = commandable(state);
    const executable = new Set([...ns.dnet.getStasisLinkedServers(), "darkweb"]);
    const now = Date.now();
    const adjacent = Object.entries(state.servers)
        .filter(([name, entry]) => isLive(entry, now) && !isLabHost(name) && !busy.has(name)
            && reachable.includes(name) && (entry.neighbours ?? []).includes(lab.host))
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    const candidates = adjacent.filter(name => executable.has(name));
    if (adjacent.length && !candidates.length) {
        log(ns, `INFO: ${adjacent.length} server(s) neighbour ${lab.host} but none is stasis-linked yet, so ns.exec cannot reach them.`);
    }

    const running = alive.length;
    let started = 0;
    for (const host of candidates) {
        if (running + started >= wanted) break;
        if (freeRam(ns, host) < needed) continue;
        if (ns.isRunning("darknet/lab.js", host, lab.host, "--port", port)) continue;
        const entry = state.servers[host];
        const session = ns.dnet.connectToSession(host, state.passwords[host].password);
        if (!session.success) {
            if (session.code === 401 && state.passwords[host]) state.passwords[host].stale = true;
            if (session.code === 503) { entry.online = false; entry.lastSeen = Date.now(); }
            continue;
        }
        entry.lastSeen = Date.now();
        ns.scp(files, host, "home");
        const pid = ns.exec("darknet/lab.js", host, { threads, preventDuplicates: true }, lab.host, "--port", port);
        if (!pid) {
            log(ns, `WARN: darknet could not start a labyrinth walker on ${host}.`);
            continue;
        }
        state.labs.walkers.push({ host, pid, lab: lab.host, startedAt: Date.now(), steps: 0 });
        started++;
        log(ns, `SUCCESS: darknet sent a walker into ${lab.host} from ${host} (pid ${pid}, ${threads} threads).`, false, "success");
    }
    return started;
}

// ---------------------------------------------------------------- status and shutdown

/** @param {NS} ns */
export function printStatus(ns, state) {
    const names = Object.keys(state.servers);
    const online = names.filter(name => state.servers[name].online);
    const cracked = Object.keys(state.passwords).filter(name => !state.passwords[name].stale);
    const histogram = {};
    for (const name of online) {
        const depth = Number(state.servers[name].depth) || 0;
        histogram[depth] = (histogram[depth] ?? 0) + 1;
    }
    const perModel = {};
    for (const name of cracked) {
        const model = state.passwords[name].modelId || "unknown";
        perModel[model] = (perModel[model] ?? 0) + 1;
    }
    const lab = currentLab(ns, state);
    const linked = ns.dnet.getStasisLinkedServers();
    const lines = [
        "=== darknet status ===",
        `mode: ${state.mode}  |  known ${names.length}  online ${online.length}  cracked ${cracked.length}`,
        `depth histogram: ${Object.keys(histogram).sort((a, b) => a - b).map(depth => `${depth}:${histogram[depth]}`).join(" ") || "(none)"}`,
        `passwords by model: ${Object.entries(perModel).sort((a, b) => b[1] - a[1]).map(([model, count]) => `${model}=${count}`).join(" ") || "(none)"}`,
        `cracks: ${Object.entries(state.stats.cracks).map(([model, row]) => `${model} ${row.won}/${row.won + row.failed} (${row.attempts} tries)`).join(", ") || "(none)"}`,
        `RAM freed: ${formatRam(state.stats.ramFreed, true)}  |  caches: ${state.stats.cachesOpened} worth ${formatMoney(state.stats.moneyFromCaches)}`,
        `phish successes: ${formatNumberShort(state.stats.phishSuccesses ?? 0, 6, 0)}  |  promote calls: ${formatNumberShort(state.stats.promoteCalls ?? 0, 6, 0)}`,
        `lab: ${lab ? `${lab.host} (depth ${lab.depth}, cha ${lab.cha})` : "none"}  |  completed ${state.labs.completed.length}  |  walkers ${state.labs.walkers.map(walker => `${walker.host}@${walker.steps ?? 0}`).join(", ") || "(none)"}`,
        `lab reward queued: ${state.labs.rewardQueuedAt ? new Date(state.labs.rewardQueuedAt).toLocaleTimeString() : "no"}  |  lab password: ${lab && state.passwords[lab.host] ? "known" : "unknown"}`,
        `stasis links: ${linked.join(", ") || "(none)"}  (planned: ${state.plan.stasisTargets.join(", ") || "none"})`,
        `migration targets: ${Object.entries(state.plan.migrationTargets ?? {}).map(([name, chargers]) => `${name}<-${chargers.length}`).join(" ") || "(none)"}`,
        `promote symbols: ${state.plan.promoteSymbols.join(", ") || "(none)"}  |  share active: ${state.plan.shareActive}`,
        `charisma goal: ${state.plan.charismaGoal || "(none)"}`,
    ];
    log(ns, lines.join("\n"), true);
}

/** `--kill`: push a stop flag everywhere, wait, then kill whatever is still running.
 * @param {NS} ns */
async function stopEverything(ns, state, options) {
    const stopCmd = {
        mode: "loot", claimed: [],
        threads: { crack: 0, realloc: 0, phish: 0, migrate: 0, promote: 0 },
        migrateTarget: null, promoteSymbols: [], stasis: false, "share": false, storm: false, stop: true,
    };
    ns.write(FILES.cmd, JSON.stringify(stopCmd), "w");
    const reached = [];
    const seen = new Set();
    for (const host of ["darkweb", ...Object.keys(state.servers)]) {
        if (seen.has(host) || isLabHost(host)) continue;
        seen.add(host);
        if (host !== "darkweb") {
            const entry = state.servers[host];
            const secret = state.passwords[host];
            if (!entry || !entry.online || !secret || secret.stale || secret.password === undefined) continue;
            const session = ns.dnet.connectToSession(host, secret.password);
            if (!session.success) {
                if (session.code === 503) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
        }
        if (ns.scp([FILES.cmd], host, "home")) reached.push(host);
    }
    log(ns, `INFO: darknet --kill pushed the stop flag to ${reached.length} servers; waiting ${KILL_GRACE / 1000}s.`, true);
    await ns.sleep(KILL_GRACE);

    let stopped = 0;
    for (const host of reached) {
        // By name and args, not by a stored pid: the agent may have been restarted (or the
        // server bounced) since we recorded it.
        if (ns.kill("darknet/agent.js", host, "--port", options.port)) stopped++;
    }
    log(ns, `SUCCESS: darknet --kill finished; ${stopped} agent(s) killed after the grace period.`, true, "success");
}
