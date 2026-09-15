// HC-7: the basic (weaken/grow) XP farm must rank targets by an unweighted grow-exp rate; only hack-based farming is chance-weighted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { xpRatesPerRamSecond } from "../analyze-hack.js";

test("expRate keeps the chance-weighted hack formula (failed hack = 1/4 exp, plus recovery weaken cost)", () => {
    const hackExp = 30, hackChance = 0.5, hackCost = 1.7 * 10000 + 1.75 * 40000 * 0.002 / 0.05;
    const { expRate } = xpRatesPerRamSecond(hackExp, hackChance, hackCost, 1.75, 32000);
    const expected = hackExp * (hackChance + (1 - hackChance) / 4) * (1 + 0.002 / 0.05) / hackCost * 1000;
    assert.ok(Math.abs(expRate - expected) < 1e-12);
});

test("growExpRate ignores hack chance and charges only the grow's own RAM-time", () => {
    const a = xpRatesPerRamSecond(30, 0.55, 20000, 1.75, 32000); // server near the player's level: chance 0.55
    const b = xpRatesPerRamSecond(30, 1.0, 20000, 1.75, 32000);  // easy server: chance 1
    assert.equal(a.growExpRate, b.growExpRate, "chance does not matter for grow/weaken exp");
    assert.equal(a.growExpRate, 30 / (1.75 * 32000) * 1000);
    assert.ok(a.expRate < b.expRate, "the hack-based rate is still chance-weighted");
});
