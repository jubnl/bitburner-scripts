# Darknet Crawler Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the darknet controller find the current labyrinth and cross air gaps after any reset, and stop the crawler wasting time and RAM on heartbleeds, duplicate walkers, duplicate cracks and inverted filler sizing.

**Architecture:** `darknet.js` (home) plans from `darknet/state.txt` and pushes `darknet/cmd.txt` per host; `darknet/agent.js` executes the command file and spawns the workers (`crack.js`, `lab.js`, `phish.js`, ...); `darknet/lib.js` and `darknet/solvers.js` are pure and unit-tested in Node. Every planning change lands as a pure exported function with a `node --test` case; worker changes that cannot be imported in Node are verified by source assertions plus the headless harness.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22 `node:test` for unit tests, tools/harness for RAM checks and the headless game.

**Spec:** docs/audit/2026-09-15-functional-review.md, section 4.

## Default changes for the user to approve

All three options are branch-added (`darknet.js` is not an alainbryden script), listed for completeness:

| Option / constant | Old | New | Why |
|---|---|---|---|
| `--lab-threads` | 6 | 0 (= every thread that fits on the walk host; any positive value is a cap) | R7: the walk host has all fillers evicted and the auth delay keeps shrinking with threads (`threadsFactor = 1/(1+0.2(t-1))`) |
| `--lab-walkers` | 3 | 1 | R8: walkers are deterministic duplicates on the first three labs; one walker with all the RAM is strictly better |
| `PROMOTE_THREADS = 4` per host, `MIN_PROMOTE_RAM = 64` | 4 / 64 GB floor | `PROMOTE_THREADS_PER_SYMBOL = 24` network-wide per held symbol, no floor; `PHISH_THREADS_TOTAL = 14` network-wide on the deepest hosts | R9 sizing rule (stock-profit magnitude unverified, sizing rule is the deliverable) |

## Global Constraints
- Never edit anything under /home/jubnl/dev/bitburner/bitburner-src.
- One finding per commit; commit message names the finding ID, e.g. `darknet: infer the current labyrinth from installed augmentations (R1)`. No Co-Authored-By or session trailers. Never push. Never touch .idea/. Per the user's global rules, stop before each `git commit` and let the user trigger it (or hand them the exact command).
- After every script edit run `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>` from the scripts repo root; any `+[...]` output is a new RAM charge from an identifier whose name equals an NS function -- rename it. `darknet/agent.js` must stay 4.50 GB and each worker at its `WORKER_RAM` value in `darknet/lib.js` (crack 2.95, lab 3.95, phish 3.65, ...). The only new NS call this plan adds to a worker is `ns.self()` in crack.js, which costs 0 GB (`bitburner-src/src/Netscript/RamCostGenerator.ts:592` `self: 0`).
- Run the full Node suite with a bare `node --test` from the scripts repo root (126 tests pass at HEAD). No globs or pipes on that command.
- Scope discipline: fix the finding, do not refactor around it.
- All paths below are relative to `/home/jubnl/dev/bitburner/bitburner-scripts`. Line numbers are as of HEAD `7d13c98`; later tasks quote the text as the earlier tasks leave it.

## Task order and dependencies

| Task | Finding | Depends on |
|---|---|---|
| 0 | R15 treat an `Invalid host` throw as a deleted server | - |
| 1 | R1 infer the current lab | - |
| 2 | R2 enter labyrinth mode at a gap | 1 (test fixtures use `ownedAugs`) |
| 3 | R3 never migrate a pinned host | 1 |
| 4 | R4 heartbleed only for oracle models, charisma-aware crack order | - |
| 5 | R12 crack reserve equals the launched threads | 4 (same line) |
| 6 | R5 one lab delay per step | - |
| 7 | R11 charisma goal and walker gate off by one | 1 |
| 8 | R6 crack claims renewed while cracking | 4 |
| 9 | R7 walker gets every thread that fits | 1, 7 |
| 10 | R8 per-walker direction preference, one walker by default | 6 |
| 11 | R9 filler sizing | - |
| 12 | R10 remove island migration | - |
| 13 | R13 skip unchanged file pushes | 0 (`pushFiles` text) |
| 14 | R14 2G_cellular timing side channel | 4, 8 (`crack.js` text) |
| 15 | headless smoke run | all |

---

### Task 0: R15 -- treat an `Invalid host` throw from connectToSession as a deleted server

**Files:**
- Modify: `darknet.js` lines 849-857 (the session block of `pushFiles`), lines 1091-1095 (the session block of `stopEverything`, the `--kill` path -- the spec calls it the "--status loop", but line 1091 is in `stopEverything`; `printStatus` opens no session), append after line 1133 (end of file)
- Test: `test/darknet-controller.test.js` (import lines 5-8; append after line 428)

**Interfaces:**
- Produces `darknet.js`: `function trySession(ns, host, secret) -> { success, code, message? }` (module-private) -- the only place `ns.dnet.connectToSession` is called; returns `{ success: false, code: 404, message }` when the call throws a message containing `Invalid host`, rethrows anything else. Both call sites treat 404 like 503 (`entry.online = false; entry.lastSeen = Date.now()`) plus `state.passwords[host].stale = true`. Task 13 (R13) edits `pushFiles` as this task leaves it.
- No new NS call: `connectToSession` is already in the controller's static budget (header line 10), so `darknet.js` stays at 6.15 GB.

**Root cause (verified against the game source):** `src/DarkNet/effects/SaveLoad.ts:4-14` persists only `storedCycles` and `hasUsedHeartbleed`, so after a game reload `DarknetState.offlineServers` is empty; `src/Netscript/NetscriptHelpers.tsx:504-515` `getServer` then finds a host deleted before the reload in neither the server table nor the offline table and throws `Invalid host: '<name>'` instead of returning the "offline" `[null, host]` that makes `connectToSession` answer 503. `darknet/state.txt` survives the reload with that host `online: true` and a password, `pushFiles` (line 849) calls `connectToSession` on it with no try/catch, and because `pushFiles` runs before `saveState` (main loop lines 120-122) the loop fails at the same host every 10 s forever; nothing ever marks the host offline. Note `errorMessage` in `src/Netscript/ErrorMessages.ts:29` returns a *string* and the game throws that string (the live report reads `RUNTIME ERROR ... dnet.connectToSession: Invalid host: 'byte%oasis'`), so the wrapper must read both a string and an `Error`.

**Placement note:** `trySession` is appended at the END of `darknet.js` (function declarations hoist), and the two replacements keep their line counts, so every `darknet.js` line number quoted in Tasks 1-11 stays valid. The test is appended after line 428 of `test/darknet-controller.test.js`, so Task 1's references to lines 37 and 397-428 of that file stay valid too. This task adds one Node test, so every `node --test` total quoted in Tasks 1-11 is one lower than what you will see (read Task 1's "131 pass" as 132, Task 11's "154 pass" as 155, and so on; Tasks 12-15 below already include it).

- [ ] **Step 1: write the failing test**

In `test/darknet-controller.test.js` change the import at lines 5-8 to
```js
import {
    applyMessage, assignStasis, buildCmd, chooseMode, currentLab, drainPort, launchWalkers,
    loadState, planLabyrinth, planLoot, planPromotions, pushFiles, saveState,
} from "../darknet.js";
```
and append after the last test (line 428):

```js
// ------------------------------------------------------------------ R15: a host the game no longer knows

// After a reload the game's DarknetState.offlineServers is empty (src/DarkNet/effects/SaveLoad.ts persists only
// storedCycles and hasUsedHeartbleed), so a host deleted before the reload resolves to neither the server table
// nor the offline table and every dnet call on it throws `Invalid host` (NetscriptHelpers.tsx getServer) instead
// of answering 503. darknet/state.txt survives the reload with the host online, so pushFiles threw on it every
// loop and nothing after it ran (no pushes, no walkers, no saveState).
test("pushFiles treats an `Invalid host` throw from connectToSession as a deleted server", () => {
    const ns = makeNs({});
    let sessions = 0;
    ns.dnet.connectToSession = (host) => {
        sessions++;
        if (host === "byte%oasis") throw new Error("dnet.connectToSession: Invalid host: 'byte%oasis'");
        return { success: true, code: 200 };
    };
    const state = makeState({ "byte%oasis": { depth: 3 }, keeper: { depth: 2 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.doesNotThrow(() => pushFiles(ns, state, plan));
    assert.equal(state.servers["byte%oasis"].online, false, "a name the game no longer knows is a deleted server");
    assert.equal(state.passwords["byte%oasis"].stale, true, "and its password is worthless too");
    assert.equal(state.servers.keeper.online, true);
    assert.equal(state.passwords.keeper.stale, undefined);
    assert.deepEqual(ns.scps.map(row => row.host), ["darkweb", "keeper"], "the loop carried on past the dead host");
    assert.equal(sessions, 2, "one session per stored host; darkweb needs none");

    // In the game errorMessage() throws a plain string, not an Error: the wrapper must read both.
    ns.dnet.connectToSession = () => { throw "RUNTIME ERROR\ndarknet.js@home (PID - 216)\n\ndnet.connectToSession: Invalid host: 'gone'"; };
    const stringState = makeState({ gone: {} });
    assert.doesNotThrow(() => pushFiles(ns, stringState, plan));
    assert.equal(stringState.servers.gone.online, false);

    // Anything else still propagates: a real bug must not be filed as a deletion.
    ns.dnet.connectToSession = () => { throw new Error("dnet.connectToSession: something else"); };
    assert.throws(() => pushFiles(ns, makeState({ other: {} }), plan), /something else/);

    const controller = readFileSync(new URL("../darknet.js", import.meta.url), "utf8");
    assert.equal((controller.match(/ns\.dnet\.connectToSession\(/g) ?? []).length, 1, "the only raw call is inside trySession; pushFiles and --kill go through it");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> the new test fails at `assert.doesNotThrow` ("Got unwanted exception. actual: Error: dnet.connectToSession: Invalid host: 'byte%oasis'").

- [ ] **Step 3: implement in `darknet.js`**

Replace lines 849-857 (inside `pushFiles`)
```js
            const session = ns.dnet.connectToSession(host, secret);
            if (!session.success) {
                // 401: the password no longer works (the server was replaced). 503: the server
                // is gone entirely -- nothing else ever tells us that, since a deleted host
                // simply stops appearing in its neighbours' probes.
                if (session.code === 401 && state.passwords[host]) state.passwords[host].stale = true;
                if (session.code === 503) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
```
with
```js
            const session = trySession(ns, host, secret);
            if (!session.success) {
                // 401: the password no longer works (the server was replaced). 503: the server was
                // deleted this game session. 404 (trySession): deleted before a reload, so the game
                // no longer knows the name at all -- gone, and the password is worthless too (R15).
                if ((session.code === 401 || session.code === 404) && state.passwords[host]) state.passwords[host].stale = true;
                if (session.code === 503 || session.code === 404) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
```
Replace lines 1091-1095 (inside `stopEverything`)
```js
            const session = ns.dnet.connectToSession(host, secret.password);
            if (!session.success) {
                if (session.code === 503) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
```
with
```js
            const session = trySession(ns, host, secret.password);
            if (!session.success) {
                if (session.code === 503 || session.code === 404) { entry.online = false; entry.lastSeen = Date.now(); }
                if (session.code === 404) secret.stale = true;
                continue;
            }
```
Append at the end of the file (after line 1133):
```js

// ---------------------------------------------------------------- sessions

/** connectToSession, with a server the game no longer knows treated as gone. After a reload the game's
 * DarknetState.offlineServers is empty (src/DarkNet/effects/SaveLoad.ts persists only storedCycles and
 * hasUsedHeartbleed), so a host deleted before the reload is in neither the server table nor the offline
 * table and every dnet call on it throws `Invalid host` (src/Netscript/NetscriptHelpers.tsx getServer)
 * instead of answering 503. The game throws that as a plain string (ErrorMessages.ts errorMessage), so
 * both shapes are read. Only that throw is caught; anything else propagates (R15).
 * @param {NS} ns */
function trySession(ns, host, secret) {
    try {
        return ns.dnet.connectToSession(host, secret);
    } catch (err) {
        const message = String(err?.message ?? err);
        if (message.includes("Invalid host")) return { success: false, code: 404, message };
        throw err;
    }
}
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 127 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]` (`connectToSession` was already charged).

- [ ] **Step 5: in-game check** -- reproduce the live report: with the controller running and at least one cracked host, wait for a network deletion (`run darknet.js --status` shows `known N` drop, or watch the darknet map), then save and reload the page and `run darknet.js`. The controller log must show no `ERROR: darknet controller loop failed ... Invalid host`, `run darknet.js --status` lists the deleted name under `last failures:` with nothing after it (its `online` is false and it has left `cracked`), and `cat darknet/state.txt` keeps being rewritten (its `plan.charismaGoal` and `stats` move). Hand workaround until the fix is in: `run darknet.js --kill`, then remove the dead host's `servers` and `passwords` entries from `darknet/state.txt` with `nano`.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: treat an Invalid host throw from connectToSession as a deleted server (R15)"`

**Optional follow-up (not planned, no task):** key `state.servers` / `state.passwords` by IP instead of hostname (`ns.dnet.probe(true)`; IPs are stable across moves and restarts and unique across hostname reuse) -- deferred, medium refactor, and it does not fix R15 on its own because a deleted IP is lost from `offlineServers` on reload exactly like a deleted hostname.

---

### Task 1: R1 -- infer the current labyrinth from installed augmentations, not from wiped state

**Files:**
- Modify: `darknet/lib.js` (append after `AIR_GAP_ROWS`, line 88)
- Modify: `darknet.js` lines 97 (`recomputeCompleted(state)` call), 600-657 (`observedLab`, `recomputeCompleted`, `currentLab`), import line 2
- Test: `test/darknet-controller.test.js` (`makeNs` line 37, tests at 397-428, new tests)

**Interfaces:**
- Produces `darknet/lib.js`: `export const LAB_AUGMENTATIONS`, `export function labFromAugmentations(ownedNames, bitNode) -> labHost`, `export function labFromDifficulty(maxDifficulty) -> labHost`.
- Produces `darknet.js`: `export function recomputeCompleted(ns, state)` (signature gains `ns`), `export function currentLab(ns, state)` (unchanged signature, new source of truth). Tasks 2, 3, 7 and 9 rely on `currentLab` returning the game's lab.
- Consumes `ns.getResetInfo().ownedAugs` / `.currentNode` (already paid for: darknet.js budgets `getResetInfo 1.00`).

**Design decision:** the spec's suggested `getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)')` is replaced by `ns.getResetInfo().ownedAugs`, because (a) it is literally `Player.augmentations` (`NetscriptFunctions.ts:1490`), the same installed-only list `labyrinth.ts:432 hasAugment` reads, whereas `getOwnedAugmentations(true)` also lists *queued* augmentations and would name the next lab before the install that creates it; (b) it needs no SF4 and no temp script; (c) `getNsDataThroughFile` references `ns.run` (1.0 GB) that darknet.js does not currently pay. The `maxObservedDifficulty + 1` fallback is kept for a game build whose `ResetInfo` lacks `ownedAugs`.

- [ ] **Step 1: write the failing tests**

Edit `test/darknet-controller.test.js`. Replace the `getResetInfo` line of `makeNs` (line 37):

```js
        getResetInfo: () => ({ lastAugReset: config.resetTime ?? 1000 }),
```
with
```js
        getResetInfo: () => ({
            lastAugReset: config.resetTime ?? 1000,
            currentNode: config.bitNode ?? 1,
            // undefined (the default) models a build whose ResetInfo has no ownedAugs, which exercises the
            // difficulty fallback; a list (possibly empty) models the real game.
            ownedAugs: config.ownedAugs ? new Map(config.ownedAugs.map(name => [name, 1])) : undefined,
        }),
```
Change the import at line 4 to
```js
import { parseCmd, emptyState, encodeMsg, WORKER_RAM, LABS, LAB_AUGMENTATIONS, labFromAugmentations, labFromDifficulty } from "../darknet/lib.js";
```
Append after the last test (line 428):

```js
// ------------------------------------------------------------------ R1: which labyrinth is current

// labyrinth.ts getCurrentLabName: the lab is chosen from *installed* augmentations, in this order, with a
// BN15 branch (TRP gates the fifth lab there) and TRP only gating the seventh lab outside BN8
// (BitNode.tsx:792 is the only DarknetLabyrinthRewardsTheRedPill: 0).
test("labFromAugmentations mirrors labyrinth.ts getCurrentLabName, BN15 branch included", () => {
    const A = LAB_AUGMENTATIONS;
    assert.equal(labFromAugmentations([], 1), "th3_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings], 1), "cru3l_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings, A.TheBoots], 1), "m3rc1l3ss_l4byr1nth");
    assert.equal(labFromAugmentations([A.TheBrokenWings, A.TheBoots, A.TheHammer], 1), "ub3r_l4byr1nth");
    const four = [A.TheBrokenWings, A.TheBoots, A.TheHammer, A.TheStaff];
    assert.equal(labFromAugmentations(four, 1), "et3rn4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw], 1), "end13ss_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 1), "f1n4l_l4byr1nth", "TRP still to be won outside BN8");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 8), "b0nus_l4byr1nth", "BN8 never offers TRP from the labyrinth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword, A.TheRedPill], 1), "b0nus_l4byr1nth");
    // BN15: TRP gates the fifth lab, then Law, then Sword.
    assert.equal(labFromAugmentations(four, 15), "et3rn4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill], 15), "end13ss_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill, A.TheLaw], 15), "f1n4l_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheRedPill, A.TheLaw, A.TheSword], 15), "b0nus_l4byr1nth");
    assert.equal(labFromAugmentations([...four, A.TheLaw, A.TheSword], 15), "end13ss_l4byr1nth", "in BN15 the Law/Sword order only counts once TRP is installed");
});

