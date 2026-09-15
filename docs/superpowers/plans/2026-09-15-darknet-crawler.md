# Darknet Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully automate Bitburner's Darknet (crack, spread, loot, promote, migrate, labyrinth) with a controller on home and thin agents on darknet servers.

**Architecture:** `darknet.js` (home) owns all state in `darknet/state.txt`, drains a report port, and pushes a password file plus a per-server command file to every reachable server. `darknet/agent.js` runs on every cracked server, does local work only and spawns single-purpose workers. `darknet/solvers.js` is a pure library with one solver per password model, unit-tested in Node against a port of the game's feedback code.

**Tech Stack:** Bitburner Netscript (ES modules), Node 24 for `node --test` unit tests (no dependencies), the repo's `helpers.js` (`getConfiguration`, `log`, `formatMoney`). Game source for reference: `/home/jubnl/dev/bitburner/bitburner-src/src` (v3.0.1).

**Spec:** `docs/superpowers/specs/2026-09-15-darknet-crawler-design.md`

## Global Constraints

- Git: commit your task locally on the current branch (`game-optimisation-3.0`) with a plain message; NEVER add `Co-Authored-By` or any Claude/session trailer, never push, never change branches, never touch `.idea/`. Each task ends with `git status --short` showing a clean tree.
- Every in-game script must pass `node --check` and the identifier-collision check: `node /tmp/claude-1000/-home-jubnl-dev-bitburner/a21f0fa8-6aad-4714-9900-72bd45ff1ffe/scratchpad/bc/collide.mjs <abs path>` must print `+[]`. The game charges RAM for ANY identifier (variable, function, property) that equals an NS function name (e.g. `authenticate`, `probe`, `exec`, `scp`, `read`, `write`, `share`, `hack`, `sleep`, `attempt`, `connect`, `getServer`). Name local things `doProbe`, `tryAuth`, `attemptFn`, `readPortLine`, etc.
- RAM targets from the spec: agent under 5 GB, controller under 8 GB, crack 2.6 GB/thread, realloc 2.6, phish 3.6, migrate 5.6, promote 3.6, cache 3.8, stasis 13.6, lab about 2.0. Measured in game with `mem <script>`.
- Never use `eval`/`Function` on darknet data. Never call `ns.dnet.connectToSession` on a labyrinth host (`*_l4byr1nth`).
- Report port default 15. Files: `darknet/state.txt`, `darknet/state.tmp.txt`, `darknet/state.bak.txt`, `darknet/passwords.txt`, `darknet/cmd.txt` (per-host content, scp'd), `/Temp/darknet-charisma-goal.txt`, `/Temp/share-active.txt`.
- Style: 4-space indent, `argsSchema` + `getConfiguration(ns, argsSchema)` + `autocomplete` like the other scripts, `log(ns, msg, toast, style)` from helpers.
- Test save for in-game runs: `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz` (BN1, SF1-4, DarkscapeNavigator owned, 33 darknet servers, charisma 6). Headless harness: `/tmp/claude-1000/-home-jubnl-dev-bitburner/a21f0fa8-6aad-4714-9900-72bd45ff1ffe/scratchpad/bc/drv.mjs` with snippets (see Task 10).

---

## File structure

| File | Responsibility |
|---|---|
| `darknet/lib.js` | constants, message encode/decode, state/command/password file helpers, small utils (safe JSON, hostname checks). Imported by every darknet script. Contains NO ns calls that cost RAM. |
| `darknet/solvers.js` | `solve(details, attemptFn, opts)`: pure solvers per model. No `ns`. |
| `test/darknet-mock.js` | port of the game's server generators + feedback (`makeServer`, `feedback`, `labMaze`). Node only. |
| `test/darknet-solvers.test.js` | `node --test` suite for every model. |
| `darknet/crack.js` | worker: crack one neighbour, report password. |
| `darknet/cache.js`, `realloc.js`, `phish.js`, `migrate.js`, `promote.js`, `stasis.js` | single-purpose workers. |
| `darknet/agent.js` | per-server loop. |
| `darknet/lab.js` | labyrinth walker. |
| `darknet.js` | controller. |
| `daemon.js`, `work-for-factions.js`, `sleeve.js` | integration hooks. |

---

### Task 1: lib.js and the Node test harness mock

**Files:**
- Create: `darknet/lib.js`
- Create: `test/darknet-mock.js`
- Create: `test/darknet-mock.test.js`

**Interfaces:**
- Produces `darknet/lib.js` exports:
  - `export const PORT_DEFAULT = 15;`
  - `export const FILES = { state: "darknet/state.txt", stateTmp: "darknet/state.tmp.txt", stateBak: "darknet/state.bak.txt", passwords: "darknet/passwords.txt", cmd: "darknet/cmd.txt", charismaGoal: "/Temp/darknet-charisma-goal.txt", shareActive: "/Temp/share-active.txt" };`
  - `export const AGENT_FILES = ["darknet/agent.js","darknet/lib.js","darknet/solvers.js","darknet/crack.js","darknet/cache.js","darknet/realloc.js","darknet/phish.js","darknet/migrate.js","darknet/promote.js","darknet/stasis.js","darknet/lab.js","Remote/share.js","helpers.js"];`
  - `export const WORKER_RAM = { crack: 2.6, realloc: 2.6, phish: 3.6, migrate: 5.6, promote: 3.6, cache: 3.8, stasis: 13.6, lab: 2.0, share: 4.0 };`
  - `export const LABS = [{host:"th3_l4byr1nth",depth:7,cha:300},{host:"cru3l_l4byr1nth",depth:12,cha:600},{host:"m3rc1l3ss_l4byr1nth",depth:19,cha:1500},{host:"ub3r_l4byr1nth",depth:23,cha:2500},{host:"et3rn4l_l4byr1nth",depth:29,cha:3000},{host:"end13ss_l4byr1nth",depth:31,cha:3500},{host:"f1n4l_l4byr1nth",depth:36,cha:4000},{host:"b0nus_l4byr1nth",depth:36,cha:4000}];`
  - `export const AIR_GAP_ROWS = [8, 16, 24, 32];`
  - `export function isLabHost(host)` → `host.endsWith("_l4byr1nth")`
  - `export function encodeMsg(type, from, pid, payload)` → JSON string `{type, from, pid, ts: Date.now(), ...payload}`
  - `export function decodeMsg(line)` → object or `null` (never throws)
  - `export function safeParse(text, fallback)` → parsed JSON or fallback
  - `export function emptyState(resetTime)` → the spec section 4 schema with empty collections, `version: 1`
  - `export function parseCmd(text)` → `{mode:"loot", claimed:[], threads:{crack:6,realloc:0,phish:0,migrate:0,promote:0}, migrateTarget:null, promoteSymbols:[], stasis:false, share:false, storm:false, stop:false}` merged with the parsed JSON
  - `export function parsePasswords(text)` → `{[host]: password}`
  - `export function parseClueText(text, knownHosts)` → `{passwords:{[host]:pw}, contains:{[host]:[chars]}}` using regexes `/Server:\s*(\S+)\s+Password:\s*"([^"]*)"/g` and `/The password for (\S+) contains (\S+) and (\S+)/g` and `/Remember this password:\s*(\S+)/g` (the last one goes to `passwords["?"]` list under key `unknown` as an array)
- Produces `test/darknet-mock.js` exports (Node only):
  - `export function makeRng(seed)` → deterministic `() => number` in [0,1) (mulberry32)
  - `export const MODELS = [...all 24 model ids...]`
  - `export function makeServer(modelId, difficulty, rng)` → `{hostname, modelId, difficulty, password, staticPasswordHint, passwordHintData, passwordLength, passwordFormat, requiredCharismaSkill}` ported from `bitburner-src/src/DarkNet/controllers/ServerGenerator.ts` (the `serverBuilders` map, lines ~90-420, plus helpers `getPassword` ~564-579, `getPasswordMadeUpOfPrimesProduct` ~685-706, `largePrimes`/`smallPrimes` ~658-667, `generateSimpleArithmeticExpression` ~515-548, `romanNumeralEncoder` ~625-656, `toBaseN`/`parseBaseNNumberString` ~438-456, `dictionaryData.ts` lists verbatim)
  - `export function feedback(server, attempt)` → `{success:boolean, code:200|401, message, data}` ported from `bitburner-src/src/DarkNet/effects/authentication.ts` `checkPassword` lines 19-150 and `darknetAuthUtils.ts` (`getExactCorrectChars`, `getMisplacedCorrectCharsCount`, `isCloseToCorrectPassword`, `getGenericSuccess`, `getFailureResponse`) and `packetSniffing.ts` `capturePackets` lines 16-24 (noise may be simplified to random alphanumerics of the same length as long as the password is embedded at a random index with the ` host:pw ` delimiters for difficulty <= 16)
  - `export function makeLab(width, height, rng, offsetStartAndEnd)` → `{maze:string[], start:[x,y], end:[x,y]}` ported from `labyrinth.ts` `generateMaze`/`mazeMaker` lines 120-186 and `getRandomOffset` 377-382
  - `export function labStep(lab, pos, input)` → `{code, message, data, pos}` ported from `handleLabyrinthPassword` lines 236-332 (direction parsing 340-362), and `labReport(lab, pos)` → `{coords, north, east, south, west}` from lines 217-234, `labRadar(lab, pos)` from `getSurroundingsVisualized`

- [ ] **Step 1: Write the failing mock tests**

```js
// test/darknet-mock.test.js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jubnl/dev/bitburner/bitburner-scripts && node --test test/darknet-mock.test.js`
Expected: FAIL, cannot find module `./darknet-mock.js`.

- [ ] **Step 3: Write `darknet/lib.js`** exactly as the Interfaces block specifies. `emptyState`:

```js
export function emptyState(resetTime) {
    return { version: 1, resetTime, mode: "balanced", passwords: {}, servers: {},
        labs: { current: null, walkers: [], rewardQueuedAt: null, completed: [] },
        plan: { stasisTargets: [], migrationTargets: {}, promoteSymbols: [], charismaGoal: 0, shareActive: false },
        stats: { cracks: {}, ramFreed: 0, cachesOpened: 0, moneyFromCaches: 0, phishMoney: 0 } };
}
```

- [ ] **Step 4: Write `test/darknet-mock.js`** by porting the cited game functions. Keep the game's exact hint templates and dictionaries (copy `commonPasswordDictionary`, `EUCountries`, `dogNames`, `defaultPasswords`, `filler`, `largePrimes`, `smallPrimes`). `makeServer` must set `passwordLength = password.length` and `passwordFormat` as the game does (`numeric` unless letters allowed → `alphanumeric`). For `MathML`, generate expressions with the game's operator set and apply the unicode obfuscation for difficulty > 12 and the `,payload` injection for difficulty > 16 with probability 0.3.

- [ ] **Step 5: Run the mock tests**

Run: `node --test test/darknet-mock.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Collision check on lib.js**

Run: `node --check darknet/lib.js && node <collide.mjs> $PWD/darknet/lib.js`
Expected: `+[]`. Then `git status --short`.

---

### Task 2: direct-decode and dictionary solvers

**Files:**
- Create: `darknet/solvers.js`
- Create: `test/darknet-solvers.test.js`

**Interfaces:**
- Produces `export async function solve(details, attemptFn, opts = {})` where `details` is the `getServerDetails` shape (`modelId, passwordHint, data, passwordLength, passwordFormat, difficulty, hostname`), `attemptFn(password)` resolves to `{success:boolean, feedback:{code, message, data}|null}`, `opts = { clues: string[] (passwords to try first), budgetScale: 1, log: (msg)=>void }`. Returns `{password:string|null, attempts:number, reason:string}` where reason is `"solved" | "budget" | "inconsistent" | "unsupported" | "clue"`.
- Produces `export const BUDGETS = { ZeroLogon: 1, "DeskMemo_3.1": 1, ... }` (all 24) and `export const SOLVERS = { [modelId]: async (details, attempt, opts) => password|null }`.
- Produces helpers used by Task 3 tests: `export function romanToInt(s)`, `export function parseBaseN(str, base)`, `export function evalArithmetic(expr)` (hand-written recursive-descent parser for `+ - * /` and parentheses, decimals allowed).

- [ ] **Step 1: Write failing tests for the direct models**

```js
// test/darknet-solvers.test.js
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
    "Pr0verFl0", "110100100", "OrdoXenos", "PrimeTime 2", "OctantVoxel", "MathML"];
