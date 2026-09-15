import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCmd, emptyState, encodeMsg, WORKER_RAM } from "../darknet/lib.js";
import {
    applyMessage, assignStasis, buildCmd, currentLab, drainPort, launchWalkers,
    loadState, planLabyrinth, planLoot, planPromotions, saveState,
} from "../darknet.js";

/* Node-only tests for darknet.js's planning and state machine.
 *
 * darknet.js has no top-level side effects (only constants and function definitions), so
 * importing it in Node never starts the controller loop; `main` is simply never called. The
 * fake `ns` below implements exactly the functions the tested code paths touch, with an
 * in-memory file map behind read/write and an in-memory queue behind readPort.
 */

const LAB = "th3_l4byr1nth";
const LAB_CHA = 300;

function makeNs(config = {}) {
    const files = new Map(Object.entries(config.files ?? {}));
    const ports = [...(config.port ?? [])];
    const ns = {
        args: config.args ?? [],
        pid: 1,
        execs: [],                  // test-visible log of every ns.exec
        scps: [],
        killed: [],
        read: (path) => files.get(path) ?? "",
        write: (path, data, mode) => { files.set(path, mode === "a" ? (files.get(path) ?? "") + data : String(data)); },
        fileExists: (path) => files.has(path),
        files,
        readPort: () => (ports.length ? ports.shift() : "NULL PORT DATA"),
        tryWritePort: (_port, data) => { ports.push(data); return true; },
        getPlayer: () => ({ skills: { charisma: config.charisma ?? 0 } }),
        getResetInfo: () => ({ lastAugReset: config.resetTime ?? 1000 }),
        isRunning: () => config.isRunning ?? false,
        exec: (script, host, opts, ...rest) => { ns.execs.push({ script, host, opts, args: rest }); return ns.execs.length + 100; },
        scp: (what, host) => { ns.scps.push({ what, host }); return true; },
        kill: (pid) => { ns.killed.push(pid); return true; },
        ps: () => [],
        getServerMaxRam: (host) => config.maxRam?.[host] ?? 0,
        getServerUsedRam: (host) => config.usedRam?.[host] ?? 0,
        sleep: async () => { },
        print: () => { },
        tprint: () => { },
        toast: () => { },
        disableLog: () => { },
        getScriptName: () => "darknet.js",
        flags: () => ({ _: [] }),
        dnet: {
            getStasisLinkLimit: () => config.stasisLimit ?? 1,
            getStasisLinkedServers: () => [...(config.stasisLinked ?? [])],
            getServerDetails: (host) => config.details?.[host] ?? { isOnline: true, depth: 0, difficulty: 0 },
            connectToSession: () => ({ success: true, code: 200 }),
        },
    };
    return ns;
}

/** A state with `hosts` (name -> {depth, maxRam, neighbours}) all online, cracked and fresh. */
function makeState(hosts) {
    const state = emptyState(1000);
    const now = Date.now();
    for (const [name, row] of Object.entries(hosts)) {
        state.servers[name] = {
            depth: row.depth ?? 1, difficulty: row.difficulty ?? 1, modelId: row.modelId ?? "TopPass",
            maxRam: row.maxRam ?? 32, blockedRam: row.blockedRam ?? 0, chaReq: row.chaReq ?? 0,
            neighbours: row.neighbours ?? [], neighboursAt: now, online: true, lastSeen: now,
            stasis: false, isStationary: row.isStationary ?? false,
        };
        if (row.cracked !== false) state.passwords[name] = { password: row.password ?? "pw", modelId: "TopPass", solvedAt: now };
    }
    return state;
}

const baseOptions = {
    mode: "balanced", port: 15, interval: 10000, "crack-threads": 6, "realloc-threads": 50,
    "lab-walkers": 3, "lab-threads": 6, "allow-webstorm": false, "no-promote": false,
};

// ------------------------------------------------------------------ buildCmd

