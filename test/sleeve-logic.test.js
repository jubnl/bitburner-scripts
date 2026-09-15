// Pure decision helpers of sleeve.js (lib/sleeve-logic.js) checked against the game constants they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingCostPerExp, canAffordTraining, karmaRatePerAttempt, shouldFillWithKarmaHomicide, bladeburnerSleeveTasks } from "../lib/sleeve-logic.js";

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

// SL-1: karma from sleeve crime is only awarded on success and is scaled by sync (SleeveCrimeWork.ts process:
// Player.karma -= crime.karma * sleeve.syncBonus() inside `if (success)`).
test("SL-1: karma rate per attempt is chance x sync/100 and clamps both inputs", () => {
    assert.equal(karmaRatePerAttempt(1, 100), 1);
    assert.equal(karmaRatePerAttempt(0.5, 50), 0.25);
    assert.equal(karmaRatePerAttempt(2, 200), 1);
    assert.equal(karmaRatePerAttempt(-1, 100), 0);
});

test("SL-1: a fresh sleeve (0.5 % homicide, 1 % sync) never qualifies; a trained, synced one does", () => {
    assert.equal(shouldFillWithKarmaHomicide(0.005, 1, 0.1), false);
    assert.equal(shouldFillWithKarmaHomicide(0.5, 1, 0.1), false);   // trained (str/def 105) but unsynchronised
    assert.equal(shouldFillWithKarmaHomicide(0.5, 100, 0.1), true);  // trained and fully synced
    assert.equal(shouldFillWithKarmaHomicide(0.1, 100, 0.1), true);  // exactly at the gate
    assert.equal(shouldFillWithKarmaHomicide(0.005, 1, 0), true);    // gate disabled
});

// SL-3: each infiltrating sleeve adds sqrt(n)/2 count per minute to EVERY contract and operation (Bladeburner.ts sleeveSupport /
// SleeveInfiltrateWork.ts), worth several rank/min; a stat-1 sleeve on Field Analysis or Diplomacy is worth ~0.2 rank/min or nothing.
test("SL-3: by default only sleeves 1-3 take contracts, everyone else infiltrates", () => {
    const tasks = bladeburnerSleeveTasks(false);
    assert.equal(tasks.length, 8);
    assert.deepEqual(tasks[1], ["Take on contracts", "Retirement"]);
    assert.deepEqual(tasks[2], ["Take on contracts", "Bounty Hunter"]);
    assert.deepEqual(tasks[3], ["Take on contracts", "Tracking"]);
    for (const i of [0, 4, 5, 6, 7]) assert.deepEqual(tasks[i], ["Infiltrate Synthoids"], `sleeve ${i}`);
});

test("SL-3: team building only changes sleeves 0 and 7", () => {
    const tasks = bladeburnerSleeveTasks(true);
    assert.deepEqual(tasks[0], ["Support main sleeve"]);
    assert.deepEqual(tasks[7], ["Recruitment"]);
    for (const i of [4, 5, 6]) assert.deepEqual(tasks[i], ["Infiltrate Synthoids"], `sleeve ${i}`);
});
