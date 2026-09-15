// ST-1: in --top-up mode stanek.js charges each stat fragment (id < 100) once above its peak; boosters, already-topped-up fragments
// and fragments flagged as not accepting charge (chargeAttempts == 2) are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTopUpFragments } from "../stanek.js";

const frag = (id, extra = {}) => ({ id, x: 0, y: 0, highestCharge: 48, numCharge: 120, ...extra });

test("selects stat fragments that have not been topped up this run", () => {
    const fragments = [frag(0), frag(5), frag(25), frag(100), frag(101)];
    assert.deepEqual(selectTopUpFragments(fragments, new Set(), {}).map(f => f.id), [0, 5, 25]);
    assert.deepEqual(selectTopUpFragments(fragments, new Set([0, 25]), {}).map(f => f.id), [5]);
    assert.deepEqual(selectTopUpFragments(fragments, new Set([0, 5, 25]), {}), []);
});

test("skips fragments marked as not accepting charge", () => {
    const fragments = [frag(0), frag(5)];
    assert.deepEqual(selectTopUpFragments(fragments, new Set(), { 5: 2 }).map(f => f.id), [0]);
    assert.deepEqual(selectTopUpFragments(fragments, new Set(), { 5: 1 }).map(f => f.id), [0, 5]);
});