test("labFromDifficulty is the first lab deeper than every difficulty seen so far", () => {
    // NetworkMovement.ts:194: difficulty is uniform in [0, netDepth), so netDepth >= max + 1.
    assert.equal(labFromDifficulty(0), "th3_l4byr1nth");
    assert.equal(labFromDifficulty(6), "th3_l4byr1nth");
    assert.equal(labFromDifficulty(7), "cru3l_l4byr1nth", "a difficulty-7 host cannot exist on a net of depth 7");
    assert.equal(labFromDifficulty(11), "cru3l_l4byr1nth");
    assert.equal(labFromDifficulty(12), "m3rc1l3ss_l4byr1nth");
    assert.equal(labFromDifficulty(99), "b0nus_l4byr1nth");
});

test("currentLab follows the installed augmentations after a state wipe, not state.labs.completed", () => {
    // Every install wipes the darknet and the controller's state; the second lab (depth 12) is wired to
    // depth-11 hosts beyond the row-8 air gap, so nothing near it is ever observed.
    const ns = makeNs({
        charisma: 700, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },   // not wired in yet: depth -1 like NetworkGenerator creates it
    });
    const state = makeState({
        shallow: { depth: 3, difficulty: 3, neighbours: ["mover"] },
        mover: { depth: 5, difficulty: 6, neighbours: ["shallow"] },   // 6 + 4 = 10 > 8: can land past the first gap
    });
    assert.deepEqual(state.labs.completed, [], "fresh state knows nothing");
    const lab = currentLab(ns, state);
    assert.equal(lab.host, "cru3l_l4byr1nth");
    assert.equal(lab.depth, 12, "LABS depth is used while the lab reports -1");
    assert.deepEqual(recomputeCompleted(ns, state), ["th3_l4byr1nth"]);

    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["mover"], "the row-8 gap below the inferred lab is planned");
    assert.deepEqual(plan.migrationTargets.mover, ["shallow"]);
    assert.equal(plan.charismaGoal, 0, "700 already clears the 600 gate");
});

test("currentLab falls back to the deepest observed difficulty when ownedAugs is unavailable", () => {
    const ns = makeNs({ details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } } });   // no ownedAugs at all
    const state = makeState({ a: { depth: 2, difficulty: 6 }, b: { depth: 4, difficulty: 7 } });
    assert.equal(currentLab(ns, state).host, "cru3l_l4byr1nth", "a difficulty-7 host rules out the depth-7 lab");
    state.servers.b.difficulty = 5;
    assert.equal(currentLab(ns, state).host, "th3_l4byr1nth");
});

test("currentLab trusts a lab an agent has probed over the difficulty fallback", () => {
    const ns = makeNs({});
    const state = makeState({ near: { depth: 11, difficulty: 2, neighbours: ["cru3l_l4byr1nth"] } });
    assert.equal(currentLab(ns, state).host, "cru3l_l4byr1nth");
});
```
Also add `recomputeCompleted` to the `../darknet.js` import list (lines 5-8).

Then update the two existing tests that set `state.labs.completed` by hand (they now describe the pre-R1 behaviour):
- line 402: `const ns = makeNs({ charisma: 600, details: { cru3l_l4byr1nth: { isOnline: true, depth: 12 } } });` -> `const ns = makeNs({ charisma: 600, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings], details: { cru3l_l4byr1nth: { isOnline: true, depth: 12 } } });` and delete line 409 (`state.labs.completed = ["th3_l4byr1nth"];`).
- line 419: same `makeNs` change; delete line 421 (`state.labs.completed = ["th3_l4byr1nth"];`).

- [ ] **Step 2: run the tests, expect failures**

`node --test test/darknet-controller.test.js` -> fails to import `LAB_AUGMENTATIONS`/`labFromAugmentations`/`labFromDifficulty` from `../darknet/lib.js` (SyntaxError: The requested module does not provide an export named 'LAB_AUGMENTATIONS').

- [ ] **Step 3: add the pure helpers to `darknet/lib.js`**

Insert after line 88 (`export const AIR_GAP_ROWS = [8, 16, 24, 32];`):

```js
// The augmentation each labyrinth is gated on (src/Augmentation/Enums.ts). Keyed by the enum member name
// labyrinth.ts getCurrentLabName uses, valued by the in-game name getResetInfo().ownedAugs is keyed by.
export const LAB_AUGMENTATIONS = {
    TheBrokenWings: "The W1ngs of Icarus",
    TheBoots: "The B00ts of Perseus",
    TheHammer: "The H4mmer of Daedalus",
    TheStaff: "The St4ff of Asclepius",
    TheRedPill: "The Red Pill",
    TheLaw: "The L4w of Bayes",
    TheSword: "The B1ade of Solomonoff",
};

/** The labyrinth the game considers current, from the *installed* augmentations. A line-for-line mirror of
 * src/DarkNet/effects/labyrinth.ts getCurrentLabName: `hasAugment` there reads Player.augmentations (installed,
 * not queued), which is exactly what getResetInfo().ownedAugs exposes. BN15 gates the fifth lab on The Red Pill;
 * everywhere else TRP only gates the seventh, and never in BN8 (BitNode.tsx:792 is the only
 * DarknetLabyrinthRewardsTheRedPill: 0). */
export function labFromAugmentations(ownedNames, bitNode) {
    const owned = new Set(ownedNames ?? []);
    const has = (key) => owned.has(LAB_AUGMENTATIONS[key]);
    if (!has("TheBrokenWings")) return "th3_l4byr1nth";
    if (!has("TheBoots")) return "cru3l_l4byr1nth";
    if (!has("TheHammer")) return "m3rc1l3ss_l4byr1nth";
    if (!has("TheStaff")) return "ub3r_l4byr1nth";
    if (Number(bitNode) === 15) {
        if (!has("TheRedPill")) return "et3rn4l_l4byr1nth";
        if (!has("TheLaw")) return "end13ss_l4byr1nth";
        if (!has("TheSword")) return "f1n4l_l4byr1nth";
        return "b0nus_l4byr1nth";
    }
    if (!has("TheLaw")) return "et3rn4l_l4byr1nth";
    if (!has("TheSword")) return "end13ss_l4byr1nth";
    const allowTRP = Number(bitNode) !== 8;
    if (allowTRP && !has("TheRedPill")) return "f1n4l_l4byr1nth";
    return "b0nus_l4byr1nth";
}

/** Lower bound on the current lab from what the network shows: every server's difficulty is drawn uniformly
 * from [0, netDepth) (NetworkMovement.ts:194), so the net is at least `max + 1` deep and the current lab is the
 * first one at that depth or deeper. Used only when getResetInfo() carries no ownedAugs. */
export function labFromDifficulty(maxDifficulty) {
    const bound = (Number(maxDifficulty) || 0) + 1;
    return (LABS.find(row => row.depth >= bound) ?? LABS[LABS.length - 1]).host;
}
```

- [ ] **Step 4: rewire `darknet.js`**

Change the import at line 2 to:
```js
import { AGENT_FILES, AIR_GAP_ROWS, FILES, LABS, PORT_DEFAULT, WORKER_RAM, decodeMsg, emptyState, isLabHost, safeParse, hostArg, canHoldStasis, labFromAugmentations, labFromDifficulty } from "./darknet/lib.js";
```
Line 97: `recomputeCompleted(state);` -> `recomputeCompleted(ns, state);`

Replace lines 617-657 (`recomputeCompleted` docblock through the end of `currentLab`) with:

```js
/** The lab the game itself says is current (labyrinth.ts getCurrentLabName), or null on a build whose
 * ResetInfo has no ownedAugs. getResetInfo is already in this script's static budget and is free to call.
 * @param {NS} ns */
function gameLab(ns) {
    const info = ns.getResetInfo();
    const owned = info?.ownedAugs;
    if (!owned || typeof owned.keys !== "function") return null;
    return labFromAugmentations([...owned.keys()], info.currentNode);
}

function maxObservedDifficulty(state) {
    let deepest = 0;
    for (const [name, entry] of Object.entries(state.servers ?? {})) {
        if (isLabHost(name)) continue;
        deepest = Math.max(deepest, Number(entry.difficulty) || 0);
    }
    return deepest;
}

/** The current labyrinth's hostname. The game's augmentation list is authoritative; a lab an agent has probed
 * says the same thing; failing both, the deepest difficulty seen bounds the net depth from below. None of
 * these needs any host near the lab to exist, which after a reset none does (R1). */
function inferredLabHost(ns, state) {
    return gameLab(ns) ?? observedLab(state) ?? labFromDifficulty(maxObservedDifficulty(state));
}

/** Recompute `state.labs.completed` from the current lab: the labs unlock strictly in LABS order, so
 * everything before the current one is done. Cheap and pure, so the loop runs it every pass.
 * @param {NS} ns */
export function recomputeCompleted(ns, state) {
    const index = LABS.findIndex(row => row.host === inferredLabHost(ns, state));
    state.labs.completed = index > 0 ? LABS.slice(0, index).map(row => row.host) : [];
    return state.labs.completed;
}

/** The labyrinth the player is currently working on, or null when there is none (no SF15/BN15).
 * @param {NS} ns */
