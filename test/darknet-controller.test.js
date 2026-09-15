import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCmd, emptyState, encodeMsg, WORKER_RAM, LABS, LAB_AUGMENTATIONS, labFromAugmentations, labFromDifficulty } from "../darknet/lib.js";
import {
    applyMessage, assignStasis, buildCmd, chooseMode, currentLab, drainPort, launchWalkers,
    loadState, planFillers, planLabyrinth, planLoot, planPromotions, pushFiles, recomputeCompleted, saveState,
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
        getResetInfo: () => ({
            lastAugReset: config.resetTime ?? 1000,
            currentNode: config.bitNode ?? 1,
            // undefined (the default) models a build whose ResetInfo has no ownedAugs, which exercises the
            // difficulty fallback; a list (possibly empty) models the real game.
            ownedAugs: config.ownedAugs ? new Map(config.ownedAugs.map(name => [name, 1])) : undefined,
        }),
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
    "lab-walkers": 1, "lab-threads": 6, "allow-webstorm": false, "no-promote": false,
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
    assert.equal(cmd.charisma, 10, "the agent needs the player's charisma to skip oracle hosts it cannot heartbleed");
    assert.deepEqual(cmd.claimed, []);
    assert.equal(cmd.threads.crack, 6);
    assert.equal(cmd.threads.realloc, 50);
    assert.equal(cmd.threads.phish, 14, "alone on the network, alpha gets the whole phish budget");
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

// R9: phishing's cache stream is bound by a 3-minute global cooldown and its money is pennies (phishing.ts), so a
// dozen threads on the deepest hosts (money factor 0.1 + 0.05 x depth) saturate it network-wide; promote out-yields
// it in charisma XP and ~22 threads/symbol reach ~3x volatility on a held stock (effects.ts:197-201), but was
// capped at 4 threads and only on >= 64 GB hosts (no host below difficulty 12).
test("planFillers puts phish on the deepest hosts up to 14 threads and promote on the biggest, no RAM floor", () => {
    // ECP's prob is 0.8, not the brief's 0.7: Math.abs(0.7 - 0.5) rounds to 0.19999999999999996, a hair under
    // FSIG's Math.abs(0.3 - 0.5) === 0.2, so planPromotions' unrelated, pre-existing sort would tip FSIG first
    // on IEEE754 rounding alone. 0.8 keeps ECP's edge unambiguously larger and the "strongest forecast first"
    // order the brief specifies (R9's own change is planFillers, not planPromotions' sort).
    const ns = makeNs({ files: { "/Temp/stock-probabilities.txt": JSON.stringify({ ECP: { prob: 0.8, sharesLong: 10 }, FSIG: { prob: 0.3, sharesShort: 10 } }) } });
    const state = makeState({
        deep: { depth: 6, maxRam: 32 },                  // floor((32 - 4.5) / 3.65) = 7 threads of room
        mid: { depth: 4, maxRam: 45, blockedRam: 5 },    // floor((45 - 5 - 4.5) / 3.65) = 9
        big: { depth: 1, maxRam: 128 },                  // floor((128 - 4.5) / 3.65) = 33
        tiny: { depth: 9, maxRam: 16, blockedRam: 10 },  // no room at all
    });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.deepEqual(plan.promoteSymbols, ["ECP", "FSIG"]);
    assert.deepEqual(plan.phishByHost, { deep: 7, mid: 7 }, "14 threads, deepest first, tiny has no room");
    assert.deepEqual(plan.promoteByHost, { big: 33, mid: 2 }, "48 threads for two symbols, biggest host first, after phish took its share of mid");
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 7);
    assert.equal(buildCmd(state, plan, "deep").threads.promote, 0);
    assert.equal(buildCmd(state, plan, "big").threads.promote, 33, "a 128 GB host is no longer capped at 4");
    assert.equal(buildCmd(state, plan, "mid").threads.promote, 2, "a 45 GB host promotes too: the 64 GB floor is gone");
    assert.equal(buildCmd(state, plan, "tiny").threads.phish, 0);
});

