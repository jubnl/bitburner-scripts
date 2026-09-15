// HC-2: the host-manager budget must only be debited by purchased-server spend, never by home RAM/core upgrades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHostManagerBudget, parseSpendRecord } from "../daemon.js";

test("budget is 25% of hack income minus purchased-server spend", () => {
    assert.equal(computeHostManagerBudget(0.25, 100e9, 120e9, 5e9), 20e9);
});

test("budget ignores home upgrades: 14.7b of home RAM does not veto servers", () => {
    // Spec HC-2: after home reaches 4 TB (~14.7b under the old accounting) host-manager was not launched until hack income exceeded ~59b.
    // With purchased spend tracked separately (0 here), 10b of hack income already yields a 2.5b budget.
    assert.equal(computeHostManagerBudget(0.25, 10e9, 30e9, 0), 2.5e9);
});

test("budget falls back to 0.1% of total income and never goes negative", () => {
    assert.equal(computeHostManagerBudget(0.25, 0, 50e12, 0), 50e9); // hack income disabled, 0.1% of total
    assert.equal(computeHostManagerBudget(0.25, 1e9, 1e9, 10e9), 0);
});

test("parseSpendRecord mirrors host-manager's record format", () => {
    assert.equal(parseSpendRecord(JSON.stringify({ resetKey: 42, spent: 7e8 }), 42), 7e8);
    assert.equal(parseSpendRecord(JSON.stringify({ resetKey: 41, spent: 7e8 }), 42), 0);
    assert.equal(parseSpendRecord("", 42), 0);
});