for (const modelId of DIRECT) {
    test(`solves ${modelId} within budget`, async () => {
        for (const seed of [1, 2, 3, 4, 5]) for (const difficulty of [1, 6, 13, 20]) {
            const { r, attempts, s } = await runModel(modelId, difficulty, seed);
            assert.equal(r.password, s.password, `${modelId} seed ${seed} d${difficulty}`);
            assert.ok(attempts <= BUDGETS[modelId], `${modelId} used ${attempts} > ${BUDGETS[modelId]}`);
        }
    });
}
test("clues are tried first", async () => {
    const s = makeServer("TopPass", 10, makeRng(9));
    let attempts = 0;
    const attemptFn = async (pw) => { attempts++; const f = feedback(s, pw); return { success: f.success, feedback: f }; };
    const r = await solve(detailsOf(s), attemptFn, { clues: ["nope", s.password] });
    assert.equal(r.password, s.password); assert.equal(attempts, 2); assert.equal(r.reason, "clue");
});
```

- [ ] **Step 2: Run to verify failure**: `node --test test/darknet-solvers.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `darknet/solvers.js`** with `solve` (clues first, then dispatch, budget enforced by wrapping `attemptFn` in a counter that throws a `BudgetExceeded` sentinel caught by `solve`), plus these solvers:

