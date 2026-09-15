// Pure solver library for the Darknet password-cracking minigame. No `ns`, no imports
// from `test/`. Loaded by darknet/crack.js (a real NS agent script), so every export here
// must cost 0 GB of RAM.
//
// NOTE: some object keys below are written as quoted string literals (e.g. "share" would
// be, if it appeared) instead of bare identifiers, and locals that would otherwise shadow
// an NS function name are deliberately renamed (attemptFn/tryPw instead of `attempt`, etc).
// This is deliberate: Bitburner charges RAM for any bare identifier that matches an NS
// function name, regardless of whether it's actually called as a function. See
// darknet/lib.js for the same convention and the RAM-collision check this file must pass.

// ---- dictionaries, copied verbatim from DarkNet/models/dictionaryData.ts ----
export const COMMON_PASSWORDS = [
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567", "dragon",
    "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow", "master", "666666",
    "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321", "superman", "1qaz2wsx", "7777777",
    "121212", "0", "qazwsx", "123qwe", "trustno1", "jordan", "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster",
    "soccer", "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert",
    "thomas", "hockey", "ranger", "daniel", "starwars", "112233", "george", "computer", "michelle", "jessica",
    "pepper", "1111", "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
    "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love", "ashley", "6969", "nicole",
    "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas", "austin", "thunder", "taylor",
    "matrix",
];

export const EU_COUNTRIES = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark", "Estonia",
    "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
    "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
];

// Prime lists used by Factori-Os, copied verbatim from ServerGenerator.ts's
// smallPrimes/largePrimes (getLargestPrimeFactorPassword / getPasswordMadeUpOfPrimesProduct),
// NOT from test/darknet-mock.js.
export const SMALL_PRIMES = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
];
export const LARGE_PRIMES = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
    2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
    4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
    6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
    9343, 9467, 9551, 9601, 9739, 9749, 9859,
];

// ---- budget-exceeded sentinel, thrown by solve()'s attempt wrapper and caught by solve() ----
class BudgetExceeded extends Error {}

// ---- small shared helpers ----

// Builds a solver that walks a fixed dictionary in order, trying each entry until one
// succeeds. Used for the FreshInstall_1.0 / Laika4 / TopPass / EuroZone Free models.
function dict(list) {
    return async (d, tryPw) => {
        for (const pw of list) {
            if ((await tryPw(pw)).success) return pw;
        }
        return null;
    };
}

// Strips the MathML model's decorative substitutions and any injected code-execution
// suffix from the raw expression hint, leaving a plain "+ - * / ( ) number" expression.
function cleanExpression(s) {
    return s.replace(/ҳ/g, "*").replace(/÷/g, "/").replace(/➕/g, "+").replace(/➖/g, "-").replace(/ns\.exit\(\),/g, "").split(",")[0];
}

// ---- exported helpers used by Task 3's solvers and tests ----

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

// Mirrors the game's romanNumeralEncoder's fallback of "nulla" for zero, and standard
// subtractive-notation parsing (a numeral followed by a strictly larger one is subtracted).
export function romanToInt(s) {
    if (s === "nulla") return 0;
    let total = 0;
    for (let i = 0; i < s.length; i++) {
        const current = ROMAN_VALUES[s[i]];
        const following = ROMAN_VALUES[s[i + 1]];
        if (following !== undefined && current < following) {
            total -= current;
        } else {
            total += current;
        }
    }
    return total;
}

const BASE_N_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Mirrors the game's parseBaseNNumberString exactly (ServerGenerator.ts): digits 0-9A-Z,
// a "." separates the fractional part, each digit weighted by base**position -- including
// fractional bases like 7.3, since `base` is only ever used as an exponent base, never
// itself parsed digit-by-digit.
export function parseBaseN(str, base) {
    let result = 0;
    let index = 0;
    let digit = str.split(".")[0].length - 1;
    while (index < str.length) {
        const currentDigit = str[index];
        if (currentDigit === ".") {
            index += 1;
            continue;
        }
        result += BASE_N_DIGITS.indexOf(currentDigit) * base ** digit;
        index += 1;
        digit -= 1;
    }
    return result;
}

