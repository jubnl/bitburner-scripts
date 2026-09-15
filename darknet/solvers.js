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
};

// Attempt caps enforced by solve(). Task 3 fills in the solvers for the remaining
// (oracle-driven) model ids; their budgets are listed here now so solve()'s budget
// enforcement and clue-trying work for them from day one.
export const BUDGETS = {
    ZeroLogon: 1, "DeskMemo_3.1": 1, "FreshInstall_1.0": 4, Laika4: 4, TopPass: 93, "EuroZone Free": 27, "CloudBlare(tm)": 1,
    Pr0verFl0: 1, NIL: 64, DeepGreen: 30, "2G_cellular": 500, "110100100": 1, OrdoXenos: 1, BellaCuore: 14, "AccountsManager_4.2": 60,
    "PrimeTime 2": 1, "Factori-Os": 200, "BigMo%od": 12, OctantVoxel: 1, MathML: 1, KingOfTheHill: 120, "RateMyPix.Auth": 120, "PHP 5.4": 30,
    OpenWebAccessPoint: 10, "(The Labyrinth)": 0,
};

// details: getServerDetails shape (modelId, passwordHint, data, passwordLength,
// passwordFormat, difficulty, hostname). attemptFn(password) resolves to
// {success, feedback:{code, message, data}|null}. opts: { clues, budgetScale, log }.
export async function solve(details, attemptFn, opts = {}) {
    const clues = opts.clues ?? [];
    const budgetScale = opts.budgetScale ?? 1;
    const log = opts.log ?? (() => {});
    const budgetCap = BUDGETS[details.modelId];
    const budget = budgetCap === undefined ? Infinity : Math.floor(budgetCap * budgetScale);
    let count = 0;

    const tryPw = async (pw) => {
        if (count >= budget) throw new BudgetExceeded();
        count += 1;
        const result = await attemptFn(pw);
        log(`#${count} "${pw}" -> ${result.success}`);
        return result;
    };

    try {
        for (const pw of clues) {
            if ((await tryPw(pw)).success) return { password: pw, attempts: count, reason: "clue" };
        }

        const solverFn = SOLVERS[details.modelId];
        if (!solverFn) return { password: null, attempts: count, reason: "unsupported" };

        const password = await solverFn(details, tryPw);
        if (password != null) return { password, attempts: count, reason: "solved" };
        return { password: null, attempts: count, reason: "inconsistent" };
    } catch (err) {
        if (err instanceof BudgetExceeded) return { password: null, attempts: count, reason: "budget" };
        throw err;
    }
}