```js
ZeroLogon: async (d, a) => (await a("")).success ? "" : null,
"DeskMemo_3.1": async (d, a) => { const pw = d.passwordHint.trim().split(/\s+/).pop(); return (await a(pw)).success ? pw : null; },
"FreshInstall_1.0": dict(["admin", "password", "0000", "12345"]),
Laika4: dict(["fido", "spot", "rover", "max"]),
TopPass: dict(COMMON_PASSWORDS),           // copy the 93 entries from dictionaryData.ts in order
"EuroZone Free": dict(EU_COUNTRIES),        // 27 entries
"CloudBlare(tm)": async (d, a) => { const pw = d.data.replace(/[^0-9]/g, ""); return (await a(pw)).success ? pw : null; },
Pr0verFl0: async (d, a) => { const n = Number((d.passwordHint.match(/(\d+) bytes/) || [])[1] || d.passwordLength);
    const pw = "0".repeat(2 * n); return (await a(pw)).success ? pw : null; },
"110100100": async (d, a) => { const pw = d.data.trim().split(/\s+/).map(b => String.fromCharCode(parseInt(b, 2))).join(""); return (await a(pw)).success ? pw : null; },
OrdoXenos: async (d, a) => { const [cipher, maskStr] = d.data.split(";"); const masks = maskStr.trim().split(/\s+/);
    const pw = [...cipher].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ parseInt(masks[i], 2))).join(""); return (await a(pw)).success ? pw : null; },
"PrimeTime 2": async (d, a) => { let n = BigInt(d.data.trim()), best = 1n; for (let p = 2n; p * p <= n; p++) while (n % p === 0n) { best = p; n /= p; } if (n > 1n) best = n;
    const pw = best.toString(); return (await a(pw)).success ? pw : null; },
OctantVoxel: async (d, a) => { const [baseStr, enc] = d.data.split(","); const pw = String(Math.round(parseBaseN(enc.trim(), Number(baseStr)))); return (await a(pw)).success ? pw : null; },
MathML: async (d, a) => { const pw = String(evalArithmetic(cleanExpression(d.data))); return (await a(pw)).success ? pw : null; },
```
with `cleanExpression = s => s.replace(/ҳ/g, "*").replace(/÷/g, "/").replace(/➕/g, "+").replace(/➖/g, "-").replace(/ns\.exit\(\),/g, "").split(",")[0]`. Note: the `Pr0verFl0` trick works because the game compares the first N and last N characters of a 2N-length buffer; when the hint is missing use `passwordLength`. `OctantVoxel` answers are accepted with tolerance so rounding is fine; `parseBaseN` must support fractional bases (`base = 7.3`) exactly as `parseBaseNNumberString` does (digits `0-9A-Z`, a `.` separates the fractional part, each digit weighted by `base^position`).

`dict(list)` = `async (d, a) => { for (const pw of list) if ((await a(pw)).success) return pw; return null; }`.

`BUDGETS` (attempt caps enforced by `solve`):
```js
export const BUDGETS = { ZeroLogon: 1, "DeskMemo_3.1": 1, "FreshInstall_1.0": 4, Laika4: 4, TopPass: 93, "EuroZone Free": 27, "CloudBlare(tm)": 1,
    Pr0verFl0: 1, NIL: 64, DeepGreen: 30, "2G_cellular": 500, "110100100": 1, OrdoXenos: 1, BellaCuore: 14, "AccountsManager_4.2": 60,
    "PrimeTime 2": 1, "Factori-Os": 200, "BigMo%od": 12, OctantVoxel: 1, MathML: 1, KingOfTheHill: 120, "RateMyPix.Auth": 120, "PHP 5.4": 30,
    OpenWebAccessPoint: 10, "(The Labyrinth)": 0 };
```
(`2G_cellular` and `RateMyPix.Auth` scale with length times charset, hence the generous caps; the tests assert the measured attempts stay under them.)

- [ ] **Step 4: Run tests** → PASS for all 13 direct models and the clue test.

- [ ] **Step 5: Collision check** `node <collide.mjs> $PWD/darknet/solvers.js` → `+[]` (watch out for identifiers like `attempt`, `hack`, `share`). `git status --short`.

---

### Task 3: oracle-driven solvers

**Files:**
- Modify: `darknet/solvers.js`
- Modify: `test/darknet-solvers.test.js`

**Interfaces:** same `solve` contract. Adds solvers for `NIL`, `2G_cellular`, `AccountsManager_4.2`, `BellaCuore`, `BigMo%od`, `Factori-Os`, `DeepGreen`, `RateMyPix.Auth`, `PHP 5.4`, `KingOfTheHill`, `OpenWebAccessPoint`.

- [ ] **Step 1: Add failing tests** (same loop as Task 2) for `ORACLE = ["NIL","2G_cellular","AccountsManager_4.2","BellaCuore","BigMo%od","Factori-Os","DeepGreen","RateMyPix.Auth","PHP 5.4","KingOfTheHill","OpenWebAccessPoint"]` over seeds 1-5 and difficulties `[2, 9, 17, 26]`, asserting solved within `BUDGETS[modelId]`.

- [ ] **Step 2: Run** → FAIL with `null` passwords.

- [ ] **Step 3: Implement each solver.** Feedback fields: `f.feedback.data` and `f.feedback.message`. Charset: `"0123456789"` for `numeric`, plus `"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"` for `alphanumeric`.

```js
NIL: async (d, a) => {                       // per-position yes/yesn't oracle
    const L = d.passwordLength, cs = charset(d), known = Array(L).fill(null);
    for (const c of cs) {
        const r = await a(c.repeat(L)); if (r.success) return c.repeat(L);
        r.feedback.data.split(",").forEach((v, i) => { if (v === "yes") known[i] = c; });
        if (known.every(k => k !== null)) { const pw = known.join(""); return (await a(pw)).success ? pw : null; }
    }
    return null;
},
"2G_cellular": async (d, a) => {             // prefix oracle: "Found a mismatch while checking each character (i)"
    const L = d.passwordLength, cs = charset(d); let prefix = "";
    while (prefix.length < L) {
        let found = false;
        for (const c of cs) {
            const guess = (prefix + c).padEnd(L, cs[0]);
            const r = await a(guess); if (r.success) return guess;
            const m = /\((\d+)\)/.exec(r.feedback.message); const idx = m ? Number(m[1]) : -1;
            if (idx > prefix.length) { prefix += c; found = true; break; }
        }
        if (!found) return null;
    }
    return null;
},
"AccountsManager_4.2": async (d, a) => binarySearch(a, 0, 10 ** d.passwordLength - 1, f => f.data === "Higher"),
BellaCuore: async (d, a) => {
    if (!d.data.includes(",")) { const pw = String(romanToInt(d.data.trim())); return (await a(pw)).success ? pw : null; }
    const [lo, hi] = d.data.split(",").map(s => romanToInt(s.trim()));
    return binarySearch(a, lo, hi, f => f.data === "PARUM BREVIS");   // PARUM BREVIS = too low
},
"BigMo%od": async (d, a) => {                // CRT: n = 1e16 + r  => (P % n) % (((n-1)%32)+1) = P % r  when n > P and (n-1)%32+1 == r
    const mods = [31, 29, 27, 25, 23, 19, 17, 13, 11]; const res = [];
    for (const r of mods) { const n = 10n ** 16n + BigInt(r); const f = await a(n.toString()); if (f.success) return n.toString(); res.push(BigInt(f.feedback.data)); }
    const pw = crt(mods.map(BigInt), res).toString(); return (await a(pw)).success ? pw : null;
},
"Factori-Os": async (d, a) => {              // divisibility oracle over the game's prime lists (only these primes can occur)
    let product = 1n; const limit = 10n ** BigInt(d.passwordLength);
    for (const p of [...SMALL_PRIMES, ...LARGE_PRIMES]) {
        let q = BigInt(p);
        while (q <= limit) {                      // test p, p^2, p^3 ... while divisible
            const f = await a(q.toString()); if (f.success) return q.toString();
            if (f.feedback.data !== "true") break;
            product *= BigInt(p); q *= BigInt(p);
        }
    }
    const pw = product.toString(); return (await a(pw)).success ? pw : null;
},
```
`SMALL_PRIMES` (25 entries, 2..97) and `LARGE_PRIMES` (84 entries, 1069..9859) are copied from `ServerGenerator.ts` lines ~658-667. Budget 200.

