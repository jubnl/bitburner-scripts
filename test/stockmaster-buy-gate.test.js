// SM-1: pre-4S the upstream --fracB liquidity gate stands; post-4S any cash above the --fracH floor plus two commissions is invested at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAffordToBuy } from "../stockmaster.js";

const commission = 100_000;

test("pre-4S keeps the fracB liquidity gate and ignores fracH", () => {
    assert.equal(canAffordToBuy(true, 41, 0, 100, 0.4, 0.1, commission), true);
    assert.equal(canAffordToBuy(true, 39, 0, 100, 0.4, 0.1, commission), false);
    assert.equal(canAffordToBuy(true, 39, 0, 100, 0.4, 0.001, commission), false);
});

test("post-4S buys once spendable cash exceeds the fracH floor by two commissions", () => {
    const corpus = 10e9;
    assert.equal(canAffordToBuy(false, 0.1 * corpus + 2 * commission + 1, 0, corpus, 0.4, 0.1, commission), true);
    assert.equal(canAffordToBuy(false, 0.1 * corpus + 2 * commission, 0, corpus, 0.4, 0.1, commission), false);
    assert.equal(canAffordToBuy(false, 0.2 * corpus, 0, corpus, 0.4, 0.1, commission), true); // 20% cash: the old 40% gate blocked this
    assert.equal(canAffordToBuy(false, 0.2 * corpus, 0.15 * corpus, corpus, 0.4, 0.1, commission), false); // the reserve is not spendable
    assert.equal(canAffordToBuy(false, 0.01 * corpus, 0, corpus, 0.4, 0.001, commission), true); // autopilot's BN8 fracH
});