// Hand-written recursive-descent parser/evaluator for "+ - * / ( ) number" expressions
// (decimals allowed). Deliberately never uses eval/Function -- the MathML model's hint
// text is untrusted input straight from the game (and, per the game's own source, is
// sometimes a deliberate code-injection attempt).
function tokenizeArithmetic(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === " ") {
            i += 1;
            continue;
        }
        if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "(" || ch === ")") {
            tokens.push(ch);
            i += 1;
            continue;
        }
        if (ch >= "0" && ch <= "9") {
            let j = i;
            while (j < expr.length && ((expr[j] >= "0" && expr[j] <= "9") || expr[j] === ".")) j += 1;
            tokens.push(expr.slice(i, j));
            i = j;
            continue;
        }
        throw new Error(`evalArithmetic: unexpected character '${ch}'`);
    }
    return tokens;
}

export function evalArithmetic(expr) {
    const tokens = tokenizeArithmetic(expr);
    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function parseExpr() {
        let value = parseTerm();
        while (peek() === "+" || peek() === "-") {
            const op = consume();
            const rhs = parseTerm();
            value = op === "+" ? value + rhs : value - rhs;
        }
        return value;
    }

    function parseTerm() {
        let value = parseFactor();
        while (peek() === "*" || peek() === "/") {
            const op = consume();
            const rhs = parseFactor();
            value = op === "*" ? value * rhs : value / rhs;
        }
        return value;
    }

    function parseFactor() {
        const tok = consume();
        if (tok === "(") {
            const value = parseExpr();
            if (consume() !== ")") throw new Error("evalArithmetic: expected ')'");
            return value;
        }
        if (tok === "-") return -parseFactor();
        if (tok === "+") return parseFactor();
        const value = Number(tok);
        if (Number.isNaN(value)) throw new Error(`evalArithmetic: bad number '${tok}'`);
        return value;
    }

    const result = parseExpr();
    if (pos !== tokens.length) throw new Error("evalArithmetic: unexpected trailing tokens");
    return result;
}

// ---- Task 3: oracle-driven solver helpers ----