test("phish threads survive while the daemon shares; a walk host still gets none", () => {
    const ns = makeNs({ files: { "/Temp/share-active.txt": "true" } });
    const state = makeState({ deep: { depth: 6, maxRam: 64, neighbours: [LAB] }, other: { depth: 2, maxRam: 64 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.equal(plan.shareActive, true);
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 14, "sharing no longer zeroes the cache stream");
    assert.equal(buildCmd(state, plan, "deep")["share"], true, "the remainder still shares");
    // R9 fix round 1: simulate deep becoming a walk host, the way launchWalkers would in
    // labyrinth mode, and main's corrected ordering re-running planFillers afterward -- the
    // budget planFillers would otherwise have stranded on deep (zeroed by buildCmd and never
    // reassigned) now flows to the non-walk host instead of being lost.
    plan.walkHosts = ["deep"]; plan.walkLab = LAB; plan.walkThreadsByHost = { deep: 4 };
    planFillers(state, plan);
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 0, "a walk host never gets phish budget");
    assert.equal(buildCmd(state, plan, "other").threads.phish, 14, "the budget now flows to the non-walk host instead of being stranded");
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

// DN-F5: setStasisLink only ever targets the calling script's own host (Darknet.ts) and
// getStasisLinkServers() counts every darknet server, labyrinths included (effects.ts). A link a
// lab agent put on the labyrinth occupies a global slot no command can take back, so it must
// count against the limit instead of making the plan hand out a slot that does not exist.
test("assignStasis counts a link held by a labyrinth against the limit", () => {
    const ns = makeNs({ stasisLimit: 2, stasisLinked: [LAB] });
    const plan = { stasisRelease: [] };
    assert.deepEqual(assignStasis(ns, plan, ["alpha", "beta"]), ["alpha"], "only one free slot really exists");
    assert.deepEqual(plan.stasisRelease, [LAB], "reported so the status line shows where the slot went");
});

test("lab.js does not ship the walk host's cmd.txt to the labyrinth", () => {
    const lab = readFileSync(new URL("../darknet/lab.js", import.meta.url), "utf8");
    const delivery = lab.match(/for \(const file of \[([^\]]*)\]\)/);
    assert.ok(delivery, "deliverAgent's file loop");
    assert.doesNotMatch(delivery[1], /FILES\.cmd/, "the walk host's cmd carries stasis:true, which the lab agent would act on");
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
        charisma: LAB_CHA + 1,
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
    const plan = planLabyrinth(ns, state, options, LAB_CHA + 1);
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

    const ns = makeNs({ ...config, charisma: LAB_CHA + 1 });
    const state = makeState(hosts);
    state.labs.rewardQueuedAt = Date.now();
    assert.deepEqual(launchWalkers(ns, state, planLabyrinth(ns, state, options, LAB_CHA + 1), options), [],
        "one win per reset: the reward has to be installed before the next lab exists");
});

// R11: effects.ts applies the underleveled factor (>= 2.5x on every lab call) at charisma <= chaRequired, and
// NetworkGenerator.ts:257 gives the lab its own gate as requiredCharismaSkill. At charisma == lab.cha the maze
// is enterable but every step pays 2.5x, and the study goal stopped one point short of removing that.
test("the charisma goal is one above the requirement and walkers wait for it", () => {
    const options = { ...baseOptions, "lab-walkers": 1 };
    const ns = makeNs({ charisma: LAB_CHA, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 64 } });
    const state = makeState({
        near: { depth: 6, maxRam: 64, neighbours: [LAB] },
        locked: { depth: 5, maxRam: 32, chaReq: 120, cracked: false },
    });
    assert.equal(chooseMode(ns, state, { ...baseOptions, mode: "balanced" }, LAB_CHA), "loot", "equality still pays the penalty");
    const plan = planLabyrinth(ns, state, options, LAB_CHA);
    assert.equal(plan.charismaGoal, LAB_CHA + 1);
    assert.deepEqual(launchWalkers(ns, state, plan, options), [], "held back at exactly the gate");

    const above = makeNs({ charisma: LAB_CHA + 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 64 } });
    const plan2 = planLabyrinth(above, state, options, LAB_CHA + 1);
    assert.deepEqual(launchWalkers(above, state, plan2, options), ["near"]);
    assert.equal(chooseMode(above, state, { ...baseOptions, mode: "balanced" }, LAB_CHA + 1), "labyrinth");

    assert.equal(planLoot(ns, state, baseOptions, 120).charismaGoal, 121, "an uncracked host at chaReq 120 needs 121, the lab is further away");
    assert.equal(planLoot(ns, state, baseOptions, 121).charismaGoal, LAB_CHA + 1, "121 clears that host; the next blocked action is the lab");
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

// DN-F4: a completed migration re-places the server in [difficulty - 2, difficulty + 4]
// (effects.ts induceServerMigration -> moveDarknetServer(server, 2, 4), whose startingDepth
// defaults to server.difficulty), wherever it currently sits. So the air-gap candidates are
// the hosts whose difficulty reaches past the gap, not the ones sitting just above it.
test("planLabyrinth picks air-gap migration targets by difficulty, strongest first", () => {
    const ns = makeNs({ charisma: 600, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings], details: { cru3l_l4byr1nth: { isOnline: true, depth: 12 } } });
    const state = makeState({
        shallow: { depth: 7, difficulty: 3, neighbours: ["charger"] },   // depth 7 but 3 + 4 = 7 never reaches row 9
        deep: { depth: 6, difficulty: 5, neighbours: ["charger"] },      // 5 + 4 = 9 > 8: can land past the gap
        best: { depth: 5, difficulty: 7, neighbours: ["charger"] },      // reaches row 11
        charger: { depth: 6, difficulty: 4, neighbours: ["shallow", "deep", "best"] },
    });
    assert.equal(currentLab(ns, state).host, "cru3l_l4byr1nth");

    const plan = planLabyrinth(ns, state, baseOptions, 600);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["best", "deep"], "ordered by difficulty so the chargers go to the best candidate first");
    assert.deepEqual(plan.migrationTargets.best, ["charger"]);
    assert.equal(buildCmd(state, plan, "charger").migrateTarget, "best");
});