```js
DeepGreen: async (d, a) => {                 // Mastermind, consistency filtering
    const L = d.passwordLength, cs = charset(d);
    let candidates = cs.length ** L <= 200000 ? allStrings(cs, L) : null;  // alphanumeric L>=4 needs sampling: generate 200000 random candidates instead
    let guess = candidates[0];
    while (true) {
        const r = await a(guess); if (r.success) return guess;
        const [ex, mis] = r.feedback.data.split(",").map(Number);
        candidates = candidates.filter(c => { const s = score(c, guess); return s[0] === ex && s[1] === mis; });
        if (!candidates.length) return null;
        guess = candidates[0];
    }
},
"RateMyPix.Auth": async (d, a) => {          // exact-count oracle, one position at a time
    const L = d.passwordLength, cs = charset(d);
    const base = await a(cs[0].repeat(L)); if (base.success) return cs[0].repeat(L);
    const count = f => (f.data.match(/🌶️/g) || []).length;
    let baseCount = count(base.feedback); const pw = Array(L).fill(null);
    for (let i = 0; i < L; i++) {
        for (const c of cs) {
            if (c === cs[0]) continue;
            const g = cs[0].repeat(i) + c + cs[0].repeat(L - i - 1);
            const r = await a(g); if (r.success) return g;
            const n = count(r.feedback);
            if (n > baseCount) { pw[i] = c; break; }
            if (n < baseCount) { pw[i] = cs[0]; break; }
        }
        if (pw[i] === null) pw[i] = cs[0];
    }
    const final = pw.join(""); return (await a(final)).success ? final : null;
},
"PHP 5.4": async (d, a) => {                 // sorted multiset; RMSD feedback when L>=5 gives each digit exactly
    const m = /(\d+)\s*$/.exec(d.passwordHint) || /(\d+)/.exec(d.data || "");
    if (!m) return null; const sorted = m[1], L = sorted.length;
    if (L < 5) { for (const p of uniquePermutations(sorted)) { if ((await a(p)).success) return p; } return null; }
    // Probe "0..090..0" (9 at position i): sum of squared deviations = S + 81 - 18*p_i, where S = sum of p_j^2 is known from the multiset
    const S = [...sorted].reduce((acc, c) => acc + Number(c) ** 2, 0); const pw = [];
    for (let i = 0; i < L; i++) {
        const probe = "0".repeat(i) + "9" + "0".repeat(L - i - 1);
        const r = await a(probe); if (r.success) return probe;
        const dev = rmsd(r.feedback); if (!Number.isFinite(dev)) return null;
        pw.push(String(Math.max(0, Math.min(9, Math.round((S + 81 - L * dev * dev) / 18)))));
    }
    const final = pw.join(""); return (await a(final)).success ? final : null;
},
KingOfTheHill: async (d, a) => {             // altitude oracle: scan at one-width steps, then solve the main gaussian analytically
    const L = d.passwordLength, max = 10 ** L - 1, width = 10 ** Math.max(L - 2, 0) + 1;
    let solved = null;
    const alt = async (x) => { x = Math.max(0, Math.min(max, Math.round(x))); const r = await a(String(x)); if (r.success) { solved = String(x); return Infinity; } return Number(r.feedback.data); };
    let best = 0, bestAlt = -1;                   // a sample within width/2 of P reads >= 10000*e^-0.25 = 7788, above any decoy peak (<= 7400)
    for (let x = 0; x <= max && solved === null; x += width) { const h = await alt(x); if (h > bestAlt) { bestAlt = h; best = x; } }
    if (solved) return solved;
    const delta = width * Math.sqrt(Math.log(10000 / bestAlt));   // alt = 10000*exp(-((x-P)/width)^2)  =>  |x-P|
    for (const c of [best + delta, best - delta, best + delta + 1, best - delta - 1, best + delta - 1, best - delta + 1]) { await alt(c); if (solved) return solved; }
    return null;
},
OpenWebAccessPoint: async (d, a) => {
    const first = await a("0"); if (first.success) return "0";
    const m = new RegExp(`\\s${escapeRe(d.hostname)}:(\\S+)\\s`).exec(first.feedback.data);
    if (m) return (await a(m[1])).success ? m[1] : null;
    // difficulty > 16: intersect captures; the password is the unique substring of length passwordLength common to all captures
    let common = null;
    for (let i = 0; i < 7; i++) { const r = await a(String(i + 1)); const subs = new Set(substrings(r.feedback.data, d.passwordLength)); common = common ? new Set([...common].filter(s => subs.has(s))) : subs; if (common.size === 1) break; }
    for (const pw of common) if ((await a(pw)).success) return pw;
    return null;
},
```
Fill in the elided parts fully in code (no `...` may remain). `binarySearch(a, lo, hi, tooLowPredicate)` submits `mid = floor((lo+hi)/2)`, returns on success, moves `lo = mid+1` when the feedback says the guess was too low, else `hi = mid-1`. `crt(mods, residues)` is standard (moduli pairwise coprime). `score(candidate, guess)` returns `[exact, misplaced]` with the game's duplicate-aware counting (port `getMisplacedCorrectCharsCount`). `uniquePermutations` yields distinct permutations. `rmsd(f)` parses `RMS Deviation:(\d+\.\d+)` from `f.feedback.data` (returns `Infinity` if absent).

- [ ] **Step 4: Run tests** → PASS for all 24 models. If a solver exceeds its budget on some seed, tighten the algorithm, not the budget, unless the game's math makes the budget impossible; document any budget change in `BUDGETS` with a comment.

- [ ] **Step 5: Collision check** on `darknet/solvers.js` → `+[]`. `git status --short`.

---

### Task 4: the crack worker

**Files:**
- Create: `darknet/crack.js`

**Interfaces:**
- Consumes `solve`, `BUDGETS` (Task 2/3); `encodeMsg`, `PORT_DEFAULT`, `parseClueText`, `FILES` (Task 1).
- CLI: `run darknet/crack.js <targetHost> [--port 15] [--threads-note n]`; runs with N threads via exec.
- Produces port messages `crack` `{host, modelId, difficulty, success, password?, attempts, reason}`; on success ALSO writes the password to the local `darknet/passwords.txt` (merge) before reporting, so a dying server never loses it.

- [ ] **Step 1: Write the worker**

