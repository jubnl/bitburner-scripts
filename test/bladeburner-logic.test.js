// Pure decision helpers of bladeburner.js (lib/bladeburner-logic.js) checked against the game formulas they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyPctPerMinute, diplomacyMinutesTo, shouldRunDiplomacy, planSkillUpgradeCount } from "../lib/bladeburner-logic.js";

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

// BB-2: estimate improvement per completion (Bladeburner.ts completeOperation / completeAction): Undercover 0.8 % and Investigation 0.4 % per
// success, Field Analysis eff % per 30 s where eff = 0.04*hack^0.3 + 0.04*int^0.9 + 0.02*cha^0.3 (x bladeburner_analysis mult);
// Tracking moves the estimate by an absolute 100-1000 people on a ~1e9 population and is no longer a candidate.
test("BB-2: Field Analysis effectiveness matches Bladeburner.ts", () => {
    assert.ok(Math.abs(fieldAnalysisEffect(1, 1, 1) - 0.1) < 1e-12);
    const expected = 0.04 * Math.pow(1000, 0.3) + 0.04 * Math.pow(50, 0.9) + 0.02 * Math.pow(500, 0.3);
    assert.ok(Math.abs(fieldAnalysisEffect(1000, 50, 500) - expected) < 1e-12);
    assert.ok(Math.abs(fieldAnalysisEffect(1000, 50, 500, 2) - 2 * expected) < 1e-12);
});

test("BB-2: population actions are ranked by expected estimate improvement per second, zero-count actions dropped", () => {
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 0.9, timeMs: 50000, count: 3 }, // 1.44e-5 %/ms
        { name: "Investigation", pctPerSuccess: 0.4, chance: 1, timeMs: 40000, count: 3 },          // 1.0e-5
        { name: "Field Analysis", pctPerSuccess: 0.6, chance: 1, timeMs: 30000, count: Infinity },  // 2.0e-5
    ]), ["Field Analysis", "Undercover Operation", "Investigation"]);
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 1, timeMs: 50000, count: 0 },
        { name: "Field Analysis", pctPerSuccess: 0.1, chance: 1, timeMs: 30000, count: Infinity },
    ]), ["Field Analysis"]);
});

test("BB-2: ties keep the given order (rank-earning operations listed first win)", () => {
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 1, timeMs: 40000, count: 1 },
        { name: "Field Analysis", pctPerSuccess: 0.8, chance: 1, timeMs: 40000, count: Infinity },
    ]), ["Undercover Operation", "Field Analysis"]);
});

// BB-3: chaos above 50 multiplies action difficulty by sqrt(1 + chaos - 50) (Action.ts getChaosSuccessFactor) - a cliff, not a slope to
// --max-chaos. Diplomacy removes cha^0.045 + cha/1000 percent of the current city's chaos per 60 s (Bladeburner.ts getDiplomacyPercentage,
// City.ts changeChaosByPercentage: chaos *= 1 + p/100).
test("BB-3: chaos penalty is a cliff at 50", () => {
    assert.equal(chaosDifficultyMult(50), 1);
    assert.equal(chaosDifficultyMult(0), 1);
    assert.ok(Math.abs(chaosDifficultyMult(51) - Math.SQRT2) < 1e-12);
    assert.ok(Math.abs(chaosDifficultyMult(100) - Math.sqrt(51)) < 1e-12);
});

test("BB-3: diplomacy rate and time to reach the threshold", () => {
    assert.ok(Math.abs(diplomacyPctPerMinute(500) - (Math.pow(500, 0.045) + 0.5)) < 1e-12); // ~1.82 %/min
    assert.equal(diplomacyMinutesTo(40, 50, 500), 0);
    const minutes = diplomacyMinutesTo(60, 50, 500);
    assert.ok(minutes > 9 && minutes < 11, `expected ~10 minutes, got ${minutes}`);
});

test("BB-3: Diplomacy beats working under the penalty over an hour's stay, never at or below the threshold, not for a short stay", () => {
    assert.equal(shouldRunDiplomacy(60, 50, 500, 60), true);  // ~10 min of Diplomacy vs ~42 min-equivalents of rank lost
    assert.equal(shouldRunDiplomacy(51, 50, 100, 60), true);  // ~1.5 min vs ~17.6
    assert.equal(shouldRunDiplomacy(50, 50, 500, 60), false);
    assert.equal(shouldRunDiplomacy(60, 50, 500, 5), false);  // 9.9 min > 5 * 0.70
});

// Fix round 1: the difficulty penalty the pay-off protects against is the game's fixed cliff (Action.ts getChaosSuccessFactor always uses 50),
// never --chaos-recovery-threshold. At chaos 51 the real penalty is only x1.41 (lostFraction ~0.29); if the pay-off wrongly used
// chaosDifficultyMult(chaos, 5) for a low --chaos-recovery-threshold of 5, it would compute x6.86 (lostFraction ~0.85) and wrongly say "yes".
test("BB-3: the pay-off's difficulty penalty always uses the game's fixed 50 cliff, not --chaos-recovery-threshold", () => {
    assert.equal(shouldRunDiplomacy(51, 5, 5000, 60), false);
});

// BB-4: Skill.ts calculateCost is linear in level (baseCost + costInc * level, x BitNode mult), so the per-level increment is
// costForTwo - 2 * costForOne. Cloak at level 10: cost for one 13, for two 27 (increment ~1.1, rounded).
test("BB-4: bulk count stops at the perceived-cost crossover, at affordability, and at max level", () => {
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 1000), 8);      // levels 11..18 cost 14..21, x1.5 stays <= 30 up to 20 (8 levels)
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 50), 3);        // 13 + 14 + 15 = 42 <= 50, +16 would exceed
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 1000, 2), 2);   // max level cap (Overclock 90)
    assert.equal(planSkillUpgradeCount(13, 27, 1, 100, 12), 0);         // cannot afford even one
    assert.equal(planSkillUpgradeCount(13, 27, 1, Infinity, 100), 6);   // no competing skill: 13+14+15+16+17+18 = 93
    assert.equal(planSkillUpgradeCount(13, 26, 1, 13, 39), 3);          // flat cost (rounding hid the increment): 3 x 13
    assert.equal(planSkillUpgradeCount(0, 0, 1, 10, 10), 0);            // unusable cost (null/Infinity from the API become 0/Infinity)
});

// Fix round 1: maxCount <= 0 (already at max level) must buy nothing; `count` was initialised to 1 before the `while (count < maxCount)` guard,
// so a maxCount of 0 (or negative) fell through to a return of 1.
test("BB-4: a non-positive maxCount buys nothing", () => {
    assert.equal(planSkillUpgradeCount(13, 27, 1, 100, 1000, 0), 0);
});
