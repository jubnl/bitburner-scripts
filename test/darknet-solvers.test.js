import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, makeServer, feedback } from "./darknet-mock.js";
import { solve, BUDGETS, budgetFor, timingStep, indexFromTiming } from "../darknet/solvers.js";
import { logMatchesAttempt, FEEDBACK_MODELS } from "../darknet/lib.js";

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
            assert.ok(attempts <= budgetFor(detailsOf(s)), `${modelId} used ${attempts} > ${budgetFor(detailsOf(s))}`);
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
const ORACLE = ["NIL", "2G_cellular", "AccountsManager_4.2", "BellaCuore", "BigMo%od", "Factori-Os", "DeepGreen",
    "RateMyPix.Auth", "PHP 5.4", "KingOfTheHill", "OpenWebAccessPoint"];
for (const modelId of ORACLE) {
    test(`solves ${modelId} within budget`, async () => {
        for (const seed of [1, 2, 3, 4, 5]) for (const difficulty of [2, 9, 17, 26]) {
            const { r, attempts, s } = await runModel(modelId, difficulty, seed);
            assert.equal(r.password, s.password, `${modelId} seed ${seed} d${difficulty}`);
            assert.ok(attempts <= budgetFor(detailsOf(s)), `${modelId} seed ${seed} d${difficulty} used ${attempts} > ${budgetFor(detailsOf(s))}`);
        }
    });
}
// DN-F3: above difficulty 16 DeepGreen rolls a 62-symbol alphanumeric password 30% of the time
// (ServerGenerator.ts getMastermindHintConfig), and RateMyPix.Auth does above difficulty 8
// (getSpiceLevelConfig). Both then go through solveByExactCount, whose worst case is
// charset + L*(L-1)/2 attempts: 107 for DeepGreen at L=10, far above the old flat budget of 30.
// An alphanumeric roll with no digit is reported as passwordFormat "alphabetic" (getPasswordType).
for (const modelId of ["DeepGreen", "RateMyPix.Auth"]) {
    test(`solves alphanumeric and alphabetic ${modelId} passwords within budgetFor`, async () => {
        const formats = new Set();
        for (let seed = 1; seed <= 40; seed++) for (const difficulty of [17, 26, 35]) {
            const { r, attempts, s } = await runModel(modelId, difficulty, seed);
            formats.add(s.passwordFormat);
            assert.equal(r.password, s.password, `${modelId} seed ${seed} d${difficulty} (${s.passwordFormat}, L=${s.passwordLength})`);
            assert.ok(attempts <= budgetFor(detailsOf(s)), `${modelId} seed ${seed} d${difficulty} used ${attempts} > ${budgetFor(detailsOf(s))}`);
        }
        assert.ok(formats.has("alphanumeric") && formats.has("alphabetic"), `sampled formats: ${[...formats]}`);
    });
}
test("budgetFor is the flat BUDGETS entry unless the model's budget depends on the password", () => {
    assert.equal(budgetFor({ modelId: "TopPass" }), BUDGETS.TopPass);
    assert.equal(budgetFor({ modelId: "unknown-model" }), Infinity);
    assert.equal(budgetFor({ modelId: "DeepGreen", passwordLength: 10, passwordFormat: "alphanumeric" }), 62 + 45);
    assert.equal(budgetFor({ modelId: "DeepGreen", passwordLength: 3, passwordFormat: "numeric" }), 30, "the enumeration path keeps the old floor");
    assert.equal(budgetFor({ modelId: "RateMyPix.Auth", passwordLength: 14, passwordFormat: "alphabetic" }), 52 + 91);
});

test("clues are tried first", async () => {
    const s = makeServer("TopPass", 10, makeRng(9));
    let attempts = 0;
    const attemptFn = async (pw) => { attempts++; const f = feedback(s, pw); return { success: f.success, feedback: f }; };
    const r = await solve(detailsOf(s), attemptFn, { clues: ["nope", s.password] });
    assert.equal(r.password, s.password); assert.equal(attempts, 2); assert.equal(r.reason, "clue");
});

// DN-F2: for Pr0verFl0 (BufferOverflow) the game's logPasswordAttempt rewrites the log's
// passwordAttempted to `receivedBuffer` (src/DarkNet/models/packetSniffing.ts:99-119), which is
// the first password.length characters of the attempt padded with "ˍ" from the buffer
// (src/DarkNet/effects/authentication.ts:101-118). crack.js must recognise its own line anyway.
test("logMatchesAttempt reproduces the BufferOverflow buffer rewrite and stays exact elsewhere", () => {
    const L = 5; // server password length; the log line always carries exactly L characters
    const received = (attempt) => { const buffer = "ˍ".repeat(L) + "■".repeat(L); return (attempt.slice(0, buffer.length) + buffer.slice(attempt.length)).slice(0, L); };
    for (const attempt of ["hunter2", "abc", "abcde", "0000000000", "ab"]) {
        assert.equal(logMatchesAttempt("Pr0verFl0", { passwordAttempted: received(attempt) }, attempt), true, attempt);
    }
    assert.equal(logMatchesAttempt("Pr0verFl0", { passwordAttempted: received("hunter2") }, "huntXr2"), false, "another PID's clue");
    assert.equal(logMatchesAttempt("Pr0verFl0", { passwordAttempted: received("abc") }, "abd"), false);
    assert.equal(logMatchesAttempt("Pr0verFl0", {}, "abc"), false, "noise line without passwordAttempted");
    assert.equal(logMatchesAttempt("TopPass", { passwordAttempted: "hunter2" }, "hunter2"), true);
    assert.equal(logMatchesAttempt("TopPass", { passwordAttempted: "hunte" }, "hunter2"), false, "other models log the attempt verbatim");
});