const NUMERIC_CHARS = "0123456789";
const ALPHA_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Numeric charset is "0123456789"; alphanumeric adds lowercase then uppercase (matches the
// game's `letters` = lowercase + uppercase, ServerGenerator.ts's `numbers + letters`).
// passwordFormat is getPasswordType(password) (ServerGenerator.ts), so a letters-allowed
// password that happens to contain no digit is reported as "alphabetic": letters only.
function charset(d) {
    if (d.passwordFormat === "alphanumeric") return NUMERIC_CHARS + ALPHA_CHARS;
    if (d.passwordFormat === "alphabetic") return ALPHA_CHARS;
    return NUMERIC_CHARS;
}

// 2G_cellular's timing side channel (R14). effects.ts calculateAuthenticationTime adds
// `sharedChars * 50 * threadsFactor` ms to the authenticate delay, with threadsFactor = 1 / (1 + 0.2 (t - 1))
// and sharedChars = getSharedChars(server.password, attempt) (Darknet.ts:125), the leading-match count that
// the heartbleed message also reports. The extra time is added after the intelligence bonus, so the step is
// exactly this; the base delay is measured, never computed (it depends on charisma, backdoors, SF15, ...).
export const TIMING_TOLERANCE = 0.25;   // of a step: further from an integer than this is ambiguous
export function timingStep(threads) {
    const t = Math.max(1, Math.floor(Number(threads) || 1));
    return 50 / (1 + 0.2 * (t - 1));
}
/** The mismatch index an attempt's own duration implies, or null when it cannot be trusted: no timing,
 * uncalibrated, between two integers (timer jitter), or below the already confirmed prefix (the base delay
 * drifted -- a charisma level, a stasis link made or released -- and must be recalibrated from feedback). */
export function indexFromTiming(elapsed, base, step, prefixLength) {
    if (!Number.isFinite(elapsed) || !Number.isFinite(base) || !(step > 0)) return null;
    const raw = (elapsed - base) / step;
    const idx = Math.round(raw);
    if (Math.abs(raw - idx) > TIMING_TOLERANCE) return null;
    if (idx < prefixLength) return null;
    return idx;
}
// "Found a mismatch while checking each character (i)" -> i, or null without such a message.
function feedbackIndex(fb) {
    const m = String(fb?.message ?? "").match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
}

// Worst case of solveByExactCount: (charset - 1) multiset probes, at most L*(L-1)/2 positional
// probes (all L symbols distinct) and one final attempt = charset + L*(L-1)/2.
function exactCountBudget(d) {
    const L = Number(d.passwordLength) || 0;
    return charset(d).length + (L * (L - 1)) / 2;
}

// All length-L strings over charset cs, in charset order. Only used when cs.length**L is
// small enough to enumerate (DeepGreen's exact-search branch).
function allStrings(cs, L) {
    let result = [""];
    for (let i = 0; i < L; i++) {
        const next = [];
        for (const prefix of result) for (const c of cs) next.push(prefix + c);
        result = next;
    }
    return result;
}

// Ported verbatim from DarkNet/utils/darknetAuthUtils.ts.
function getExactCorrectCharsCount(password, attempted) {
    let count = 0;
    for (let i = 0; i < password.length; i++) if (password[i] === attempted[i]) count += 1;
    return count;
}
function getMisplacedCorrectCharsCount(password, attempted) {
    const remainingPasswordChars = password.split("").filter((digit, i) => digit !== attempted[i]);
    const remainingAttemptedChars = attempted.split("").filter((digit, i) => digit !== password[i]);
    return remainingAttemptedChars.filter((digit, i) => {
        const isPresentInPassword = remainingPasswordChars.includes(digit);
        const countInAttemptedThusFar = remainingAttemptedChars.slice(0, i).filter((prevDigit) => prevDigit === digit).length;
        const countInPassword = remainingPasswordChars.filter((prevDigit) => prevDigit === digit).length;
        return isPresentInPassword && countInAttemptedThusFar < countInPassword;
    }).length;
}
// score(candidate, guess): as if `candidate` were the true password and `guess` the attempt,
// returns [exact, misplaced] with the game's duplicate-aware counting.
function score(password, attempted) {
    return [getExactCorrectCharsCount(password, attempted), getMisplacedCorrectCharsCount(password, attempted)];
}

// Submits mid = floor((lo+hi)/2); returns on success; moves lo = mid+1 when tooLow(feedback)
// is true, else hi = mid-1. Returns null if the range is exhausted without a match.
async function binarySearch(a, lo, hi, tooLow) {
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const r = await a(String(mid));
        if (r.success) return String(mid);
        if (tooLow(r.feedback)) lo = mid + 1;
        else hi = mid - 1;
    }
    return null;
}

// Standard extended-Euclidean-based modular inverse and CRT (moduli must be pairwise coprime).
function egcd(a, b) {
    let [oldR, r] = [a, b];
    let [oldS, s] = [1n, 0n];
    while (r !== 0n) {
        const q = oldR / r;
        [oldR, r] = [r, oldR - q * r];
        [oldS, s] = [s, oldS - q * s];
    }
    return [oldR, oldS];
}
function modInverse(a, m) {
    const [g, x] = egcd(((a % m) + m) % m, m);
    if (g !== 1n) throw new Error("modInverse: moduli not coprime");
    return ((x % m) + m) % m;
}
function crt(mods, residues) {
    let modulus = 1n;
    for (const m of mods) modulus *= m;
    let result = 0n;
    for (let i = 0; i < mods.length; i++) {
        const partial = modulus / mods[i];
        const inv = modInverse(partial, mods[i]);
        result = (result + ((residues[i] * partial * inv) % modulus)) % modulus;
    }
    return ((result % modulus) + modulus) % modulus;
}

// Distinct (multiset-aware) permutations of a string, e.g. "112" -> ["112","121","211"].
function uniquePermutations(str) {
    const chars = str.split("").sort();
    const used = Array(chars.length).fill(false);
    const current = [];
    const results = [];
    (function backtrack() {
        if (current.length === chars.length) {
            results.push(current.join(""));
            return;
        }
        for (let i = 0; i < chars.length; i++) {
            if (used[i]) continue;
            if (i > 0 && chars[i] === chars[i - 1] && !used[i - 1]) continue;
            used[i] = true;
            current.push(chars[i]);
            backtrack();
            current.pop();
            used[i] = false;
        }
    })();
    return results;
}