```js
import { getConfiguration } from "../helpers.js";
import { solve } from "./solvers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parsePasswords, parseClueText, safeParse } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT], ["clues", ""]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const target = String(ns.args[0] ?? ""); if (!target) return ns.tprint("crack.js: missing target host");
    const me = ns.getHostname(), pid = ns.pid;
    const send = (payload) => { const line = encodeMsg("crack", me, pid, payload); if (!ns.tryWritePort(options.port, line)) ns.print(`WARN: port full, dropped: ${line}`); };
    const details = ns.dnet.getServerDetails(target);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return send({ host: target, success: false, attempts: 0, reason: "unreachable" });
    details.hostname = target;
    // Clues: passwords for this host from local clue files
    const known = parsePasswords(ns.read(FILES.passwords)); const clues = [];
    if (known[target]) clues.push(known[target]);
    for (const f of ns.ls(me, ".data.txt")) { const c = parseClueText(ns.read(f), [target]); if (c.passwords[target]) clues.push(c.passwords[target]); for (const p of (c.passwords.unknown || [])) clues.push(p); }
    const attemptFn = async (password) => {
        for (let tries = 0; tries < 5; tries++) {
            const r = await ns.dnet.authenticate(target, password);
            if (r.success) return { success: true, feedback: { code: 200, message: r.message, data: r.data } };
            if (r.code === 408) continue;                       // timeout: independent of correctness, retry
            if (r.code === 351 || r.code === 503) throw new Error("unreachable");
            const hb = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 });
            if (!hb.success) { if (hb.code === 451) throw new Error("charisma"); throw new Error("heartbleed:" + hb.code); }
            const fb = safeParse(hb.logs[0] ?? "", null);
            if (!fb || fb.passwordAttempted !== password) continue;  // not our line (race with another PID); retry
            return { success: false, feedback: fb };
        }
        throw new Error("timeouts");
    };
    let result;
    try { result = await solve(details, attemptFn, { clues, log: m => ns.print(m) }); }
    catch (e) { return send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: false, attempts: 0, reason: String(e.message || e), chaReq: details.requiredCharismaSkill }); }
    if (result.password !== null) {
        known[target] = result.password; ns.write(FILES.passwords, JSON.stringify(known), "w");   // persist first
        send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: true, password: result.password, attempts: result.attempts, reason: result.reason });
    } else send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: false, attempts: result.attempts, reason: result.reason, chaReq: details.requiredCharismaSkill });
}
```
Note: `heartbleed` refuses when charisma is below the server requirement (code 451). Feedback-free models (ZeroLogon, DeskMemo, dictionaries, Captcha, Pr0verFl0, 110100100, OrdoXenos, PrimeTime 2, OctantVoxel, MathML, Roman below 8) never hit heartbleed because they succeed on their computed password; `solve` must not call heartbleed-dependent paths for them, which holds because `attemptFn` only heartbleeds after a 401, and those solvers return on the first 401 anyway.

- [ ] **Step 2: Verify**: `node --check darknet/crack.js`; collision check → `+[]` (rename any local named `authenticate`/`heartbleed`/`read`/`write`/`ls`). `git status --short`.

---

### Task 5: the single-purpose workers

**Files:**
- Create: `darknet/cache.js`, `darknet/realloc.js`, `darknet/phish.js`, `darknet/migrate.js`, `darknet/promote.js`, `darknet/stasis.js`

**Interfaces:** each takes `--port` and reports with `encodeMsg(type, host, pid, payload)`:
- `cache.js`: opens every file from `ns.ls(host, ".cache")` via `ns.dnet.openCache(name, true)`; message `cache {host, name, success, message, karmaLoss}`; exits.
- `realloc.js <targetHost|self>`: loops `ns.dnet.memoryReallocation(target)` while `ns.dnet.getBlockedRam(target) > 0` and result code is 200; message `freed {host, gb}` every 10 calls and at the end; exits on 454 or when blocked RAM is 0.
- `phish.js`: loops `ns.dnet.phishingAttack()` forever; every 20 calls sends `worker {type:"phish", host, successes, money?}` (money is not returned by the API; count successes only); exits when `darknet/cmd.txt` has `stop:true` or `threads.phish === 0`.
- `migrate.js <targetHost>`: loops `ns.dnet.induceServerMigration(target)`; stops when the result code is not 200 (target moved/offline) or the command file no longer names this target; message `worker {type:"migrate", host:target, calls}`.
- `promote.js <sym...>`: round-robin `ns.dnet.promoteStock(sym)`; stops when cmd `promoteSymbols` is empty or `stop`; message every 20 calls.
- `stasis.js [--unlink]`: `await ns.dnet.setStasisLink(!options.unlink)`; message `worker {type:"stasis", host, success, code}`; exits.

- [ ] **Step 1: Write the six workers** following this template (shown for realloc):

```js
import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd } from "./lib.js";
const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }
/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname(), target = String(ns.args[0] ?? me) === "self" ? me : String(ns.args[0] ?? me);
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("freed", me, ns.pid, p));
    let calls = 0, freed = 0, before = ns.dnet.getBlockedRam(target);
    while (ns.dnet.getBlockedRam(target) > 0) {
        const r = await ns.dnet.memoryReallocation(target);
        if (r.code !== 200) { ns.print(`realloc stopped: ${r.code} ${r.message}`); break; }
        calls++; const now = ns.dnet.getBlockedRam(target); freed = before - now;
        if (calls % 10 === 0) send({ host: target, gb: freed, remaining: now });
        if (parseCmd(ns.read(FILES.cmd)).stop) break;
    }
    send({ host: target, gb: freed, remaining: ns.dnet.getBlockedRam(target), done: true });
}
```

- [ ] **Step 2: Verify** all six with `node --check` and the collision check (`+[]`). `git status --short`.

---

### Task 6: the agent

**Files:**
- Create: `darknet/agent.js`

**Interfaces:**
- Consumes `FILES`, `AGENT_FILES`, `WORKER_RAM`, `parseCmd`, `parsePasswords`, `encodeMsg`, `isLabHost`, `parseClueText`.
- CLI: `run darknet/agent.js [--port 15] [--interval 4000]`. Always exec'd with `preventDuplicates: true`.
- Produces messages: `hello {host, maxRam, freeRam}`, `server {host, details:{...getServerDetails fields}, neighbours:[...]}` for itself and each neighbour when changed, `gone {host}`, `clue {host, file, passwords, contains}`, `worker {...}` (spawn results).
- Command file semantics (`parseCmd`): `claimed` = hosts some other agent is cracking (skip), `threads` = per-worker allocation, `migrateTarget`, `promoteSymbols`, `stasis` (true → run stasis.js once and remember in a local file `darknet/stasis-done.txt`), `share` (true → run `Remote/share.js` with spare RAM instead of phish), `stop`.

- [ ] **Step 1: Write the agent.** Skeleton with every function implemented:

