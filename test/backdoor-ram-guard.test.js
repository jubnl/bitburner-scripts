// test/backdoor-ram-guard.test.js
// HC-11: backdoor-one.js costs 1.6 + SF4Cost(2) GB = 33.6 GB below SF4.3, 8.6 GB at SF4.2, 3.6 GB at SF4.3 (src/Netscript/RamCostGenerator.ts SF4Cost),
// so the guard must use the measured cost and keep the reserve free *after* spawning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSpawnBackdoor } from "../Tasks/backdoor-all-servers.js";

test("SF4.3: 3.6 GB script, 22 GB reserve", () => {
    assert.equal(canSpawnBackdoor(30, 22, 3.6), true);
    assert.equal(canSpawnBackdoor(25, 22, 3.6), false);
});

test("below SF4.3: 33.6 GB script - the old '22 GB free' guard would have let ns.run fail instead", () => {
    assert.equal(canSpawnBackdoor(40, 22, 33.6), false);
    assert.equal(canSpawnBackdoor(56, 22, 33.6), true);
});