test("chooseMode counts a charging migration by the same difficulty rule", () => {
    const ns = makeNs({ charisma: 601, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings], details: { cru3l_l4byr1nth: { isOnline: true, depth: 12, cha: 600 } } });
    const state = makeState({ deep: { depth: 5, difficulty: 5, neighbours: [] } });
    const options = { ...baseOptions, mode: "balanced" };
    assert.equal(chooseMode(ns, state, options, 601), "loot");
    state.servers.deep.migrationCharge = 0.5; state.servers.deep.migrationChargeAt = Date.now();
    assert.equal(chooseMode(ns, state, options, 601), "labyrinth");
    state.servers.deep.difficulty = 3;
    assert.equal(chooseMode(ns, state, options, 601), "loot", "a charge that cannot cross the gap does not count");
});

// ------------------------------------------------------------------ R1: which labyrinth is current

// labyrinth.ts getCurrentLabName: the lab is chosen from *installed* augmentations, in this order, with a
// BN15 branch (TRP gates the fifth lab there) and TRP only gating the seventh lab outside BN8
// (BitNode.tsx:792 is the only DarknetLabyrinthRewardsTheRedPill: 0).
test("labFromAugmentations mirrors labyrinth.ts getCurrentLabName, BN15 branch included", () => {
    const A = LAB_AUGMENTATIONS;
    assert.equal(labFromAugmentations([], 1), "th3_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings], 1), "cru3l_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings, A.TheBoots], 1), "m3rc1l3ss_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings, A.TheBoots, A.TheHammer], 1), "ub3r_l4byr1nth");
    const four = [A.TheBrokenWings, A.TheBoots, A.TheHammer, A.TheStaff];
    assert.equal(labFromAugmentations(four, 1), "et3rn4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw], 1), "end13ss_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 1), "f1n4l_l4byr1nth", "TRP still to be won outside BN8");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 8), "b0nus_l4byr1nth", "BN8 never offers TRP from the labyrinth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword, A.TheRedPill], 1), "b0nus_l4byr1nth");
    // BN15: TRP gates the fifth lab, then Law, then Sword.
    assert.equal(labFromAugmentations(four, 15), "et3rn4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill], 15), "end13ss_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill, A.TheLaw], 15), "f1n4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill, A.TheLaw, A.TheSword], 15), "b0nus_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 15), "et3rn4l_l4byr1nth", "in BN15 the Law/Sword order only counts once TRP is installed");
});

test("labFromDifficulty is the first lab deeper than every difficulty seen so far", () => {
    // NetworkMovement.ts:194: difficulty is uniform in [0, netDepth), so netDepth >= max + 1.
    assert.equal(labFromDifficulty(0), "th3_l4byr1nth");
    assert.equal(labFromDifficulty(6), "th3_l4byr1nth");
    assert.equal(labFromDifficulty(7), "cru3l_l4byr1nth", "a difficulty-7 host cannot exist on a net of depth 7");
    assert.equal(labFromDifficulty(11), "cru3l_l4byr1nth");
    assert.equal(labFromDifficulty(12), "m3rc1l3ss_l4byr1nth");
    assert.equal(labFromDifficulty(99), "b0nus_l4byr1nth");
});

