// Shared constants and pure helpers for the darknet automation. Loaded by every
// darknet/*.js agent script. Contains no `ns` calls, so it costs 0 GB of RAM.
//
// NOTE: some object keys below are written as quoted string literals (e.g. "share")
// instead of bare identifiers. This is deliberate: Bitburner charges RAM for any bare
// identifier that matches an NS function name (see .superpowers RAM-collision check),
// and "share" is one such name. A quoted key produces an identical object at runtime.

export const PORT_DEFAULT = 15;

// Darknet hostnames are lore strings and may begin with "-" or "--" (e.g. the reversed
// `--;SREVRES-ELBAT-PORD;)`), which ns.flags / getConfiguration would parse as an option and
// throw ArgError. Every hostname handed to a worker as a positional argument goes through
// hostArg, and the worker reads it back with hostFromArg. Both sides of an exec/isRunning pair
// must use the same wrapped form so isRunning keeps matching.
const HOST_ARG_PREFIX = "host:";
export function hostArg(host) { return HOST_ARG_PREFIX + String(host); }
export function hostFromArg(arg) {
    if (arg === undefined || arg === null) return "";
    const s = String(arg);
    return s.startsWith(HOST_ARG_PREFIX) ? s.slice(HOST_ARG_PREFIX.length) : s;
}

export const FILES = {
    state: "darknet/state.txt",
    stateTmp: "darknet/state.tmp.txt",
    stateBak: "darknet/state.bak.txt",
    passwords: "darknet/passwords.txt",
    cmd: "darknet/cmd.txt",
    // Written by the agent on its own server: "1" while this host holds a stasis link, "0"
    // once it has released one. A content marker, not an existence marker, because the
    // controller can command both directions (see darknet/agent.js).
    stasisMark: "darknet/stasis-done.txt",
    charismaGoal: "/Temp/darknet-charisma-goal.txt",
    // Written by the agent on its own server: "1" asks a running phish.js to exit so the agent
    // can re-size it next tick (see fillerPlan), "0" once a fresh one has been launched.
    phishResize: "darknet/phish-resize.txt",
    shareActive: "/Temp/share-active.txt",
};

export const AGENT_FILES = [
    "darknet/agent.js",
    "darknet/lib.js",
    "darknet/solvers.js",
    "darknet/crack.js",
    "darknet/cache.js",
    "darknet/realloc.js",
    "darknet/phish.js",
    "darknet/migrate.js",
    "darknet/promote.js",
    "darknet/stasis.js",
    "darknet/lab.js",
    "Remote/share.js",
    "helpers.js",
];

export const WORKER_RAM = {
    crack: 2.95,
    realloc: 2.65,
    phish: 3.65,
    migrate: 5.65,
    promote: 3.65,
    cache: 3.85,
    stasis: 13.65,
    // Every entry includes the 1.6 GB script base cost (e.g. share.js = 1.6 + ns.share 2.4).
    // lab.js = 1.6 base + dnet.authenticate 0.4 + scp 0.6 + exec 1.3 + getHostname 0.05.
    lab: 3.95,
    "share": 4.0,
    // darknet/agent.js's own footprint (base 1.6 + exec 1.3 + scp 0.6 + dnet.probe 0.2 + ls 0.2 +
    // dnet.getServerDetails 0.1 + isRunning 0.1 + fileExists 0.1 + dnet.unleashStormSeed 0.1 +
    // getServerMaxRam 0.05 + getServerUsedRam 0.05 + dnet.connectToSession 0.05 + getHostname
    // 0.05 = 4.50). Used by the controller to size labyrinth walkers so agent + walker(s) both
    // fit on the host's known max RAM.
    agent: 4.5,
};

export const LABS = [
    { host: "th3_l4byr1nth", depth: 7, cha: 300 },
    { host: "cru3l_l4byr1nth", depth: 12, cha: 600 },
    { host: "m3rc1l3ss_l4byr1nth", depth: 19, cha: 1500 },
    { host: "ub3r_l4byr1nth", depth: 23, cha: 2500 },
    { host: "et3rn4l_l4byr1nth", depth: 29, cha: 3000 },
    { host: "end13ss_l4byr1nth", depth: 31, cha: 3500 },
    { host: "f1n4l_l4byr1nth", depth: 36, cha: 4000 },
    { host: "b0nus_l4byr1nth", depth: 36, cha: 4000 },
];

export const AIR_GAP_ROWS = [8, 16, 24, 32];

export function isLabHost(host) {
    return host.endsWith("_l4byr1nth");
}

// The envelope always wins: `type`, `from`, `pid` and `ts` are spread last so a payload key
// can never shadow them. Worker subtypes therefore travel as `kind`, never as `type`, and a
// spawned worker's pid travels as `workerPid` (`pid` is always the sender's).
export function encodeMsg(type, from, pid, payload) {
    return JSON.stringify({ ...payload, type, from, pid, ts: Date.now() });
}

