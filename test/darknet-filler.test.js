// The agent hands every byte of spare RAM to a filler worker (phish.js / share.js). Fillers
// never resize themselves, so a cache, a stasis link or a crack that shows up later finds the
// host full. fillerPlan is the pure sizing rule the agent applies each tick: how many threads
// to launch when no filler runs, and whether a running filler must exit so the agent can
// re-size it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fillerPlan, selfReportKey, WORKER_RAM, FILES, STASIS_HOST_MIN_RAM, FEEDBACK_MODELS, crackOrder } from "../darknet/lib.js";

const unit = WORKER_RAM.phish;
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("fillerPlan spawns floor(spare / unit) threads when no filler is running", () => {
    assert.deepEqual(fillerPlan({ free: 11.5, reserve: 0, unitRam: unit, running: false, launched: 0 }), { launch: 3, resize: false });
    assert.deepEqual(fillerPlan({ free: 11.5, reserve: WORKER_RAM.cache, unitRam: unit, running: false, launched: 0 }), { launch: 2, resize: false });
    assert.deepEqual(fillerPlan({ free: 2, reserve: 0, unitRam: unit, running: false, launched: 0 }), { launch: 0, resize: false });
});

test("fillerPlan asks a running filler to exit when reserved work no longer fits", () => {
    // 16 GB host: agent 4.5 + 3 phish threads = 15.45 used; a .cache appears and needs 3.85.
    assert.deepEqual(fillerPlan({ free: 0.55, reserve: WORKER_RAM.cache, unitRam: unit, running: true, launched: 3 }), { launch: 0, resize: true });
    // Thread count unknown (agent restarted while phish kept running): still yields.
    assert.deepEqual(fillerPlan({ free: 0.55, reserve: WORKER_RAM.cache, unitRam: unit, running: true, launched: 0 }), { launch: 0, resize: true });
});

test("fillerPlan asks a running filler to exit when a whole extra thread would fit", () => {
    assert.deepEqual(fillerPlan({ free: 4.2, reserve: 0, unitRam: unit, running: true, launched: 2 }), { launch: 0, resize: true });
});

test("fillerPlan leaves a right-sized filler alone", () => {
    assert.deepEqual(fillerPlan({ free: 0.55, reserve: 0, unitRam: unit, running: true, launched: 3 }), { launch: 0, resize: false });
    assert.deepEqual(fillerPlan({ free: 3.0, reserve: 0, unitRam: unit, running: true, launched: 2 }), { launch: 0, resize: false }, "less than one thread free: no churn");
    assert.deepEqual(fillerPlan({ free: 3.0, reserve: 0, unitRam: unit, running: true, launched: 0 }), { launch: 0, resize: false }, "unknown size and nothing starved: no churn");
});

test("STASIS_HOST_MIN_RAM is what a host needs to run the agent and the stasis worker together", () => {
    assert.equal(STASIS_HOST_MIN_RAM, WORKER_RAM.agent + WORKER_RAM.stasis);
});

test("phish.js exits when the agent raises the resize flag", () => {
    assert.match(src("darknet/phish.js"), /FILES\.phishResize/);
});