```js
import { getConfiguration } from "../helpers.js";
import { FILES, AGENT_FILES, WORKER_RAM, PORT_DEFAULT, parseCmd, parsePasswords, encodeMsg, isLabHost, parseClueText, safeParse } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT], ["interval", 4000]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname(); const port = options.port;
    const send = (type, payload) => { const line = encodeMsg(type, me, ns.pid, payload); if (!ns.tryWritePort(port, line)) pending.push(line); };
    const pending = [];                       // retry queue for a full port
    const seen = {};                          // host -> last details JSON string, to report only changes
    const reportedFiles = new Set();
    const myDetails = ns.dnet.getServerDetails(me);
    send("hello", { host: me, maxRam: ns.getServerMaxRam(me), freeRam: ns.getServerMaxRam(me) - ns.getServerUsedRam(me), depth: myDetails.depth, difficulty: myDetails.difficulty });
    while (true) {
        while (pending.length && ns.tryWritePort(port, pending[0])) pending.shift();
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop) return ns.print("stop requested");
        const passwords = parsePasswords(ns.read(FILES.passwords));
        // 1. discover
        const neighbours = ns.dnet.probe();
        const detailsByHost = {};
        for (const h of neighbours) {
            const d = ns.dnet.getServerDetails(h); detailsByHost[h] = d;
            const key = JSON.stringify([d.isOnline, d.depth, d.difficulty, d.blockedRam, d.modelId, d.hasSession]);
            if (seen[h] !== key) { seen[h] = key; send("server", { host: h, details: d, neighbours: null }); }
        }
        send("server", { host: me, details: ns.dnet.getServerDetails(me), neighbours });
        // 2. crack unknown neighbours
        for (const h of neighbours) {
            const d = detailsByHost[h];
            if (!d.isOnline || passwords[h] !== undefined || cmd.claimed.includes(h) || isLabHost(h)) continue;
            if (ns.isRunning("darknet/crack.js", me, h)) continue;
            const threads = Math.max(1, Math.min(cmd.threads.crack || 6, Math.floor(freeRam(ns, me) / WORKER_RAM.crack)));
            if (threads >= 1) { const pid = ns.exec("darknet/crack.js", me, { threads }, h, "--port", port); send("worker", { type: "crack", host: h, threads, pid }); }
        }
        // 3. spread to known neighbours without an agent
        for (const h of neighbours) {
            const d = detailsByHost[h]; const pw = passwords[h];
            if (!d.isOnline || pw === undefined || isLabHost(h)) continue;
            if (ns.isRunning("darknet/agent.js", h)) continue;
            const session = ns.dnet.connectToSession(h, pw);
            if (!session.success) { send("crack", { host: h, success: false, attempts: 0, reason: "session:" + session.code, stale: session.code === 401 }); continue; }
            if (freeRam(ns, h) < 5) { if (d.blockedRam > 0 && !ns.isRunning("darknet/realloc.js", me, h)) spawnRealloc(ns, me, h, cmd, port); continue; }
            ns.scp(AGENT_FILES, h, me); ns.write(FILES.cmd, ns.read(FILES.cmd), "w"); ns.scp([FILES.passwords, FILES.cmd], h, me);
            const pid = ns.exec("darknet/agent.js", h, { threads: 1, preventDuplicates: true }, "--port", port);
            send("worker", { type: "agent", host: h, pid });
        }
        // 4. spend free RAM: realloc self, migrate, promote, share, phish
        if (ns.dnet.getBlockedRam(me) > 0 && !ns.isRunning("darknet/realloc.js", me, "self")) spawnRealloc(ns, me, "self", cmd, port);
        if (cmd.migrateTarget && neighbours.includes(cmd.migrateTarget) && !ns.isRunning("darknet/migrate.js", me, cmd.migrateTarget) && (cmd.threads.migrate || 0) > 0)
            ns.exec("darknet/migrate.js", me, { threads: Math.min(cmd.threads.migrate, Math.floor(freeRam(ns, me) / WORKER_RAM.migrate)) || 1 }, cmd.migrateTarget, "--port", port);
        if (cmd.promoteSymbols.length && !ns.isRunning("darknet/promote.js", me) && (cmd.threads.promote || 0) > 0)
            ns.exec("darknet/promote.js", me, { threads: Math.min(cmd.threads.promote, Math.floor(freeRam(ns, me) / WORKER_RAM.promote)) || 1 }, ...cmd.promoteSymbols, "--port", port);
        if (cmd.storm && ns.fileExists("STORM_SEED.exe", me)) { const r = ns.dnet.unleashStormSeed(); send("worker", { type: "storm", host: me, success: r.success, code: r.code }); }
        if (cmd.stasis && !ns.fileExists("darknet/stasis-done.txt", me) && freeRam(ns, me) >= WORKER_RAM.stasis) { ns.exec("darknet/stasis.js", me, 1, "--port", port); ns.write("darknet/stasis-done.txt", "1", "w"); }
        const spare = Math.floor(freeRam(ns, me) / (cmd.share ? WORKER_RAM.share : WORKER_RAM.phish));
        if (cmd.share) { if (spare > 0 && !ns.isRunning("Remote/share.js", me)) ns.exec("Remote/share.js", me, spare); }
        else if (spare > 0 && !ns.isRunning("darknet/phish.js", me)) ns.exec("darknet/phish.js", me, spare, "--port", port);
        if (cmd.share && ns.isRunning("darknet/phish.js", me)) ns.scriptKill("darknet/phish.js", me);   // NOTE scriptKill costs 1 GB; if the agent exceeds 5 GB, instead let phish.js exit on cmd.share (add that check to phish.js)
        // 5. caches and clues
        if (ns.ls(me, ".cache").length && !ns.isRunning("darknet/cache.js", me) && freeRam(ns, me) >= WORKER_RAM.cache) ns.exec("darknet/cache.js", me, 1, "--port", port);
        for (const f of [...ns.ls(me, ".data.txt"), ...ns.ls(me, ".lit")]) {
            if (reportedFiles.has(f)) continue; reportedFiles.add(f);
            const c = parseClueText(ns.read(f), neighbours); send("clue", { host: me, file: f, passwords: c.passwords, contains: c.contains });
        }
        await ns.sleep(options.interval);
    }
}
function freeRam(ns, host) { return ns.getServerMaxRam(host) - ns.getServerUsedRam(host); }
function spawnRealloc(ns, me, target, cmd, port) {
    const threads = Math.max(1, Math.min(cmd.threads.realloc || 50, Math.floor(freeRam(ns, me) / 2.6)));
    ns.exec("darknet/realloc.js", me, { threads }, target, "--port", port);
}
```
Decide the phish/share switch per the NOTE: prefer making `phish.js` exit when `cmd.share` becomes true (no `scriptKill` in the agent). `getServerMaxRam`/`getServerUsedRam` cost 0.05 each, `isRunning` 0.1, `fileExists` 0.1, `ls` 0.2, `scp` 0.6, `exec` 1.3, `probe` 0.2, `getServerDetails` 0.1, `connectToSession` 0.05, `getBlockedRam` 0, `getHostname` 0.05: total about 4.6 GB + 1.6 base. Verify with `mem`.

- [ ] **Step 2: Verify**: `node --check`, collision check `+[]`. `git status --short`.

---

### Task 7: the controller, part 1 (state, port, bootstrap, file push, loot planning)

**Files:**
- Create: `darknet.js`

**Interfaces:**
- CLI: `run darknet.js [--mode balanced|loot|labyrinth] [--port 15] [--interval 10000] [--crack-threads 6] [--realloc-threads 50] [--lab-walkers 3] [--lab-threads 6] [--allow-webstorm false] [--no-promote false] [--status] [--kill]`.
- Reads config overrides via `getConfiguration` (which already supports `darknet.js.config.txt`), re-read every loop so `mode` can change at runtime.
- Produces `darknet/state.txt` (spec schema), `/Temp/darknet-charisma-goal.txt` (a number), pushes `darknet/passwords.txt` and `darknet/cmd.txt` to every online known server.

