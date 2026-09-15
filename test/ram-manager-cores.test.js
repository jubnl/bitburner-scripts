// test/ram-manager-cores.test.js
// HC-9: a home core costs 1e9 * 7.5^cores (src/PersonObjects/Player/PlayerObjectServerMethods.ts) for a 6.25% thread saving on home-run grow/weaken
// only, so it must be a small fraction of cash, not just "whatever budget is left after RAM".
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreWithinBudget } from "../Tasks/ram-manager.js";

test("the spec's example is refused: 40b cash, 10b left after RAM, 7.5b core", () => {
    assert.equal(coreWithinBudget(7.5e9, 40e9, 10e9, 0.05), false);
});

test("a core is bought when it fits the leftover budget and is under the cash fraction", () => {
    assert.equal(coreWithinBudget(7.5e9, 200e9, 10e9, 0.05), true);   // 3.75% of cash
    assert.equal(coreWithinBudget(7.5e9, 200e9, 5e9, 0.05), false);   // budget too small
    assert.equal(coreWithinBudget(56.25e9, 1e12, 100e9, 0.05), false); // 5.6% of cash
    assert.equal(coreWithinBudget(56.25e9, 1.2e12, 100e9, 0.05), true); // 4.7% of cash
});