test("agent.js sizes the phish filler with fillerPlan and holds RAM for pending caches and stasis", () => {
    const agent = src("darknet/agent.js");
    assert.match(agent, /fillerPlan\(/);
    assert.match(agent, /FILES\.phishResize/);
    assert.match(agent, /reserve \+= WORKER_RAM\.cache/);
    assert.match(agent, /reserve \+= WORKER_RAM\.stasis/);
});

// DN-F1: ns.dnet.probe() shuffles its result on every call (src/NetscriptFunctions/Darknet.ts
// `return shuffle(out)`), so a change key built from the raw list changes almost every loop.
test("selfReportKey ignores the order probe() returns the neighbours in", () => {
    const d = { isOnline: true, depth: 3, difficulty: 2, blockedRam: 0, modelId: "m", hasSession: false };
    assert.equal(selfReportKey(d, ["b", "a", "c"]), selfReportKey(d, ["c", "b", "a"]));
    assert.notEqual(selfReportKey(d, ["a", "b"]), selfReportKey(d, ["a", "b", "c"]), "a new neighbour still changes the key");
    assert.notEqual(selfReportKey(d, ["a"]), selfReportKey({ ...d, hasSession: true }, ["a"]), "a detail change still changes the key");
});

test("agent.js keys its own server report with selfReportKey", () => {
    assert.match(src("darknet/agent.js"), /selfReportKey\(mine, neighbours\)/);
});

// R4: authenticate has no charisma gate (Darknet.ts:93-177), only heartbleed does (:248-258). 13 of 24 models are
// solved by authenticate alone, so on those a host above the charisma bar is crackable, and a heartbleed after
// each miss only adds 1.5x the auth delay. The underleveled auth penalty (>= 2.5x) applies at charisma <= chaReq.
test("crackOrder skips oracle-model hosts above the charisma bar and puts penalised hosts last", () => {
    const details = {
        free: { modelId: "TopPass", requiredCharismaSkill: 900 },              // feedback-free: crackable at any charisma
        easy: { modelId: "NIL", requiredCharismaSkill: 100 },                  // oracle, well under the bar
        equal: { modelId: "DeepGreen", requiredCharismaSkill: 300 },           // passes heartbleed, pays the 2.5x penalty
        locked: { modelId: "KingOfTheHill", requiredCharismaSkill: 301 },      // heartbleed answers 451: skip it
        cheap: { modelId: "ZeroLogon", requiredCharismaSkill: 50 },
    };
    assert.deepEqual(crackOrder(["locked", "equal", "free", "easy", "cheap"], details, 300), ["cheap", "easy", "equal", "free"]);
    assert.deepEqual(crackOrder(["locked", "free"], details, null), ["free", "locked"], "unknown charisma (old controller): skip nothing");
    assert.deepEqual(crackOrder(["ghost"], {}, 300), ["ghost"], "no details yet: try it");
});

test("FEEDBACK_MODELS lists exactly the solvers that read heartbleed feedback", () => {
    assert.deepEqual([...FEEDBACK_MODELS].sort(), ["2G_cellular", "AccountsManager_4.2", "BellaCuore", "BigMo%od",
        "DeepGreen", "Factori-Os", "KingOfTheHill", "NIL", "OpenWebAccessPoint", "PHP 5.4", "RateMyPix.Auth"]);
});

test("crack.js only heartbleeds for feedback models and agent.js orders cracks with crackOrder", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /FEEDBACK_MODELS\.has\(details\.modelId\)/);
    assert.match(crack, /if \(!wantsFeedback \|\| !needFeedback\) return \{ success: false, feedback: null/);
    const agent = src("darknet/agent.js");
    assert.match(agent, /crackOrder\(/);
    assert.match(agent, /cmd\.charisma/);
});

// R12: the agent launches min(cmd.threads.crack, free) threads (6 by default) but reserved only 4 threads' worth
// from the fillers, so a filler could keep the last two threads' RAM and the crack ran under-sized.
test("agent.js reserves the full commanded crack thread count for a pending crack", () => {
    const agent = src("darknet/agent.js");
    assert.match(agent, /let reserve = pending\.length \? \(cmd\.threads\.crack \|\| 6\) \* WORKER_RAM\.crack : 0;/);
    assert.doesNotMatch(agent, /Math\.min\(cmd\.threads\.crack \|\| 6, 4\)/);
});

test("crack.js renews its claim from inside the attempt loop", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /const CLAIM_REFRESH = 60000;/);
    assert.match(crack, /kind: "crack", host: target, workerPid: pid, renewed: true/);
    assert.match(crack, /if \(Date\.now\(\) - claimedAt >= CLAIM_REFRESH\) renewClaim\(\);/);
});

// R6 fix round 1: claimedAt used to advance before the port write, so a full port silently
// dropped the renewal yet still pushed the next retry a full CLAIM_REFRESH away, reopening the
// duplicate-crack race. claimedAt must only advance once tryWritePort actually succeeds.
test("crack.js only marks a crack claim renewed once the port write succeeds", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /if \(ns\.tryWritePort\(options\.port, line\)\) claimedAt = Date\.now\(\);/);
    assert.doesNotMatch(crack, /claimedAt = Date\.now\(\);\s*\n\s*const line = encodeMsg\("worker"/);
});

test("fillerPlan honours a thread cap", () => {
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: false, launched: 0, cap: 7 }), { launch: 7, resize: false });
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: true, launched: 7, cap: 7 }), { launch: 0, resize: false }, "at the cap: spare RAM is not a reason to grow");
    assert.deepEqual(fillerPlan({ free: 1, reserve: 0, unitRam: unit, running: true, launched: 7, cap: 3 }), { launch: 0, resize: true }, "the cap dropped below what runs");
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: false, launched: 0, cap: 0 }), { launch: 0, resize: false });
});

test("agent.js launches phish up to its cap before sharing, and promote has no RAM floor", () => {
    const agent = src("darknet/agent.js");
    assert.match(agent, /cap: cmd\.threads\.phish/);
    assert.doesNotMatch(agent, /getServerMaxRam\(me\) >= 64/);
    assert.ok(agent.indexOf('ns.exec("darknet/phish.js"') < agent.indexOf('ns.exec("Remote/share.js"'), "phish is sized before share takes the rest");
    assert.doesNotMatch(src("darknet/phish.js"), /cmd\["share"\]/, "phish.js keeps running while the daemon shares");
});