test("every oracle solver is in FEEDBACK_MODELS and no direct solver is", () => {
    for (const modelId of ORACLE) assert.ok(FEEDBACK_MODELS.has(modelId), modelId);
    for (const modelId of [...DIRECT, "Pr0verFl0"]) assert.ok(!FEEDBACK_MODELS.has(modelId), modelId);
});

// R14: the authenticate delay itself encodes 2G_cellular's answer. effects.ts calculateAuthenticationTime adds
// `sharedChars * 50 * threadsFactor` ms (threadsFactor = 1 / (1 + 0.2 (t - 1))) and Darknet.ts passes
// getSharedChars(server.password, attempt) -- the same leading-match count the heartbleed message reports as
// "(i)". So the delay may REJECT a guess for free (i == prefix length); anything else buys the heartbleed.
test("timingStep and indexFromTiming mirror effects.ts sharedCharsExtraTime", () => {
    assert.equal(timingStep(1), 50);
    assert.equal(timingStep(6), 25);
    assert.equal(timingStep(undefined), 50, "unknown thread count: the single-thread step");
    assert.equal(indexFromTiming(4075, 4000, 25, 3), 3, "3 shared characters: wrong at index 3");
    assert.equal(indexFromTiming(4100, 4000, 25, 3), 4, "one more: the prefix grew");
    assert.equal(indexFromTiming(4081, 4000, 25, 3), 3, "6 ms of timer overshoot is within tolerance");
    assert.equal(indexFromTiming(4088, 4000, 25, 3), null, "half a step off: ambiguous");
    assert.equal(indexFromTiming(4050, 4000, 25, 3), null, "below the confirmed prefix: the base drifted");
    assert.equal(indexFromTiming(undefined, 4000, 25, 3), null, "no timing at all");
    assert.equal(indexFromTiming(4075, null, 25, 3), null, "uncalibrated");
});

/** An attemptFn that behaves like crack.js in the game: the mock's feedback, a delay of base + sharedChars * step
 * (+ jitter) measured around authenticate, feedback only on request, and a lazy fetchFeedback for the attempt
 * just made. `hb` counts the heartbleeds. */
function timedAttempt(s, hb, { threads = 6, base = 4000, jitter = () => 0 } = {}) {
    const step = timingStep(threads);
    return async (pw, needFeedback = true) => {
        const shared = [...s.password].findIndex((ch, i) => ch !== pw[i]);   // getSharedChars
        const elapsed = base() + (shared === -1 ? s.password.length : shared) * step + jitter();
        const f = feedback(s, pw);
        if (f.success) return { success: true, feedback: f, elapsed };
        if (!needFeedback) return { success: false, feedback: null, elapsed, fetchFeedback: async () => { hb.count++; return f; } };
        hb.count++;
        return { success: false, feedback: f, elapsed };
    };
}

test("2G_cellular rejects wrong guesses by the authenticate delay and heartbleeds once per prefix character", async () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const difficulty of [2, 9, 17, 26]) {
        const s = makeServer("2G_cellular", difficulty, makeRng(seed));
        const hb = { count: 0 };
        let attempts = 0;
        const timed = timedAttempt(s, hb, { base: () => 4000 });
        const r = await solve(detailsOf(s), async (pw, need) => { attempts++; return timed(pw, need); }, { threads: 6 });
        assert.equal(r.password, s.password, `seed ${seed} d${difficulty}`);
        assert.ok(attempts <= budgetFor(detailsOf(s)), `seed ${seed} d${difficulty} used ${attempts}`);
        // One calibrating heartbleed on the first attempt, then one to confirm each prefix extension; the final
        // character is the success itself and needs none.
        assert.ok(hb.count <= s.password.length, `seed ${seed} d${difficulty}: ${hb.count} heartbleeds for L=${s.password.length}`);
        assert.ok(hb.count < attempts, "most attempts are settled by their own duration");
    }
});

test("2G_cellular survives timer jitter and a drifting base without a wrong prefix or an extra attempt", async () => {
    for (const seed of [1, 2, 3]) {
        const s = makeServer("2G_cellular", 17, makeRng(seed));
        const plain = { count: 0 };
        let plainAttempts = 0;
        const quiet = timedAttempt(s, plain, { base: () => 4000 });
        await solve(detailsOf(s), async (pw, need) => { plainAttempts++; return quiet(pw, need); }, { threads: 6 });

        let calls = 0;
        const hb = { count: 0 };
        let attempts = 0;
        const noisy = timedAttempt(s, hb, {
            base: () => (calls > 20 ? 3740 : 4000),                     // a stasis link released: 7 % less delay
            jitter: () => (++calls % 7 === 0 ? 600 : (calls % 3 === 0 ? 9 : 0)),   // a throttled timer, then small overshoot
        });
        const r = await solve(detailsOf(s), async (pw, need) => { attempts++; return noisy(pw, need); }, { threads: 6 });
        assert.equal(r.password, s.password, `seed ${seed}`);
        assert.equal(attempts, plainAttempts, "ambiguity is resolved by fetching feedback, never by re-authenticating");
        assert.ok(hb.count < attempts, `seed ${seed}: ${hb.count} heartbleeds for ${attempts} attempts`);
    }
});
