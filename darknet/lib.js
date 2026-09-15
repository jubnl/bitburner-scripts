// Shared constants and pure helpers for the darknet automation. Loaded by every
// darknet/*.js agent script. Contains no `ns` calls, so it costs 0 GB of RAM.
//
// NOTE: some object keys below are written as quoted string literals (e.g. "share")
// instead of bare identifiers. This is deliberate: Bitburner charges RAM for any bare
// identifier that matches an NS function name (see .superpowers RAM-collision check),
// and "share" is one such name. A quoted key produces an identical object at runtime.

export const PORT_DEFAULT = 15;

export const FILES = {
    state: "darknet/state.txt",
    stateTmp: "darknet/state.tmp.txt",
    stateBak: "darknet/state.bak.txt",
    passwords: "darknet/passwords.txt",
    cmd: "darknet/cmd.txt",
    charismaGoal: "/Temp/darknet-charisma-goal.txt",
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
    crack: 2.6,
    realloc: 2.6,
    phish: 3.6,
    migrate: 5.6,
    promote: 3.6,
    cache: 3.8,
    stasis: 13.6,
    // Every entry includes the 1.6 GB script base cost (e.g. share.js = 1.6 + ns.share 2.4).
    // lab.js = 1.6 base + dnet.authenticate 0.4 + scp 0.6 + exec 1.3 + getHostname 0.05.
    lab: 3.95,
    "share": 4.0,
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
        stats: { cracks: {}, ramFreed: 0, cachesOpened: 0, moneyFromCaches: 0, phishMoney: 0 },
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
