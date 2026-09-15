import { log, getConfiguration, formatMoney, formatRam, formatNumberShort, parseShortNumber, getErrorInfo } from "./helpers.js";
import { AGENT_FILES, AIR_GAP_ROWS, FILES, LABS, PORT_DEFAULT, WORKER_RAM, decodeMsg, emptyState, isLabHost, safeParse } from "./darknet/lib.js";

/* The darknet controller. Runs on home, owns `darknet/state.txt`, drains the report port,
 * plans loot / labyrinth work and pushes `darknet/passwords.txt` + `darknet/cmd.txt` to every
 * online cracked server. Agents never plan; they only execute the pushed command file.
 *
 * Static RAM budget (target: under 8 GB):
 *   base 1.60 | getResetInfo 1.00 | getPlayer 0.50 | exec 1.30 | scp 0.60 | kill 0.50 | ps 0.20
 *   dnet.getServerDetails 0.10 | fileExists 0.10 | isRunning 0.10 | dnet.connectToSession 0.05
 *   getServerMaxRam 0.05 | getServerUsedRam 0.05
 *   dnet.getStasisLinkLimit 0 | dnet.getStasisLinkedServers 0 | read/write/readPort/print/tprint/
 *   toast/flags/getScriptName/disableLog/sleep/args 0                     => 6.15 GB
 *
 * NOTE: object keys that collide with an NS function name are written as quoted strings
 * (e.g. "share", which would otherwise cost 4 GB). Same convention as darknet/lib.js.
 */