// Parses "RMS Deviation:(\d+\.\d+)" out of a SortedEchoVuln (PHP 5.4) feedback object
// (f = r.feedback, so this reads f.data). Returns Infinity if absent (e.g. the probe's
// length didn't match, or the model's password is under 5 chars).
function rmsd(f) {
    const m = (f.data ?? "").match(/RMS Deviation:(\d+\.\d+)/);
    return m ? Number(m[1]) : Infinity;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function substrings(str, len) {
    const result = [];
    for (let i = 0; i + len <= str.length; i++) result.push(str.slice(i, i + len));
    return result;
}

// Shared oracle-driven positional solver used by DeepGreen and RateMyPix.Auth once their
// guess space (cs.length ** L) is too large to enumerate or to brute-force scan
// position-by-position (a blind O(L * cs.length) scan). Both models' feedback reduces, for a
// guess made of a single repeated character c, to "how many positions equal c" (DeepGreen:
// the exact component of [exact,misplaced] -- a uniform guess always yields misplaced===0
// per getMisplacedCorrectCharsCount, since no character can be "remaining" at a position
// where the uniform guess didn't already match it there or nowhere; RateMyPix.Auth: the
// pepper count). `exactCount(feedback)` extracts that number from a model's own feedback
// shape. Strategy: (1) learn each charset symbol's total occurrence count via one
// "c repeated L times" query per symbol (skip the last, infer its count from the rest --
// this alone identifies the full multiset in cs.length-1 queries, independent of L); (2)
// resolve each position via isolated single-character probes drawn only from symbols still
// remaining in the multiset (all other positions filled with a filler character guaranteed
// absent from any charset password), removing a resolved symbol from the pool once its count
// is exhausted so later positions have fewer candidates left to try. Total queries are
// bounded by roughly cs.length + L*(L-1)/2 instead of L*cs.length.
const FILLER = "_";
async function solveByExactCount(L, cs, a, exactCount) {
    const remaining = new Map();
    let accounted = 0;
    for (let i = 0; i < cs.length - 1; i++) {
        const c = cs[i];
        const guess = c.repeat(L);
        const r = await a(guess);
        if (r.success) return guess;
        const n = exactCount(r.feedback);
        if (n > 0) remaining.set(c, n);
        accounted += n;
    }
    const lastCount = L - accounted;
    if (lastCount > 0) remaining.set(cs[cs.length - 1], lastCount);

    const pw = Array(L).fill(null);
    for (let i = 0; i < L; i++) {
        const candidates = [...remaining.keys()];
        if (candidates.length === 0) return null;
        let found = null;
        for (let ci = 0; ci < candidates.length; ci++) {
            const c = candidates[ci];
            if (ci === candidates.length - 1) {
                found = c;
                break;
            }
            const guess = FILLER.repeat(i) + c + FILLER.repeat(L - i - 1);
            const r = await a(guess);
            if (r.success) return guess;
            if (exactCount(r.feedback) === 1) {
                found = c;
                break;
            }
        }
        pw[i] = found;
        const cnt = remaining.get(found) - 1;
        if (cnt <= 0) remaining.delete(found);
        else remaining.set(found, cnt);
    }
    const final = pw.join("");
    return (await a(final)).success ? final : null;
}

// ---- direct-decode and dictionary solvers, one per crackable model ----
export const SOLVERS = {
    ZeroLogon: async (d, tryPw) => (await tryPw("")).success ? "" : null,
    "DeskMemo_3.1": async (d, tryPw) => {
        const pw = d.passwordHint.trim().split(/\s+/).pop();
        return (await tryPw(pw)).success ? pw : null;
    },
    "FreshInstall_1.0": dict(["admin", "password", "0000", "12345"]),
    Laika4: dict(["fido", "spot", "rover", "max"]),
    TopPass: dict(COMMON_PASSWORDS),
    "EuroZone Free": dict(EU_COUNTRIES),
    "CloudBlare(tm)": async (d, tryPw) => {
        const pw = d.data.replace(/[^0-9]/g, "");
        return (await tryPw(pw)).success ? pw : null;
    },
    Pr0verFl0: async (d, tryPw) => {
        const n = Number((d.passwordHint.match(/(\d+) bytes/) || [])[1] || d.passwordLength);
        const pw = "0".repeat(2 * n);
        return (await tryPw(pw)).success ? pw : null;
    },
    "110100100": async (d, tryPw) => {
        const pw = d.data.trim().split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join("");
        return (await tryPw(pw)).success ? pw : null;
    },
    OrdoXenos: async (d, tryPw) => {
        const [cipher, maskStr] = d.data.split(";");
        const masks = maskStr.trim().split(/\s+/);
        const pw = [...cipher].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ parseInt(masks[i], 2))).join("");
        return (await tryPw(pw)).success ? pw : null;
    },
    "PrimeTime 2": async (d, tryPw) => {
        let n = BigInt(d.data.trim());
        let best = 1n;
        for (let p = 2n; p * p <= n; p++) {
            while (n % p === 0n) {
                best = p;
                n /= p;
            }
        }
        if (n > 1n) best = n;
        const pw = best.toString();
        return (await tryPw(pw)).success ? pw : null;
    },
    OctantVoxel: async (d, tryPw) => {
        const [baseStr, enc] = d.data.split(",");
        const pw = String(Math.round(parseBaseN(enc.trim(), Number(baseStr))));
        return (await tryPw(pw)).success ? pw : null;
    },
    MathML: async (d, tryPw) => {
        const pw = String(evalArithmetic(cleanExpression(d.data)));
        return (await tryPw(pw)).success ? pw : null;
    },

    // ---- Task 3: oracle-driven solvers ----

    // Per-position yes/yesn't oracle: guessing c.repeat(L) reveals, per position, whether
    // that position's character is c (via the "yes"/"yesn't" CSV in feedback.data).
    NIL: async (d, tryPw) => {
        const L = d.passwordLength, cs = charset(d), known = Array(L).fill(null);
        for (const c of cs) {
            const r = await tryPw(c.repeat(L));
            if (r.success) return c.repeat(L);
            r.feedback.data.split(",").forEach((v, i) => {
                if (v === "yes") known[i] = c;
            });
            if (known.every((k) => k !== null)) {
                const pw = known.join("");
                return (await tryPw(pw)).success ? pw : null;
            }
        }
        return null;
    },

    // Prefix oracle: "Found a mismatch while checking each character (i)" -- i counts
    // leading matching characters, so extending the confirmed prefix by one correct
    // character always pushes the mismatch index strictly past the prefix's old length.
    // The authenticate delay encodes the same i (timingStep / indexFromTiming, R14): after one
    // calibrating heartbleed, an attempt's own duration REJECTS a wrong guess for free (i equals
    // the prefix length, the common case); a longer, ambiguous or uncalibrated reading buys the
    // heartbleed for that attempt (fetchFeedback, no second authenticate) and recalibrates.
    "2G_cellular": async (d, tryPw, opts = {}) => {
        const L = d.passwordLength, cs = charset(d);
        const step = timingStep(opts.threads);
        let base = null;                        // measured delay at 0 shared characters; null until the first feedback
        const mismatchIndex = async (guess, prefixLength) => {
            let r = await tryPw(guess, base === null);
            if (r.success) return { success: true, idx: L };
            let idx = feedbackIndex(r.feedback);
            if (idx === null) {
                const timed = indexFromTiming(r.elapsed, base, step, prefixLength);
                if (timed === prefixLength) return { success: false, idx: timed };
                const fb = typeof r.fetchFeedback === "function" ? await r.fetchFeedback() : null;
                idx = feedbackIndex(fb);
                if (idx === null) {                 // no fetcher, or another pid's line came back: once more, with feedback
                    r = await tryPw(guess, true);
                    if (r.success) return { success: true, idx: L };
                    idx = feedbackIndex(r.feedback);
                    if (idx === null) return { success: false, idx: -1 };
                }
            }
            if (Number.isFinite(r.elapsed)) base = r.elapsed - idx * step;   // every feedback recalibrates
            return { success: false, idx };
        };
        let prefix = "";
        while (prefix.length < L) {
            let found = false;
            for (const c of cs) {
                const guess = (prefix + c).padEnd(L, cs[0]);
                const r = await mismatchIndex(guess, prefix.length);
                if (r.success) return guess;
                if (r.idx > prefix.length) {
                    prefix += c;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }
        return null;
    },

    // Higher/lower guessing game: feedback.data is "Higher" when the guess was too low
    // (go higher), "Lower" when it was too high.
    "AccountsManager_4.2": async (d, tryPw) => binarySearch(tryPw, 0, 10 ** d.passwordLength - 1, (f) => f.data === "Higher"),

    // Roman-numeral clue. Below difficulty 8 the hint is a single exact value (no comma);
    // otherwise it's a "min,max" range and the failure data says ALTUS NIMIS (too high) or
    // PARUM BREVIS (too low).
    BellaCuore: async (d, tryPw) => {
        if (!d.data.includes(",")) {
            const pw = String(romanToInt(d.data.trim()));
            return (await tryPw(pw)).success ? pw : null;
        }
        const [lo, hi] = d.data.split(",").map((s) => romanToInt(s.trim()));
        return binarySearch(tryPw, lo, hi, (f) => f.data === "PARUM BREVIS");
    },

    // CRT: probing n = 10^15 + r for r in a set of pairwise-coprime moduli < 32 gives back
    // P mod r directly, because n > P (so P % n === P) and (n-1)%32+1 === r (10^15 is a
    // multiple of 32, so (n-1)%32 === (r-1)%32 === r-1 for every r below). Once every
    // residue is known, CRT reconstructs P mod (product of moduli), which comfortably
    // exceeds any password this model can generate. Uses 10^15 rather than the more obvious
    // 10^16: checkPassword computes `Number(attempt)` internally, and 10^16-plus-a-few is
    // already past Number.MAX_SAFE_INTEGER (~9.007e15), so different residues r collide onto
    // the same rounded double and the oracle answers get corrupted. 10^15 keeps every probe
    // exactly representable as a double while still comfortably exceeding any password this
    // model generates (at most 9-10 digits).
    "BigMo%od": async (d, tryPw) => {
        const mods = [31, 29, 27, 25, 23, 19, 17, 13, 11];
        const res = [];
        for (const r of mods) {
            const n = 10n ** 15n + BigInt(r);
            const f = await tryPw(n.toString());
            if (f.success) return n.toString();
            res.push(BigInt(f.feedback.data));
        }
        const pw = crt(mods.map(BigInt), res).toString();
        return (await tryPw(pw)).success ? pw : null;
    },

    // Divisibility oracle over the game's own prime lists -- every Factori-Os password is
    // built exclusively as a product of small/large primes (getPasswordMadeUpOfPrimesProduct),
    // so no other prime can ever divide it. For each prime p, test p, p^2, p^3, ... while the
    // oracle reports divisible, then move to the next prime.
    "Factori-Os": async (d, tryPw) => {
        let product = 1n;
        const limit = 10n ** BigInt(d.passwordLength);
        for (const p of [...SMALL_PRIMES, ...LARGE_PRIMES]) {
            let q = BigInt(p);
            while (q <= limit) {
                const f = await tryPw(q.toString());
                if (f.success) return q.toString();
                if (f.feedback.data !== "true") break;
                product *= BigInt(p);
                q *= BigInt(p);
            }
        }
        const pw = product.toString();
        return (await tryPw(pw)).success ? pw : null;
    },

    // Mastermind with duplicate-aware exact/misplaced feedback. When the guess space
    // (cs.length ** L) is small enough to enumerate, this is a textbook consistency-filtered
    // search: keep only candidates whose score() against each guess matches the observed
    // feedback, and always guess the first surviving candidate.
    //
    // When the space is too large to enumerate, blindly sampling a fixed pool of random
    // candidate strings and filtering by consistency is *not* reliable here: the true
    // password essentially never lands in a 200,000-string sample out of a space that can
    // exceed 10^8-10^9 strings, so the "consistent" pool can shrink to candidates that were
    // never actually the answer (or to empty), i.e. the model would fail unpredictably no
    // matter the budget. Instead this falls back to solveByExactCount, which is still driven
    // entirely by the model's own consistency feedback (the exact-match component of
    // [exact,misplaced]) but determines the true password deterministically rather than by
    // sampling. See BUDGETS.DeepGreen for the measured attempt counts this requires.
    DeepGreen: async (d, tryPw) => {
        const L = d.passwordLength, cs = charset(d);
        if (cs.length ** L > 200000) {
            return solveByExactCount(L, cs, tryPw, (fb) => Number(fb.data.split(",")[0]));
        }
        let candidates = allStrings(cs, L);
        let guess = candidates[0];
        while (true) {
            const r = await tryPw(guess);
            if (r.success) return guess;
            const [ex, mis] = r.feedback.data.split(",").map(Number);
            candidates = candidates.filter((c) => {
                const s = score(c, guess);
                return s[0] === ex && s[1] === mis;
            });
            if (!candidates.length) return null;
            guess = candidates[0];
        }
    },

    // Exact-count oracle (the pepper string only ever encodes a total count, not which
    // positions matched -- see darknet-mock.js's SpiceLevel branch). Delegates straight to
    // solveByExactCount: the naive "one baseline + linear scan per position" strategy is
    // O(L * cs.length), which blows past any reasonable budget once the model goes
    // alphanumeric at higher difficulty (L up to 12, cs.length 62); solveByExactCount's
    // multiset-then-elimination approach stays close to O(cs.length + L^2).
    "RateMyPix.Auth": async (d, tryPw) => {
        const L = d.passwordLength, cs = charset(d);
        return solveByExactCount(L, cs, tryPw, (fb) => (fb.data.match(/🌶️/g) || []).length);
    },

    // Sorted multiset (the digits, pre-sorted) is given directly; below 5 digits the model
    // never reports an RMS deviation (checkPassword's SortedEchoVuln branch bails out for
    // password.length < 5), so brute-force the (few) distinct permutations. At 5+ digits,
    // probing "0..0 9 0..0" (a single 9 at position i, zero elsewhere) isolates position i:
    // squaredError = S + 81 - 18*actual_i where S = sum of the known digits squared, so
    // actual_i is recovered exactly from the reported RMS deviation.
    "PHP 5.4": async (d, tryPw) => {
        const m = d.passwordHint.match(/(\d+)\s*$/) || (d.data || "").match(/(\d+)/);
        if (!m) return null;
        const sorted = m[1], L = sorted.length;
        if (L < 5) {
            for (const p of uniquePermutations(sorted)) {
                if ((await tryPw(p)).success) return p;
            }
            return null;
        }
        const S = [...sorted].reduce((acc, c) => acc + Number(c) ** 2, 0);
        const pw = [];
        for (let i = 0; i < L; i++) {
            const trial = "0".repeat(i) + "9" + "0".repeat(L - i - 1);
            const r = await tryPw(trial);
            if (r.success) return trial;
            const dev = rmsd(r.feedback);
            if (!Number.isFinite(dev)) return null;
            pw.push(String(Math.max(0, Math.min(9, Math.round((S + 81 - L * dev * dev) / 18)))));
        }
        const final = pw.join("");
        return (await tryPw(final)).success ? final : null;
    },

    // Altitude oracle over a landscape of decoy hills plus one main peak at the password.
    // Scan at one-width steps (a sample within width/2 of P reads >= 10000*e^-0.25 ~= 7788,
    // above any decoy peak's contribution at that range), then solve the Gaussian for the
    // peak's exact location analytically from the best sample found.
    KingOfTheHill: async (d, tryPw) => {
        const L = d.passwordLength, max = 10 ** L - 1, width = 10 ** Math.max(L - 2, 0) + 1;
        let solved = null;
        const alt = async (x) => {
            x = Math.max(0, Math.min(max, Math.round(x)));
            const r = await tryPw(String(x));
            if (r.success) {
                solved = String(x);
                return Infinity;
            }
            return Number(r.feedback.data);
        };
        let best = 0, bestAlt = -1;
        for (let x = 0; x <= max && solved === null; x += width) {
            const h = await alt(x);
            if (h > bestAlt) {
                bestAlt = h;
                best = x;
            }
        }
        if (solved) return solved;
        const delta = width * Math.sqrt(Math.log(10000 / bestAlt));
        for (const c of [best + delta, best - delta, best + delta + 1, best - delta - 1, best + delta - 1, best - delta + 1]) {
            await alt(c);
            if (solved) return solved;
        }
        return null;
    },

    // Packet capture oracle. Below difficulty 17 the capture wraps the password as
    // " hostname:password " (the only spaces anywhere in the noise -- see darknet-mock.js's
    // capturePackets -- so the regex finds it in one extra call). Above that threshold the
    // password is embedded in raw noise with no delimiter, so instead take several fresh
    // captures (each redrawn with new random noise around the same password) and intersect
    // their length-L substrings: the password is the only substring guaranteed to recur in
    // every capture.
    OpenWebAccessPoint: async (d, tryPw) => {
        const first = await tryPw("0");
        if (first.success) return "0";
        const m = first.feedback.data.match(new RegExp(`\\s${escapeRe(d.hostname)}:(\\S+)\\s`));
        if (m) return (await tryPw(m[1])).success ? m[1] : null;
        let common = null;
        for (let i = 0; i < 7; i++) {
            const r = await tryPw(String(i + 1));
            if (r.success) return String(i + 1);
            const subs = new Set(substrings(r.feedback.data, d.passwordLength));
            common = common ? new Set([...common].filter((s) => subs.has(s))) : subs;
            if (common.size === 1) break;
        }
        for (const pw of common ?? []) {
            if ((await tryPw(pw)).success) return pw;
        }
        return null;
    },
};

// Attempt caps enforced by solve(). Task 3 fills in the solvers for the remaining
// (oracle-driven) model ids; their budgets are listed here now so solve()'s budget
// enforcement and clue-trying work for them from day one.
export const BUDGETS = {
    ZeroLogon: 1, "DeskMemo_3.1": 1, "FreshInstall_1.0": 4, Laika4: 4, TopPass: 93, "EuroZone Free": 27, "CloudBlare(tm)": 1,
    Pr0verFl0: 1, NIL: 64, "2G_cellular": 500, "110100100": 1, OrdoXenos: 1, BellaCuore: 14, "AccountsManager_4.2": 60,
    "PrimeTime 2": 1, "Factori-Os": 200, "BigMo%od": 12, OctantVoxel: 1, MathML: 1, KingOfTheHill: 120, "PHP 5.4": 30,
    OpenWebAccessPoint: 10, "(The Labyrinth)": 0,
    // Password-dependent: above difficulty 16 (DeepGreen) / 8 (RateMyPix.Auth) the game rolls
    // 62-symbol alphanumeric passwords (ServerGenerator.ts getMastermindHintConfig /
    // getSpiceLevelConfig), and solveByExactCount then needs up to 62 + L*(L-1)/2 attempts
    // (107 for DeepGreen at L=10) -- a flat 30 aborted every such server at attempt 30.
    DeepGreen: (d) => Math.max(30, exactCountBudget(d)),
    "RateMyPix.Auth": (d) => Math.max(120, exactCountBudget(d)),
};

/** The attempt cap solve() enforces for a server: the BUDGETS entry, evaluated against the
 * server details when it depends on the password length/format. Unknown models are uncapped. */
export function budgetFor(details) {
    const cap = BUDGETS[details.modelId];
    if (cap === undefined) return Infinity;
    return typeof cap === "function" ? cap(details) : cap;
}

// details: getServerDetails shape (modelId, passwordHint, data, passwordLength,
// passwordFormat, difficulty, hostname). attemptFn(password, needFeedback = true) resolves to
// {success, feedback:{code, message, data}|null, elapsed?, fetchFeedback?}: `elapsed` is the
// authenticate duration in ms and `fetchFeedback()` fetches the feedback of that attempt later
// (both optional; only the 2G_cellular solver reads them). opts: { clues, budgetScale, log, threads }.
export async function solve(details, attemptFn, opts = {}) {
    const clues = opts.clues ?? [];
    const budgetScale = opts.budgetScale ?? 1;
    const log = opts.log ?? (() => {});
    const budget = Math.floor(budgetFor(details) * budgetScale);
    let count = 0;

    const tryPw = async (pw, needFeedback = true) => {
        if (count >= budget) throw new BudgetExceeded();
        count += 1;
        const result = await attemptFn(pw, needFeedback);
        log(`#${count} "${pw}" -> ${result.success}`);
        return result;
    };

    try {
        for (const pw of clues) {
            if ((await tryPw(pw)).success) return { password: pw, attempts: count, reason: "clue" };
        }

        const solverFn = SOLVERS[details.modelId];
        if (!solverFn) return { password: null, attempts: count, reason: "unsupported" };

        const password = await solverFn(details, tryPw, opts);
        if (password != null) return { password, attempts: count, reason: "solved" };
        return { password: null, attempts: count, reason: "inconsistent" };
    } catch (err) {
        if (err instanceof BudgetExceeded) return { password: null, attempts: count, reason: "budget" };
        throw err;
    }
}
