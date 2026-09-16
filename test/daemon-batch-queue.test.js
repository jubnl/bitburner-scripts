// HC-1: pure helpers of the just-in-time batch launcher in daemon.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionDueTasks, nextRoundStart, canPlanNextRound, withStockManipulationFlag, chainingRegressed, dropBatchAfterFailure } from "../daemon.js";

/** A queued task as performScheduling builds it (only the fields the pure helpers read) */
const task = (target, batchNumber, description, start) => ({ target: { name: target }, start, description: `Batch ${batchNumber}-${description}` });
const ids = queue => queue.map(t => `${t.target.name} ${t.description}`);

test("partitionDueTasks returns due tasks sorted by start and keeps the rest", () => {
    const queue = [{ start: 5000, id: "c" }, { start: 1500, id: "a" }, { start: 2200, id: "b" }, { start: 900, id: "z" }];
    const [due, pending] = partitionDueTasks(queue, 1000, 1000);
    assert.deepEqual(due.map((t) => t.id), ["z", "a"]); // 900 and 1500 are within 1000 ms of now=1000
    assert.deepEqual(pending.map((t) => t.id), ["c", "b"]); // original order preserved
    assert.equal(queue.length, 4, "input is not mutated");
});

test("partitionDueTasks with a longer lead pulls in the tasks a long loop would otherwise launch late", () => {
    // Final review issue 1: the lead is max(loopInterval, last loop's duration). A loop that took 2500 ms must launch everything due before its
    // next turn, or those tasks are exec'd after their start time and the remote scripts (which clamp a negative sleep to 0) fire immediately.
    const queue = [{ start: 1500, id: "a" }, { start: 2200, id: "b" }, { start: 5000, id: "c" }];
    assert.deepEqual(partitionDueTasks(queue, 1000, 1000)[0].map(t => t.id), ["a"], "a 1000 ms lead leaves b for the next loop");
    const [due, pending] = partitionDueTasks(queue, 1000, 2500);
    assert.deepEqual(due.map(t => t.id), ["a", "b"], "a 2500 ms lead launches b now instead of 200 ms late");
    assert.deepEqual(pending.map(t => t.id), ["c"]);
});

test("partitionDueTasks with an empty queue", () => {
    assert.deepEqual(partitionDueTasks([], 0, 1000), [[], []]);
});

test("nextRoundStart continues the previous cadence when it is still in the future", () => {
    // previous round's last batch started at t=10000, cycle 2000 -> next batch at 12000, which is later than now + queueDelay (11000)
    assert.equal(nextRoundStart(10000, 1000, 10000, 2000), 12000);
});

test("nextRoundStart falls back to now + queueDelay when the cadence is in the past or unknown", () => {
    assert.equal(nextRoundStart(50000, 1000, 10000, 2000), 51000);
    assert.equal(nextRoundStart(50000, 1000, undefined, 2000), 51000);
});

test("withStockManipulationFlag rewrites the flag of hack/grow tasks only, without mutating the input", () => {
    // Args spec: [0: Target, 1: DesiredStartTime, 2: Duration, 3: Description, 4: DoStockManipulation, 5: DisableWarnings, 6: LoopingMode]
    const hackArgs = ["joesguns", 1000, 500, "Batch 0-hack", 1, 0, 0];
    assert.deepEqual(withStockManipulationFlag("hack", hackArgs, false), ["joesguns", 1000, 500, "Batch 0-hack", 0, 0, 0]);
    assert.equal(hackArgs[4], 1, "input is not mutated");
    const growArgs = ["joesguns", 1000, 500, "Batch 0-grow", 0, 0, 0];
    assert.equal(growArgs[4], 0, "sanity: the flag starts off, so the assertion below cannot pass on an untouched array");
    assert.equal(withStockManipulationFlag("grow", growArgs, true)[4], 1);
    assert.equal(withStockManipulationFlag("manualhack", hackArgs, false)[4], 0, "the -i manual hack tool carries the same flag");
});

test("withStockManipulationFlag leaves args that carry no stock flag untouched", () => {
    // A weaken task has no stock flag: its args[4] is the "disable warnings" flag and must not be overwritten
    const weakenArgs = ["joesguns", 1000, 500, "Batch 0-weak1", 1, 0];
    assert.equal(withStockManipulationFlag("weak", weakenArgs, false), weakenArgs, "the same array is returned");
    assert.deepEqual(weakenArgs, ["joesguns", 1000, 500, "Batch 0-weak1", 1, 0]);
    // Defensive: args too short to carry the flag are returned as-is
    const shortArgs = ["joesguns", 1000, 500, "prep"];
    assert.equal(withStockManipulationFlag("hack", shortArgs, true), shortArgs);
});