test("currentLab follows the installed augmentations after a state wipe, not state.labs.completed", () => {
    // Every install wipes the darknet and the controller's state; the second lab (depth 12) is wired to
    // depth-11 hosts beyond the row-8 air gap, so nothing near it is ever observed.
    const ns = makeNs({
        charisma: 700, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },   // not wired in yet: depth -1 like NetworkGenerator creates it
    });
    const state = makeState({
        shallow: { depth: 3, difficulty: 3, neighbours: ["mover"] },
        mover: { depth: 5, difficulty: 6, neighbours: ["shallow"] },   // 6 + 4 = 10 > 8: can land past the first gap
    });
    assert.deepEqual(state.labs.completed, [], "fresh state knows nothing");
    const lab = currentLab(ns, state);
    assert.equal(lab.host, "cru3l_l4byr1nth");
    assert.equal(lab.depth, 12, "LABS depth is used while the lab reports -1");
    assert.deepEqual(recomputeCompleted(ns, state), ["th3_l4byr1nth"]);

    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["mover"], "the row-8 gap below the inferred lab is planned");
    assert.deepEqual(plan.migrationTargets.mover, ["shallow"]);
    assert.equal(plan.charismaGoal, 0, "700 already clears the 600 gate");
});

test("currentLab falls back to the deepest observed difficulty when ownedAugs is unavailable", () => {
    const ns = makeNs({ details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } } });   // no ownedAugs at all
    const state = makeState({ a: { depth: 2, difficulty: 6 }, b: { depth: 4, difficulty: 7 } });
    assert.equal(currentLab(ns, state).host, "cru3l_l4byr1nth", "a difficulty-7 host rules out the depth-7 lab");
    state.servers.b.difficulty = 5;
    assert.equal(currentLab(ns, state).host, "th3_l4byr1nth");
});

test("currentLab trusts a lab an agent has probed over the difficulty fallback", () => {
    const ns = makeNs({});
    const state = makeState({ near: { depth: 11, difficulty: 2, neighbours: ["cru3l_l4byr1nth"] } });
    assert.equal(currentLab(ns, state).host, "cru3l_l4byr1nth");
});

// ------------------------------------------------------------------ R15: a host the game no longer knows

