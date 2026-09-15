// HC-1: pure helpers of the just-in-time batch launcher in daemon.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionDueTasks, nextRoundStart, canPlanNextRound, withStockManipulationFlag } from "../daemon.js";

test("partitionDueTasks returns due tasks sorted by start and keeps the rest", () => {
    const queue = [{ start: 5000, id: "c" }, { start: 1500, id: "a" }, { start: 2200, id: "b" }, { start: 900, id: "z" }];
    const [due, pending] = partitionDueTasks(queue, 1000, 1000);
    assert.deepEqual(due.map((t) => t.id), ["z", "a"]); // 900 and 1500 are within 1000 ms of now=1000
    assert.deepEqual(pending.map((t) => t.id), ["c", "b"]); // original order preserved
    assert.equal(queue.length, 4, "input is not mutated");
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
    assert.equal(withStockManipulationFlag("grow", hackArgs, true)[4], 1);
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