test("canPlanNextRound is true once the last batch's first task is due to launch", () => {
    const round = { lastBatchStart: 20000, readyAt: 20500, nextBatchNumber: 40 };
    assert.equal(canPlanNextRound(round, 19000, 1000), false);
    assert.equal(canPlanNextRound(round, 19500, 1000), true);
    assert.equal(canPlanNextRound(round, 25000, 1000), true);
    assert.equal(canPlanNextRound(undefined, 25000, 1000), false);
});

test("chainingRegressed tolerates the dip between a hack and its grow, but not a real regression", () => {
    // One batch of this round hardens security by 50 hack threads * 0.002 + 120 grow threads * 0.004 = 0.58
    const hackHardening = 50 * 0.002, growHardening = 120 * 0.004;
    // Security threshold: minSecurity (10) + 2 * 0.58 + 1 = 12.16. Money threshold: 0.5 * 1e9 * (1 - 0.25) = 3.75e8
    const regressed = (security, money) => chainingRegressed(security, 10, money, 1e9, hackHardening, growHardening, 0.25);
    assert.equal(regressed(10, 1e9), false, "a fully prepped target is not regressed");
    assert.equal(regressed(12.16, 7.5e8), false, "two batches' worth of hardening + 1, and money down by one theft, is tolerated");
    assert.equal(regressed(12.17, 7.5e8), true, "more security than that is a regression");
    assert.equal(regressed(10, 3.75e8), false, "money at half of what a theft leaves is still tolerated");
    assert.equal(regressed(10, 3.74e8), true, "less money than that is a regression");
});

test("dropBatchAfterFailure drops the failed task's own later tasks and nothing else", () => {
    // Within a batch the launch order is weak1, weak2, grow, hack (see getScheduleTiming). The failed task is already off the queue.
    const queue = [
        task("joesguns", 7, "weak1", 2000), task("joesguns", 7, "weak2", 3000), task("joesguns", 7, "hack", 5000),
        task("joesguns", 8, "grow", 4200), task("joesguns", 8, "hack", 5200),
        task("phantasy", 7, "hack", 5500),
    ];
    const [remaining, dropped] = dropBatchAfterFailure(queue, task("joesguns", 7, "grow", 4000));
    assert.equal(dropped, 1, "only batch 7's hack, which would otherwise steal money nothing grows back");
    assert.deepEqual(ids(remaining), ["joesguns Batch 7-weak1", "joesguns Batch 7-weak2",
        "joesguns Batch 8-grow", "joesguns Batch 8-hack", "phantasy Batch 7-hack"]);
    assert.equal(queue.length, 6, "input is not mutated");
});

test("dropBatchAfterFailure drops nothing when the failed task is the last of its batch", () => {
    const queue = [task("joesguns", 7, "weak1", 2000), task("joesguns", 8, "grow", 4200), task("joesguns", 8, "hack", 5200)];
    const [remaining, dropped] = dropBatchAfterFailure(queue, task("joesguns", 7, "hack", 5000));
    assert.equal(dropped, 0, "a dropped hack strands nothing: the weakens before it are harmless on their own");
    assert.deepEqual(ids(remaining), ids(queue));
});

test("dropBatchAfterFailure drops both the grow and the hack when a second weaken fails", () => {
    const queue = [task("joesguns", 7, "grow", 4000), task("joesguns", 7, "hack", 5000), task("joesguns", 8, "weak2", 5000)];
    const [remaining, dropped] = dropBatchAfterFailure(queue, task("joesguns", 7, "weak2", 3000));
    assert.equal(dropped, 2, "a grow with no weaken to follow it would permanently harden the target");
    assert.deepEqual(ids(remaining), ["joesguns Batch 8-weak2"]);
});

import { launchTiming } from "../daemon.js";
test("launchTiming: start is the planned landing minus the duration as it is now; late only when that start is already past", () => {
    assert.deepEqual(launchTiming(10_000, 4_000, 5_000), { start: 6_000, lateMs: 0 });
    assert.deepEqual(launchTiming(10_000, 4_400, 5_000), { start: 5_600, lateMs: 0 }); // hardening made the tool 10% slower: start earlier, still lands on time
    assert.deepEqual(launchTiming(10_000, 5_300, 5_000), { start: 4_700, lateMs: 300 }); // too slow to land on time now, by 300 ms
});
