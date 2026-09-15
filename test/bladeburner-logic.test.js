// Pure decision helpers of bladeburner.js (lib/bladeburner-logic.js) checked against the game formulas they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chanceRangeVerdict } from "../lib/bladeburner-logic.js";

// BB-1: Action.ts getSuccessRange returns [real*r, real] when the population is over-estimated (r = pop/popEst < 1) and [real, real*r]
// when it is under-estimated, so only the low end never exceeds the true chance.
test("BB-1: an under-estimated population ([real, real*r]) is not a go", () => {
    assert.equal(chanceRangeVerdict([0.77, 1.0], 0.99), "uncertain"); // r = 1.3, a 77 %-real Daedalus reported as up to 100 %
    assert.equal(chanceRangeVerdict([1.0, 0.77], 0.99), "uncertain"); // order-insensitive
});

test("BB-1: only a collapsed or fully-above range is a go", () => {
    assert.equal(chanceRangeVerdict([1, 1], 0.99), "go");
    assert.equal(chanceRangeVerdict([0.995, 1], 0.99), "go");
    assert.equal(chanceRangeVerdict([0.99, 1], 0.99), "uncertain"); // lo == threshold is not > threshold, but hi is: resolve rather than stall
    assert.equal(chanceRangeVerdict([0.5, 0.9], 0.99), "no");
    assert.equal(chanceRangeVerdict([0, 0], 0.99), "no");
});
