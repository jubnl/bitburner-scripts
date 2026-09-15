// Pure decision helpers of sleeve.js (lib/sleeve-logic.js) checked against the game constants they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingCostPerExp, canAffordTraining } from "../lib/sleeve-logic.js";

// SL-2: Powerhouse Gym costs $120/s x costMult 20 = $2400/s for 1 exp/s x expMult 10 = 10 exp/s; sleeve exp is scaled by
// (100 - shock)/100 (SleeveClassWork.ts calculateRates), the fee is not.
test("SL-2: cost per exp is $240 at shock 0, $2400 at shock 90, infinite at shock 100", () => {
    assert.equal(trainingCostPerExp(0), 240);
    assert.ok(Math.abs(trainingCostPerExp(90) - 2400) < 1e-9);
    assert.equal(trainingCostPerExp(100), Infinity);
});

test("SL-2: the default gate (2500 $/exp) admits shock <= 90 and rejects shock 91+ and 100", () => {
    assert.equal(canAffordTraining(90, 2500), true);
    assert.equal(canAffordTraining(50, 2500), true);
    assert.equal(canAffordTraining(91, 2500), false);
    assert.equal(canAffordTraining(100, 2500), false);
    assert.equal(canAffordTraining(100, Infinity), false); // exp is exactly 0 at shock 100: never pay
});
