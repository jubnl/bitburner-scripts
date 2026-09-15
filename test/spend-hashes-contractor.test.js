// HN-4: contracts are only generated while Tasks/contractor.js has written its heartbeat recently (contracts nobody solves are worth nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contractorIsActive, contractorHeartbeatFile } from "../spend-hacknet-hashes.js";

test("heartbeat path is the one contractor.js writes", () => {
    assert.equal(contractorHeartbeatFile, "/Temp/contractor-heartbeat.txt");
});

test("active only while the heartbeat is younger than max age", () => {
    const now = 1_700_000_000_000;
    assert.equal(contractorIsActive(String(now - 10_000), now, 300_000), true);
    assert.equal(contractorIsActive(String(now - 300_000), now, 300_000), true);
    assert.equal(contractorIsActive(String(now - 300_001), now, 300_000), false);
});

test("missing or malformed heartbeat is inactive", () => {
    assert.equal(contractorIsActive("", Date.now(), 300_000), false);
    assert.equal(contractorIsActive("not a number", Date.now(), 300_000), false);
});