// After a reload the game's DarknetState.offlineServers is empty (src/DarkNet/effects/SaveLoad.ts persists only
// storedCycles and hasUsedHeartbleed), so a host deleted before the reload resolves to neither the server table
// nor the offline table and every dnet call on it throws `Invalid host` (NetscriptHelpers.tsx getServer) instead
// of answering 503. darknet/state.txt survives the reload with the host online, so pushFiles threw on it every
// loop and nothing after it ran (no pushes, no walkers, no saveState).
test("pushFiles treats an `Invalid host` throw from connectToSession as a deleted server", () => {
    const ns = makeNs({});
    let sessions = 0;
    ns.dnet.connectToSession = (host) => {
        sessions++;
        if (host === "byte%oasis") throw new Error("dnet.connectToSession: Invalid host: 'byte%oasis'");
        return { success: true, code: 200 };
    };
    const state = makeState({ "byte%oasis": { depth: 3 }, keeper: { depth: 2 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.doesNotThrow(() => pushFiles(ns, state, plan));
    assert.equal(state.servers["byte%oasis"].online, false, "a name the game no longer knows is a deleted server");
    assert.equal(state.passwords["byte%oasis"].stale, true, "and its password is worthless too");
    assert.equal(state.servers.keeper.online, true);
    assert.equal(state.passwords.keeper.stale, undefined);
    assert.deepEqual(ns.scps.map(row => row.host), ["darkweb", "keeper"], "the loop carried on past the dead host");
    assert.equal(sessions, 2, "one session per stored host; darkweb needs none");

    // In the game errorMessage() throws a plain string, not an Error: the wrapper must read both.
    ns.dnet.connectToSession = () => { throw "RUNTIME ERROR\ndarknet.js@home (PID - 216)\n\ndnet.connectToSession: Invalid host: 'gone'"; };
    const stringState = makeState({ gone: {} });
    assert.doesNotThrow(() => pushFiles(ns, stringState, plan));
    assert.equal(stringState.servers.gone.online, false);

    // Anything else still propagates: a real bug must not be filed as a deletion.
    ns.dnet.connectToSession = () => { throw new Error("dnet.connectToSession: something else"); };
    assert.throws(() => pushFiles(ns, makeState({ other: {} }), plan), /something else/);

    const controller = readFileSync(new URL("../darknet.js", import.meta.url), "utf8");
    assert.equal((controller.match(/ns\.dnet\.connectToSession\(/g) ?? []).length, 1, "the only raw call is inside trySession; pushFiles and --kill go through it");
});

// R2: without a migration nothing is ever reachable past an air-gap row (rows 8/16/24/32 hold no servers and
// connections only join rows x+-1), so the frontier stalls at row-1 and can never creep to within
// LAB_DEPTH_SLACK of a lab at depth >= 19. Gap migrations are only planned in labyrinth mode.
test("chooseMode flips to labyrinth when the frontier sits just above an air gap below the lab", () => {
    const ns = makeNs({
        charisma: 2000, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings, LAB_AUGMENTATIONS.TheBoots],
        details: { m3rc1l3ss_l4byr1nth: { isOnline: true, depth: -1, cha: 1500 } },
    });
    const options = { ...baseOptions, mode: "balanced" };
    const blocked = makeState({ edge: { depth: 7, difficulty: 6 }, mid: { depth: 4, difficulty: 2 } });
    assert.equal(currentLab(ns, blocked).host, "m3rc1l3ss_l4byr1nth");
    assert.equal(chooseMode(ns, blocked, options, 2000), "labyrinth", "frontier 7 = row 8 - 1, lab at 19");
    const creeping = makeState({ edge: { depth: 6, difficulty: 6 } });
    assert.equal(chooseMode(ns, creeping, options, 2000), "loot", "row 7 is still crackable, keep looting");
    const crossed = makeState({ beyond: { depth: 9, difficulty: 7 } });
    assert.equal(chooseMode(ns, crossed, options, 2000), "loot", "past the gap and 10 rows short: loot until the next gap");

    // Gap rule only: slack cannot satisfy this, only the gap check can.
    const ns2 = makeNs({
        charisma: 2501, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings, LAB_AUGMENTATIONS.TheBoots, LAB_AUGMENTATIONS.TheHammer],
        details: { ub3r_l4byr1nth: { isOnline: true, depth: -1, cha: 2500 } },
    });
    assert.equal(currentLab(ns2, makeState({})).host, "ub3r_l4byr1nth");
    const gapBlocked = makeState({ deep: { depth: 15, difficulty: 12 } });
    assert.equal(chooseMode(ns2, gapBlocked, options, 2501), "labyrinth", "frontier 15 = row 16 - 1, lab at 23, slack 17 > 15");
    const gapNotBlocked = makeState({ deep: { depth: 14, difficulty: 12 } });
    assert.equal(chooseMode(ns2, gapNotBlocked, options, 2501), "loot", "frontier 14 is not row-1 of any gap");
});

// ------------------------------------------------------------------ R3: never migrate a pinned host

// R3: a linked server is immutable (NetworkMovement.ts isImmutable = openServer || isConnectedTo || hasStasisLink)
// and a full migration charge on it is thrown away (effects.ts:257-260). Before the first crossing the deepest
// hosts and the highest-difficulty hosts are the same handful, so the old plan pinned its own migration target.
test("planLabyrinth never pins the host it is migrating, and never migrates a pinned host", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 2, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        best: { depth: 7, difficulty: 7, maxRam: 64, neighbours: ["charger"] },     // deepest AND the strongest candidate
        deep: { depth: 7, difficulty: 5, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 4, maxRam: 64, neighbours: ["best", "deep"] },
    });
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["best", "deep"]);
    for (const target of Object.keys(plan.migrationTargets)) {
        assert.ok(!plan.stasisTargets.includes(target), `${target} is being migrated and must not be pinned`);
    }
    assert.deepEqual(plan.stasisTargets, ["charger"], "the slots go to hosts that are not crossing");
});

