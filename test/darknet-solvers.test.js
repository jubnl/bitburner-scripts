import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, makeServer, feedback } from "./darknet-mock.js";
import { solve, BUDGETS } from "../darknet/solvers.js";

function detailsOf(s) {
    return { hostname: s.hostname, modelId: s.modelId, passwordHint: s.staticPasswordHint, data: s.passwordHintData,
        passwordLength: s.passwordLength, passwordFormat: s.passwordFormat, difficulty: s.difficulty };
}
export async function runModel(modelId, difficulty, seed) {
    const s = makeServer(modelId, difficulty, makeRng(seed));
    let attempts = 0;
    const attemptFn = async (pw) => { attempts++; const f = feedback(s, pw); return { success: f.success, feedback: f }; };
    const r = await solve(detailsOf(s), attemptFn, {});
    return { r, attempts, s };
}
const DIRECT = ["ZeroLogon", "DeskMemo_3.1", "FreshInstall_1.0", "Laika4", "TopPass", "EuroZone Free", "CloudBlare(tm)",
    "110100100", "OrdoXenos", "PrimeTime 2", "OctantVoxel", "MathML"];
for (const modelId of DIRECT) {
    test(`solves ${modelId} within budget`, async () => {
        for (const seed of [1, 2, 3, 4, 5]) for (const difficulty of [1, 6, 13, 20]) {
            const { r, attempts, s } = await runModel(modelId, difficulty, seed);
            assert.equal(r.password, s.password, `${modelId} seed ${seed} d${difficulty}`);
            assert.ok(attempts <= BUDGETS[modelId], `${modelId} used ${attempts} > ${BUDGETS[modelId]}`);
        }
    });
}
// Pr0verFl0 (BufferOverflow) is tested separately from the other direct models: with
// BUDGETS.Pr0verFl0 === 1, the only single-attempt strategy that always succeeds is the
// buffer-overflow exploit (submit any doubled string of the right total length -- see the
// solver's implementation note and the mock's own "buffer overflow accepts any doubled
// string" test in darknet-mock.test.js). That exploit succeeds independent of content --
// ported verbatim from bitburner-src/src/DarkNet/effects/authentication.ts, whose own
// comment says the buffer comparison "can 'trick' the comparison into matching" -- so the
// string that authenticates is never the mock's internal ground-truth `s.password` (except
// by astronomical chance). So this test asserts the returned password actually authenticates
// against the mock, rather than asserting string equality to `s.password` as the shared
// DIRECT loop above does for the other 12 models (all of which are solved exactly, not via
// an exploit, so string equality holds for them).
test("solves Pr0verFl0 within budget (buffer-overflow exploit accepts any doubled string)", async () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const difficulty of [1, 6, 13, 20]) {
        const { r, attempts, s } = await runModel("Pr0verFl0", difficulty, seed);
        assert.ok(r.password !== null, `Pr0verFl0 seed ${seed} d${difficulty} should solve`);
        assert.equal(r.password.length, 2 * s.passwordLength, `Pr0verFl0 seed ${seed} d${difficulty}`);
        assert.equal(feedback(s, r.password).success, true, `Pr0verFl0 seed ${seed} d${difficulty} returned password must authenticate`);
        assert.ok(attempts <= BUDGETS.Pr0verFl0, `Pr0verFl0 used ${attempts} > ${BUDGETS.Pr0verFl0}`);
    }
});
test("clues are tried first", async () => {
    const s = makeServer("TopPass", 10, makeRng(9));
    let attempts = 0;
    const attemptFn = async (pw) => { attempts++; const f = feedback(s, pw); return { success: f.success, feedback: f }; };
    const r = await solve(detailsOf(s), attemptFn, { clues: ["nope", s.password] });
    assert.equal(r.password, s.password); assert.equal(attempts, 2); assert.equal(r.reason, "clue");
});