const argsSchema = [
    ["mode", "balanced"],           // balanced | loot | labyrinth. Re-read every loop. A --mode given
                                     // on the command line pins the mode for the whole run; the config
                                     // file's "mode" entry can only switch it at runtime when --mode
                                     // was NOT passed on the command line (see printStatus's "source").
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
const KILL_GRACE = 6000;            // ms to let agents notice the stop flag before killing them
const MIGRATE_THREADS = 10;
const PROMOTE_THREADS = 4;          // threads buildCmd hands a qualifying host for promote.js
const MIN_PROMOTE_RAM = 64;         // buildCmd never hands out promote threads below this known maxRam
const MAX_PROMOTE_SYMBOLS = 3;
const LAB_DEPTH_SLACK = 6;          // balanced mode flips to labyrinth within this many rows of the lab
const MIGRATION_CHARGE_TTL = 600000; // a migration charge counts as "in flight" for 10 minutes
const SERVER_TTL = 300000;          // a known server nothing has confirmed for 5 minutes is presumed gone
const WALKER_TTL = 300000;          // a walker that has not reported for 5 minutes is presumed dead
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

    if (options.status) return printStatus(ns, state, options);
    if (options["kill"]) return await stopEverything(ns, state);

    // getConfiguration always logs its settings dump, so only call it again once
    // darknet.js.config.txt actually changes -- otherwise the log is flooded every loop.
    const confName = `${ns.getScriptName()}.config.txt`;
    let lastConfigText = ns.read(confName);

    log(ns, `INFO: darknet controller started on port ${options.port} (mode ${options.mode}).`, false, "info");
    while (true) {
        try {
            const configText = ns.read(confName);
            if (configText !== lastConfigText) {
                lastConfigText = configText;
                const reloaded = getConfiguration(ns, argsSchema);
                if (reloaded) options = reloaded;
            }

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
            state.plan.stasisRelease = plan.stasisRelease;
            state.plan.migrationTargets = plan.migrationTargets;
            state.plan.promoteSymbols = plan.promoteSymbols;
            state.plan.charismaGoal = plan.charismaGoal;
            state.plan.shareActive = plan.shareActive;

            state.labs.current = plan.lab ? plan.lab.host : null;
            // Before buildCmd: planning a walker only writes `walk`/`walkThreads` into the
            // chosen hosts' command files, and the lab-adjacent agent starts it from there.
            if (mode === "labyrinth") launchWalkers(ns, state, plan, options);

            bootstrap(ns, state, plan, options);
            pushFiles(ns, state, plan);
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

/** Read `state.txt`, falling back to `state.bak.txt`, then to `state.tmp.txt`, then to a fresh
 * state. `resetTime` is `ns.getResetInfo().lastAugReset`; a mismatch means a prestige wiped the
 * darknet.
 *
 * `state.tmp.txt` is the first of the three files `saveState` writes, so it is the newest copy
 * on disk and the only one that survives a crash between the tmp write and the live write. It
 * is read last because it is also the one most likely to be a partial write -- `safeParse` plus
 * the `version` check below is what rejects that case.
 * @param {NS} ns */
export function loadState(ns, resetTime) {
    for (const path of [FILES.state, FILES.stateBak, FILES.stateTmp]) {
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
    if (!merged.stats.sessionFailures || typeof merged.stats.sessionFailures !== "object") merged.stats.sessionFailures = {};
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
        neighbours: [], online: true, lastSeen: 0, stasis: false, isStationary: false,
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

export function applyMessage(state, msg) {
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
                maxRam: msg.maxRam, isStationary: details.isStationary,
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
            const reason = String(msg.reason ?? "");
            if (reason.includes("charisma") && msg.chaReq !== undefined) entry.chaReq = msg.chaReq;
            // Why the last attempt on this host ended, whatever kind of attempt it was. Without
            // it a host that never gets cracked gives the player nothing to go on.
            if (reason) entry.lastReason = reason;
            else if (msg.success) entry.lastReason = "solved";
            // A refused connectToSession says nothing about the model's solver, so it must not
            // pollute the per-model crack scoreboard (it would show every model as failing on
            // any host whose password went stale). It gets its own per-host counter instead.
            if (reason.startsWith("session:")) {
                state.stats.sessionFailures[host] = (Number(state.stats.sessionFailures[host]) || 0) + 1;
            } else {
                bumpCrackStats(state, msg.modelId ?? entry.modelId, !!msg.success, msg.attempts);
            }
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
            // One walker per host (preventDuplicates plus identical exec args), so a host is as
            // good a key as a pid -- and it also retires the entry a restarted walker replaces.
            const walkers = (state.labs.walkers ?? []).filter(row => row.pid !== msg.pid && row.host !== host);
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
        case "walker-launch": {
            // The agent on `host` started darknet/lab.js on itself. That is the first proof the
            // walker exists, so the roster (and therefore the --lab-walkers cap) starts here.
            upsertServer(state, host, {}, ts);
            if (msg.workerPid && msg.lab) {
                const walkers = (state.labs.walkers ?? []).filter(row => row.host !== host);
                walkers.push({ host, pid: msg.workerPid, lab: msg.lab, startedAt: ts, lastSeen: ts, steps: 0 });
                state.labs.walkers = walkers;
            }
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
export function planPromotions(ns, options) {
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

/** Keep existing stasis links where they are still wanted, then fill the remaining slots, and
 * record the links this plan gives up in `plan.stasisRelease`.
 *
 * The budget counts only the links we intend to KEEP. Every other link the game still holds is
 * one this plan releases -- `buildCmd` sends those hosts `stasis: false` and their agent runs
 * `stasis.js --unlink` (spec section 7) -- so reserving slots for them would permanently shrink
 * the plan down to whatever stale links happened to exist. */
export function assignStasis(ns, plan, candidates) {
    const limit = ns.dnet.getStasisLinkLimit();
    const linked = ns.dnet.getStasisLinkedServers().filter(name => !isLabHost(name));
    const kept = linked.filter(name => candidates.includes(name));
    const budget = Math.max(0, limit - kept.length);
    const rest = candidates.filter(name => !kept.includes(name));
    const targets = [...kept, ...rest.slice(0, budget)];
    plan.stasisRelease = linked.filter(name => !targets.includes(name));
    return targets;
}

function basePlan(ns, state, options, charisma) {
    return {
        mode: "loot",
        stasisTargets: [],
        stasisRelease: [],          // hosts holding a link this plan no longer wants (stasis: false)
        migrationTargets: {},
        promoteSymbols: planPromotions(ns, options),
        charismaGoal: 0,
        shareActive: String(ns.read(FILES.shareActive) ?? "").trim() === "true",
        crackThreads: Math.max(1, Math.floor(Number(options["crack-threads"]) || 1)),
        reallocThreads: Math.max(1, Math.floor(Number(options["realloc-threads"]) || 1)),
        stormHost: null,
        lab: null,
        walkLab: null,              // the labyrinth `walkHosts` should be sent into
        walkHosts: [],              // hosts whose command file asks their agent to start a walker
        walkThreads: 0,             // requested thread cap (--lab-threads), before any per-host clamp
        walkThreadsByHost: {},      // host -> threads that actually fit on that host's max RAM
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
    // darkweb (the stationary root) and lab hosts are never valid stasis targets, and neither is
    // any host the game itself reports as isStationary (fixed/story servers cannot be moved).
    const freed = Object.entries(state.servers)
        .filter(([name, entry]) => isLive(entry, liveNow) && !isLabHost(name) && name !== "darkweb"
            && entry.isStationary !== true && (Number(entry.blockedRam) || 0) === 0 && (Number(entry.maxRam) || 0) > 0)
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    plan.stasisTargets = assignStasis(ns, plan, freed);

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
    // Only commandable hosts: a stasis link is applied by stasis.js, which the host's agent only
    // starts because its command file said so, so pinning a host we cannot reach does nothing
    // except waste a slot in `assignStasis`'s budget.
    const reachable = commandable(state);
    // darkweb and any isStationary host are never valid stasis targets (see planLoot); lab hosts
    // are already excluded from `online` above.
    const adjacent = online
        .filter(([name, entry]) => name !== "darkweb" && entry.isStationary !== true
            && reachable.includes(name) && (entry.neighbours ?? []).includes(lab.host))
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    const deepest = online
        .filter(([name, entry]) => name !== "darkweb" && entry.isStationary !== true && reachable.includes(name))
        .sort((a, b) => (Number(b[1].depth) || 0) - (Number(a[1].depth) || 0))
        .map(([name]) => name);
    plan.stasisTargets = assignStasis(ns, plan, adjacent.length ? adjacent : deepest);

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
    const walking = (plan.walkHosts ?? []).includes(host);
    const hostMaxRam = Number(state.servers[host]?.maxRam) || 0;
    return {
        mode: plan.mode,
        claimed,
        threads: {
            crack: plan.crackThreads,
            realloc: plan.reallocThreads,
            // A walk host gives its spare RAM to the walker: phish/promote/share are told to
            // stop (and exit on their own -- see darknet/agent.js) so the walker can claim it.
            phish: walking ? 0 : (plan.shareActive ? 0 : 1),
            migrate: migrateTarget ? MIGRATE_THREADS : 0,
            promote: walking ? 0 : ((plan.promoteSymbols.length && hostMaxRam >= MIN_PROMOTE_RAM) ? PROMOTE_THREADS : 0),
        },
        migrateTarget,
        promoteSymbols: plan.promoteSymbols,
        // Two-way (spec section 7): true keeps/creates the link on a host the plan still wants,
        // false tells a host that holds a link the plan no longer wants to release it. The
        // agent only acts on a change, so a host that is neither linked nor wanted does nothing.
        stasis: plan.stasisTargets.includes(host),
        "share": walking ? false : plan.shareActive,
        storm: plan.stormHost === host,
        walk: walking ? plan.walkLab : null,
        walkThreads: walking ? (plan.walkThreadsByHost?.[host] ?? 0) : 0,
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

// Reasons already written to the log, so a condition that persists for hours does not write a
// line every loop. A key is forgotten again as soon as its condition clears, so the message
// comes back if it recurs. These never toast: none of them needs the player's attention.
const announced = new Set();

/** @param {NS} ns */
function announceOnce(ns, key, message) {
    if (announced.has(key)) return;
    announced.add(key);
    log(ns, message);
}

function forgetAnnouncement(key) {
    announced.delete(key);
}

/** @param {NS} ns */
function freeRam(ns, host) {
    // A darknet server folds its blocked RAM into ramUsed (NetscriptWorker.ts), so this is
    // the RAM ns.exec can actually use, blocked RAM already deducted.
    return ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
}

/** Plan this loop's labyrinth walkers.
 *
 * The walker has to run on a host directly connected to the lab (labreport, labradar and
 * authenticate all require it), and `ns.exec` also demands a direct connection *to its target*
 * -- which home only has to `darkweb`. So the controller does not start walkers: it names the
 * chosen hosts in `plan.walkHosts`, `buildCmd` turns that into `walk`/`walkThreads` in each
 * host's command file, and the agent already running there execs the walker on itself.
 * `darkweb` is the one exception, kept as a fallback for the case where its agent is not up yet.
 *
 * The lab itself is never given a session anywhere in this path: connectToSession on a
 * labyrinth corrupts the walker's tracked position (see darknet/lab.js).
 *
 * Aliveness comes from the walkers' own reports (a `walker-launch` from the agent, then a
 * progress report at least once a minute), so a walker silent for WALKER_TTL is presumed dead
 * and its slot is handed to another host.
 *
 * @param {NS} ns
 * @returns {string[]} the hosts asked to walk this loop */
export function launchWalkers(ns, state, plan, options) {
    const lab = plan.lab;
    if (!lab) return [];
    const port = options.port;
    const charisma = Number(plan.charisma) || 0;

    // Retire silent walkers first: a walker that won, gave up, or died with its server may
    // never have managed a final report.
    const now = Date.now();
    const alive = (state.labs.walkers ?? []).filter(walker => walker.lab === lab.host
        && typeof walker.host === "string"
        && now - (Number(walker.lastSeen ?? walker.startedAt) || 0) <= WALKER_TTL);
    state.labs.walkers = alive;

    // One win per reset: the reward augmentation has to be installed before the next lab
    // appears, and installing it wipes this state anyway.
    if (state.labs.rewardQueuedAt) return [];
    if (state.labs.completed.includes(lab.host)) return [];

    // The lab's own charisma gate. Below it every authenticate comes back as the gate message,
    // so a walker would burn network delays forever without taking a single step.
    if (charisma < lab.cha) {
        announceOnce(ns, `cha:${lab.host}`, `INFO: darknet is holding labyrinth walkers back: ${lab.host} needs ${lab.cha} charisma (have ${Math.floor(charisma)}).`);
        return [];
    }
    forgetAnnouncement(`cha:${lab.host}`);
    // A walker already hit the gate and reported the requirement. Believe it over LABS until
    // charisma has actually risen to meet what it reported. The game's own test is
    // `charisma < cha`, so equality is enough to pass and must clear the block.
    const blocked = state.labs.charismaBlocked;
    if (blocked && blocked.lab === lab.host) {
        const required = Number(blocked.chaReq) || lab.cha;
        if (charisma < required) {
            const when = new Date(Number(blocked.at) || Date.now()).toLocaleTimeString();
            announceOnce(ns, `blocked:${lab.host}`, `INFO: a walker reported at ${when} that ${lab.host} needs ${required} charisma (have ${Math.floor(charisma)}); not launching more.`);
            return [];
        }
        state.labs.charismaBlocked = null;
        forgetAnnouncement(`blocked:${lab.host}`);
    }

    const wanted = Math.max(0, Math.floor(Number(options["lab-walkers"]) || 0));
    plan.walkLab = lab.host;
    plan.walkThreads = Math.max(1, Math.floor(Number(options["lab-threads"]) || 1));
    plan.walkHosts = alive.map(walker => walker.host);
    // Max-RAM-based clamp, never the host's current free RAM: a walk host's spare-RAM workers
    // (phish/promote/share) are told to stop in buildCmd and take a loop or two to exit, so free
    // RAM right now understates what the host will actually have once they do.
    const threadsForHost = (host) => {
        const maxRam = Number(state.servers[host]?.maxRam) || 0;
        return Math.max(0, Math.min(plan.walkThreads, Math.floor((maxRam - WORKER_RAM.agent - 0.5) / WORKER_RAM.lab)));
    };
    for (const host of plan.walkHosts) plan.walkThreadsByHost[host] = threadsForHost(host);
    if (plan.walkHosts.length >= wanted) return plan.walkHosts;

    const busy = new Set(plan.walkHosts);
    const reachable = commandable(state);
    const candidates = Object.entries(state.servers)
        .filter(([name, entry]) => isLive(entry, now) && !isLabHost(name) && !busy.has(name)
            && reachable.includes(name) && (entry.neighbours ?? []).includes(lab.host))
        .map(([name, entry]) => ({ name, maxRam: Number(entry.maxRam) || 0, walkThreads: threadsForHost(name) }))
        .sort((a, b) => b.maxRam - a.maxRam);

    for (const cand of candidates) {
        if (plan.walkHosts.length >= wanted) break;
        const host = cand.name;
        if (cand.walkThreads < 1) {
            announceOnce(ns, `ram:${host}`, `INFO: ${host} neighbours ${lab.host} but has only ${formatRam(cand.maxRam, true)} max RAM, too small to host even 1 walker thread (needs agent ${formatRam(WORKER_RAM.agent, true)} + ${formatRam(WORKER_RAM.lab, true)} per thread).`);
            continue;
        }
        forgetAnnouncement(`ram:${host}`);
        plan.walkHosts.push(host);
        plan.walkThreadsByHost[host] = cand.walkThreads;
        // darkweb is home's only direct darknet connection, so it is the one host the
        // controller can start a walker on itself -- useful before its agent comes up.
        if (host === "darkweb" && !ns.isRunning("darknet/lab.js", host, lab.host, "--port", port)) {
            const files = agentPayload(ns);
            if (files.includes("darknet/lab.js")) {
                ns.scp(files, host, "home");
                // Clamp further by the host's actual free RAM right now: darkweb's own agent may
                // not be up yet to evict spare-RAM workers on its behalf (see buildCmd), so the
                // max-RAM-based thread count can outrun what is free at this exact instant.
                const threads = Math.min(cand.walkThreads, Math.floor(freeRam(ns, host) / WORKER_RAM.lab));
                if (threads >= 1) {
                    const pid = ns.exec("darknet/lab.js", host, { threads, preventDuplicates: true }, lab.host, "--port", port);
                    if (pid) {
                        state.labs.walkers.push({ host, pid, lab: lab.host, startedAt: Date.now(), lastSeen: Date.now(), steps: 0 });
                        log(ns, `SUCCESS: darknet sent a walker into ${lab.host} from darkweb (pid ${pid}, ${threads} threads).`, false, "success");
                    }
                }
            }
        }
    }
    return plan.walkHosts;
}

// ---------------------------------------------------------------- status and shutdown

/** Why `options.mode` currently has the value it does. A `--mode` on the command line always
 * wins over the config file (see the argsSchema comment); absent that, a `mode` entry in
 * `darknet.js.config.txt` is what drives it; absent both, it is just the schema default.
 * @param {NS} ns */
function modeSource(ns) {
    if (ns.args.includes("--mode")) return "cli";
    const confName = `${ns.getScriptName()}.config.txt`;
    let parsed = safeParse(ns.read(confName), null);
    if (Array.isArray(parsed)) parsed = Object.fromEntries(parsed);
    if (parsed && typeof parsed === "object" && "mode" in parsed) return "config";
    return "default";
}

/** @param {NS} ns */
export function printStatus(ns, state, options) {
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
        `mode: ${state.mode} (requested: ${options.mode}, source: ${modeSource(ns)})  |  known ${names.length}  online ${online.length}  cracked ${cracked.length}`,
        `depth histogram: ${Object.keys(histogram).sort((a, b) => a - b).map(depth => `${depth}:${histogram[depth]}`).join(" ") || "(none)"}`,
        `passwords by model: ${Object.entries(perModel).sort((a, b) => b[1] - a[1]).map(([model, count]) => `${model}=${count}`).join(" ") || "(none)"}`,
        `cracks: ${Object.entries(state.stats.cracks).map(([model, row]) => `${model} ${row.won}/${row.won + row.failed} (${row.attempts} tries)`).join(", ") || "(none)"}`,
        `RAM freed: ${formatRam(state.stats.ramFreed, true)}  |  caches: ${state.stats.cachesOpened} worth ${formatMoney(state.stats.moneyFromCaches)}`,
        `phish successes: ${formatNumberShort(state.stats.phishSuccesses ?? 0, 6, 0)}  |  promote calls: ${formatNumberShort(state.stats.promoteCalls ?? 0, 6, 0)}`,
        `lab: ${lab ? `${lab.host} (depth ${lab.depth}, cha ${lab.cha})` : "none"}  |  completed ${state.labs.completed.length}  |  walkers ${state.labs.walkers.map(walker => `${walker.host}@${walker.steps ?? 0}`).join(", ") || "(none)"}`,
        `lab reward queued: ${state.labs.rewardQueuedAt ? new Date(state.labs.rewardQueuedAt).toLocaleTimeString() : "no"}  |  lab password: ${lab && state.passwords[lab.host] ? "known" : "unknown"}  |  charisma gate: ${state.labs.charismaBlocked ? `${state.labs.charismaBlocked.chaReq ?? "?"} reported` : "clear"}`,
        `stasis links: ${linked.join(", ") || "(none)"}  (planned: ${state.plan.stasisTargets.join(", ") || "none"}, releasing: ${(state.plan.stasisRelease ?? []).join(", ") || "none"})`,
        `session failures: ${Object.entries(state.stats.sessionFailures ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${name}x${count}`).join(" ") || "(none)"}`,
        `last failures: ${names.filter(name => state.servers[name].lastReason).slice(0, 5).map(name => `${name}:${state.servers[name].lastReason}`).join("  ") || "(none)"}`,
        `migration targets: ${Object.entries(state.plan.migrationTargets ?? {}).map(([name, chargers]) => `${name}<-${chargers.length}`).join(" ") || "(none)"}`,
        `promote symbols: ${state.plan.promoteSymbols.join(", ") || "(none)"}  |  share active: ${state.plan.shareActive}`,
        `charisma goal: ${state.plan.charismaGoal || "(none)"}`,
    ];
    log(ns, lines.join("\n"), true);
}

/** `--kill`: stop every other darknet.js controller on home first (a live controller would
 * otherwise re-bootstrap and re-spread agents right behind this sweep), push a stop flag
 * everywhere so agents get a chance to exit cleanly, wait, then kill whatever is still running
 * by pid. The final sweep does not use `ns.isRunning` by name: workers carry varying args (a
 * migrate/crack/walk target, thread counts, ...), so a name match cannot find them all.
 * @param {NS} ns */
async function stopEverything(ns, state) {
    // 1. Kill every OTHER darknet.js controller on home before anything else -- otherwise a
    // still-running controller re-bootstraps darkweb and re-pushes command files behind us.
    let controllersKilled = 0;
    for (const proc of ns.ps("home")) {
        if (proc.filename !== "darknet.js" || proc.pid === ns.pid) continue;
        if (ns.kill(proc.pid)) controllersKilled++;
    }
    log(ns, `INFO: darknet --kill stopped ${controllersKilled} other darknet.js controller(s) on home.`, true);

    // 2. Push the stop flag to every reachable known server, same as before, and give agents a
    // few seconds to notice it and exit on their own.
    const stopCmd = {
        mode: "loot", claimed: [],
        threads: { crack: 0, realloc: 0, phish: 0, migrate: 0, promote: 0 },
        migrateTarget: null, promoteSymbols: [], stasis: false, "share": false, storm: false,
        walk: null, walkThreads: 0, stop: true,
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

    // 3. Sweep darkweb, every known online server, and every lab host (a walker or its agent may
    // be running there even though labs are excluded from `state.servers`) and kill anything the
    // agent payload could have started. `ns.ps` throws or returns [] for an offline host.
    const sweepHosts = new Set(["darkweb"]);
    for (const [name, entry] of Object.entries(state.servers)) {
        if (entry && entry.online) sweepHosts.add(name);
    }
    for (const lab of LABS) sweepHosts.add(lab.host);

    let stopped = 0;
    let hostsWithKills = 0;
    for (const host of sweepHosts) {
        let procs;
        try {
            procs = ns.ps(host);
        } catch {
            continue;
        }
        if (!Array.isArray(procs) || procs.length === 0) continue;
        let hostStopped = 0;
        for (const proc of procs) {
            if (!(proc.filename.startsWith("darknet/") || proc.filename === "Remote/share.js")) continue;
            if (ns.kill(proc.pid)) hostStopped++;
        }
        if (hostStopped > 0) {
            stopped += hostStopped;
            hostsWithKills++;
            log(ns, `INFO: darknet --kill killed ${hostStopped} process(es) on ${host}.`);
        }
    }
    log(ns, `SUCCESS: darknet --kill finished; stopped ${stopped} processes on ${hostsWithKills} hosts.`, true, "success");
}