test("buildCmd fills every field parseCmd defaults, for a normal host", () => {
    const ns = makeNs({});
    const state = makeState({ alpha: { depth: 1, maxRam: 128 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    const cmd = buildCmd(state, plan, "alpha");

    assert.deepEqual(Object.keys(cmd).sort(), Object.keys(parseCmd("")).sort(),
        "a missing field would silently keep the agent's parseCmd default instead of the plan's value");
    assert.equal(cmd.mode, "loot");
    assert.deepEqual(cmd.claimed, []);
    assert.equal(cmd.threads.crack, 6);
    assert.equal(cmd.threads.realloc, 50);
    assert.equal(cmd.threads.phish, 1, "a normal host phishes with its spare RAM");
    assert.equal(cmd.threads.migrate, 0);
    assert.equal(cmd.migrateTarget, null);
    assert.equal(cmd.walk, null);
    assert.equal(cmd.walkThreads, 0);
    assert.equal(cmd.stop, false);
    assert.equal(cmd.storm, false);
});

test("buildCmd zeroes phish, promote and share on a walk host", () => {
    const ns = makeNs({ files: { "/Temp/share-active.txt": "true" } });
    const state = makeState({ alpha: { depth: 6, maxRam: 128, neighbours: [LAB] } });
    const plan = planLoot(ns, state, baseOptions, 10);
    plan.promoteSymbols = ["ECP"];
    plan.walkHosts = ["alpha"];
    plan.walkLab = LAB;
    plan.walkThreadsByHost = { alpha: 4 };

    const walking = buildCmd(state, plan, "alpha");
    assert.deepEqual(Object.keys(walking).sort(), Object.keys(parseCmd("")).sort());
    assert.equal(walking.threads.phish, 0, "the walker gets the spare RAM, not phish");
    assert.equal(walking.threads.promote, 0);
    assert.equal(walking["share"], false);
    assert.equal(walking.walk, LAB);
    assert.equal(walking.walkThreads, 4);

    // ...and the same plan still lets a non-walk host share, so the zeroing is per host.
    state.servers.beta = { ...state.servers.alpha, neighbours: [] };
    state.passwords.beta = { password: "pw", modelId: "TopPass", solvedAt: Date.now() };
    const other = buildCmd(state, plan, "beta");
    assert.equal(other["share"], true);
    assert.equal(other.walk, null);
});

test("buildCmd only hands out promote threads above the RAM floor", () => {
    const ns = makeNs({});
    const state = makeState({ big: { maxRam: 128 }, small: { maxRam: 32 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    plan.promoteSymbols = ["ECP", "FSIG"];
    assert.equal(buildCmd(state, plan, "big").threads.promote, 4);
    assert.equal(buildCmd(state, plan, "small").threads.promote, 0);
});

// ------------------------------------------------------------------ planPromotions

test("planPromotions returns only held symbols, strongest forecast first, capped at 3", () => {
    const ns = makeNs({
        files: {
            "/Temp/stock-probabilities.txt": JSON.stringify({
                FLAT: { prob: 0.5, sharesLong: 100 },          // no edge at all
                NONE: { prob: 0.95, sharesLong: 0, sharesShort: 0 },  // not held
                UP: { prob: 0.62, sharesLong: 10 },
                DOWN: { prob: 0.25, sharesShort: 10 },         // |0.25-0.5| = 0.25, the strongest
                MILD: { prob: 0.55, sharesLong: 5 },
            }),
        },
    });
    assert.deepEqual(planPromotions(ns, baseOptions), ["DOWN", "UP", "MILD"]);
    assert.deepEqual(planPromotions(ns, { ...baseOptions, "no-promote": true }), []);
    assert.deepEqual(planPromotions(makeNs({}), baseOptions), [], "no stockmaster file: nothing to promote");
});

// ------------------------------------------------------------------ applyMessage

test("applyMessage: a server report updates details and stamps the neighbours", () => {
    const state = emptyState(1000);
    const ts = Date.now();
    applyMessage(state, {
        type: "server", from: "alpha", host: "alpha", pid: 7, ts, maxRam: 64,
        details: { isOnline: true, depth: 4, difficulty: 9, modelId: "TopPass", blockedRam: 12, requiredCharismaSkill: 50 },
        neighbours: ["beta"],
    });
    const alpha = state.servers.alpha;
    assert.equal(alpha.depth, 4);
    assert.equal(alpha.difficulty, 9);
    assert.equal(alpha.modelId, "TopPass");
    assert.equal(alpha.blockedRam, 12);
    assert.equal(alpha.chaReq, 50);
    assert.equal(alpha.maxRam, 64);
    assert.deepEqual(alpha.neighbours, ["beta"]);
    assert.equal(alpha.neighboursAt, ts);
    assert.ok(state.servers.beta, "a probed neighbour is known to exist even before anyone cracks it");

    applyMessage(state, { type: "server", from: "alpha", host: "alpha", pid: 7, ts: ts + 1, details: { isOnline: false } });
    assert.equal(state.servers.alpha.online, false);
});

test("applyMessage: a crack win stores the password and scores the model", () => {
    const state = emptyState(1000);
    applyMessage(state, {
        type: "crack", from: "alpha", host: "beta", pid: 7, ts: Date.now(),
        success: true, password: "hunter2", modelId: "TopPass", difficulty: 3, attempts: 11, reason: "solved",
    });
    assert.equal(state.passwords.beta.password, "hunter2");
    assert.deepEqual(state.stats.cracks.TopPass, { won: 1, failed: 0, attempts: 11 });
    assert.equal(state.servers.beta.lastReason, "solved");
    assert.deepEqual(state.stats.sessionFailures, {});
});

test("applyMessage: a session failure is counted apart from the model's crack record", () => {
    const state = emptyState(1000);
    const ts = Date.now();
    state.passwords.beta = { password: "stale", modelId: "TopPass", solvedAt: ts };
    applyMessage(state, { type: "crack", from: "alpha", host: "beta", pid: 7, ts, success: false, attempts: 0, reason: "session:401", stale: true });
    applyMessage(state, { type: "crack", from: "alpha", host: "beta", pid: 7, ts, success: false, attempts: 0, reason: "session:401", stale: true });

    assert.deepEqual(state.stats.cracks, {}, "a refused session says nothing about the model's solver");
    assert.equal(state.stats.sessionFailures.beta, 2);
    assert.equal(state.servers.beta.lastReason, "session:401");
    assert.equal(state.passwords.beta.stale, true);

    // A real solver failure still lands on the model's scoreboard, with its reason kept.
    applyMessage(state, { type: "crack", from: "alpha", host: "gamma", pid: 7, ts, success: false, attempts: 30, modelId: "DeepGreen", reason: "charisma", chaReq: 250 });
    assert.deepEqual(state.stats.cracks.DeepGreen, { won: 0, failed: 1, attempts: 30 });
    assert.equal(state.servers.gamma.lastReason, "charisma");
    assert.equal(state.servers.gamma.chaReq, 250);
});

test("applyMessage: worker reports (agent, crack claim, stasis)", () => {
    const state = emptyState(1000);
    const ts = Date.now();
    applyMessage(state, { type: "worker", kind: "agent", from: "alpha", host: "beta", pid: 7, ts, workerPid: 42 });
    assert.equal(state.servers.beta.agentPid, 42);
    assert.equal(state.servers.beta.online, true);

    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 7, ts });
    assert.equal(state.servers.gamma.crackClaimBy, "alpha");
    assert.equal(state.servers.gamma.crackClaimAt, ts);

    applyMessage(state, { type: "worker", kind: "stasis", from: "beta", host: "beta", pid: 8, ts, success: true, code: 200 });
    assert.equal(state.servers.beta.stasis, true);
    applyMessage(state, { type: "worker", kind: "stasis", from: "beta", host: "beta", pid: 8, ts, success: false, code: 400 });
    assert.equal(state.servers.beta.stasis, false, "a failed (or released) link must not stay recorded as linked");
});

test("applyMessage: a walker's win queues the reward and stores the lab password", () => {
    const state = emptyState(1000);
    const ts = Date.now();
    applyMessage(state, { type: "walker", from: "alpha", host: "alpha", pid: 9, ts, lab: LAB, steps: 25, done: false });
    assert.equal(state.labs.walkers.length, 1);
    assert.equal(state.labs.walkers[0].host, "alpha");
    assert.equal(state.labs.walkers[0].steps, 25);

    applyMessage(state, { type: "walker", from: "alpha", host: "alpha", pid: 9, ts: ts + 1, lab: LAB, steps: 40, done: true, password: "themaze" });
    assert.deepEqual(state.labs.walkers, [], "a finished walker leaves the roster");
    assert.equal(state.labs.rewardQueuedAt, ts + 1);
    assert.equal(state.passwords[LAB].password, "themaze");
});

test("drainPort applies encoded agent lines and stops at NULL PORT DATA", () => {
    const state = emptyState(1000);
    const ns = makeNs({
        port: [
            encodeMsg("server", "alpha", 7, { host: "alpha", details: { isOnline: true, depth: 2 }, neighbours: ["beta"] }),
            "not json at all",
            encodeMsg("crack", "alpha", 7, { host: "beta", success: true, password: "pw", modelId: "Laika4", attempts: 2 }),
        ],
    });
    assert.equal(drainPort(ns, 15, state), 2);
    assert.equal(state.servers.alpha.depth, 2);
    assert.equal(state.passwords.beta.password, "pw");
});

// ------------------------------------------------------------------ state files

test("loadState falls back to the backup, then to the tmp copy", () => {
    const good = JSON.stringify({ ...emptyState(1000), mode: "loot" });
    assert.equal(loadState(makeNs({ files: { "darknet/state.txt": good } }), 1000).mode, "loot");
    assert.equal(loadState(makeNs({ files: { "darknet/state.txt": "{tru", "darknet/state.bak.txt": good } }), 1000).mode, "loot");
    assert.equal(loadState(makeNs({ files: { "darknet/state.txt": "{tru", "darknet/state.tmp.txt": good } }), 1000).mode, "loot");
    // A state from a previous prestige is dropped, not repaired.
    assert.deepEqual(loadState(makeNs({ files: { "darknet/state.txt": good } }), 2000).passwords, {});

    const ns = makeNs({});
    const state = makeState({ alpha: {} });
    saveState(ns, state);
    assert.equal(loadState(ns, 1000).servers.alpha.maxRam, 32);
    assert.deepEqual(loadState(ns, 1000).stats.sessionFailures, {}, "an older state file gains the new counter");
});

// ------------------------------------------------------------------ stasis

test("assignStasis keeps wanted links, spends the whole limit, and lists the releases", () => {
    const ns = makeNs({ stasisLimit: 2, stasisLinked: ["stale"] });
    const plan = { stasisRelease: [] };
    // "stale" holds a link nothing wants any more: its slot must not be reserved for it, so
    // both candidates fit inside the limit of 2.
    assert.deepEqual(assignStasis(ns, plan, ["alpha", "beta"]), ["alpha", "beta"]);
    assert.deepEqual(plan.stasisRelease, ["stale"]);

    const keeping = makeNs({ stasisLimit: 2, stasisLinked: ["alpha"] });
    const plan2 = { stasisRelease: [] };
    assert.deepEqual(assignStasis(keeping, plan2, ["beta", "alpha", "gamma"]), ["alpha", "beta"]);
    assert.deepEqual(plan2.stasisRelease, []);
});

test("a host holding a link the plan dropped is commanded to release it", () => {
    const ns = makeNs({ stasisLimit: 1, stasisLinked: ["stale"] });
    const state = makeState({
        // `stale` still has blocked RAM, so the loot planner no longer wants it pinned.
        stale: { maxRam: 8, blockedRam: 40 },
        fat: { maxRam: 256 },
    });
    const plan = planLoot(ns, state, baseOptions, 10);

    assert.deepEqual(plan.stasisTargets, ["fat"], "the biggest freed server wins the only slot");
    assert.deepEqual(plan.stasisRelease, ["stale"]);
    assert.equal(buildCmd(state, plan, "fat").stasis, true);
    assert.equal(buildCmd(state, plan, "stale").stasis, false, "stasis:false is what makes the agent run stasis.js --unlink");
});

// ------------------------------------------------------------------ walkers

test("launchWalkers picks the lab-adjacent commandable host and sizes its walker", () => {
    const options = { ...baseOptions, "lab-walkers": 2, "lab-threads": 6 };
    const ns = makeNs({
        charisma: LAB_CHA,
        stasisLimit: 1,
        details: { [LAB]: { isOnline: true, depth: 7 } },
        maxRam: { near: 20, tiny: 8, far: 256 },
    });
    const state = makeState({
        near: { depth: 6, maxRam: 20, neighbours: [LAB, "far"] },
        tiny: { depth: 6, maxRam: 8, neighbours: [LAB] },
        far: { depth: 5, maxRam: 256, neighbours: ["near"] },
        locked: { depth: 6, maxRam: 512, neighbours: [LAB], cracked: false },
    });

    assert.equal(currentLab(ns, state).host, LAB);
    const plan = planLabyrinth(ns, state, options, LAB_CHA);
    const hosts = launchWalkers(ns, state, plan, options);

    assert.deepEqual(hosts, ["near"], "tiny is too small, far is not adjacent, locked has no password");
    assert.equal(plan.walkLab, LAB);
    const expected = Math.min(6, Math.floor((20 - WORKER_RAM.agent - 0.5) / WORKER_RAM.lab));
    assert.equal(expected, 3);
    assert.equal(plan.walkThreadsByHost.near, expected);
    assert.equal(buildCmd(state, plan, "near").walkThreads, expected);
    assert.equal(ns.execs.length, 0, "the controller never execs a walker itself except on darkweb");
});

test("launchWalkers holds back below the lab's charisma gate and after a win", () => {
    const options = { ...baseOptions, "lab-walkers": 2 };
    const config = { charisma: 10, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 64 } };
    const hosts = { near: { depth: 6, maxRam: 64, neighbours: [LAB] } };

    const low = makeNs(config);
    const lowState = makeState(hosts);
    assert.deepEqual(launchWalkers(low, lowState, planLabyrinth(low, lowState, options, 10), options), []);

    const ns = makeNs({ ...config, charisma: LAB_CHA });
    const state = makeState(hosts);
    state.labs.rewardQueuedAt = Date.now();
    assert.deepEqual(launchWalkers(ns, state, planLabyrinth(ns, state, options, LAB_CHA), options), [],
        "one win per reset: the reward has to be installed before the next lab exists");
});

// ------------------------------------------------------------------ stasis candidates

test("stasis candidates need room for the agent plus the stasis worker", () => {
    const ns = makeNs({ stasisLimit: 2 });
    const state = makeState({
        big: { depth: 1, maxRam: 256 },
        tiny: { depth: 9, maxRam: 16 },                 // deepest, but stasis.js (13.65 GB) can never launch beside the agent
        clogged: { depth: 8, maxRam: 64, blockedRam: 50 }, // 14 GB usable: same problem
    });
    assert.deepEqual(planLoot(ns, state, baseOptions, 10).stasisTargets, ["big"]);
    const labNs = makeNs({ stasisLimit: 2, details: { [LAB]: { isOnline: true, depth: 7 } } });
    assert.deepEqual(planLabyrinth(labNs, state, baseOptions, LAB_CHA).stasisTargets, ["big"], "deepest fallback applies the same floor");
});

test("loot mode pins the biggest host first, then the deepest ones", () => {
    const ns = makeNs({ stasisLimit: 3 });
    const state = makeState({
        base: { depth: 1, maxRam: 256 },
        deep: { depth: 6, maxRam: 32 },
        mid: { depth: 4, maxRam: 64 },
        shallowFat: { depth: 2, maxRam: 128 },
    });
    assert.deepEqual(planLoot(ns, state, baseOptions, 10).stasisTargets, ["base", "deep", "mid"]);
});
