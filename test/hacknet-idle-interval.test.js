// HN-2: --interval 0 (daemon's kick-start) keeps buying back-to-back while purchases succeed, but never polls faster than the idle
// interval while the next purchase is unaffordable (upgradeHacknet returns 0) or nothing is bought (false).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLoopDelay } from "../hacknet-upgrade-manager.js";

test("a successful purchase keeps the configured interval", () => {
    assert.equal(nextLoopDelay(0, 1e6), 0);
    assert.equal(nextLoopDelay(1000, 1e6), 1000);
});

test("no purchase waits at least the idle interval", () => {
    assert.equal(nextLoopDelay(0, 0), 200);
    assert.equal(nextLoopDelay(0, false), 200);
    assert.equal(nextLoopDelay(50, 0), 200);
    assert.equal(nextLoopDelay(1000, 0), 1000);
    assert.equal(nextLoopDelay(0, 0, 500), 500);
});