export function currentLab(ns, state) {
    const lab = LABS.find(row => row.host === inferredLabHost(ns, state));
    if (!lab) return null;
    const details = ns.dnet.getServerDetails(lab.host);
    if (!details || !details.isOnline) return null;
    // Labyrinths are created with depth -1 and only get a real depth once they are wired in.
    const depth = Number(details.depth) > 0 ? Number(details.depth) : lab.depth;
    return { host: lab.host, cha: lab.cha, depth };
}
```
(`observedLab`, lines 600-615, stays as it is.) The air-gap loop in `planLabyrinth` (`for (const row of AIR_GAP_ROWS) { if (row >= lab.depth) continue; ...`) already iterates every gap below `lab.depth`; with `lab` now correct it plans every gap below the inferred lab, which the new test asserts.

- [ ] **Step 5: run the tests and checks**

`node --test test/darknet-controller.test.js` -> all pass (5 new tests). `node --test` -> 131 pass.
`node --check darknet.js && node --check darknet/lib.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/lib.js` -> both print `+[]`.

- [ ] **Step 6: in-game check (any save with darknet access)**

`run darknet.js --status` after one loop: the `lab:` line names the lab matching the installed W1ngs/B00ts/... augmentations even on a fresh `darknet/state.txt`; `completed N` equals the number of those augmentations installed.

- [ ] **Step 7: commit (user triggers)**

`git add darknet.js darknet/lib.js test/darknet-controller.test.js && git commit -m "darknet: infer the current labyrinth from installed augmentations (R1)"`

---

### Task 2: R2 -- balanced mode enters labyrinth mode when the frontier is blocked by an air gap

**Files:**
- Modify: `darknet.js` lines 717-737 (`chooseMode`)
- Test: `test/darknet-controller.test.js`

**Interfaces:** `chooseMode(ns, state, options, charisma)` unchanged signature. Consumes `currentLab` from Task 1.

- [ ] **Step 1: write the failing test** (append to `test/darknet-controller.test.js`)

```js
// R2: without a migration nothing is ever reachable past an air-gap row (rows 8/16/24/32 hold no servers and
// connections only join rows x+-1), so the frontier stalls at row-1 and can never creep to within
// LAB_DEPTH_SLACK of a lab at depth >= 19. Gap migrations are only planned in labyrinth mode.
test("chooseMode flips to labyrinth when the frontier sits just above an air gap below the lab", () => {
    const ns = makeNs({
        charisma: 2000, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings, LAB_AUGMENTATIONS.TheBoots],
        details: { m3rc1l3ss_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const options = { ...baseOptions, mode: "balanced" };
    const blocked = makeState({ edge: { depth: 7, difficulty: 6 }, mid: { depth: 4, difficulty: 2 } });
    assert.equal(currentLab(ns, blocked).host, "m3rc1l3ss_l4byr1nth");
    assert.equal(chooseMode(ns, blocked, options, 2000), "labyrinth", "frontier 7 = row 8 - 1, lab at 19");
    const creeping = makeState({ edge: { depth: 6, difficulty: 6 } });
    assert.equal(chooseMode(ns, creeping, options, 2000), "loot", "row 7 is still crackable, keep looting");
    const crossed = makeState({ beyond: { depth: 9, difficulty: 7 } });
    assert.equal(chooseMode(ns, crossed, options, 2000), "loot", "past the gap and 10 rows short: loot until the next gap");
    const secondGap = makeState({ beyond: { depth: 15, difficulty: 12 } });
    assert.equal(chooseMode(ns, secondGap, options, 2000), "labyrinth", "row 16 also lies below the lab");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> the new test fails on the first `chooseMode` assertion (`'loot' !== 'labyrinth'`).

- [ ] **Step 3: implement**

In `chooseMode`, replace
```js
    if (frontierDepth(state) >= lab.depth - LAB_DEPTH_SLACK) return "labyrinth";
```
with
```js
    const frontier = frontierDepth(state);
    if (frontier >= lab.depth - LAB_DEPTH_SLACK) return "labyrinth";
    // Blocked by an air gap: rows 8/16/24/32 hold no servers and connections only join adjacent rows
    // (darknetNetworkUtils.ts:501, NetworkGenerator.ts:192-200), so a frontier at row-1 can only advance by
    // the gap migrations planLabyrinth plans. Slack does not matter here (R2).
    if (AIR_GAP_ROWS.some(row => row < lab.depth && frontier === row - 1)) return "labyrinth";
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 132 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: enter labyrinth mode when an air gap blocks the frontier (R2)"`

---

### Task 3: R3 -- never charge a migration on a stasis-pinned host, never pin the migration target

**Files:**
- Modify: `darknet.js` lines 680-709 (`planLabyrinth` stasis and air-gap blocks)
- Test: `test/darknet-controller.test.js`

**Interfaces:** `planLabyrinth(ns, state, options, charisma)` unchanged; `plan.migrationTargets` keys are never in `plan.stasisTargets`, never currently linked (`ns.dnet.getStasisLinkedServers()` or `entry.stasis === true`) unless every crossing candidate is linked, in which case the strongest linked candidate is chosen and released via `plan.stasisRelease`.

**Design decision:** migration targets are chosen first (unlinked candidates preferred; if every candidate is linked, take them anyway so `assignStasis` releases them next loop instead of deadlocking), then the stasis candidates exclude every migration target -- a linked server is immutable (`NetworkMovement.ts:227-228, 240-243`) and its full charge is discarded.

- [ ] **Step 1: write the failing tests** (append to `test/darknet-controller.test.js`)

```js
// R3: a linked server is immutable (NetworkMovement.ts isImmutable = openServer || isConnectedTo || hasStasisLink)
// and a full migration charge on it is thrown away (effects.ts:257-260). Before the first crossing the deepest
// hosts and the highest-difficulty hosts are the same handful, so the old plan pinned its own migration target.
test("planLabyrinth never pins the host it is migrating, and never migrates a pinned host", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 2, ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        best: { depth: 7, difficulty: 7, maxRam: 64, neighbours: ["charger"] },     // deepest AND the strongest candidate
        deep: { depth: 7, difficulty: 5, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 4, maxRam: 64, neighbours: ["best", "deep"] },
    });
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["best", "deep"]);
    for (const target of Object.keys(plan.migrationTargets)) {
        assert.ok(!plan.stasisTargets.includes(target), `${target} is being migrated and must not be pinned`);
    }
    assert.deepEqual(plan.stasisTargets, ["charger"], "the slots go to hosts that are not crossing");
});

test("planLabyrinth skips hosts the game already holds in stasis when another candidate exists", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 2, stasisLinked: ["best"], ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        best: { depth: 7, difficulty: 7, maxRam: 64, neighbours: ["charger"] },
        deep: { depth: 7, difficulty: 5, maxRam: 64, neighbours: ["charger"] },
        selfReported: { depth: 6, difficulty: 6, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 4, maxRam: 64, neighbours: ["best", "deep", "selfReported"] },
    });
    state.servers.selfReported.stasis = true;   // stasis.js reported success, the game list is stale
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["deep"], "best (linked) and selfReported (stasis:true) cannot move");
    assert.ok(plan.stasisTargets.includes("best"), "an existing link on a non-target is kept");
});

test("planLabyrinth releases a pinned host when every crossing candidate is pinned", () => {
    const ns = makeNs({
        charisma: 700, stasisLimit: 1, stasisLinked: ["only"], ownedAugs: [LAB_AUGMENTATIONS.TheBrokenWings],
        details: { cru3l_l4byr1nth: { isOnline: true, depth: -1 } },
    });
    const state = makeState({
        only: { depth: 7, difficulty: 6, maxRam: 64, neighbours: ["charger"] },
        charger: { depth: 6, difficulty: 2, maxRam: 64, neighbours: ["only"] },   // 2 + 4 = 6 < 8: cannot cross
    });
    const plan = planLabyrinth(ns, state, baseOptions, 700);
    assert.deepEqual(Object.keys(plan.migrationTargets), ["only"]);
    assert.ok(!plan.stasisTargets.includes("only"));
    assert.deepEqual(plan.stasisRelease, ["only"], "stasis:false goes out so the host becomes movable");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> first new test fails (`best` is in both `stasisTargets` and `migrationTargets`).

- [ ] **Step 3: implement**

In `planLabyrinth`, replace lines 686-709 (from the `// darkweb and any isStationary host are never valid stasis targets` comment through the closing `}` of the `for (const row of AIR_GAP_ROWS)` loop) with:

```js
    // Air-gap crossings are planned BEFORE stasis: a linked server is immutable (NetworkMovement.ts
    // isImmutable = openServer || isConnectedTo || hasStasisLink) and induceServerMigration discards a full
    // charge on it, so a migration target must not hold a link and must not be given one until it has landed
    // beyond the gap -- after landing it is the deepest host and the rule below pins it, which is right (R3).
    const linked = new Set(ns.dnet.getStasisLinkedServers());
    for (const [name, entry] of online) if (entry.stasis === true) linked.add(name);
    for (const row of AIR_GAP_ROWS) {
        if (row >= lab.depth) continue;
        if (online.some(([, entry]) => (Number(entry.depth) || 0) > row)) continue;   // gap already crossed
        // Strongest candidate first: buildCmd gives a charger to the first target that lists it.
        const candidates = online.filter(([, entry]) => canCrossAirGap(entry, row))
            .sort((a, b) => (Number(b[1].difficulty) || 0) - (Number(a[1].difficulty) || 0));
        // Prefer hosts that can move now. When every candidate is pinned, take them anyway: excluding them
        // from the stasis candidates below makes assignStasis release the link, and next loop they can move.
        const movable = candidates.filter(([name]) => !linked.has(name));
        for (const [name, entry] of (movable.length ? movable : candidates)) {
            const chargers = (entry.neighbours ?? []).filter(charger => reachable.includes(charger));
            if (chargers.length) plan.migrationTargets[name] = chargers;
        }
    }
    const crossing = (name) => name in plan.migrationTargets;
    // darkweb and any isStationary host are never valid stasis targets (see planLoot); lab hosts
    // are already excluded from `online` above.
    const adjacent = online
        .filter(([name, entry]) => name !== "darkweb" && entry.isStationary !== true && canHoldStasis(entry)
            && reachable.includes(name) && !crossing(name) && (entry.neighbours ?? []).includes(lab.host))
        .sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0))
        .map(([name]) => name);
    const deepest = online
        .filter(([name, entry]) => name !== "darkweb" && entry.isStationary !== true && canHoldStasis(entry)
            && reachable.includes(name) && !crossing(name))
        .sort((a, b) => (Number(b[1].depth) || 0) - (Number(a[1].depth) || 0))
        .map(([name]) => name);
    plan.stasisTargets = assignStasis(ns, plan, adjacent.length ? adjacent : deepest);
```
The `reachable` declaration at line 685 stays above this block. The existing test "planLabyrinth picks air-gap migration targets by difficulty, strongest first" still passes (`charger` alone is pinned; targets unchanged).

- [ ] **Step 4: run tests and checks** -- `node --test` -> 135 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: in-game check** -- `run darknet.js --status` in labyrinth mode: no host appears both after `migration targets:` and after `stasis links: ... (planned:`.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: never migrate a pinned host nor pin the migration target (R3)"`

---

### Task 4: R4 -- heartbleed only for oracle models; charisma-aware crack skipping and ordering

**Files:**
- Modify: `darknet/lib.js` (`parseCmd` base object line 134-149; append `FEEDBACK_MODELS`, `crackOrder`)
- Modify: `darknet/crack.js` lines 3, 21-40
- Modify: `darknet/agent.js` lines 61-74, 87-94
- Modify: `darknet.js` `buildCmd` lines 772-795 and `stopEverything`'s `stopCmd` lines 1075-1080
- Test: `test/darknet-filler.test.js` (agent-side rules), `test/darknet-solvers.test.js` (model set), `test/darknet-controller.test.js` (cmd field)

**Interfaces:**
- Produces `darknet/lib.js`: `export const FEEDBACK_MODELS = new Set([...11 oracle model ids])`; `export function crackOrder(hosts, detailsByHost, charisma) -> string[]` (hosts to crack this tick, best first; oracle-model hosts with `requiredCharismaSkill > charisma` removed; `charisma === null` means unknown, nothing removed).
- Produces `cmd.charisma` (number) in `darknet/cmd.txt`; `parseCmd` default `charisma: null`.
- Produces `crack.js`'s `attemptFn(password, needFeedback = true)` returning `{ success, feedback }` where `feedback` is `null` for feedback-free models. Task 14 extends this with `elapsed`.

- [ ] **Step 1: write the failing tests**

Append to `test/darknet-filler.test.js` (import line 9 gains `FEEDBACK_MODELS, crackOrder`):

```js
// R4: authenticate has no charisma gate (Darknet.ts:93-177), only heartbleed does (:248-258). 13 of 24 models are
// solved by authenticate alone, so on those a host above the charisma bar is crackable, and a heartbleed after
// each miss only adds 1.5x the auth delay. The underleveled auth penalty (>= 2.5x) applies at charisma <= chaReq.
test("crackOrder skips oracle-model hosts above the charisma bar and puts penalised hosts last", () => {
    const details = {
        free: { modelId: "TopPass", requiredCharismaSkill: 900 },              // feedback-free: crackable at any charisma
        easy: { modelId: "NIL", requiredCharismaSkill: 100 },                  // oracle, well under the bar
        equal: { modelId: "DeepGreen", requiredCharismaSkill: 300 },           // passes heartbleed, pays the 2.5x penalty
        locked: { modelId: "KingOfTheHill", requiredCharismaSkill: 301 },      // heartbleed answers 451: skip it
        cheap: { modelId: "ZeroLogon", requiredCharismaSkill: 50 },
    };
    assert.deepEqual(crackOrder(["locked", "equal", "free", "easy", "cheap"], details, 300), ["cheap", "easy", "equal", "free"]);
    assert.deepEqual(crackOrder(["locked", "free"], details, null), ["free", "locked"], "unknown charisma (old controller): skip nothing");
    assert.deepEqual(crackOrder(["ghost"], {}, 300), ["ghost"], "no details yet: try it");
});

test("FEEDBACK_MODELS lists exactly the solvers that read heartbleed feedback", () => {
    assert.deepEqual([...FEEDBACK_MODELS].sort(), ["2G_cellular", "AccountsManager_4.2", "BellaCuore", "BigMo%od",
        "DeepGreen", "Factori-Os", "KingOfTheHill", "NIL", "OpenWebAccessPoint", "PHP 5.4", "RateMyPix.Auth"]);
});

test("crack.js only heartbleeds for feedback models and agent.js orders cracks with crackOrder", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /FEEDBACK_MODELS\.has\(details\.modelId\)/);
    assert.match(crack, /if \(!wantsFeedback \|\| !needFeedback\) return \{ success: false, feedback: null/);
    const agent = src("darknet/agent.js");
    assert.match(agent, /crackOrder\(/);
    assert.match(agent, /cmd\.charisma/);
});
```

Append to `test/darknet-solvers.test.js` (import `FEEDBACK_MODELS` from `../darknet/lib.js` on line 5):
```js
test("every oracle solver is in FEEDBACK_MODELS and no direct solver is", () => {
    for (const modelId of ORACLE) assert.ok(FEEDBACK_MODELS.has(modelId), modelId);
    for (const modelId of [...DIRECT, "Pr0verFl0"]) assert.ok(!FEEDBACK_MODELS.has(modelId), modelId);
});
```

In `test/darknet-controller.test.js`, test "buildCmd fills every field parseCmd defaults, for a normal host" (line 85): after `assert.equal(cmd.mode, "loot");` add `assert.equal(cmd.charisma, 10, "the agent needs the player's charisma to skip oracle hosts it cannot heartbleed");`.

- [ ] **Step 2: run them** -- `node --test test/darknet-filler.test.js test/darknet-solvers.test.js test/darknet-controller.test.js` -> import errors for `FEEDBACK_MODELS`/`crackOrder`, then `cmd.charisma` undefined.

- [ ] **Step 3: `darknet/lib.js`**

In `parseCmd`'s `base` (line 134-149) add after `claimed: [],`:
```js
        // The player's charisma at planning time (null = an older controller that never wrote it). The agent
        // skips oracle-model hosts whose requiredCharismaSkill exceeds it: heartbleed would answer 451.
        charisma: null,
```
Append at the end of the file:
```js
// The models whose solver reads heartbleed feedback (the "oracle" solvers in darknet/solvers.js). Every other
// model is decoded from the hint or a dictionary and is solved by authenticate alone, which has no charisma gate.
export const FEEDBACK_MODELS = new Set([
    "NIL", "2G_cellular", "AccountsManager_4.2", "BellaCuore", "BigMo%od", "Factori-Os", "DeepGreen",
    "RateMyPix.Auth", "PHP 5.4", "KingOfTheHill", "OpenWebAccessPoint",
]);

/** The uncracked neighbours worth starting a crack on this tick, best first. An oracle-model host whose
 * requiredCharismaSkill exceeds the player's charisma is dropped: heartbleed refuses it (451) and authenticate
 * alone cannot solve it. Hosts at or below the bar (calculateAuthenticationTime's underleveled factor applies at
 * charisma <= required) come last, cheapest requirement first. `charisma` null = unknown, drop nothing. */
export function crackOrder(hosts, detailsByHost, charisma) {
    const known = charisma !== null && charisma !== undefined && Number.isFinite(Number(charisma));
    const rows = [];
    for (const host of hosts) {
        const d = detailsByHost?.[host] ?? {};
        const req = Number(d.requiredCharismaSkill) || 0;
        if (known && FEEDBACK_MODELS.has(d.modelId) && req > Number(charisma)) continue;
        rows.push({ host, penalised: known && req >= Number(charisma) ? 1 : 0, req });
    }
    rows.sort((a, b) => a.penalised - b.penalised || a.req - b.req);
    return rows.map(row => row.host);
}
```

- [ ] **Step 4: `darknet.js`**

In `buildCmd`'s returned object (line 772) add after `claimed,`:
```js
        charisma: Number(plan.charisma) || 0,
```
In `stopEverything`'s `stopCmd` (line 1076) change `mode: "loot", claimed: [],` to `mode: "loot", claimed: [], charisma: null,`.

- [ ] **Step 5: `darknet/agent.js`**

Line 2 import: add `crackOrder` -> `import { FILES, AGENT_FILES, WORKER_RAM, PORT_DEFAULT, parseCmd, parsePasswords, encodeMsg, isLabHost, parseClueText, hostArg, fillerPlan, selfReportKey, crackOrder } from "./lib.js";`

Replace lines 61-74 (the `needsCrack` comment, loop and `let reserve = ...`) with:
```js
        // Cracking always outranks spare-RAM work (promote/phish/share): reserve enough RAM for
        // up to 4 crack.js threads whenever a live, non-lab, unclaimed neighbour still needs one.
        // crackOrder drops oracle-model hosts above the charisma bar (heartbleed would refuse them, R4)
        // and puts hosts that would pay the underleveled auth penalty last.
        const pending = crackOrder(neighbours.filter(h => {
            const d = detailsByHost[h];
            return d.isOnline && passwords[h] === undefined && !cmd.claimed.includes(h) && !isLabHost(h)
                && !ns.isRunning("darknet/crack.js", me, hostArg(h), "--port", port);
        }), detailsByHost, cmd.charisma);
        let reserve = pending.length ? Math.min(cmd.threads.crack || 6, 4) * WORKER_RAM.crack : 0;
```
Replace lines 87-94 (`// 2. crack unknown neighbours` loop) with:
```js
        // 2. crack unknown neighbours, in crackOrder's order
        for (const h of pending) {
            const threads = Math.min(cmd.threads.crack || 6, Math.floor(freeRam(ns, me) / WORKER_RAM.crack));
            if (threads >= 1) { const pid = ns.exec("darknet/crack.js", me, { threads, preventDuplicates: true }, hostArg(h), "--port", port); dispatch("worker", { kind: "crack", host: h, threads, workerPid: pid }); }
        }
```

- [ ] **Step 6: `darknet/crack.js`**

Line 3: `import { encodeMsg, PORT_DEFAULT, FILES, FEEDBACK_MODELS, parsePasswords, parseClueText, safeParse, hostFromArg, logMatchesAttempt } from "./lib.js";`

Replace lines 21-40 (`let attempts = 0;` through the end of `attemptFn`) with:
```js
    let attempts = 0;
    // Only the oracle solvers read feedback; every other model is solved by authenticate alone, which has no
    // charisma gate, so a heartbleed there would only add 1.5x the auth delay per miss or abort with 451 (R4).
    const wantsFeedback = FEEDBACK_MODELS.has(details.modelId);
    const attemptFn = async (password, needFeedback = true) => {
        let incremented = false;
        for (let tries = 0; tries < 5; tries++) {
            const r = await ns.dnet.authenticate(target, password);
            if (r.success) {
                if (!incremented) attempts++;
                return { success: true, feedback: { code: 200, message: r.message, data: r.data } };
            }
            if (r.code === 408) continue;                       // timeout: independent of correctness, retry
            if (!incremented) { attempts++; incremented = true; }
            if (r.code === 351 || r.code === 503) throw new Error("unreachable");
            if (!wantsFeedback || !needFeedback) return { success: false, feedback: null };
            const hb = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 });
            if (!hb.success) { if (hb.code === 451) throw new Error("charisma"); throw new Error("heartbleed:" + hb.code); }
            const fb = safeParse(hb.logs[0] ?? "", null);
            if (!logMatchesAttempt(details.modelId, fb, password)) continue;  // not our line (race with another PID); retry
            return { success: false, feedback: fb };
        }
        throw new Error("timeouts");
    };
```

- [ ] **Step 7: run tests and checks**

`node --test` -> 139 pass (the direct-model solver tests still pass: `dict()` and the decode solvers never read `feedback`).
`for f in darknet.js darknet/lib.js darknet/agent.js darknet/crack.js; do node --check $f && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs $f; done` -> every line `+[]`. In game: `mem darknet/agent.js` -> 4.50GB, `mem darknet/crack.js` -> 2.95GB.

- [ ] **Step 8: in-game check** -- with a neighbour whose model is `TopPass` and `requiredCharismaSkill` above the player's charisma, `tail` the agent's log: a crack.js starts on it and its log shows only `Connecting to ... with password` lines (no `Attempting to extract data`), and `run darknet.js --status` lists no `charisma` under `last failures:` for feedback-free models.

- [ ] **Step 9: commit (user triggers)** -- `git add darknet.js darknet/lib.js darknet/agent.js darknet/crack.js test/darknet-filler.test.js test/darknet-solvers.test.js test/darknet-controller.test.js && git commit -m "darknet: heartbleed only for oracle models, skip and order cracks by charisma (R4)"`

---

### Task 5: R12 -- the crack reserve equals the threads the agent will actually launch

**Files:**
- Modify: `darknet/agent.js` (the `let reserve = ...` line written in Task 4)
- Test: `test/darknet-filler.test.js`

**Interfaces:** none new.

- [ ] **Step 1: write the failing test** (append to `test/darknet-filler.test.js`)
```js
// R12: the agent launches min(cmd.threads.crack, free) threads (6 by default) but reserved only 4 threads' worth
// from the fillers, so a filler could keep the last two threads' RAM and the crack ran under-sized.
test("agent.js reserves the full commanded crack thread count for a pending crack", () => {
    const agent = src("darknet/agent.js");
    assert.match(agent, /let reserve = pending\.length \? \(cmd\.threads\.crack \|\| 6\) \* WORKER_RAM\.crack : 0;/);
    assert.doesNotMatch(agent, /Math\.min\(cmd\.threads\.crack \|\| 6, 4\)/);
});
```
- [ ] **Step 2: run it** -- `node --test test/darknet-filler.test.js` -> fails on the first `assert.match`.
- [ ] **Step 3: implement** -- in `darknet/agent.js` replace
```js
        let reserve = pending.length ? Math.min(cmd.threads.crack || 6, 4) * WORKER_RAM.crack : 0;
```
with
```js
        let reserve = pending.length ? (cmd.threads.crack || 6) * WORKER_RAM.crack : 0;
```
and in the comment two lines above change `up to 4 crack.js threads` to `the commanded crack.js thread count`.
- [ ] **Step 4: run tests and checks** -- `node --test` -> 140 pass. `node --check darknet/agent.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/agent.js` -> `+[]`.
- [ ] **Step 5: commit (user triggers)** -- `git add darknet/agent.js test/darknet-filler.test.js && git commit -m "darknet: reserve the commanded crack threads, not 4 (R12)"`

---

### Task 6: R5 -- one lab authentication delay per step: read position and walls from the move reply

**Files:**
- Modify: `darknet/lab.js` lines 49-50 (patterns), 160-232 (main loop)
- Test: `test/darknet-lab.test.js` (`walk` harness lines 44-91, new tests)

**Interfaces:**
- Produces `darknet/lab.js`: `export function parseMoveOutcome(message, data) -> { coords: [x, y], open: { north, east, south, west } } | null`. Task 10 keeps the same main-loop shape.
- Consumes: the game's move reply (`labyrinth.ts:288-331`): `"You have moved to X,Y."` / `"You cannot go that way. You are still at X,Y."` with `data` = the 3x3 window `getSurroundingsVisualized(maze, x, y, 1, true, false)` whose `[0][1]`, `[1][2]`, `[2][1]`, `[1][0]` are exactly what `labreport` tests (`labyrinth.ts:217-227`).

- [ ] **Step 1: write the failing tests**

In `test/darknet-lab.test.js` change line 4 to
```js
import { nextMove, cellKey, stepTo, findExit, shouldRestart, parseMoveOutcome } from "../darknet/lab.js";
```
Replace the `walk` function (lines 41-91) with a harness that, like the walker, asks `labReport` only when it has no parsed reply, and counts the reports:

```js
/** Run one complete walk. `mode` is "corner" (no radar fix) or "exit" (radar has shown the X).
 * `swap` is an optional `{ at, to }` that replaces the maze after `at` steps and drops the
 * walker at the new maze's start, which is what a page reload does in game.
 * `order` is the walker's direction preference (see walkerOrder in darknet/lab.js; Task 10).
 * Mirrors darknet/lab.js's main loop: labreport is only called when the last move reply could not
 * be parsed (never, with this mock) and the position and walls come from the reply otherwise (R5). */
function walk(initial, mode, swap, order) {
    const visited = new Set();
    const stack = [];
    const limit = 4 * cellCount(initial) + (swap ? 4 * cellCount(swap.to) : 0) + 16;
    let lab = initial;
    let position = lab.start.slice();
    let report = null;              // { coords, open } from the last reply, null = ask labreport
    let expected = null;
    let previous = null;
    let steps = 0;
    let stepsAfterSwap = 0;
    let restarts = 0;
    let reports = 0;
    let swapped = false;
    let stale = false;              // the walker's cached walls describe a maze that no longer exists
    while (steps < limit) {
        if (swap && !swapped && steps >= swap.at) {
            swapped = true;
            stale = true;
            lab = swap.to;
            position = lab.start.slice();
        }
        if (!report) {
            const status = labReport(lab, position);
            reports++;
            report = { coords: status.coords, open: { north: status.north, east: status.east, south: status.south, west: status.west } };
        }
        const { coords, open } = report;
        if (shouldRestart(coords, expected, previous)) {
            visited.clear();
            stack.length = 0;
            restarts++;
            stale = false;
        }
        expected = null;
        previous = coords;
        visited.add(cellKey(coords));
        const move = nextMove(visited, stack, coords, open, mode === "exit" ? lab.end : null, order);
        if (!move.dir) return { solved: false, steps, stepsAfterSwap, restarts, reports, why: "no move left" };
        if (move.push) {
            stack.push(move.dir);
        } else {
            assert.ok(stack.length > 0, "a backtrack move must have something to pop");
            stack.pop();
        }
        const outcome = labStep(lab, position, move.dir);
        expected = coords;
        const parsed = parseMoveOutcome(outcome.message, outcome.data);
        if (/cannot go that way/i.test(outcome.message)) {
            // The reply told the walker which walls are open, so only a regenerated maze may surprise it.
            assert.ok(stale, `walked into a wall at ${coords} going ${move.dir}`);
            visited.add(cellKey(stepTo(coords, move.dir)));
            if (move.push) stack.pop();
            report = parsed;
            continue;
        }
        if (outcome.code === 200) return { solved: true, steps: steps + 1, stepsAfterSwap, restarts, reports };
        assert.ok(parsed, `a move reply carries the new position and the wall window: ${outcome.message}`);
        if (!stale) assert.deepEqual(outcome.pos, stepTo(coords, move.dir), "stepTo must agree with the game's move");
        assert.deepEqual(parsed.coords, outcome.pos, "the parsed position is where the game put us");
        position = outcome.pos;
        expected = stepTo(coords, move.dir);
        report = parsed;
        steps++;
        if (swapped) stepsAfterSwap++;
    }
    return { solved: false, steps, stepsAfterSwap, restarts, reports, why: "step limit" };
}
```
In the size loop test (line 95-105) add after the `restarts` assertion:
```js
                assert.equal(result.reports, 1, "R5: one labreport at the start, every later position comes from the move reply");
```
In "restarts and still finishes when the maze is regenerated mid-walk" add after the `restarts >= 1` assertion:
```js
        assert.ok(result.reports <= 1 + result.restarts, `seed ${seed}: at most one extra labreport per restart, got ${result.reports}`);
```
Append:
```js
test("parseMoveOutcome reads the same position and walls labreport would report, on every cell", () => {
    for (const seed of SEEDS) {
        const lab = makeLab(20, 14, makeRng(seed), false);
        for (let y = 1; y < lab.maze.length - 1; y += 2) {
            for (let x = 1; x < lab.maze[0].length - 1; x += 2) {
                for (const dir of ["north", "east", "south", "west"]) {
                    const outcome = labStep(lab, [x, y], dir);
                    if (outcome.code === 200) continue;                     // the win carries the password, not a window
                    const parsed = parseMoveOutcome(outcome.message, outcome.data);
                    const truth = labReport(lab, outcome.pos);
                    assert.deepEqual(parsed, {
                        coords: truth.coords,
                        open: { north: truth.north, east: truth.east, south: truth.south, west: truth.west },
                    }, `seed ${seed} at ${x},${y} going ${dir}`);
                }
            }
        }
    }
});

test("parseMoveOutcome returns null for replies without a position", () => {
    assert.equal(parseMoveOutcome("You have successfully navigated the labyrinth! Congratulations", "hunter2"), null);
    assert.equal(parseMoveOutcome("You feel disconnected...", undefined), null);
    assert.equal(parseMoveOutcome("You have moved to 3,5.", "██\n█"), null, "a truncated window is not trusted");
    assert.equal(parseMoveOutcome(undefined, undefined), null);
});
```
(The `order` argument of `nextMove` is ignored until Task 10 adds it; passing `undefined` is harmless now.)

- [ ] **Step 2: run it** -- `node --test test/darknet-lab.test.js` -> import error: `parseMoveOutcome` is not exported.

- [ ] **Step 3: implement in `darknet/lab.js`**

After line 50 (`const BLOCKED_PATTERN = ...`) add:
```js
const POSITION_PATTERN = /(?:moved to|still at) (-?\d+),(-?\d+)\./;
```
After `findExit` (line 132) add:
```js
/** Position and open walls from an authenticate(lab, direction) reply, or null when the reply has neither.
 * The game answers every move with "You have moved to X,Y." (or "...still at X,Y." for a wall) and puts the
 * 3x3 window around the new cell in `data` (labyrinth.ts handleLabyrinthPassword). labreport's north/east/
 * south/west are that same window's [0][1], [1][2], [2][1], [1][0] === " " (labyrinth.ts getLocationStatus),
 * so reading them here saves the second lab authentication delay every step would otherwise cost (R5). */
export function parseMoveOutcome(message, data) {
    const found = String(message ?? "").match(POSITION_PATTERN);
    if (!found) return null;
    const rows = String(data ?? "").split("\n");
    if (rows.length < 3 || rows[0].length < 2 || rows[1].length < 3 || rows[2].length < 2) return null;
    return {
        coords: [Number(found[1]), Number(found[2])],
        open: { north: rows[0][1] === " ", east: rows[1][2] === " ", south: rows[2][1] === " ", west: rows[1][0] === " " },
    };
}
```
Replace the main loop body, lines 160-233 (`while (true) {` through its closing `}` before `}` of `main`), with:
```js
    let report = null;              // { coords, open } from the last move reply; null = ask labreport
    while (true) {
        if (!report) {
            const status = await ns.dnet.labreport();
            if (!status.success) {
                // "You feel lost..." (no lab) or "You feel disconnected..." (the host stopped
                // neighbouring the lab, which happens when a darknet server migrates).
                lost++;
                send({ steps, done: false, reason: String(status.message ?? "no labreport") });
                if (lost >= MAX_LOST) return ns.print("giving up: labreport keeps failing");
                await ns.sleep(RETRY_DELAY);
                continue;
            }
            lost = 0;
            report = { coords: status.coords, open: { north: status.north, east: status.east, south: status.south, west: status.west } };
        }
        const coords = report.coords;
        const open = report.open;
        if (shouldRestart(coords, expected, previous)) {
            ns.print(`WARN: expected to be at ${cellKey(expected)} but the lab says ${cellKey(coords)}; the maze was regenerated, restarting the walk`);
            send({ steps, done: false, reason: "restart" });
            visited.clear();
            stack.length = 0;
            target = null;              // the exit moved with the maze
            sinceRadar = RADAR_EVERY;   // so the next loop sweeps immediately
        }
        expected = null;
        previous = coords;
        visited.add(cellKey(coords));

        if (target === null && sinceRadar >= RADAR_EVERY) {
            sinceRadar = 0;
            const radar = await ns.dnet.labradar();
            if (radar.success) target = findExit(radar.message, coords);
        }
        sinceRadar++;

        const move = nextMove(visited, stack, coords, open, target);
        if (!move.dir) {
            send({ steps, done: false, reason: "exhausted" });
            return ns.print("giving up: every reachable cell has been visited");
        }
        if (move.push) stack.push(move.dir); else stack.pop();

        const outcome = await ns.dnet.authenticate(labHost, move.dir);
        report = null;                  // anything unparseable below falls back to labreport
        expected = coords;              // unless the move landed, we are still where we were
        if (outcome.code === 408) {
            // A network timeout says nothing about the move; undo the bookkeeping and retry.
            if (move.push) stack.pop(); else stack.push(OPP[move.dir]);
            continue;
        }
        if (outcome.success) {
            send({ steps: steps + 1, done: true, password: outcome.data });
            deliverAgent(ns, labHost, port);
            return;
        }
        const message = String(outcome.message ?? "");
        if (outcome.code === 451 || CHARISMA_PATTERN.test(message)) {
            send({ steps, done: false, reason: "charisma", chaReq });
            return ns.print(`giving up: charisma is too low for ${labHost}`);
        }
        // The reply already carries the new position and the 3x3 wall window (R5): use it and skip
        // next loop's labreport. A 351/503 or an unexpected message leaves `report` null instead.
        const parsed = parseMoveOutcome(message, outcome.data);
        if (BLOCKED_PATTERN.test(message)) {
            // The walls we knew said that way was open, so the maze was regenerated under us (a page
            // reload does that). Treat the cell beyond it as a dead end and re-read the position.
            visited.add(cellKey(stepTo(coords, move.dir)));
            // Undo a push, because we never entered the cell. A *backtrack* that is blocked
            // keeps its pop on purpose: the recorded path no longer exists, so unwinding
            // further is the only thing that makes progress (and the only thing that
            // terminates -- restoring the stack would retry the same blocked move forever).
            if (move.push) stack.pop();
            report = parsed;
            continue;
        }
        expected = stepTo(coords, move.dir);
        report = parsed;
        steps++;
        // Also report on a timer: the controller treats a walker that has been silent for five
        // minutes as dead, and 25 moves through a deep lab can take longer than that.
        if (steps % PROGRESS_EVERY === 0 || Date.now() - reportedAt >= HEARTBEAT) send({ steps, done: false });
    }
```
Update the header comment block line 12 (`dnet.labreport 0 | dnet.labradar 0`) is unchanged; add to the "Game facts" list at line 22:
```
 *   - The move reply's `data` is the 3x3 window around the new cell, the same one labreport reads its
 *     north/east/south/west from, so labreport is only needed once at the start and after a failure.
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 142 pass (the size tests now also assert `reports === 1`). `node --check darknet/lab.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/lab.js` -> `+[]`. In game `mem darknet/lab.js` -> 3.95GB.

- [ ] **Step 5: in-game check** -- with a walker running (`run darknet.js --mode labyrinth` on a save with a lab-adjacent cracked host and enough charisma), `tail darknet/lab.js host:<lab> --port 15` on the walk host: the log shows one `labreport` line followed only by `Connecting to <lab> with password 'north'...` lines, and the controller's `walkers` column advances about twice as fast per minute as before.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet/lab.js test/darknet-lab.test.js && git commit -m "darknet: read the walker's position and walls from the move reply (R5)"`

---

### Task 7: R11 -- charisma goal is `required + 1`; walkers and labyrinth mode need `charisma > lab.cha`

**Files:**
- Modify: `darknet.js` lines 496-510 (`planCharismaGoal`), 727 (`chooseMode`), 928-948 (`launchWalkers` gates)
- Test: `test/darknet-controller.test.js` (lines 328-370 and new)

**Interfaces:** unchanged signatures. `/Temp/darknet-charisma-goal.txt` now carries `required + 1`; `work-for-factions.js:396-399` and `sleeve.js:441-442` study until `charisma >= goal`, so no change there.

- [ ] **Step 1: write the failing tests**

Existing tests launch walkers at exactly `LAB_CHA`; change them to `LAB_CHA + 1`, which is now the first level that clears the gate without the penalty:
- line 331 `charisma: LAB_CHA,` -> `charisma: LAB_CHA + 1,`; line 344 `planLabyrinth(ns, state, options, LAB_CHA)` -> `LAB_CHA + 1`.
- line 365 `makeNs({ ...config, charisma: LAB_CHA })` -> `LAB_CHA + 1`; line 368 `planLabyrinth(ns, state, options, LAB_CHA)` -> `LAB_CHA + 1`.

Append:
```js
// R11: effects.ts applies the underleveled factor (>= 2.5x on every lab call) at charisma <= chaRequired, and
// NetworkGenerator.ts:257 gives the lab its own gate as requiredCharismaSkill. At charisma == lab.cha the maze
// is enterable but every step pays 2.5x, and the study goal stopped one point short of removing that.
test("the charisma goal is one above the requirement and walkers wait for it", () => {
    const options = { ...baseOptions, "lab-walkers": 1 };
    const ns = makeNs({ charisma: LAB_CHA, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 64 } });
    const state = makeState({
        near: { depth: 6, maxRam: 64, neighbours: [LAB] },
        locked: { depth: 5, maxRam: 32, chaReq: 120, cracked: false },
    });
    assert.equal(chooseMode(ns, state, { ...baseOptions, mode: "balanced" }, LAB_CHA), "loot", "equality still pays the penalty");
    const plan = planLabyrinth(ns, state, options, LAB_CHA);
    assert.equal(plan.charismaGoal, LAB_CHA + 1);
    assert.deepEqual(launchWalkers(ns, state, plan, options), [], "held back at exactly the gate");

    const above = makeNs({ charisma: LAB_CHA + 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 64 } });
    const plan2 = planLabyrinth(above, state, options, LAB_CHA + 1);
    assert.deepEqual(launchWalkers(above, state, plan2, options), ["near"]);
    assert.equal(chooseMode(above, state, { ...baseOptions, mode: "balanced" }, LAB_CHA + 1), "labyrinth");

    assert.equal(planLoot(ns, state, baseOptions, 120).charismaGoal, 121, "an uncracked host at chaReq 120 needs 121, the lab is further away");
    assert.equal(planLoot(ns, state, baseOptions, 121).charismaGoal, LAB_CHA + 1, "121 clears that host; the next blocked action is the lab");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> the new test fails at `plan.charismaGoal` (300 !== 301).

- [ ] **Step 3: implement in `darknet.js`**

`planCharismaGoal` (lines 497-510): replace the `consider` closure
```js
    const consider = (value) => {
        const required = Number(value) || 0;
        if (required > charisma && (goal === 0 || required < goal)) goal = required;
    };
```
with
```js
    // effects.ts calculateAuthenticationTime applies the underleveled factor at charisma <= required, so the
    // level that actually removes the penalty (and clears heartbleed's `<` gate) is required + 1 (R11).
    const consider = (value) => {
        const required = Number(value) || 0;
        if (required <= 0) return;
        const wanted = required + 1;
        if (wanted > charisma && (goal === 0 || wanted < goal)) goal = wanted;
    };
```
`chooseMode` line 727: `if (charisma < lab.cha) return "loot";` -> `if (charisma <= lab.cha) return "loot";   // equality pays the 2.5x underleveled factor on every lab call (R11)`

`launchWalkers`: lines 928-933 become
```js
    // The lab's own charisma gate. Below it every authenticate comes back as the gate message, so a
    // walker would burn network delays forever without taking a single step; AT it every call pays the
    // >= 2.5x underleveled factor (effects.ts, charisma <= required), so wait for one more level (R11).
    if (charisma <= lab.cha) {
        announceOnce(ns, `cha:${lab.host}`, `INFO: darknet is holding labyrinth walkers back: ${lab.host} needs more than ${lab.cha} charisma (have ${Math.floor(charisma)}).`);
        return [];
    }
```
and lines 935-941: replace the comment and condition
```js
    // A walker already hit the gate and reported the requirement. Believe it over LABS until
    // charisma has actually risen to meet what it reported. The game's own test is
    // `charisma < cha`, so equality is enough to pass and must clear the block.
    const blocked = state.labs.charismaBlocked;
    if (blocked && blocked.lab === lab.host) {
        const required = Number(blocked.chaReq) || lab.cha;
        if (charisma < required) {
```
with
```js
    // A walker already hit the gate and reported the requirement. Believe it over LABS until
    // charisma has actually risen past what it reported (past, not to: see the gate above).
    const blocked = state.labs.charismaBlocked;
    if (blocked && blocked.lab === lab.host) {
        const required = Number(blocked.chaReq) || lab.cha;
        if (charisma <= required) {
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 143 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: in-game check** -- `cat /Temp/darknet-charisma-goal.txt` shows a value one above the lowest blocking `requiredCharismaSkill` / lab gate shown by `run darknet.js --status`.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: charisma goal is required + 1 and walkers need charisma above the gate (R11)"`

---

### Task 8: R6 -- crack.js renews its claim while it is still cracking

**Files:**
- Modify: `darknet/crack.js` (after line 13 `send`, inside `attemptFn` from Task 4)
- Test: `test/darknet-controller.test.js` (controller half), `test/darknet-filler.test.js` (source half)

**Interfaces:** crack.js emits `encodeMsg("worker", me, pid, { kind: "crack", host: target, workerPid: pid, renewed: true })` every `CLAIM_REFRESH = 60000` ms. `applyWorkerMessage` (darknet.js:392-398) already stamps `crackClaimBy = msg.from`, `crackClaimAt = ts` for it; `CLAIM_LIFETIME` stays 120 s.

**Design decision:** renew every 60 s (half the lifetime) rather than deriving a lifetime from the model budget -- a renewal is one port line per minute and works for any attempt time.

- [ ] **Step 1: write the failing tests**

Append to `test/darknet-controller.test.js`:
```js
// R6: a claim stamped once at launch expired after 2 minutes while oracle cracks run 4-30 minutes, so a second
// agent started a duplicate crack whose heartbleed lines made both fail with `timeouts`. crack.js now renews.
test("a renewed crack claim keeps the host claimed past CLAIM_LIFETIME", () => {
    const state = makeState({ alpha: {}, beta: {} });
    const t0 = Date.now() - 150000;
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 7, ts: t0, workerPid: 42 });
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 42, ts: t0 + 60000, workerPid: 42, renewed: true });
    applyMessage(state, { type: "worker", kind: "crack", from: "alpha", host: "gamma", pid: 42, ts: t0 + 120000, workerPid: 42, renewed: true });
    const plan = planLoot(makeNs({}), state, baseOptions, 10);
    assert.deepEqual(buildCmd(state, plan, "beta").claimed, ["gamma"], "150 s after launch, renewed 30 s ago");
    assert.deepEqual(buildCmd(state, plan, "alpha").claimed, [], "the claimant itself is never blocked");
});
```
Append to `test/darknet-filler.test.js`:
```js
test("crack.js renews its claim from inside the attempt loop", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /const CLAIM_REFRESH = 60000;/);
    assert.match(crack, /kind: "crack", host: target, workerPid: pid, renewed: true/);
    assert.match(crack, /if \(Date\.now\(\) - claimedAt >= CLAIM_REFRESH\) renewClaim\(\);/);
});
```

- [ ] **Step 2: run them** -- the controller test passes already (the controller half needs no change; keep it as the regression guard); `node --test test/darknet-filler.test.js` -> the source test fails.

- [ ] **Step 3: implement in `darknet/crack.js`**

After line 6 (`export function autocomplete...`) add:
```js
const CLAIM_REFRESH = 60000;   // re-send the crack claim this often; the controller forgets a claim after 120 s
```
After line 13 (`const send = ...`) add:
```js
    // The agent claimed `target` when it launched us, but the controller expires a claim after 2 minutes and
    // an oracle crack can run 4-30 minutes; a neighbouring agent would then start a duplicate whose heartbleed
    // lines break both cracks (R6). Same envelope as the agent's claim, so the controller re-stamps it.
    let claimedAt = Date.now();
    const renewClaim = () => {
        claimedAt = Date.now();
        const line = encodeMsg("worker", me, pid, { kind: "crack", host: target, workerPid: pid, renewed: true });
        if (!ns.tryWritePort(options.port, line)) ns.print(`WARN: port full, dropped claim renewal: ${line}`);
    };
```
In `attemptFn`, as its first statement (before `let incremented = false;`), add:
```js
        if (Date.now() - claimedAt >= CLAIM_REFRESH) renewClaim();
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 145 pass. `node --check darknet/crack.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/crack.js` -> `+[]`; `mem darknet/crack.js` in game -> 2.95GB.

- [ ] **Step 5: in-game check** -- during a long crack (a `2G_cellular` or `Factori-Os` host), `run darknet.js --status` never lists a second `crack.js` for that host on another agent (`ps <otherHost>`), and the controller log shows no `timeouts` reason for it.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet/crack.js test/darknet-controller.test.js test/darknet-filler.test.js && git commit -m "darknet: renew the crack claim every minute while cracking (R6)"`

---

### Task 9: R7 -- a walk host gives the walker every thread that fits; `--lab-threads` is only a cap

**Files:**
- Modify: `darknet.js` line 29 (`argsSchema`), lines 950-961 (`launchWalkers` sizing)
- Test: `test/darknet-controller.test.js`

**Interfaces:** `options["lab-threads"]` 0 (new default) = no cap; `plan.walkThreadsByHost[host]` = `min(cap, floor((maxRam - agent - 0.5 - stasisHold) / lab))` where `stasisHold = WORKER_RAM.stasis` when the host is in `plan.stasisTargets` and that still leaves >= 1 thread, else 0. `buildCmd` and agent.js consume `walkThreads` unchanged.

**Design decision:** a pinned walk host keeps room for `stasis.js` (a host the game moves loses the lab and the walk), unless that room would starve the walker, in which case the walker wins and the link is simply not made.

- [ ] **Step 1: write the failing test** (append to `test/darknet-controller.test.js`)

```js
// R7: the controller evicts every filler from a walk host but capped the walker at --lab-threads 6, leaving a
// 128 GB lab-adjacent host ~100 GB idle although threadsFactor = 1/(1+0.2(t-1)) keeps shrinking the lab delay.
test("launchWalkers gives the walker every thread that fits unless --lab-threads caps it", () => {
    const ns = makeNs({ charisma: LAB_CHA + 1, stasisLimit: 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { fat: 128 } });
    const state = makeState({ fat: { depth: 6, maxRam: 128, neighbours: [LAB] } });
    const uncapped = { ...baseOptions, "lab-walkers": 1, "lab-threads": 0 };
    const plan = planLabyrinth(ns, state, uncapped, LAB_CHA + 1);
    assert.deepEqual(plan.stasisTargets, ["fat"], "the lab-adjacent host is pinned so the game cannot move it mid-walk");
    assert.deepEqual(launchWalkers(ns, state, plan, uncapped), ["fat"]);
    const expected = Math.floor((128 - WORKER_RAM.agent - 0.5 - WORKER_RAM.stasis) / WORKER_RAM.lab);
    assert.equal(expected, 27);
    assert.equal(plan.walkThreadsByHost.fat, expected, "everything but the agent, the stasis worker and the slack");
    assert.equal(buildCmd(state, plan, "fat").walkThreads, expected);

    const capped = { ...baseOptions, "lab-walkers": 1, "lab-threads": 6 };
    const plan2 = planLabyrinth(ns, state, capped, LAB_CHA + 1);
    launchWalkers(ns, state, plan2, capped);
    assert.equal(plan2.walkThreadsByHost.fat, 6, "a positive --lab-threads is a cap");
});

test("launchWalkers lets the walker win over the stasis hold on a host too small for both", () => {
    const ns = makeNs({ charisma: LAB_CHA + 1, stasisLimit: 1, details: { [LAB]: { isOnline: true, depth: 7 } }, maxRam: { near: 20 } });
    const state = makeState({ near: { depth: 6, maxRam: 20, neighbours: [LAB] } });
    const options = { ...baseOptions, "lab-walkers": 1, "lab-threads": 0 };
    const plan = planLabyrinth(ns, state, options, LAB_CHA + 1);
    assert.deepEqual(plan.stasisTargets, ["near"]);
    launchWalkers(ns, state, plan, options);
    assert.equal(plan.walkThreadsByHost.near, 3, "20 GB: agent 4.5 + 3 x 3.95; holding 13.65 for stasis would leave 0 threads");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> first new test fails (`walkThreadsByHost.fat` is 1 because `Math.max(1, floor(0))` turns the 0 default into 1).

- [ ] **Step 3: implement in `darknet.js`**

Line 29:
```js
    ["lab-threads", 0],             // cap on threads per labyrinth walker; 0 = every thread that fits on the walk host
```
Lines 950-961 (`const wanted = ...` through the `for (const host of plan.walkHosts)` line): replace
```js
    plan.walkThreads = Math.max(1, Math.floor(Number(options["lab-threads"]) || 1));
    plan.walkHosts = alive.map(walker => walker.host);
    // Max-RAM-based clamp, never the host's current free RAM: a walk host's spare-RAM workers
    // (phish/promote/share) are told to stop in buildCmd and take a loop or two to exit, so free
    // RAM right now understates what the host will actually have once they do.
    const threadsForHost = (host) => {
        const maxRam = Number(state.servers[host]?.maxRam) || 0;
        return Math.max(0, Math.min(plan.walkThreads, Math.floor((maxRam - WORKER_RAM.agent - 0.5) / WORKER_RAM.lab)));
    };
```
with
```js
    plan.walkThreads = Math.max(0, Math.floor(Number(options["lab-threads"]) || 0));
    const cap = plan.walkThreads > 0 ? plan.walkThreads : Infinity;   // 0 = every thread that fits (R7)
    plan.walkHosts = alive.map(walker => walker.host);
    // Max-RAM-based clamp, never the host's current free RAM: a walk host's spare-RAM workers
    // (phish/promote/share) are told to stop in buildCmd and take a loop or two to exit, so free
    // RAM right now understates what the host will actually have once they do. A host this plan
    // pins keeps room for stasis.js (a moved walk host loses the lab), unless that would leave the
    // walker no thread at all -- then the walk matters more than the link.
    const threadsForHost = (host) => {
        const maxRam = Number(state.servers[host]?.maxRam) || 0;
        const fits = (held) => Math.max(0, Math.min(cap, Math.floor((maxRam - WORKER_RAM.agent - 0.5 - held) / WORKER_RAM.lab)));
        const withStasis = (plan.stasisTargets ?? []).includes(host) ? fits(WORKER_RAM.stasis) : 0;
        return withStasis >= 1 ? withStasis : fits(0);
    };
```
The `--lab-threads` comment in the `argsSchema` header of the existing test `baseOptions` (test line 80, `"lab-threads": 6`) stays: the older tests describe the capped case.

- [ ] **Step 4: run tests and checks** -- `node --test` -> 147 pass (the existing "launchWalkers picks the lab-adjacent commandable host" test still expects 3 on the 20 GB host: the stasis hold gives 0 there, so the walker wins). `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: in-game check** -- `run darknet.js --mode labyrinth`, then `ps <walkHost>`: `darknet/lab.js` runs with `(maxRam - 4.5 - 0.5 - 13.65) / 3.95` threads (e.g. 27 on a 128 GB host) and `darknet/stasis.js` still managed to run once (`run darknet.js --status` lists the host under `stasis links:`).

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: give the walker every thread that fits, --lab-threads is a cap (R7)"`

---

### Task 10: R8 -- per-walker direction preference; one walker by default

**Files:**
- Modify: `darknet/lab.js` lines 41 (`DIRS`), 88-96 (`nextMove`), main loop (`nextMove` call written in Task 6)
- Modify: `darknet.js` line 28 (`["lab-walkers", 3]`)
- Test: `test/darknet-lab.test.js`, `test/darknet-controller.test.js` (`baseOptions` line 80)

**Interfaces:** `export function walkerOrder(seed) -> ["north","east","south","west"] rotated by seed % 4`; `export function nextMove(visited, stack, coords, open, target, order = DIR_ORDER)` -- ties in the distance sort are broken by `order`. The Task 6 harness already passes `order` through.

- [ ] **Step 1: write the failing tests** (append to `test/darknet-lab.test.js`; import `walkerOrder` on line 4)

```js
// R8: labyrinth.ts starts every pid at [1,1] on the first three labs (offsetStartAndEnd false) and all walkers
// share one maze, so walkers with the same tie-break walk the identical DFS. A per-pid direction order makes
// them fan out at the first fork.
test("walkerOrder rotates the direction preference by pid", () => {
    assert.deepEqual(walkerOrder(0), ["north", "east", "south", "west"]);
    assert.deepEqual(walkerOrder(1), ["east", "south", "west", "north"]);
    assert.deepEqual(walkerOrder(6), ["south", "west", "north", "east"]);
    assert.deepEqual(walkerOrder(-1), ["west", "north", "east", "south"]);
    assert.deepEqual(walkerOrder(undefined), ["north", "east", "south", "west"]);
});

test("nextMove breaks a distance tie by the walker's own order", () => {
    // Toward the far corner, east and south shorten the distance equally; north and west lengthen it.
    const visited = new Set([cellKey([3, 3])]);
    const open = { north: true, east: true, south: true, west: true };
    assert.equal(nextMove(visited, [], [3, 3], open, null, walkerOrder(0)).dir, "east");
    assert.equal(nextMove(visited, [], [3, 3], open, null, walkerOrder(2)).dir, "south");
    assert.equal(nextMove(visited, [], [3, 3], open, null).dir, "east", "the default order is the old one");
});

test("every direction order still solves the maze", () => {
    for (let pid = 0; pid < 4; pid++) {
        const lab = makeLab(30, 20, makeRng(7), false);
        const result = walk(lab, "corner", undefined, walkerOrder(pid));
        assert.ok(result.solved, `order ${pid}: ${result.why}`);
        assert.ok(result.steps < 4 * cellCount(lab));
    }
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-lab.test.js` -> import error: `walkerOrder` is not exported.

- [ ] **Step 3: implement**

`darknet/lab.js` line 41-42: after `const OPP = ...` add
```js
const DIR_ORDER = Object.keys(DIRS);   // north, east, south, west: the tie-break order of a lone walker
```
After `stepTo` (line 61) add:
```js
/** A walker's direction preference: DIR_ORDER rotated by `seed % 4`. Every walker of the first three labs
 * starts at [1,1] in one shared maze (labyrinth.ts getRandomOffset, getLabMaze), so walkers that break ties
 * the same way walk the same path; seeding the order by pid sends them down different branches (R8). */
export function walkerOrder(seed) {
    const shift = (((Number(seed) || 0) % 4) + 4) % 4;
    return [...DIR_ORDER.slice(shift), ...DIR_ORDER.slice(0, shift)];
}
```
`nextMove` (lines 88-96): change the signature and the first line
```js
export function nextMove(visited, stack, coords, open, target) {
    const choices = Object.keys(DIRS).filter(dir => open[dir] && !visited.has(cellKey(stepTo(coords, dir))));
```
to
```js
export function nextMove(visited, stack, coords, open, target, order = DIR_ORDER) {
    const choices = order.filter(dir => open[dir] && !visited.has(cellKey(stepTo(coords, dir))));
```
and add ` * @param {string[]} [order] direction preference used to break distance ties (walkerOrder)` to its JSDoc.
In `main`, after `const chaReq = ...` (line 149) add `const order = walkerOrder(ns.pid);` and change the call `nextMove(visited, stack, coords, open, target)` to `nextMove(visited, stack, coords, open, target, order)`.

`darknet.js` line 28:
```js
    ["lab-walkers", 1],             // most darknet/lab.js walkers to keep alive on the current lab (one, with all its host's RAM, beats three copies of the same walk)
```
`test/darknet-controller.test.js` line 80: `"lab-walkers": 3,` -> `"lab-walkers": 1,` (every walker test sets its own value).

- [ ] **Step 4: run tests and checks** -- `node --test` -> 150 pass. `node --check darknet/lab.js darknet.js` (separately) and `collide.mjs` on both -> `+[]`. `mem darknet/lab.js` -> 3.95GB.

- [ ] **Step 5: commit (user triggers)** -- `git add darknet/lab.js darknet.js test/darknet-lab.test.js test/darknet-controller.test.js && git commit -m "darknet: seed each walker's direction order by pid, one walker by default (R8)"`

---

### Task 11: R9 -- filler sizing: a few deep phish threads, promote sized per held symbol, share the rest

**Files:**
- Modify: `darknet.js` lines 48-49 (constants), 536-556 (`basePlan`), 596 and 713 (end of `planLoot`/`planLabyrinth`), 776-783 (`buildCmd` threads)
- Modify: `darknet/lib.js` lines 217-231 (`fillerPlan`)
- Modify: `darknet/agent.js` lines 125, 152-170
- Modify: `darknet/phish.js` line 15
- Test: `test/darknet-controller.test.js` (lines 85-138 and new), `test/darknet-filler.test.js`

**Interfaces:**
- Produces `darknet.js`: `export function planFillers(state, plan) -> plan` filling `plan.phishByHost` and `plan.promoteByHost` (host -> threads); `buildCmd` writes `threads.phish` / `threads.promote` as *counts* (0 = none). `PHISH_THREADS_TOTAL = 14`, `PROMOTE_THREADS_PER_SYMBOL = 24`.
- Produces `darknet/lib.js`: `fillerPlan({ free, reserve, unitRam, running, launched, cap = Infinity })` -- `cap` bounds `launch` and makes an over-cap running filler resize.
- Agent: phish is launched first up to `cmd.threads.phish`, then `Remote/share.js` takes the remainder when `cmd["share"]`; `phish.js` no longer exits when sharing starts.

**Design decision:** the stock-profit magnitude of promote is unverified (spec R9); the deliverable is the sizing rule itself: phish saturates network-wide at ~14 threads on the deepest hosts, promote up to 24 threads per held symbol on the biggest hosts, share the rest. `darkweb` has no password entry and is not `commandable`, so it only ever shares -- acceptable, it is depth 0.

- [ ] **Step 1: write the failing tests**

`test/darknet-controller.test.js`:
- import `planFillers` from `../darknet.js` (lines 5-8).
- test "buildCmd fills every field parseCmd defaults, for a normal host" (line 97): `assert.equal(cmd.threads.phish, 1, "a normal host phishes with its spare RAM");` -> `assert.equal(cmd.threads.phish, 14, "alone on the network, alpha gets the whole phish budget");`
- replace the test "buildCmd only hands out promote threads above the RAM floor" (lines 131-138) with:
```js
// R9: phishing's cache stream is bound by a 3-minute global cooldown and its money is pennies (phishing.ts), so a
// dozen threads on the deepest hosts (money factor 0.1 + 0.05 x depth) saturate it network-wide; promote out-yields
// it in charisma XP and ~22 threads/symbol reach ~3x volatility on a held stock (effects.ts:197-201), but was
// capped at 4 threads and only on >= 64 GB hosts (no host below difficulty 12).
test("planFillers puts phish on the deepest hosts up to 14 threads and promote on the biggest, no RAM floor", () => {
    const ns = makeNs({ files: { "/Temp/stock-probabilities.txt": JSON.stringify({ ECP: { prob: 0.7, sharesLong: 10 }, FSIG: { prob: 0.3, sharesShort: 10 } }) } });
    const state = makeState({
        deep: { depth: 6, maxRam: 32 },                  // floor((32 - 4.5) / 3.65) = 7 threads of room
        mid: { depth: 4, maxRam: 45, blockedRam: 5 },    // floor((45 - 5 - 4.5) / 3.65) = 9
        big: { depth: 1, maxRam: 128 },                  // floor((128 - 4.5) / 3.65) = 33
        tiny: { depth: 9, maxRam: 16, blockedRam: 10 },  // no room at all
    });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.deepEqual(plan.promoteSymbols, ["ECP", "FSIG"]);
    assert.deepEqual(plan.phishByHost, { deep: 7, mid: 7 }, "14 threads, deepest first, tiny has no room");
    assert.deepEqual(plan.promoteByHost, { big: 33, mid: 2 }, "48 threads for two symbols, biggest host first, after phish took its share of mid");
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 7);
    assert.equal(buildCmd(state, plan, "deep").threads.promote, 0);
    assert.equal(buildCmd(state, plan, "big").threads.promote, 33, "a 128 GB host is no longer capped at 4");
    assert.equal(buildCmd(state, plan, "mid").threads.promote, 2, "a 45 GB host promotes too: the 64 GB floor is gone");
    assert.equal(buildCmd(state, plan, "tiny").threads.phish, 0);
});

test("phish threads survive while the daemon shares; a walk host still gets none", () => {
    const ns = makeNs({ files: { "/Temp/share-active.txt": "true" } });
    const state = makeState({ deep: { depth: 6, maxRam: 64, neighbours: [LAB] }, other: { depth: 2, maxRam: 64 } });
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.equal(plan.shareActive, true);
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 14, "sharing no longer zeroes the cache stream");
    assert.equal(buildCmd(state, plan, "deep")["share"], true, "the remainder still shares");
    plan.walkHosts = ["deep"]; plan.walkLab = LAB; plan.walkThreadsByHost = { deep: 4 };
    assert.equal(buildCmd(state, plan, "deep").threads.phish, 0);
    assert.equal(buildCmd(state, plan, "other").threads.phish, 0, "the budget went to deep; other only shares");
});
```
`test/darknet-filler.test.js`, append:
```js
test("fillerPlan honours a thread cap", () => {
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: false, launched: 0, cap: 7 }), { launch: 7, resize: false });
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: true, launched: 7, cap: 7 }), { launch: 0, resize: false }, "at the cap: spare RAM is not a reason to grow");
    assert.deepEqual(fillerPlan({ free: 1, reserve: 0, unitRam: unit, running: true, launched: 7, cap: 3 }), { launch: 0, resize: true }, "the cap dropped below what runs");
    assert.deepEqual(fillerPlan({ free: 40, reserve: 0, unitRam: unit, running: false, launched: 0, cap: 0 }), { launch: 0, resize: false });
});

test("agent.js launches phish up to its cap before sharing, and promote has no RAM floor", () => {
    const agent = src("darknet/agent.js");
    assert.match(agent, /cap: cmd\.threads\.phish/);
    assert.doesNotMatch(agent, /getServerMaxRam\(me\) >= 64/);
    assert.ok(agent.indexOf('ns.exec("darknet/phish.js"') < agent.indexOf('ns.exec("Remote/share.js"'), "phish is sized before share takes the rest");
    assert.doesNotMatch(src("darknet/phish.js"), /cmd\["share"\]/, "phish.js keeps running while the daemon shares");
});
```

- [ ] **Step 2: run them** -- `node --test test/darknet-controller.test.js test/darknet-filler.test.js` -> import error for `planFillers`, then the cap/source assertions fail.

- [ ] **Step 3: `darknet/lib.js` `fillerPlan`** (lines 224-231) becomes:
```js
export function fillerPlan({ free, reserve, unitRam, running, launched, cap = Infinity }) {
    const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : Infinity;
    const held = running ? (Number(launched) || 0) * unitRam : 0;
    const want = Math.min(limit, Math.max(0, Math.floor((free + held - reserve) / unitRam)));
    if (!running) return { launch: want, resize: false };
    const starved = free < reserve;
    const canGrow = (Number(launched) || 0) > 0 && want > launched;
    const oversized = (Number(launched) || 0) > limit;
    return { launch: 0, resize: starved || canGrow || oversized };
}
```
and add to its docblock: ` * \`cap\` (threads) bounds the launch size; a running filler above the cap is asked to exit too.`

- [ ] **Step 4: `darknet.js`**

Lines 48-49:
```js
const PHISH_THREADS_TOTAL = 14;         // phish threads network-wide, deepest hosts first: the cache stream is cooldown-bound (R9)
const PROMOTE_THREADS_PER_SYMBOL = 24;  // promote threads network-wide per held symbol, biggest hosts first (R9)
```
`basePlan` (line 541, after `migrationTargets: {},`): add
```js
        phishByHost: {},            // host -> phish.js threads (planFillers)
        promoteByHost: {},          // host -> promote.js threads (planFillers)
```
Add after `commandable` (line 479):
```js
/** Hand out the filler budgets: phish to the deepest hosts (the money factor is 0.1 + 0.05 x depth and the
 * cache chance is capped by a global 3-minute cooldown, so ~14 threads saturate it network-wide), then promote
 * to the biggest hosts, 24 threads per held symbol. Whatever is left over shares when the daemon shares. */
export function planFillers(state, plan) {
    const hosts = commandable(state).map(name => [name, state.servers[name]]);
    const room = {};
    for (const [name, entry] of hosts) {
        room[name] = Math.max(0, Math.floor(((Number(entry.maxRam) || 0) - (Number(entry.blockedRam) || 0) - WORKER_RAM.agent) / WORKER_RAM.phish));
    }
    const give = (ordered, budget, out) => {
        let left = budget;
        for (const [name] of ordered) {
            if (left <= 0) break;
            const take = Math.min(left, room[name]);
            if (take <= 0) continue;
            out[name] = take;
            room[name] -= take;
            left -= take;
        }
    };
    plan.phishByHost = {};
    plan.promoteByHost = {};
    const byDepth = [...hosts].sort((a, b) => ((Number(b[1].depth) || 0) - (Number(a[1].depth) || 0))
        || ((Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0)));
    give(byDepth, PHISH_THREADS_TOTAL, plan.phishByHost);
    if (plan.promoteSymbols.length) {
        const byRam = [...hosts].sort((a, b) => (Number(b[1].maxRam) || 0) - (Number(a[1].maxRam) || 0));
        give(byRam, PROMOTE_THREADS_PER_SYMBOL * plan.promoteSymbols.length, plan.promoteByHost);
    }
    return plan;
}
```
(`WORKER_RAM.promote === WORKER_RAM.phish === 3.65`, so one room unit serves both.)
In `planLoot`, before `return plan;` (line 597) add `planFillers(state, plan);`. In `planLabyrinth`, before the final `return plan;` (line 714) add `planFillers(state, plan);` (and before the early `return plan;` at line 677 too).
`buildCmd` threads (lines 776-783):
```js
        threads: {
            crack: plan.crackThreads,
            realloc: plan.reallocThreads,
            // A walk host gives its spare RAM to the walker: phish/promote/share are told to
            // stop (and exit on their own -- see darknet/agent.js) so the walker can claim it.
            // Otherwise phish/promote are the counts planFillers budgeted for this host (R9).
            phish: walking ? 0 : (plan.phishByHost?.[host] ?? 0),
            migrate: migrateTarget ? MIGRATE_THREADS : 0,
            promote: walking ? 0 : (plan.promoteByHost?.[host] ?? 0),
        },
```
`printStatus` (line 1051): change the `promote symbols:` line to
```js
        `promote symbols: ${state.plan.promoteSymbols.join(", ") || "(none)"}  |  share active: ${state.plan.shareActive}  |  phish threads planned: ${Object.values(state.plan.phishByHost ?? {}).reduce((a, b) => a + b, 0)}  |  promote threads planned: ${Object.values(state.plan.promoteByHost ?? {}).reduce((a, b) => a + b, 0)}`,
```
and in `main` after `state.plan.shareActive = plan.shareActive;` (line 112) add
```js
            state.plan.phishByHost = plan.phishByHost;
            state.plan.promoteByHost = plan.promoteByHost;
```

- [ ] **Step 5: `darknet/agent.js`**

Line 125: remove the RAM floor:
```js
        if (cmd.promoteSymbols.length && !ns.isRunning("darknet/promote.js", me, ...cmd.promoteSymbols, "--port", port) && (cmd.threads.promote || 0) > 0) {
```
Replace lines 152-171 (from `const spare = ...` through the `// NOTE: no ns.scriptKill here` line) with:
```js
        // Phish first, capped at the controller's count (R9: a dozen threads network-wide saturate the
        // cache stream), then share takes whatever is left when the daemon shares. Both are gated on the
        // command file; a walk host gets threads.phish = 0 and share = false and spawns neither.
        const phishRunning = ns.isRunning("darknet/phish.js", me, "--port", port);
        if (!phishRunning) phishThreads = 0;
        if ((cmd.threads.phish || 0) > 0) {
            // phish.js runs until told to stop, so the agent asks it to exit whenever it is the wrong size.
            const sizing = fillerPlan({ free: freeRam(ns, me), reserve, unitRam: WORKER_RAM.phish, running: phishRunning, launched: phishThreads, cap: cmd.threads.phish });
            if (sizing.resize) ns.write(FILES.phishResize, "1", "w");
            else if (!phishRunning && sizing.launch > 0) {
                ns.write(FILES.phishResize, "0", "w");
                if (ns.exec("darknet/phish.js", me, { threads: sizing.launch, preventDuplicates: true }, "--port", port)) phishThreads = sizing.launch;
            }
        } else if (phishRunning) ns.write(FILES.phishResize, "1", "w");   // no longer budgeted here: let it exit
        if (cmd["share"]) {
            // share.js exits on its own every 10 s, so the reserve alone re-sizes it.
            const spare = Math.floor((freeRam(ns, me) - reserve) / WORKER_RAM["share"]);
            if (spare > 0 && !ns.isRunning("Remote/share.js", me)) ns.exec("Remote/share.js", me, { threads: spare, preventDuplicates: true });
        }
```
`darknet/phish.js` line 15: `if (cmd.stop || cmd.threads.phish === 0 || cmd["share"]) break;` -> `if (cmd.stop || (cmd.threads.phish || 0) === 0) break;`

- [ ] **Step 6: run tests and checks** -- `node --test` -> 154 pass. `for f in darknet.js darknet/lib.js darknet/agent.js darknet/phish.js; do node --check $f && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs $f; done` -> all `+[]`. `mem darknet/agent.js` -> 4.50GB, `mem darknet/phish.js` -> 3.65GB.

- [ ] **Step 7: in-game check** -- after two loops, `run darknet.js --status`: `phish threads planned: 14` (or less with few hosts), `promote threads planned: 24 x symbols`; `ps <deepestHost>` shows `darknet/phish.js` with the planned count and `Remote/share.js` beside it while `/Temp/share-active.txt` is `true`; `ps <45GBhost>` shows `darknet/promote.js` when stockmaster holds a position.

- [ ] **Step 8: commit (user triggers)** -- `git add darknet.js darknet/lib.js darknet/agent.js darknet/phish.js test/darknet-controller.test.js test/darknet-filler.test.js && git commit -m "darknet: cap phish network-wide, size promote per held symbol, share the rest (R9)"`

---

### Task 12: R10 -- remove island migration; islands are left to the game's own island mover

**Files:**
- Modify: `darknet.js` lines 579-592 (the island block of `planLoot`; after Task 11's `planFillers` insertion it sits ~33 lines further down, the text is unchanged), lines 261-265 (`prevNeighbours` bookkeeping in `applyMessage`), line 560 (`planLoot` docstring), lines 729-730 (`chooseMode` comment)
- Test: `test/darknet-controller.test.js`

**Interfaces:** `planLoot(ns, state, options, charisma)` unchanged signature; in loot mode `plan.migrationTargets` is now always `{}` (the `migrationTargets` field stays in `basePlan` because `planLabyrinth` fills it for the air-gap crossings). `entry.prevNeighbours` is no longer written; an older `state.txt` may still carry it and it is simply ignored. `darknet/agent.js`'s migrate branch, `darknet/migrate.js` and the `migrate` worker message stay untouched: they serve the air-gap crossings of `planLabyrinth` (Task 3) -- the only code that served islands alone is the `planLoot` block and the `prevNeighbours` bookkeeping.

**Why it cannot work (spec R10, verified):** `induceServerMigration` requires a direct connection to the target (`Darknet.ts:417-420`) -- which no charger has to a host nothing connects to -- and refuses the target's own agent (`:428-439` "Cannot induce migration on a script's own server"). The game moves a random island itself on 30 % of mutations (`NetworkMovement.ts:64-70`), and `moveDarknetServer` never kills scripts, so the island's agent survives and re-probes.

- [ ] **Step 1: write the failing tests** (append to `test/darknet-controller.test.js`)

```js
// ------------------------------------------------------------------ R10: islands

// induceServerMigration needs a direct connection to the target (Darknet.ts requireDirectConnection) and refuses
// the target's own agent ("Cannot induce migration on a script's own server"), so nothing can ever charge an
// island. The game moves a random island itself on 30 % of mutations (NetworkMovement.ts:64-70) and the island's
// agent survives that move, so the right plan is to wait.
test("planLoot no longer plans a migration for an island", () => {
    const ns = makeNs({});
    const state = makeState({
        island: { depth: 4, neighbours: [] },
        charger: { depth: 3, neighbours: ["island"] },
    });
    state.servers.island.prevNeighbours = ["charger"];   // what an older state file may still carry
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.deepEqual(plan.migrationTargets, {}, "no charger can reach an island; the game moves islands itself");
    assert.equal(buildCmd(state, plan, "charger").migrateTarget, null);
    assert.equal(buildCmd(state, plan, "charger").threads.migrate, 0);
});

test("applyMessage no longer keeps prevNeighbours when a host's neighbour list empties", () => {
    const state = emptyState(1000);
    const ts = Date.now();
    applyMessage(state, { type: "server", from: "alpha", host: "alpha", pid: 7, ts, details: { isOnline: true, depth: 4 }, neighbours: ["beta"] });
    applyMessage(state, { type: "server", from: "alpha", host: "alpha", pid: 7, ts: ts + 1, details: { isOnline: true, depth: 4 }, neighbours: [] });
    assert.deepEqual(state.servers.alpha.neighbours, []);
    assert.equal(state.servers.alpha.prevNeighbours, undefined, "the only reader of prevNeighbours was the island block");
});
```

- [ ] **Step 2: run them** -- `node --test test/darknet-controller.test.js` -> the first new test fails (`migrationTargets` is `{ island: ["charger"] }`), the second fails on `prevNeighbours` (`["beta"]` !== undefined).

- [ ] **Step 3: implement in `darknet.js`**

In `planLoot`, replace (HEAD lines 579-592 plus the blank line after them)
```js
    const reachable = commandable(state);
    for (const [name, entry] of Object.entries(state.servers)) {
        if (!entry.online || isLabHost(name)) continue;
        if (!entry.neighboursAt) continue;                                   // never scanned itself
        if (!Array.isArray(entry.neighbours) || entry.neighbours.length > 0) continue;
        // An island: it scanned itself and found nothing. Charge from whoever last saw it.
        const chargers = new Set(entry.prevNeighbours ?? []);
        for (const [other, row] of Object.entries(state.servers)) {
            if (other !== name && row.online && (row.neighbours ?? []).includes(name)) chargers.add(other);
        }
        const usable = [...chargers].filter(charger => reachable.includes(charger));
        if (usable.length) plan.migrationTargets[name] = usable;
    }

```
with
```js
    // Islands (a host whose own probe returns nothing) are left alone: induceServerMigration needs a direct
    // connection to its target (Darknet.ts requireDirectConnection), which no charger has to a host nothing
    // connects to, and it refuses the island's own agent ("Cannot induce migration on a script's own
    // server"). The game moves a random island itself on 30 % of mutations (NetworkMovement.ts:64-70) and
    // the island's agent survives that move and re-probes, so waiting is the whole plan (R10).

```
In `applyMessage`, replace (HEAD lines 261-265)
```js
            if (Array.isArray(msg.neighbours)) {
                // Keep the last non-empty list: an island reports no neighbours, but migration
                // still needs the hosts that used to sit next to it (design doc section 7).
                if (msg.neighbours.length === 0 && entry.neighbours.length > 0) entry.prevNeighbours = entry.neighbours;
                entry.neighbours = msg.neighbours;
```
with
```js
            if (Array.isArray(msg.neighbours)) {
                entry.neighbours = msg.neighbours;
```
Line 560 (the `planLoot` docstring): ` * re-enter the frontier from home after a disconnect), migrate only stranded islands, phish the rest.` -> ` * re-enter the frontier from home after a disconnect), leave islands to the game's own island mover, fill the rest.`

Lines 729-730 (`chooseMode` comment): `    // gap that still separates us from the lab. Island migrations in loot mode do not qualify.` -> `    // gap that still separates us from the lab (the only migrations planned since R10).`

- [ ] **Step 4: run tests and checks** -- `node --test` -> 157 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: in-game check** -- in loot mode `run darknet.js --status` shows `migration targets: (none)` even while an island exists (a host whose `ps` shows its agent but whose neighbours' probes no longer list it); no `darknet/migrate.js` appears in `ps <anyHost>` outside labyrinth mode; the island's agent keeps reporting (the host stays out of `last failures:`) and comes back into the depth histogram after the game moves it.

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: remove island migration, the game moves islands itself (R10)"`

---

### Task 13: R13 -- pushFiles skips the scp when nothing changed for the host

**Files:**
- Modify: `darknet.js` `pushFiles` (HEAD lines 828-868, text as Task 0 leaves it)
- Test: `test/darknet-controller.test.js`

**Interfaces:** `pushFiles(ns, state, plan) -> delivered` now counts only hosts that were actually scp'd. Module-level `const lastPushed = new Map()` (host -> `{ passwords, cmd, agentPid }`); `connectToSession` (via `trySession`) is still called for every online cracked host every loop -- it is the liveness probe that refreshes `entry.lastSeen`. A session failure deletes the host's cache entry.

**Design decision:** the cache key includes the host's `agentPid` (set by the `hello` and `worker/agent` messages) because a restarted or re-spread agent received its *neighbour's* `cmd.txt` with the spread (`darknet/agent.js` line 115 copies its own `FILES.cmd`), so the host's own command file has to go out again even when the plan for it did not change. `passwords.txt` is compared by content, so a new or staled password re-pushes to every host, as today.

- [ ] **Step 1: write the failing test** (append to `test/darknet-controller.test.js`)

```js
// ------------------------------------------------------------------ R13: unchanged pushes

// Per commandable host per loop, pushFiles opened a session (useful: it is the liveness probe) and then wrote and
// scp'd passwords.txt and cmd.txt even when neither had changed since the last loop.
test("pushFiles skips the scp when neither passwords.txt nor the host's cmd changed, and re-pushes after an agent restart", () => {
    const ns = makeNs({});
    let sessions = 0;
    ns.dnet.connectToSession = () => { sessions++; return { success: true, code: 200 }; };
    const state = makeState({ cacheA: { depth: 1 }, cacheB: { depth: 2 }, cacheC: { depth: 3 } });
    state.servers.cacheA.agentPid = 11; state.servers.cacheB.agentPid = 12; state.servers.cacheC.agentPid = 13;
    state.passwords.cacheC.stale = true;                   // not pushable yet
    const plan = planLoot(ns, state, baseOptions, 10);
    assert.equal(pushFiles(ns, state, plan), 3, "darkweb + two hosts on the first push");
    assert.equal(ns.scps.length, 3);
    assert.equal(pushFiles(ns, state, plan), 0, "nothing changed: no scp at all");
    assert.equal(ns.scps.length, 3);
    assert.equal(sessions, 4, "the session is still opened every loop: it is the liveness probe");
    // A password that comes back changes passwords.txt for everyone.
    delete state.passwords.cacheC.stale;
    assert.equal(pushFiles(ns, state, plan), 4);
    // A plan change for one host re-pushes only that host.
    assert.deepEqual(plan.stasisTargets, ["cacheA"], "the loot planner pinned the first 32 GB host");
    plan.stasisTargets = ["cacheA", "cacheB"];
    assert.equal(pushFiles(ns, state, plan), 1);
    assert.equal(ns.scps.at(-1).host, "cacheB");
    // A restarted agent (new pid) received a neighbour's cmd.txt with the spread, so its own goes out again.
    state.servers.cacheA.agentPid = 99;
    assert.equal(pushFiles(ns, state, plan), 1);
    assert.equal(ns.scps.at(-1).host, "cacheA");
    // A host whose session fails is forgotten, so it is pushed again once it is back.
    ns.dnet.connectToSession = (host) => ({ success: host !== "cacheB", code: host !== "cacheB" ? 200 : 503 });
    assert.equal(pushFiles(ns, state, plan), 0);
    assert.equal(state.servers.cacheB.online, false);
    ns.dnet.connectToSession = () => ({ success: true, code: 200 });
    state.servers.cacheB.online = true;
    assert.equal(pushFiles(ns, state, plan), 1);
    assert.equal(ns.scps.at(-1).host, "cacheB");
});
```

- [ ] **Step 2: run it** -- `node --test test/darknet-controller.test.js` -> fails at "nothing changed: no scp at all" (3 !== 0).

- [ ] **Step 3: implement in `darknet.js`**

Replace the head of `pushFiles` (HEAD lines 828-836)
```js
/** Push `passwords.txt` and a per-host `cmd.txt` to every online cracked server.
 * @param {NS} ns */
export function pushFiles(ns, state, plan) {
    const live = {};
    for (const [name, entry] of Object.entries(state.passwords)) {
        if (!entry || entry.stale || entry.password === undefined) continue;
        live[name] = entry.password;
    }
    ns.write(FILES.passwords, JSON.stringify(live), "w");
```
with
```js
// What each host was last given -- the passwords.txt text, its own cmd.txt text and the pid of the agent
// that received them -- so an unchanged pair is not scp'd again every loop (R13). The agent pid is part of
// the key because a restarted or re-spread agent got its NEIGHBOUR's cmd.txt with the spread
// (darknet/agent.js copies its own files), so the host's own command file has to go out again even when
// the plan for it did not change.
const lastPushed = new Map();

/** Push `passwords.txt` and a per-host `cmd.txt` to every online cracked server whose copy is out of
 * date. The session is opened for every host regardless: it is the liveness probe.
 * @param {NS} ns */
export function pushFiles(ns, state, plan) {
    const live = {};
    for (const [name, entry] of Object.entries(state.passwords)) {
        if (!entry || entry.stale || entry.password === undefined) continue;
        live[name] = entry.password;
    }
    const passwordsText = JSON.stringify(live);
    ns.write(FILES.passwords, passwordsText, "w");
```
and replace the tail of `pushFiles` (from the 404 line Task 0 wrote to the end of the function)
```js
                if (session.code === 503 || session.code === 404) { entry.online = false; entry.lastSeen = Date.now(); }
                continue;
            }
            entry.lastSeen = Date.now();   // a live session is proof the host still exists
        }
        ns.write(FILES.cmd, JSON.stringify(buildCmd(state, plan, host)), "w");
        if (ns.scp([FILES.passwords, FILES.cmd], host, "home")) delivered++;
    }
    return delivered;
}
```
with
```js
                if (session.code === 503 || session.code === 404) { entry.online = false; entry.lastSeen = Date.now(); }
                lastPushed.delete(host);       // whatever it holds now, it is not something to rely on
                continue;
            }
            entry.lastSeen = Date.now();   // a live session is proof the host still exists
        }
        const cmdText = JSON.stringify(buildCmd(state, plan, host));
        const agentPid = Number(state.servers[host]?.agentPid) || 0;
        const previous = lastPushed.get(host);
        if (previous && previous.passwords === passwordsText && previous.cmd === cmdText && previous.agentPid === agentPid) continue;
        ns.write(FILES.cmd, cmdText, "w");
        if (ns.scp([FILES.passwords, FILES.cmd], host, "home")) {
            delivered++;
            lastPushed.set(host, { passwords: passwordsText, cmd: cmdText, agentPid });
        }
    }
    return delivered;
}
```

- [ ] **Step 4: run tests and checks** -- `node --test` -> 158 pass. `node --check darknet.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet.js` -> `+[]`.

- [ ] **Step 5: in-game check** -- `tail darknet.js` on home: with a settled network the log no longer shows a burst of `scp` lines every 10 s; `run darknet.js --status` still updates `online` (the liveness probe still runs); after a `.data.txt` clue or a crack adds a password, every host receives one push (`ls <host> darknet/passwords.txt` shows the new size), and after `run darknet.js --kill` followed by `run darknet.js` every host receives a push on the first loop (a new controller starts with an empty cache).

- [ ] **Step 6: commit (user triggers)** -- `git add darknet.js test/darknet-controller.test.js && git commit -m "darknet: only push files a host does not already have (R13)"`

---

### Task 14: R14 -- 2G_cellular reads the mismatch index from the authenticate delay

**Files:**
- Modify: `darknet/solvers.js` lines 196-200 (`charset`, append helpers after it), 459-482 (the `2G_cellular` solver), 703-705 (`solve` docblock), 712-715 (`tryPw`), 728 (`solverFn` call)
- Modify: `darknet/crack.js` (text as Tasks 4 and 8 leave it: `attemptFn` and the `solve(...)` call)
- Test: `test/darknet-solvers.test.js` (import line 4, new tests), `test/darknet-filler.test.js` (crack.js source test)

**Interfaces:**
- Produces `darknet/solvers.js`: `export const TIMING_TOLERANCE = 0.25`; `export function timingStep(threads) -> ms per shared character` (= `50 / (1 + 0.2 (t - 1))`); `export function indexFromTiming(elapsed, base, step, prefixLength) -> index | null`. `solve(details, attemptFn, opts)` forwards a second argument: `tryPw(pw, needFeedback = true)` calls `attemptFn(pw, needFeedback)`, and every solver is called as `solverFn(details, tryPw, opts)` (`opts.threads` is the only new field; other solvers ignore it).
- Consumes from `crack.js` (Task 4's `attemptFn(password, needFeedback = true)`): the result gains `elapsed` (ms around the final `authenticate`) and, when feedback was not requested, `fetchFeedback: () => Promise<feedback | null>` (a heartbleed peek of that same attempt; null when the newest log line is not ours). `crack.js` passes `threads: ns.self().threads` in `opts` (`ns.self` costs 0 GB: `RamCostGenerator.ts:592`; `Date.now()` is not an NS call).

**Game facts (verified):** `effects.ts:86-88` adds `sharedChars * 50 * threadsFactor` ms to the delay *after* the intelligence bonus, with `sharedChars = getSharedChars(server.password, attempt)` (`Darknet.ts:125`, `darknetAuthUtils.ts:27-34`: the leading-match count), which is exactly the `(i)` the heartbleed message reports (`authentication.ts:95-98`). The base delay is not computed (it moves with charisma, backdoor count, Boots, SF15, intelligence) but *measured*: every heartbleed feedback recalibrates `base = elapsed - index * step`.

**Design decision (safety over savings):** the timing may only *reject* a guess (derived index equals the confirmed prefix length, the common case: every wrong character of a round gives exactly that); a longer, ambiguous or uncalibrated reading buys the heartbleed for that same attempt via `fetchFeedback` (no second `authenticate`, so the attempt count and `BUDGETS["2G_cellular"] = 500` are untouched). Timer overshoot only ever lengthens `elapsed` (a background tab clamps timers to 1 s), so a false "grew" costs one heartbleed and is corrected; a false "rejected" is impossible unless the base drifted *down* by more than 3/4 of a step, which the `idx < prefixLength` guard catches on the next reading and recalibrates. Net effect: heartbleeds per crack drop from `attempts - 1` to at most `L` (one calibration, one confirmation per prefix character), e.g. 28 -> 7 on a difficulty-17 host, and each rejected attempt costs 1x instead of 2.5x the auth delay.

- [ ] **Step 1: write the failing tests**

`test/darknet-solvers.test.js` line 4 becomes
```js
import { solve, BUDGETS, budgetFor, timingStep, indexFromTiming } from "../darknet/solvers.js";
```
Append:
```js
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
```
(The existing `timedAttempt` default `base = 4000` is never used: both tests pass a function so the drift test can move it. `detailsOf`, `feedback`, `makeServer`, `makeRng` are already imported at the top of the file.)

Append to `test/darknet-filler.test.js`:
```js
test("crack.js times each authenticate, exposes a lazy heartbleed and hands the solver its thread count", () => {
    const crack = src("darknet/crack.js");
    assert.match(crack, /const startedAt = Date\.now\(\);\s*\n\s*const r = await ns\.dnet\.authenticate\(target, password\);\s*\n\s*const elapsed = Date\.now\(\) - startedAt;/);
    assert.match(crack, /threads: ns\.self\(\)\.threads/);
    assert.match(crack, /fetchFeedback: wantsFeedback \? \(\) => fetchFeedback\(password\) : null/);
    assert.match(crack, /const fb = await fetchFeedback\(password\);\s*\n\s*if \(fb === null\) continue;/);
});
```

- [ ] **Step 2: run them** -- `node --test test/darknet-solvers.test.js test/darknet-filler.test.js` -> the solvers file fails to import (`timingStep` is not exported), the filler test fails on the first `assert.match`.

- [ ] **Step 3: implement in `darknet/solvers.js`**

After `charset` (line 200) insert:
```js

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
```
Replace the `2G_cellular` solver (lines 459-482, from its comment through `},`):
```js
    // Prefix oracle: "Found a mismatch while checking each character (i)" -- i counts
    // leading matching characters, so extending the confirmed prefix by one correct
    // character always pushes the mismatch index strictly past the prefix's old length.
    "2G_cellular": async (d, tryPw) => {
        const L = d.passwordLength, cs = charset(d);
        let prefix = "";
        while (prefix.length < L) {
            let found = false;
            for (const c of cs) {
                const guess = (prefix + c).padEnd(L, cs[0]);
                const r = await tryPw(guess);
                if (r.success) return guess;
                const m = r.feedback.message.match(/\((\d+)\)/);
                const idx = m ? Number(m[1]) : -1;
                if (idx > prefix.length) {
                    prefix += c;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }
        return null;
    },
```
with
```js
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
```
(Do not name the helper `probe`: `ns.dnet.probe` is an NS function and the RAM analyser charges the identifier in any file `crack.js` imports.)

Replace the `solve` docblock (lines 703-705)
```js
// details: getServerDetails shape (modelId, passwordHint, data, passwordLength,
// passwordFormat, difficulty, hostname). attemptFn(password) resolves to
// {success, feedback:{code, message, data}|null}. opts: { clues, budgetScale, log }.
```
with
```js
// details: getServerDetails shape (modelId, passwordHint, data, passwordLength,
// passwordFormat, difficulty, hostname). attemptFn(password, needFeedback = true) resolves to
// {success, feedback:{code, message, data}|null, elapsed?, fetchFeedback?}: `elapsed` is the
// authenticate duration in ms and `fetchFeedback()` fetches the feedback of that attempt later
// (both optional; only the 2G_cellular solver reads them). opts: { clues, budgetScale, log, threads }.
```
In `solve`, change
```js
    const tryPw = async (pw) => {
        if (count >= budget) throw new BudgetExceeded();
        count += 1;
        const result = await attemptFn(pw);
```
to
```js
    const tryPw = async (pw, needFeedback = true) => {
        if (count >= budget) throw new BudgetExceeded();
        count += 1;
        const result = await attemptFn(pw, needFeedback);
```
and `        const password = await solverFn(details, tryPw);` to `        const password = await solverFn(details, tryPw, opts);`.

The existing oracle tests keep their attempt counts: the mock's `attemptFn` always returns feedback and no `elapsed`, so `base` stays null and every attempt is made with `needFeedback = true`, exactly as before.

- [ ] **Step 4: implement in `darknet/crack.js`** (text as Tasks 4 and 8 leave it)

Replace
```js
    const wantsFeedback = FEEDBACK_MODELS.has(details.modelId);
    const attemptFn = async (password, needFeedback = true) => {
```
with
```js
    const wantsFeedback = FEEDBACK_MODELS.has(details.modelId);
    // Heartbleed feedback for the attempt just made, or null when the newest log line is not ours (another
    // pid's attempt landed after it). Called right after a miss, or later by the 2G_cellular solver when the
    // attempt's own duration did not settle the question (R14).
    const fetchFeedback = async (password) => {
        const hb = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 });
        if (!hb.success) { if (hb.code === 451) throw new Error("charisma"); throw new Error("heartbleed:" + hb.code); }
        const fb = safeParse(hb.logs[0] ?? "", null);
        return logMatchesAttempt(details.modelId, fb, password) ? fb : null;
    };
    const attemptFn = async (password, needFeedback = true) => {
```
Replace
```js
            const r = await ns.dnet.authenticate(target, password);
            if (r.success) {
                if (!incremented) attempts++;
                return { success: true, feedback: { code: 200, message: r.message, data: r.data } };
            }
```
with
```js
            const startedAt = Date.now();
            const r = await ns.dnet.authenticate(target, password);
            const elapsed = Date.now() - startedAt;             // encodes 2G_cellular's shared-prefix length (R14)
            if (r.success) {
                if (!incremented) attempts++;
                return { success: true, feedback: { code: 200, message: r.message, data: r.data }, elapsed };
            }
```
Replace
```js
            if (!wantsFeedback || !needFeedback) return { success: false, feedback: null };
            const hb = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 });
            if (!hb.success) { if (hb.code === 451) throw new Error("charisma"); throw new Error("heartbleed:" + hb.code); }
            const fb = safeParse(hb.logs[0] ?? "", null);
            if (!logMatchesAttempt(details.modelId, fb, password)) continue;  // not our line (race with another PID); retry
            return { success: false, feedback: fb };
```
with
```js
            if (!wantsFeedback || !needFeedback) return { success: false, feedback: null, elapsed, fetchFeedback: wantsFeedback ? () => fetchFeedback(password) : null };
            const fb = await fetchFeedback(password);
            if (fb === null) continue;                          // not our line (race with another PID); retry
            return { success: false, feedback: fb, elapsed };
```
Replace
```js
    try { result = await solve(details, attemptFn, { clues, log: m => ns.print(m) }); }
```
with
```js
    try { result = await solve(details, attemptFn, { clues, log: m => ns.print(m), threads: ns.self().threads }); }
```
(Task 4's `assert.match(crack, /if \(!wantsFeedback \|\| !needFeedback\) return \{ success: false, feedback: null/)` and Task 8's `renewClaim` assertions still match this text.)

- [ ] **Step 5: run tests and checks** -- `node --test` -> 162 pass. `node --check darknet/solvers.js && node --check darknet/crack.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/solvers.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs darknet/crack.js` -> solvers `+[]`; crack.js may list `+[self]` at cost 0 -- acceptable, it is the one free call this plan adds. In game `mem darknet/crack.js` -> 2.95GB (unchanged).

- [ ] **Step 6: in-game check** -- on a `2G_cellular` neighbour, `tail darknet/crack.js host:<name> --port 15` on the cracking agent: the log shows a run of `Connecting to <name> with password '...'` lines with at most one `Attempting to extract data` (heartbleed) per prefix character instead of one per attempt, and `run darknet.js --status` records the win under `cracks: 2G_cellular` with the same attempt count as before the change (the timing never adds attempts). With the browser tab in the background the crack still finishes (throttled timers only cost heartbleeds).

- [ ] **Step 7: commit (user triggers)** -- `git add darknet/solvers.js darknet/crack.js test/darknet-solvers.test.js test/darknet-filler.test.js && git commit -m "darknet: read 2G_cellular's mismatch index from the authenticate delay (R14)"`

---

### Task 15: headless smoke run

**Files:** none in the repo; `/home/jubnl/dev/bitburner/tools/harness` (see its README) and its fixtures. Run after Tasks 0-14 are committed.

- [ ] **Step 1: unit suite and static RAM** -- from the scripts repo root `node --test` -> 162 pass. `for f in darknet.js darknet/lib.js darknet/solvers.js darknet/agent.js darknet/crack.js darknet/lab.js darknet/phish.js; do node --check $f && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs $f; done` -> every line `+[]` except `darknet/crack.js` (`self` at 0).

- [ ] **Step 2: fixtures** -- `cd /home/jubnl/dev/bitburner/tools/harness && EXTRA=dbg3.js OUT=fixture-darknet-loot.json.gz node mkfixture-darknet.mjs && SF15=1 EXTRA=dbg3.js OUT=fixture-darknet-lab.json.gz node mkfixture-darknet.mjs` (the default `CHA_EXP=5000` gives charisma ~520, above the `LAB_CHA + 1 = 301` gate of Task 7).

- [ ] **Step 3: in-game RAM** -- `FIXTURE=./fixture-darknet-loot.json.gz SCRIPTS=darknet.js,darknet/agent.js,darknet/crack.js,darknet/lab.js,darknet/phish.js,darknet/promote.js,darknet/migrate.js,darknet/stasis.js,darknet/realloc.js,darknet/cache.js node drv.mjs s8-mem.mjs` -> `darknet.js` 6.15GB, `agent.js` 4.50GB, `crack.js` 2.95GB, `lab.js` 3.95GB, `phish.js` 3.65GB, `promote.js` 3.65GB, `migrate.js` 5.65GB, `stasis.js` 13.65GB, `realloc.js` 2.65GB, `cache.js` 3.85GB (the `WORKER_RAM` table in `darknet/lib.js`). Any other number is a RAM regression: find the identifier with `node matches.mjs <file>` and rename it.

- [ ] **Step 4: loot run with a reload (R4, R6, R9, R10, R12, R13, R15)** -- `FIXTURE=./fixture-darknet-loot.json.gz MODE=loot SECONDS=1200 RELOAD=1 PROFILE=./profile-loot setsid nohup node drv.mjs s12-verify.mjs > run-loot.log 2>&1 &`, then poll `tail -5 run-loot.log` until `=== errors ===` appears (~25 min). Assert in `run-loot.log`: the `=== after run ===` DBG line has `cracked=` >= 5 and `online` >= `cracked`; `plan:` shows `"migrationTargets":{}` (R10) and `phishByHost` summing to <= 14 (R9); `ram <host>` lines show `phish.jsx<n>` only on the deepest hosts and `promote.jsx<n>` (when stockmaster holds a position) on the biggest; no `ctl:` line contains `controller loop failed`; after `=== after reload + 60s ===` `cracked=` is not lower, `ctl:` lines contain no `Invalid host` (R15 -- any host deleted during the 20 minutes and still `online` in `state.txt` exercises it), and the `=== errors ===` section is empty.

- [ ] **Step 5: labyrinth run (R1, R2, R3, R5, R7, R8, R11)** -- `FIXTURE=./fixture-darknet-lab.json.gz MODE=labyrinth SECONDS=2400 PROFILE=./profile-lab setsid nohup node drv.mjs s12-verify.mjs > run-lab.log 2>&1 &`. Assert in `run-lab.log`: the `labs:` DBG line has `"current":"th3_l4byr1nth"` and `"completed":[]` (R1 on a fresh save), `walkers` with at most one entry (R8) whose `steps` > 0, or `rewardQueuedAt` set (a win); the `ram <walkHost>` line shows `lab.jsx<N>` with `N = floor((maxRam - 4.5 - 0.5 - 13.65) / 3.95)` when the host is pinned, else `floor((maxRam - 5) / 3.95)` (R7), and no host appears in both `migrationTargets` and `stasisTargets` of the `plan:` line (R3); `charisma goal file:` is one above a `requiredCharismaSkill` or lab gate (R11); the `=== errors ===` section is empty.

- [ ] **Step 6: kill** -- `FIXTURE=./fixture-darknet-lab.json.gz PROFILE=./profile-lab node drv.mjs s13-kill.mjs` -> the snippet's final line reports no `darknet/` process left on darkweb or any known host.

- [ ] **Step 7: report** the numbers from Steps 4-6 to the user; nothing to commit.

---

## Skipped

- **R9, the stock-profit part** (spec: "formulas confirmed, stock magnitude suspected"): the claim that ~22 promote threads per symbol raise a held position's profit noticeably depends on stockmaster holding a position with a correct forecast and is not verified. Task 11 implements only the confirmed part -- the sizing rule (phish saturates at ~14 threads network-wide on the deepest hosts; promote has no 64 GB floor and gets up to 24 threads per held symbol; share takes the rest). Whether promote pays is a hypothesis for the user to measure with `run darknet.js --status` (`promote calls:`) against stockmaster's realised profit, and `PROMOTE_THREADS_PER_SYMBOL` is one constant to lower if it does not.
- Nothing else in section 4 is marked suspected; R1-R8 and R10-R15 are confirmed and planned.

## Self-review

**Spec coverage (section 4, every confirmed finding mapped):** R1 -> Task 1; R2 -> Task 2; R3 -> Task 3; R4 -> Task 4; R5 -> Task 6; R6 -> Task 8; R7 -> Task 9; R8 -> Task 10; R9 (sizing rule) -> Task 11, stock magnitude -> Skipped; R10 -> Task 12; R11 -> Task 7; R12 -> Task 5; R13 -> Task 13; R14 -> Task 14; R15 -> Task 0. The "Task order and dependencies" table lists all sixteen tasks; Task 15 is the headless smoke.

**Placeholder scan:** no "TBD", "TODO", "handle edge cases", "similar to task N" or "add tests" anywhere in the file; every step that changes code shows the exact old and new text or the full new function, every test step shows the full test, every run step names the command and the expected result. The only forward references are the deliberate "text as Task N leaves it" quotes (Tasks 5, 8, 13, 14), each of which quotes that text in full.

**Name/signature consistency across all tasks (checked by reading Tasks 1-11 as written and Tasks 0, 12-14 as added):**
- `currentLab(ns, state)`, `recomputeCompleted(ns, state)` (Task 1) are what Tasks 2, 3, 7, 9 call; `LAB_AUGMENTATIONS`, `labFromAugmentations(ownedNames, bitNode)`, `labFromDifficulty(maxDifficulty)` are exported from `darknet/lib.js` and imported into `darknet.js` and the controller test the same way in every task; the `makeNs` option `ownedAugs` (Task 1) is used by Tasks 2 and 3 with that name.
- `crackOrder(hosts, detailsByHost, charisma)` and `FEEDBACK_MODELS` (Task 4) are used by Task 5 (the `pending`/`reserve` lines it rewrites are Task 4's exact text) and by Task 14's `wantsFeedback`; `cmd.charisma` is written in `buildCmd` and defaulted in `parseCmd` as `null` in Task 4 only.
- `attemptFn(password, needFeedback = true)` (Task 4) -> Task 8 inserts `renewClaim` as its first statement -> Task 14 adds `elapsed`/`fetchFeedback` and `solve`'s `tryPw(pw, needFeedback)` forwarding; Task 14 quotes the Task 4 + Task 8 text verbatim and the three source-assertion regexes of Tasks 4, 8 and 14 were checked against the final text together.
- `parseMoveOutcome(message, data)` and the `report` loop (Task 6) are what Task 10's `nextMove(visited, stack, coords, open, target, order = DIR_ORDER)` and `walkerOrder(seed)` plug into; the Task 6 harness already threads `order` through.
- `planFillers(state, plan)`, `plan.phishByHost`, `plan.promoteByHost`, `fillerPlan({ ..., cap })` (Task 11) are consistent between `darknet.js`, `darknet/lib.js`, `darknet/agent.js` and both test files; `PHISH_THREADS_TOTAL = 14` / `PROMOTE_THREADS_PER_SYMBOL = 24` match the "Default changes" table.
- `trySession(ns, host, secret)` (Task 0) is the text Task 13 quotes in `pushFiles`; `lastPushed` (Task 13) is module-level in `darknet.js` and the R13 and R15 tests use disjoint host names so the cache never couples them; Task 12 removes only `prevNeighbours` and the `planLoot` island block, and Task 13 quotes `pushFiles` exactly as Task 0 leaves it (Task 12 does not touch `pushFiles`).
- `timingStep(threads)`, `indexFromTiming(elapsed, base, step, prefixLength)`, `TIMING_TOLERANCE` (Task 14) are exported from `darknet/solvers.js` and imported by name in `test/darknet-solvers.test.js`; `opts.threads` is the field `crack.js` passes as `threads: ns.self().threads`.
- Test totals: 126 at HEAD, 127 after Task 0, then Tasks 1-11 as quoted plus one (132 ... 155), 157 after Task 12, 158 after Task 13, 162 after Task 14.
- RAM: no task adds an NS call to `darknet/agent.js` (stays 4.50 GB) or to any worker except `ns.self()` (0 GB) in `crack.js`; every new identifier in Tasks 0, 12, 13, 14 was checked against `RamCostGenerator.ts` with `tools/harness/matches.mjs` (no new charged name; the helper deliberately avoids the NS names `probe`, `share`, `attempt`).