- [ ] **Step 1: Write the controller** with these functions, each fully implemented:
  - `loadState(ns)`: read `state.txt`, validate `version === 1`, else `state.bak.txt`, else `emptyState(resetTime)`. Wipe when `state.resetTime !== ns.getResetInfo().lastAugReset` (getResetInfo costs 1 GB; fetch it once at startup and once every 5 minutes).
  - `saveState(ns, state)`: write tmp, then real, then bak (copy of the previous real).
  - `drainPort(ns, port, state)`: loop `ns.readPort(port)` until `"NULL PORT DATA"`, `decodeMsg`, apply: `hello`/`server` → upsert `state.servers[host]` (depth, difficulty, modelId, maxRam, blockedRam, chaReq, neighbours when provided, online, lastSeen=ts); `crack` success → `state.passwords[host] = {password, modelId, difficulty, solvedAt}`, stats; `crack` failure with `stale` → mark `state.passwords[host].stale = true`; `crack` failure with reason `charisma` → record `chaReq` on the server; `freed` → stats and `blockedRam=remaining`; `cache` → stats (parse money from the message with `/\$([\d.]+)([kmbtq]?)/i` via helpers' number parser if available, else count only); `clue` → merge passwords into `state.passwords` as `{password, modelId:"clue", solvedAt}`; `gone` → `online=false`; `walker` → Task 9.
  - `bootstrap(ns, state)`: if `!ns.isRunning("darknet/agent.js", "darkweb")`: `ns.scp(AGENT_FILES, "darkweb", "home")`, write cmd for darkweb, scp passwords+cmd, `ns.exec("darknet/agent.js", "darkweb", 1, "--port", port)`.
  - `pushFiles(ns, state, plan)`: write `darknet/passwords.txt` on home as `{host: password}` (non-stale); for each online server with a known password: `ns.dnet.connectToSession(host, pw)` (skip lab hosts), on success write `darknet/cmd.txt` with `buildCmd(state, plan, host)` and `ns.scp([FILES.passwords, FILES.cmd], host, "home")`. Also for darkweb.
  - `buildCmd(state, plan, host)` → JSON of `{mode, claimed: hosts currently being cracked by other agents (from worker messages in the last 2 minutes), threads: {crack: options.crackThreads, realloc: options.reallocThreads, migrate: plan.migrationTargets has an entry listing this host ? 10 : 0, promote: plan.promoteSymbols.length ? 8 : 0}, migrateTarget, promoteSymbols, stasis: plan.stasisTargets.includes(host), share: plan.shareActive, stop: false}`.
  - `planLoot(ns, state, options)` → `plan` with: `stasisTargets` = the top `limit` online freed servers by maxRam (limit from `ns.dnet.getStasisLinkLimit()`, 0 GB); `migrationTargets = {}` except islands (servers whose `neighbours` is empty and are known) → charge from any known neighbour of the previous scan; `promoteSymbols` from `/Temp/stock-probabilities.txt` (written by stockmaster, JSON array of `{sym, prob, ...}`; take up to 3 held symbols with the largest `|prob-0.5|`, or `[]` if the file is missing or `--no-promote`); `shareActive = ns.read(FILES.shareActive).trim() === "true"`; `charismaGoal` = min over servers with a recorded `chaReq` above current charisma (charisma via `ns.getPlayer().skills.charisma`, 0.5 GB, fetched every loop is fine).
  - `main`: handle `--status` (print a summary from the state and exit) and `--kill` (write cmd with `stop:true` to every reachable server, then for each `ns.dnet.connectToSession` + `ns.kill` by pid from `state.servers[host].agentPid`? `kill` costs 0.5 GB; acceptable) then exit; otherwise loop: drainPort → detect prestige → plan (Task 8 adds modes) → bootstrap → pushFiles → charisma goal file → saveState → sleep.

- [ ] **Step 2: Verify** `node --check darknet.js`, collision check `+[]`, and that the identifier list contains no NS names. `git status --short`.

---

### Task 8: the controller, part 2 (modes, stasis, migration, status)

**Files:**
- Modify: `darknet.js`

**Interfaces:** adds `planLabyrinth(ns, state, options)`, `chooseMode(ns, state, options)`, `currentLab(state, ns)`, `printStatus(ns, state)`.

- [ ] **Step 1: Implement**
  - `currentLab(ns)`: `ns.dnet.getServerDetails(lab.host).isOnline` for each `LABS` entry in order; the first that is online and not yet `hasSession`-solved... Simpler and exact: read `state.labs.completed`; the current lab is `LABS[completed.length]` (bonus lab repeats: clamp to the last entry). Verify it exists with `getServerDetails(host).isOnline`; if none exists (no SF15 and not BN15) return `null`.
  - `planLabyrinth`: `target = currentLab`; `frontierDepth` = max depth among online known servers; `stasisTargets` = servers adjacent to the lab (their `neighbours` include `target.host`) sorted by maxRam desc, up to the limit, else the deepest known servers; `migrationTargets`: for each air-gap row `r` in `AIR_GAP_ROWS` with `r < target.depth` and no known server with `depth > r`, pick the known online servers with `depth === r-1` (just above the gap) as targets, and list all their known neighbours as charging hosts; `crackPriority` by depth desc then difficulty desc (the agent ignores priority; the controller expresses it through `claimed` by leaving low-priority targets unclaimed only when RAM is scarce, so implement priority simply as: nothing, and note it as YAGNI unless agents run out of RAM).
  - `chooseMode`: `options.mode` unless `balanced`; then labyrinth if `currentLab` exists, `charisma >= lab.cha`, and (`frontierDepth >= lab.depth - 6` or a migration toward it is charging); else loot.
  - Webstorm: when `--allow-webstorm` is true, the mode is loot, no new server has been discovered for 60 minutes, and a report shows `STORM_SEED.exe` on some server (agents report `ns.ls(me, ".exe")` in `hello`; add that field), set `storm:true` in that server's cmd once and record `state.plan.lastStormAt`.
  - `printStatus`: counts of known/online/cracked servers, per-depth histogram, passwords per model, RAM freed, caches, current lab and walkers, stasis links (`ns.dnet.getStasisLinkedServers()`), charisma goal, mode.

- [ ] **Step 2: Verify** `node --check`, collision check. `git status --short`.

---

### Task 9: labyrinth walker and controller lab logic

**Files:**
- Create: `darknet/lab.js`
- Modify: `darknet.js`

**Interfaces:**
- `lab.js <labHost> [--port 15]`, N threads. Messages: `walker {lab, pid, steps, done:false}` every 25 steps; on success `walker {lab, pid, steps, done:true, password}`; on 451 `walker {lab, pid, reason:"charisma", chaReq}`.
- Controller: when `chooseMode === "labyrinth"`, `currentLab` exists, an online known server `h` has `neighbours.includes(lab.host)`, `freeRam(h) >= lab-threads*2`, and `state.labs.walkers.filter(alive).length < lab-walkers`: `connectToSession(h)`, `scp(AGENT_FILES, h)`, `exec("darknet/lab.js", h, {threads}, lab.host, "--port", port)`; record `{host:h, pid, startedAt}`. On `walker done`: `state.passwords[lab.host] = {password, modelId:"lab"}`, `state.labs.rewardQueuedAt = Date.now()`, `state.labs.completed.push(lab.host)` only after the reset time changes (next loop compares) — implement as: keep `rewardQueuedAt` set; when `ns.getResetInfo().lastAugReset` changes the whole state is wiped anyway, and `completed` is recomputed on startup from owned augmentations: `ns.singularity.getOwnedAugmentations()` costs 5 GB → instead infer from `getServerDetails(lab).isOnline` for each lab in order: the current lab is the first online lab whose `hasSession` is false for the controller... Simplest exact rule: `completed = LABS.filter(l => { const d = ns.dnet.getServerDetails(l.host); return d.isOnline && d.blockedRam === 0 && state.passwords[l.host] })`. Use the password map: a lab is completed when its password is known and the reward was queued before the last reset.

- [ ] **Step 1: Write `lab.js`**

```js
import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, AGENT_FILES, FILES } from "./lib.js";
const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }
const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPP = { north: "south", south: "north", east: "west", west: "east" };
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const lab = String(ns.args[0]); const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("walker", me, ns.pid, { lab, pid: ns.pid, ...p }));
    const visited = new Set(); const stack = [];   // stack of directions taken, for backtracking
    let steps = 0, target = null;                   // target = [x,y] of X once seen on radar
    const key = (c) => c.join(",");
    while (true) {
        const rep = await ns.dnet.labreport();
        if (!rep.success) { send({ reason: rep.message }); await ns.sleep(5000); continue; }
        const { coords, north, east, south, west } = rep; visited.add(key(coords));
        if (steps % 5 === 0) { const rad = await ns.dnet.labradar(); if (rad.success) target = findX(rad.message, coords); }
        const open = { north, east, south, west };
        let dir = null;
        // prefer unvisited cells, ordered by distance to target (or to the far corner heuristic: larger x and y)
        const order = Object.keys(DIRS).filter(d => open[d] && !visited.has(key([coords[0] + 2 * DIRS[d][0], coords[1] + 2 * DIRS[d][1]])));
        if (order.length) { order.sort((a, b) => dist(coords, a, target) - dist(coords, b, target)); dir = order[0]; stack.push(dir); }
        else if (stack.length) dir = OPP[stack.pop()];
        else { send({ reason: "dead-end" }); return; }
        const r = await ns.dnet.authenticate(lab, dir); steps++;
        if (r.success) { send({ steps, done: true, password: r.data }); ns.scp(AGENT_FILES, lab, me); ns.scp([FILES.passwords, FILES.cmd], lab, me); ns.exec("darknet/agent.js", lab, { threads: 1, preventDuplicates: true }, "--port", options.port); return; }
        if (r.code === 451) { send({ reason: "charisma", steps }); return; }
        if (r.code === 408) { steps--; continue; }
        if (/cannot go that way/.test(r.message)) { visited.add(key([coords[0] + 2 * DIRS[dir][0], coords[1] + 2 * DIRS[dir][1]])); if (stack[stack.length - 1] === dir) stack.pop(); }
        if (steps % 25 === 0) send({ steps, done: false });
    }
}
function dist(c, d, target) { const dx = c[0] + 2 * DIRS[d][0], dy = c[1] + 2 * DIRS[d][1]; const t = target ?? [1e9, 1e9]; return Math.abs(t[0] - dx) + Math.abs(t[1] - dy); }
function findX(radar, coords) { const rows = radar.split("\n"); for (let y = 0; y < rows.length; y++) { const x = rows[y].indexOf("X"); if (x >= 0) return [coords[0] + (x - 3), coords[1] + (y - 3)]; } return null; }
```
Note the walker only ever calls `authenticate` on the lab (never `connectToSession`). Distance uses the far corner when `X` is unknown, which is where the exit is up to a small offset.

- [ ] **Step 2: Add a walker unit test** in `test/darknet-lab.test.js` that drives the same DFS logic against `makeLab`/`labStep`/`labReport` from the mock: extract the move-selection into a pure function `nextMove(visited, stack, coords, open, target)` exported from `darknet/lab.js`... `lab.js` imports `helpers.js` which needs `ns` only at runtime, so Node can import it. Assert the walk finishes 20x14, 30x20 and 60x40 mazes (with offsets) in under 4x the cell count of steps for 5 seeds each.

- [ ] **Step 3: Controller lab logic** as in the Interfaces block. Verify with `node --check`, collision checks on `darknet/lab.js` and `darknet.js`, and `node --test test/`. `git status --short`.

---

### Task 10: integration hooks

**Files:**
- Modify: `daemon.js` (helper list near line 392-410; share decision near line 941-975)
- Modify: `work-for-factions.js` (idle branch of the main loop; the script already has a "study at university" helper for charisma used for company requirements, reuse it)
- Modify: `sleeve.js` (task selection, after faction work and before the crime fallback)

- [ ] **Step 1: daemon.js**: add to the periodic helper list `{ interval: 30000, name: "darknet.js", shouldRun: () => !options['no-darknet'] && (ownedPrograms.includes("DarkscapeNavigator.exe") || resetInfo.currentNode == 15 || 15 in dictSourceFiles) }` with flag `['no-darknet', false]`; where daemon decides to share (search `shareTool`), write `ns.write("/Temp/share-active.txt", String(shouldShare), "w")` every loop (0 GB).
- [ ] **Step 2: work-for-factions.js**: flag `['darknet-charisma', true]`; in the idle fallback read `/Temp/darknet-charisma-goal.txt`; if `goal > player.skills.charisma` study "Leadership" at the best available university (reuse the existing university helper) until `charisma >= goal`, re-checking every 30 s; log once.
- [ ] **Step 3: sleeve.js**: flag `['darknet-charisma', true]`; for idle sleeves (no faction/BB/crime task) with the same goal condition, `ns.sleeve.setToUniversityCourse(i, university, "Leadership")` via `getNsDataThroughFile`.
- [ ] **Step 4: Verify** `node --check` on the three files; collision check must show no new non-zero entries (`+[]`). `git status --short`.

---

### Task 11: in-game verification

**Files:** none in the repo; scratchpad snippets only.

- [ ] **Step 1: Unit tests and RAM**: `node --test test/` all green; rebuild the fixture with `node /tmp/.../scratchpad/mkfixture-scripts.mjs` after pointing its save path at `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz`; run the `s8-mem.mjs` snippet with `SCRIPTS` extended by `darknet.js` and every `darknet/*.js`; assert each is at or under its target (agent < 5, controller < 8, workers as listed).
- [ ] **Step 2: Loot run**: `s7-smoke.mjs` with `CMD="run darknet.js --mode loot --tail"` for 20 minutes; then a snippet that runs `run darknet.js --status` and dumps the terminal: assert at least 5 cracked servers, at least one at depth >= 1, RAM freed > 0, no runtime error modals. Capture the log window of `darknet.js` for anomalies.
- [ ] **Step 3: Reload**: in the same profile, `page.reload()`, wait 15 s, run `run darknet.js --status` again: assert the password count is unchanged and agents come back (running scripts on darkweb include `darknet/agent.js`).
- [ ] **Step 4: Labyrinth**: build a fixture from the same save with `sourceFiles` including `[15,1]` and `exp.charisma` raised so charisma >= 300 (use the save-editor helper `readSourceFiles/toJsonMap` shapes; charisma level = floor(32*ln(exp+534.6)-200) with 3.0 formulas, so exp about 3e6 gives 300+; verify in game via `run run-command.js ns.getPlayer().skills.charisma`); run `run darknet.js --mode labyrinth` for up to 40 minutes; assert a `walker done` message in the controller log and `run run-command.js ns.singularity.getOwnedAugmentations(true)` lists "The Broken Wings" (needs SF4, present in this save).
- [ ] **Step 5: Mode switch and kill**: write `darknet.js.config.txt` with `[["mode","loot"]]` while running and confirm the status line changes within 30 s; then `run darknet.js --kill` and confirm no `darknet/` scripts remain on darkweb.
- [ ] **Step 6: Report** results per step with numbers; `git status --short` for the user to commit.
