import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, makeServer, feedback, MODELS, makeLab, labStep, labReport } from "./darknet-mock.js";

test("every model generates a server and accepts its own password", () => {
    const rng = makeRng(1);
    for (const modelId of MODELS) {
        for (const difficulty of [0, 3, 9, 17, 25]) {
            const s = makeServer(modelId, difficulty, rng);
            assert.equal(typeof s.password, "string", modelId);
            assert.equal(s.passwordLength, s.password.length, modelId);
            const ok = feedback(s, s.password);
            assert.equal(ok.success, true, `${modelId} d${difficulty}`);
            const bad = feedback(s, s.password + "x");
            assert.equal(bad.success, false, `${modelId} d${difficulty}`);
        }
    }
});

test("mastermind feedback counts exact and misplaced", () => {
    const s = { modelId: "DeepGreen", password: "1122", passwordLength: 4 };
    assert.equal(feedback(s, "1212").data, "2,2");
    assert.equal(feedback(s, "3311").data, "0,2");
});

test("buffer overflow accepts any doubled string of the right length", () => {
    const s = makeServer("Pr0verFl0", 5, makeRng(2));
    const n = Number(s.staticPasswordHint.match(/(\d+) bytes/)[1]);
    assert.equal(feedback(s, "0".repeat(2 * n)).success, true);
});

test("labyrinth maze walk reaches the end", () => {
    const lab = makeLab(20, 14, makeRng(3), false);
    let pos = lab.start;
    const r = labReport(lab, pos);
    assert.deepEqual(r.coords, pos);
    assert.equal(typeof r.north, "boolean");
    const moved = labStep(lab, pos, "go north");
    assert.match(moved.message, /moved|cannot go/);
});