export function decodeMsg(line) {
    try {
        const obj = JSON.parse(line);
        if (obj !== null && typeof obj === "object") {
            return obj;
        }
        return null;
    } catch {
        return null;
    }
}

export function safeParse(text, fallback) {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

export function emptyState(resetTime) {
    return {
        version: 1, resetTime, mode: "balanced", passwords: {}, servers: {},
        labs: { current: null, walkers: [], rewardQueuedAt: null, completed: [] },
        plan: { stasisTargets: [], migrationTargets: {}, promoteSymbols: [], charismaGoal: 0, shareActive: false },
        // `cracks` counts real crack.js outcomes per model; `sessionFailures` counts
        // connectToSession refusals per host, which say nothing about a model's solver.
        stats: { cracks: {}, sessionFailures: {}, ramFreed: 0, cachesOpened: 0, moneyFromCaches: 0 },
    };
}

export function parseCmd(text) {
    const parsed = safeParse(text, {});
    const base = {
        mode: "loot",
        claimed: [],
        threads: { crack: 6, realloc: 0, phish: 0, migrate: 0, promote: 0 },
        migrateTarget: null,
        promoteSymbols: [],
        stasis: false,
        "share": false,
        storm: false,
        // The labyrinth this host's agent should send a walker into (null = none) and how many
        // threads to give it. The controller picks the hosts; only the agent running on one can
        // ns.exec the walker, because exec needs a direct connection to its target.
        walk: null,
        walkThreads: 0,
        stop: false,
    };
    return { ...base, ...(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) };
}

export function parsePasswords(text) {
    const parsed = safeParse(text, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

// Regexes for the clue text found on cracked/scanned darknet servers.
const RE_SERVER_PASSWORD = /Server:\s*(\S+)\s+Password:\s*"([^"]*)"/g;
const RE_CONTAINS = /The password for (\S+) contains (\S+) and (\S+)/g;
const RE_REMEMBER = /Remember this password:\s*(\S+)/g;

export function parseClueText(text, knownHosts) {
    const known = new Set(knownHosts ?? []);
    const passwords = { unknown: [] };
    const contains = {};

    for (const m of text.matchAll(RE_SERVER_PASSWORD)) {
        const host = m[1];
        if (known.size === 0 || known.has(host)) {
            passwords[host] = m[2];
        }
    }

    for (const m of text.matchAll(RE_CONTAINS)) {
        const host = m[1];
        if (known.size === 0 || known.has(host)) {
            contains[host] = [...(contains[host] ?? []), m[2], m[3]];
        }
    }

    for (const m of text.matchAll(RE_REMEMBER)) {
        passwords.unknown.push(m[1]);
    }

    return { passwords, contains };
}

// A stasis link is applied by stasis.js running beside the agent on the host itself, so a host
// whose usable RAM (max minus the owner's blocked RAM) cannot hold both can never be linked;
// planning a link there only wastes one of the 1-4 slots forever.
export const STASIS_HOST_MIN_RAM = WORKER_RAM.agent + WORKER_RAM.stasis;
export function canHoldStasis(entry) {
    return (Number(entry?.maxRam) || 0) - (Number(entry?.blockedRam) || 0) >= STASIS_HOST_MIN_RAM;
}

/** Change key for the agent's report about its own host. `ns.dnet.probe()` shuffles its result
 * on every call (src/NetscriptFunctions/Darknet.ts `return shuffle(out)`), so the neighbour list
 * is sorted before it goes into the key; otherwise the key differs almost every loop and the
 * agent floods the report port with self-reports. */
export function selfReportKey(d, neighbours) {
    return JSON.stringify([d.isOnline, d.depth, d.difficulty, d.blockedRam, d.modelId, d.hasSession, [...neighbours].sort()]);
}

/** Sizing rule for a filler worker (phish.js) that takes all spare RAM and never resizes
 * itself. `free` is the host's free RAM right now (the running filler counted as used),
 * `reserve` the RAM higher-priority work needs next tick (pending cracks, walkers, caches,
 * stasis), `launched` the thread count the agent last exec'd (0 when unknown).
 * Returns the threads to launch when nothing runs, or whether the running filler must exit so
 * it can be re-launched at the right size: it yields when the reserved work no longer fits,
 * and steps aside when a whole extra thread would fit (RAM freed by a finished worker). */
export function fillerPlan({ free, reserve, unitRam, running, launched }) {
    const held = running ? (Number(launched) || 0) * unitRam : 0;
    const want = Math.max(0, Math.floor((free + held - reserve) / unitRam));
    if (!running) return { launch: want, resize: false };
    const starved = free < reserve;
    const canGrow = (Number(launched) || 0) > 0 && want > launched;
    return { launch: 0, resize: starved || canGrow };
}
