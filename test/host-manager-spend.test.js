// HC-2: host-manager.js keeps its own purchased-server spend record so daemon.js's budget is not debited by home RAM/core upgrades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSpendRecord } from "../host-manager.js";

test("readSpendRecord returns the recorded spend for the current install", () => {
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: 4.5e9 }), 1700000000000), 4.5e9);
});

test("readSpendRecord returns 0 for another install, an empty file, or garbage", () => {
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1600000000000, spent: 4.5e9 }), 1700000000000), 0);
    assert.equal(readSpendRecord("", 1700000000000), 0);
    assert.equal(readSpendRecord("not json", 1700000000000), 0);
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: "NaN" }), 1700000000000), 0);
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: -5 }), 1700000000000), 0);
});