test("planLabyrinth skips hosts the game already holds in stasis when another candidate exists", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 2, stasisLinked: ["best"], ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        best: { depth: 7, difficulty: 7, maxRam: 64, neighbours: ["charger"] },
        deep: { depth: 7, difficulty: 5, maxRam: 64, neighbours: ["charger"] },
        selfReported: { depth: 6, difficulty: 6, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 4, maxRam: 64, neighbours: ["best", "deep", "selfReported"] },
    });
    state.servers.selfReported.stasis = true;   // stasis.js reported success, the game list is stale
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["deep"], "best (linked) and selfReported (stasis:true) cannot move");
    assert.ok(plan.stasisTargets.includes("best"), "an existing link on a non-target is kept");
});

test("planLabyrinth releases a pinned host when every crossing candidate is pinned", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 1, stasisLinked: ["only"], ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        only: { depth: 7, difficulty: 6, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 2, maxRam: 64, neighbours: ["only"] },   // 2 + 4 = 6 < 8: cannot cross
    });
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["only"]);
    assert.ok(!plan.stasisTargets.includes("only"));
    assert.deepEqual(plan.stasisRelease, ["only"], "stasis:false goes out so the host becomes movable");
});

// R6: a claim stamped once at launch expired after 2 minutes while oracle cracks run 4-30 minutes, so a second
// agent started a duplicate crack whose heartbleed lines made both fail with `timeouts`. crack.js now renews.
test("a renewed crack claim keeps the host claimed past CLAIM_LIFETIME", () => {
    const state = makeState({ alpha: {}, beta: {} });
    const t0 = Date.now() - 150000;
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 7, ts: t0, workerPid: 42 });
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 42, ts: t0 + 60000, workerPid: 42, renewed: true });
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 42, ts: t0 + 120000, workerPid: 42, renewed: true });
    const plan = planLoot(makeNs({}), state, baseOptions, 10);
    assert.deepEqual(buildCmd(state, plan, "beta").claimed, ["gamma"], "150 s after launch, renewed 30 s ago");
    assert.deepEqual(buildCmd(state, plan, "alpha").claimed, [], "the claimant itself is never blocked");
});

// R7: the controller evicts every filler from a walk host but capped the walker at --lab-threads 6, leaving a
// 128 GB lab-adjacent host ~100 GB idle although threadsFactor = 1/(1+0.2(t-1)) keeps shrinking the lab delay.
test("launchWalkers gives the walker every thread that fits unless --lab-threads caps it", () => {
    const ns = makeNs({ charisma: LAB_CHA + 1, stasisLimit: 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { fat: 128 } });
    const state = makeState({ fat: { depth: 6, maxRam: 128, neighbours: [LAB] } });
    const uncapped = { ...baseOptions, "lab-walkers": 1, "lab-threads": 0 };
    const plan = planLabyrinth(ns, state, uncapped, LAB_CHA + 1);
    assert.deepEqual(plan.stasisTargets, ["fat"], "the lab-adjacent host is pinned so the game cannot move it mid-walk");
    assert.deepEqual(launchWalkers(ns, state, plan, uncapped), ["fat"]);
    const expected = Math.floor((128 - WORKER_RAM.agent - 0.5 - WORKER_RAM.stasis) / WORKER_RAM.lab);
    assert.equal(expected, 27);
    assert.equal(plan.walkThreadsByHost.fat, expected, "everything but the agent, the stasis worker and the slack");
    assert.equal(buildCmd(state, plan, "fat").walkThreads, expected);

    const capped = { ...baseOptions, "lab-walkers": 1, "lab-threads": 6 };
    const plan2 = planLabyrinth(ns, state, capped, LAB_CHA + 1);
    launchWalkers(ns, state, plan2, capped);
    assert.equal(plan2.walkThreadsByHost.fat, 6, "a positive --lab-threads is a cap");
});

test("launchWalkers lets the walker win over the stasis hold on a host too small for both", () => {
    const ns = makeNs({ charisma: LAB_CHA + 1, stasisLimit: 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 20 } });
    const state = makeState({ near: { depth: 6, maxRam: 20, neighbours: [LAB] } });
    const options = { ...baseOptions, "lab-walkers": 1, "lab-threads": 0 };
    const plan = planLabyrinth(ns, state, options, LAB_CHA + 1);
    assert.deepEqual(plan.stasisTargets, ["near"]);
    launchWalkers(ns, state, plan, options);
    assert.equal(plan.walkThreadsByHost.near, 3, "20 GB: agent 4.5 + 3 x 3.95; holding 13.65 for stasis would leave 0 threads");
});
