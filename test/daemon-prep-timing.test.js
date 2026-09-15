// HC-3: prep grow must resolve after the prep weaken (grow is sized for min security; the game reads hackDifficulty when the grow resolves,
// src/Server/formulas/grow.ts), and a second weaken must resolve after the grow to remove its hardening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepTiming } from "../daemon.js";

test("W-G-W: weaken lands first, grow one delay later, second weaken one delay after the grow", () => {
    const now = 1_000_000, W = 80_000, G = 64_000, d = 500;
    const t = prepTiming(now, W, G, d);
    assert.equal(t.weakenStart, now);
    assert.equal(t.growStart + G, now + W + d);          // grow lands d after W1
    assert.equal(t.weaken2Start + W, now + W + 2 * d);   // W2 lands d after the grow
    assert.ok(t.growStart < now + W, "grow starts before W1 lands, so its duration (read at current security) stays valid");
    assert.ok(t.weaken2Start < now + W, "W2 starts before W1 lands for the same reason");
});

test("already at min security: grow and W2 start immediately (W2 still lands after the grow since weaken time > grow time)", () => {
    const now = 1_000_000, W = 80_000, G = 64_000, d = 500;
    const t = prepTiming(now, W, G, d, false);
    assert.deepEqual(t, { weakenStart: now, growStart: now, weaken2Start: now });
    assert.ok(t.weaken2Start + W > t.growStart + G);
});
