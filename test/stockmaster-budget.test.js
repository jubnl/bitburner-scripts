// SM-3: the --diversification cap only applies pre-4S; with exact 4S forecasts the only position limit is the game's maxShares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { purchaseBudget } from "../stockmaster.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test("pre-4S caps a single stock at diversification (+spread) of max holdings, net of the inflated current position", () => {
    close(purchaseBudget(true, 5e9, 10e9, 0.34, 0.01, 0), 3.5e9); // cap binds (35% of 10b)
    close(purchaseBudget(true, 1e9, 1e9, 0.34, 0.01, 0), 3.5e8);
    assert.equal(purchaseBudget(true, 1e8, 10e9, 0.34, 0.01, 0), 1e8); // cash binds
    close(purchaseBudget(true, 5e9, 10e9, 0.34, 0.01, 3e9), 3.5e9 - 3e9 * 1.02); // existing position (inflated by 1.01 + spread) eats the cap
});

test("post-4S the whole cash budget is available for the best stock", () => {
    assert.equal(purchaseBudget(false, 1e9, 10e9, 0.34, 0.01, 0), 1e9);
    assert.equal(purchaseBudget(false, 1e9, 10e9, 0.34, 0.01, 5e9), 1e9);
});
