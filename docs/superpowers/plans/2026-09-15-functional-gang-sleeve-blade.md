# Gangs, Sleeves and Bladeburner Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gangs.js, sleeve.js and bladeburner.js steer their decisions by the quantities the game (v3.0.1) actually rewards: task stat weights, karma-per-attempt, cost-per-exp, the low end of a chance range, estimate improvement per second, the chaos cliff at 50, and the zero-RAM `nextUpdate()` pacers.

**Architecture:** Each script keeps its structure; the decision logic that changes is extracted into three ns-free modules (`lib/gang-logic.js`, `lib/sleeve-logic.js`, `lib/bladeburner-logic.js`) that the scripts import and that `node --test` exercises directly. State-machine changes that need the game (gang tick loop, cached fetches) are verified in-game with the commands given in each task.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22+ `node:test` for unit tests (the machine has Node 24), tools/harness (`collide.mjs`) for RAM checks and the headless game.

**Spec:** docs/audit/2026-09-15-functional-review.md, section 3 ("Gangs, sleeves, bladeburner").

## Default changes for the user to approve

| Script | Option / constant | Old | New | Why | Task |
|---|---|---|---|---|---|
| sleeve.js | `training-cap-seconds` (upstream) | 7200 | 0 (= no cap) | The cap cannot coexist with any shock gate (shock decays at most 0.0015/s: 100 -> 10 takes 16.7 h); sleeves keep exp across augmentation installs, so a time cap only ever cuts training short. `0` now means "no cap". | 1 |
| sleeve.js | `train-max-shock` (branch) | 10 | removed | Replaced by `train-max-cost-per-exp`. | 1 |
| sleeve.js | `train-max-cost-per-exp` (new) | - | 2500 | Train while a point of gym exp costs at most $2500 (Powerhouse: $2400/s for 10 exp/s x (100-shock)%, cost not shock-scaled). 2500 admits shock <= 90 (str 105 for ~$33M per stat at shock 90). | 1 |
| sleeve.js | `karma-homicide-min-rate` (new) | - | 0.1 | Sleeve Homicide for gang karma only when successChance x sync/100 >= 0.1 (karma is only earned on success and is scaled by sync). Fresh sleeves never qualify; trained + synced ones do. | 2 |
| sleeve.js | `sync-first` behaviour (branch narrowed upstream legacy) | sync when karma crime wanted | never sync unless `--sync-first` | Sync takes ~27 h and only scales karma / copied exp. | 2 |
| sleeve.js | bladeburner task table, sleeves 5 and 6 (upstream) | Diplomacy / Field Analysis | Infiltrate Synthoids / Infiltrate Synthoids | Each extra infiltrating sleeve adds `sqrt(n)/2` contracts+operations per minute (>= 4-7 rank/min) vs 0.2 rank/min from stat-1 Field Analysis; the chaos escalation still reassigns sleeves to Diplomacy. | 7 |
| gangs.js | `min-training-ticks` (upstream) | 10 | removed | Replaced by `retrain-recovery-fraction`. | 9 |
| gangs.js | `retrain-recovery-fraction` (new) | - | 0.9 | After an ascension, train until the task-weighted, equipment-stripped stats recover 90 % of their pre-ascension value; recruits train until 90 % of the weakest existing member. Members still retraining are not ascended again. | 9 |
| gangs.js | `disable-next-update` (branch) | false | removed | The tick loop is now paced by `ns.gang.nextUpdate()` (0 GB); polling mode is gone. | 5 |
| gangs.js | `updateInterval` constant (upstream) | 200 ms | removed | The main loop runs once per gang update (2 s normal, 200 ms bonus time) instead of every 200 ms. | 5 |
| gangs.js | bonus-time behaviour (upstream) | pre-tick warfare swap every tick | no swap while `getBonusTime() >= 5 s`; housekeeping every 20 s wall-clock | Territory ticks every 800 ms in bonus time; the swap cannot keep up and the gang spends most of the 25x catch-up on warfare. | 6 |
| bladeburner.js | Stealth Retirement gate above `chaos-recovery-threshold` (upstream constant) | `minChance > 0.99` | `minChance > --success-threshold` (0.9) | The chaos penalty is a cliff at 50 (x1.41 at 51); a 90 % Stealth Retirement is worth more than the ops run under the penalty. | 10 |
| bladeburner.js | `chaos-diplomacy-horizon-minutes` (new) | - | 60 | Run Diplomacy when every city is above the chaos threshold and the Diplomacy time is less than the rank-time lost to the penalty over this expected stay. | 10 |
| bladeburner.js | `populationActions` table (upstream) | Undercover, Investigation, Tracking | Undercover, Investigation (+ Field Analysis ranked by improvement/s) | Tracking moves the estimate by 100-1000 people on a ~1e9 population. | 8 |

## Global Constraints

- Never edit anything under /home/jubnl/dev/bitburner/bitburner-src.
- One finding per commit (or one file's worth of tightly related findings); commit message names the finding ID, e.g. `sleeve: gate training on cost per exp (SL-2)`. No Co-Authored-By or session trailers. Never push. Never touch .idea/. Stop before each `git commit` and let the user trigger it (hand them the exact command).
- After every script edit run `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>` from the scripts repo root (`/home/jubnl/dev/bitburner/bitburner-scripts`). Any `+[...]` output is a new RAM charge from an identifier whose name equals an NS function (spawn, exec, grow, hack, share, kill, attempt, connect, scan, weaken, run, ps, ls...) - rename it. Two entries are expected and cost nothing, and are called out where they appear: `nextUpdate=RamCostConstants.CycleTiming` (CycleTiming is 0 in RamCostGenerator.ts:79) and `hacking={` / `skills={` (namespace keys, not functions; sleeve.js already carries them at HEAD). New `lib/*.js` files have no HEAD version, so collide prints every hit; they must print `+[]`.
- Run the full Node suite with a bare `node --test` from the repo root (126 tests pass at HEAD 7d13c98; each task adds tests). Do not use globs or pipes on that command.
- Scope discipline: fix the finding, do not refactor around it. Line numbers below are as at HEAD 7d13c98; earlier tasks shift later ones, so locate edits by the quoted old text.
- Stat names in `lib/gang-logic.js` are only ever strings in arrays (`"hack"` etc.) or computed keys (`weights[s]`), never bare identifiers or object-literal keys, because the game charges 0.1 GB for the identifier `hack`. Test files are Node-only and may use any names.
- In-game deployment: the game must have the new `lib/` files on home. If files are pulled with git-pull.js, add `--new-file lib/gang-logic.js --new-file lib/sleeve-logic.js --new-file lib/bladeburner-logic.js` the first time (or copy them in with the game's API/file sync). Scripts import them as `./lib/<name>.js` (same style as `darknet/*.js` importing `./lib.js`).
- In-game checks below assume a save with SF2 (gangs), SF10 (sleeves) and SF7 (bladeburner API); the headless harness (`tools/harness/drv.mjs` + a snippet) can replace manual play but every check is written for the game terminal.

## File structure

| File | Responsibility |
|---|---|
| `lib/gang-logic.js` (new) | task stat weights, equipment score/ranking, weighted ascension gain, training-task pick, tick counter helpers, retrain gate. No ns. |
| `lib/sleeve-logic.js` (new) | gym cost-per-exp gate, karma filler predicate, bladeburner sleeve task table. No ns. |
| `lib/bladeburner-logic.js` (new) | chance-range verdict, Field Analysis effectiveness + population action ranking, chaos/Diplomacy decision, bulk skill count. No ns. |
| `test/gangs-logic.test.js`, `test/sleeve-logic.test.js`, `test/bladeburner-logic.test.js` (new) | `node:test` suites for the three libs. |
| `gangs.js`, `sleeve.js`, `bladeburner.js` | consume the libs; loop/caching changes verified in-game. |

---

### Task 1: SL-2 - sleeve training gated on cost per exp, no time cap

**Files:**
- Create: `lib/sleeve-logic.js`
- Create: `test/sleeve-logic.test.js`
- Modify: `sleeve.js` lines 1 (import), 22, 29, 208-210, 305-312, 440

**Interfaces:**
- Produces `lib/sleeve-logic.js`: `export const gymCostPerSecond = 2400`, `export const gymExpPerSecond = 10`, `export function trainingCostPerExp(shock: number): number`, `export function canAffordTraining(shock: number, maxCostPerExp: number): boolean`.
- Consumes in sleeve.js: `canAffordTraining(sleeve.shock, options['train-max-cost-per-exp'])`; produces the local `const trainingAffordable` inside `pickSleeveTask` (Task 2 and Task 7 do not depend on it; Task 12 does not either).

- [ ] **Step 1: Write the failing test**

Create `test/sleeve-logic.test.js`:

```js
// Pure decision helpers of sleeve.js (lib/sleeve-logic.js) checked against the game constants they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingCostPerExp, canAffordTraining } from "../lib/sleeve-logic.js";

// SL-2: Powerhouse Gym costs $120/s x costMult 20 = $2400/s for 1 exp/s x expMult 10 = 10 exp/s; sleeve exp is scaled by
// (100 - shock)/100 (SleeveClassWork.ts calculateRates), the fee is not.
test("SL-2: cost per exp is $240 at shock 0, $2400 at shock 90, infinite at shock 100", () => {
    assert.equal(trainingCostPerExp(0), 240);
    assert.ok(Math.abs(trainingCostPerExp(90) - 2400) < 1e-9);
    assert.equal(trainingCostPerExp(100), Infinity);
});

test("SL-2: the default gate (2500 $/exp) admits shock <= 90 and rejects shock 91+ and 100", () => {
    assert.equal(canAffordTraining(90, 2500), true);
    assert.equal(canAffordTraining(50, 2500), true);
    assert.equal(canAffordTraining(91, 2500), false);
    assert.equal(canAffordTraining(100, 2500), false);
    assert.equal(canAffordTraining(100, Infinity), false); // exp is exactly 0 at shock 100: never pay
});
```

- [ ] **Step 2: Run it, expect failure**

`node --test test/sleeve-logic.test.js` -> fails with `ERR_MODULE_NOT_FOUND` for `../lib/sleeve-logic.js`.

- [ ] **Step 3: Create the module**

Create `lib/sleeve-logic.js`:

```js
// Pure decision helpers for sleeve.js. No ns dependency, so this file is unit-tested in Node (test/sleeve-logic.test.js).

// Powerhouse Gym (src/Locations/data/LocationsMetadata.ts: costMult 20, expMult 10) running a gym class (src/Work/ClassWork.tsx:
// money -120/s, 1 exp/s). A sleeve's class exp is scaled by shockBonus() = (100 - shock)/100 but the fee is not
// (src/PersonObjects/Sleeve/Work/SleeveClassWork.ts calculateRates: scaleWorkStats(..., sleeve.shockBonus(), false)).
export const gymCostPerSecond = 120 * 20;
export const gymExpPerSecond = 1 * 10;

/** @param {number} shock The sleeve's shock (0..100)
 * @returns {number} Dollars paid per point of exp at Powerhouse Gym (Infinity at shock 100, where exp is exactly 0) */
export function trainingCostPerExp(shock) {
    const shockBonus = (100 - shock) / 100;
    return shockBonus > 0 ? gymCostPerSecond / (gymExpPerSecond * shockBonus) : Infinity;
}

/** @param {number} shock
 * @param {number} maxCostPerExp The --train-max-cost-per-exp option
 * @returns {boolean} Whether paying for gym/university time is worth it at this shock level */
export function canAffordTraining(shock, maxCostPerExp) {
    return trainingCostPerExp(shock) <= maxCostPerExp;
}
```

- [ ] **Step 4: Run the test, expect pass**

`node --test test/sleeve-logic.test.js` -> 2 passing.

- [ ] **Step 5: Wire sleeve.js**

Line 1, old:
```js
import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, runCommand, formatMoney, formatDuration, getErrorInfo } from './helpers.js'
```
new:
```js
import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, runCommand, formatMoney, formatDuration, getErrorInfo } from './helpers.js'
import { canAffordTraining } from './lib/sleeve-logic.js'
```

Line 22, old:
```js
    ['training-cap-seconds', 2 * 60 * 60 /* 2 hours */], // Time since the start of the bitnode after which we will no longer attempt to train sleeves to their target "train-to" settings
```
new:
```js
    ['training-cap-seconds', 0], // Time since the start of the bitnode after which we will no longer train sleeves to their "train-to" targets (0 = no cap: sleeves keep exp across augmentation installs, so a cap only ever cuts training short)
```

Line 29, old:
```js
    ['train-max-shock', 10], // Only train (gym/university) sleeves whose shock is at or below this. Class exp is multiplied by (100 - shock)% but the cost is not.
```
new:
```js
    ['train-max-cost-per-exp', 2500], // Only train (gym/university) sleeves while a point of exp costs at most this much. Class exp is multiplied by (100 - shock)% but the fee is not, so 2500 admits shock <= 90 (lib/sleeve-logic.js trainingCostPerExp)
```

Lines 208-210, old:
```js
    let canTrain = !options['disable-training'] && !sleeveExpDisabled &&
        // To avoid training forever when mults are crippling, stop training if we've been in the bitnode a certain amount of time
        (options['training-cap-seconds'] * 1000 > timeInBitnode) &&
```
new:
```js
    let canTrain = !options['disable-training'] && !sleeveExpDisabled &&
        // Optionally stop training after some time in the bitnode (--training-cap-seconds, 0 = no cap)
        (options['training-cap-seconds'] <= 0 || options['training-cap-seconds'] * 1000 > timeInBitnode) &&
```

Lines 305-312, old:
```js
    // Train if our sleeve's physical stats aren't where we want them.
    // Class exp is scaled by shockBonus() = (100 - shock)/100 (src/PersonObjects/Sleeve/Work/SleeveClassWork.ts calculateRates) but the class
    // cost is not, so don't pay to train a heavily shocked sleeve (--train-max-shock). Also, installing any sleeve augmentation zeroes all of
    // its exp (src/PersonObjects/Sleeve/Sleeve.ts installAugmentation), so don't train while augs remain to be bought (--train-with-pending-augs).
    let augsPending = false;
    if (canTrain && sleeve.shock <= options['train-max-shock'] && !options['train-with-pending-augs'] && !sleeveExpDisabled)
        augsPending = (await getAvailableAugs(ns, i)).length > 0;
    if (canTrain && sleeve.shock <= options['train-max-shock'] && !augsPending) {
```
new:
```js
    // Train if our sleeve's physical stats aren't where we want them.
    // Class exp is scaled by shockBonus() = (100 - shock)/100 (src/PersonObjects/Sleeve/Work/SleeveClassWork.ts calculateRates) but the class
    // fee is not, so only pay while a point of exp is cheap enough (--train-max-cost-per-exp, lib/sleeve-logic.js). Also, installing any sleeve
    // augmentation zeroes all of its exp (src/PersonObjects/Sleeve/Sleeve.ts installAugmentation), so don't train while augs remain to be bought (--train-with-pending-augs).
    const trainingAffordable = canTrain && canAffordTraining(sleeve.shock, options['train-max-cost-per-exp']);
    let augsPending = false;
    if (trainingAffordable && !options['train-with-pending-augs'] && !sleeveExpDisabled)
        augsPending = (await getAvailableAugs(ns, i)).length > 0;
    if (trainingAffordable && !augsPending) {
```

Line 440, old:
```js
    if (options['darknet-charisma'] && canTrain && sleeve.shock <= options['train-max-shock'] && sleeve.sync >= darknetCharismaMinSync) {
```
new:
```js
    if (options['darknet-charisma'] && trainingAffordable && sleeve.sync >= darknetCharismaMinSync) {
```

- [ ] **Step 6: Checks**

`node --check sleeve.js && node --check lib/sleeve-logic.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs sleeve.js` -> `sleeve.js: +[] -[]`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs lib/sleeve-logic.js` -> `lib/sleeve-logic.js: +[] -[]`
`grep -n "train-max-shock" sleeve.js` -> no output.
`node --test` -> 128 pass.

- [ ] **Step 7: In-game check**

In the game terminal: `run sleeve.js --tail`. With a sleeve at shock <= 90 (e.g. after some hours, or a BN10 sleeve that starts at 25) and money above reserve, the log must show `SUCCESS: Set sleeve N to train strength (Powerhouse Gym)` within a few seconds and the sleeve's Str must rise on the Sleeves page. With a sleeve at shock > 90 the log must not show any `train ...` assignment for it. `run sleeve.js --training-cap-seconds 60` on a node older than a minute must show no training at all (cap still works when set).

- [ ] **Step 8: Commit (user triggers)**

`git add lib/sleeve-logic.js test/sleeve-logic.test.js sleeve.js && git commit -m "sleeve: gate training on cost per exp, drop the 2 h cap (SL-2)"`

---

### Task 2: SL-1 - never block on sync; Homicide for karma only as a qualifying filler

**Files:**
- Modify: `lib/sleeve-logic.js` (append)
- Modify: `test/sleeve-logic.test.js` (import line + append)
- Modify: `sleeve.js` lines 2 (import), 8 (comment), argsSchema (new option after line 8), 286-291, 372-374

**Interfaces:**
- Produces `export function karmaRatePerAttempt(successChance: number, sync: number): number` (0..1) and `export function shouldFillWithKarmaHomicide(successChance: number, sync: number, minRate: number): boolean`.
- Consumes sleeve.js `calculateCrimeChance(ns, sleeve, 'Homicide')` (existing) and `sleeve.sync`.

- [ ] **Step 1: Write the failing tests**

Change the import line of `test/sleeve-logic.test.js` to:
```js
import { trainingCostPerExp, canAffordTraining, karmaRatePerAttempt, shouldFillWithKarmaHomicide } from "../lib/sleeve-logic.js";
```
Append:
```js
// SL-1: karma from sleeve crime is only awarded on success and is scaled by sync (SleeveCrimeWork.ts process:
// Player.karma -= crime.karma * sleeve.syncBonus() inside `if (success)`).
test("SL-1: karma rate per attempt is chance x sync/100 and clamps both inputs", () => {
    assert.equal(karmaRatePerAttempt(1, 100), 1);
    assert.equal(karmaRatePerAttempt(0.5, 50), 0.25);
    assert.equal(karmaRatePerAttempt(2, 200), 1);
    assert.equal(karmaRatePerAttempt(-1, 100), 0);
});

test("SL-1: a fresh sleeve (0.5 % homicide, 1 % sync) never qualifies; a trained, synced one does", () => {
    assert.equal(shouldFillWithKarmaHomicide(0.005, 1, 0.1), false);
    assert.equal(shouldFillWithKarmaHomicide(0.5, 1, 0.1), false);   // trained (str/def 105) but unsynchronised
    assert.equal(shouldFillWithKarmaHomicide(0.5, 100, 0.1), true);  // trained and fully synced
    assert.equal(shouldFillWithKarmaHomicide(0.1, 100, 0.1), true);  // exactly at the gate
    assert.equal(shouldFillWithKarmaHomicide(0.005, 1, 0), true);    // gate disabled
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/sleeve-logic.test.js` -> fails: `karmaRatePerAttempt` is not exported (SyntaxError on import).

- [ ] **Step 3: Implement**

Append to `lib/sleeve-logic.js`:
```js

/** Karma from sleeve crime is only awarded on a successful crime and is scaled by sync (src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts
 * process: `if (success) Player.karma -= crime.karma * sleeve.syncBonus()`), so the expected karma per attempt is chance x sync/100 x crime.karma.
 * @returns {number} Expected fraction (0..1) of the crime's karma earned per attempt */
export function karmaRatePerAttempt(successChance, sync) {
    return Math.min(1, Math.max(0, successChance)) * Math.min(100, Math.max(0, sync)) / 100;
}

/** @returns {boolean} Whether farming Homicide for gang karma is worth more than falling through to the sleeve's productive tasks */
export function shouldFillWithKarmaHomicide(successChance, sync, minRate) {
    return karmaRatePerAttempt(successChance, sync) >= minRate;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/sleeve-logic.test.js` -> 4 passing.

- [ ] **Step 5: Wire sleeve.js**

Import line (added in Task 1), new:
```js
import { canAffordTraining, karmaRatePerAttempt, shouldFillWithKarmaHomicide } from './lib/sleeve-logic.js'
```

Line 8, old:
```js
    ['disable-gang-homicide-priority', false], // By default, sleeves will do homicide to farm Karma until we're in a gang. Set this flag to disable this priority.
```
new (two lines):
```js
    ['disable-gang-homicide-priority', false], // By default, sleeves that can earn karma efficiently (see --karma-homicide-min-rate) do homicide until we're in a gang. Set this flag to disable this priority.
    ['karma-homicide-min-rate', 0.1], // Farm Homicide for gang karma ahead of other work only while (success chance x sync%) is at least this. Karma is only earned on success and is scaled by sync; 0.1 = 0.3 karma per 3 s attempt, ~10% of the player's own homicide rate
```

Lines 286-291, old:
```js
    // Synchronization only affects karma gained from sleeve crime (src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts: karma * syncBonus())
    // and the exp copied to the player / other sleeves (Work.ts applySleeveGains). The sleeve's own exp, rep and shock recovery are unaffected,
    // so only bother syncing first when this sleeve's job will be crime for gang karma (or when --sync-first is set).
    const wantKarmaCrime = !playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000;
    if (sleeve.sync < 100 && (options['sync-first'] || wantKarmaCrime))
        return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `syncing... ${sleeve.sync.toFixed(2)}%`];
```
new:
```js
    // Synchronization only affects karma gained from sleeve crime (src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts: karma * syncBonus())
    // and the exp copied to the player / other sleeves (Work.ts applySleeveGains). The sleeve's own exp, rep and shock recovery are unaffected,
    // and synchronizing is glacial (SleeveSynchroWork.ts: 0.0002 sync per 200 ms cycle = 0.001/s, ~27 h from 1 to 100), so never block on it:
    // only the legacy --sync-first flag forces it.
    if (sleeve.sync < 100 && options['sync-first'])
        return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `syncing... ${sleeve.sync.toFixed(2)}%`];
```

Lines 372-374, old:
```js
    // If gangs are available, prioritize homicide until we've got the requisite -54K karma to unlock them
    if (!playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000)
        return await crimeTask(ns, 'Homicide', i, sleeve, 'we want gang karma'); // Ignore chance - even a failed homicide generates more Karma than every other crime
```
new:
```js
    // If gangs are available and we still need -54K karma to unlock them, a sleeve may farm Homicide - but karma is only earned on a successful
    // crime and is scaled by sync (SleeveCrimeWork.ts process: Player.karma -= crime.karma * sleeve.syncBonus() only when success), so this is a
    // filler that must clear --karma-homicide-min-rate; otherwise the sleeve falls through to the productive tasks below.
    const wantKarmaCrime = !playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000;
    if (wantKarmaCrime) {
        const homicideChance = await calculateCrimeChance(ns, sleeve, 'Homicide');
        if (shouldFillWithKarmaHomicide(homicideChance, sleeve.sync, options['karma-homicide-min-rate']))
            return await crimeTask(ns, 'Homicide', i, sleeve, `we want gang karma (earning ${(100 * karmaRatePerAttempt(homicideChance, sleeve.sync)).toFixed(1)}% of the karma per attempt)`);
    }
```

- [ ] **Step 6: Checks**

`node --check sleeve.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs sleeve.js` -> `+[] -[]`; `node --test` -> 130 pass.

- [ ] **Step 7: In-game check**

Save with SF2 owned, no gang, karma > -54000, fresh sleeves. `run sleeve.js --tail`: no sleeve may log `syncing...`; sleeves must be assigned recovery / training / bladeburner / faction work (whatever applies) and never `committing Homicide ... because we want gang karma`. Then `run sleeve.js --karma-homicide-min-rate 0 --tail`: sleeves that reach the bottom of the task list now log `committing Homicide ... because we want gang karma (earning 0.0% ...)`, proving the gate is the only thing holding them back. `run sleeve.js --sync-first --tail` still logs `syncing...`.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/sleeve-logic.js test/sleeve-logic.test.js sleeve.js && git commit -m "sleeve: never block on sync, karma homicide only as a qualifying filler (SL-1)"`

---

### Task 3: BB-1 - BlackOp go/no-go on the low end of the chance range, resolve the range first

**Files:**
- Create: `lib/bladeburner-logic.js`
- Create: `test/bladeburner-logic.test.js`
- Modify: `bladeburner.js` lines 1 (import), 44 (comment), 247-252, 296-297, 317-318

**Interfaces:**
- Produces `export function chanceRangeVerdict(range: [number, number], threshold: number): "go" | "uncertain" | "no"`.
- Consumes bladeburner.js locals `getChance(actionName)`, `thresholdFor(actionName)`, `nextBlackOp` (existing).

- [ ] **Step 1: Write the failing test**

Create `test/bladeburner-logic.test.js`:
```js
// Pure decision helpers of bladeburner.js (lib/bladeburner-logic.js) checked against the game formulas they encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chanceRangeVerdict } from "../lib/bladeburner-logic.js";

// BB-1: Action.ts getSuccessRange returns [real*r, real] when the population is over-estimated (r = pop/popEst < 1) and [real, real*r]
// when it is under-estimated, so only the low end never exceeds the true chance.
test("BB-1: an under-estimated population ([real, real*r]) is not a go", () => {
    assert.equal(chanceRangeVerdict([0.77, 1.0], 0.99), "uncertain"); // r = 1.3, a 77 %-real Daedalus reported as up to 100 %
    assert.equal(chanceRangeVerdict([1.0, 0.77], 0.99), "uncertain"); // order-insensitive
});

test("BB-1: only a collapsed or fully-above range is a go", () => {
    assert.equal(chanceRangeVerdict([1, 1], 0.99), "go");
    assert.equal(chanceRangeVerdict([0.995, 1], 0.99), "go");
    assert.equal(chanceRangeVerdict([0.99, 1], 0.99), "uncertain"); // lo == threshold is not > threshold, but hi is: resolve rather than stall
    assert.equal(chanceRangeVerdict([0.5, 0.9], 0.99), "no");
    assert.equal(chanceRangeVerdict([0, 0], 0.99), "no");
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/bladeburner-logic.test.js` -> `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the module**

Create `lib/bladeburner-logic.js`:
```js
// Pure decision helpers for bladeburner.js. No ns dependency, so this file is unit-tested in Node (test/bladeburner-logic.test.js).

/** Classify an estimated success-chance range against a threshold.
 * ns.bladeburner.getActionEstimatedSuccessChance returns [low, high] (src/Bladeburner/Actions/Action.ts getSuccessRange): the true chance lies
 * inside, and the two ends coincide only when the city's population estimate is exact (popEst == pop). Only the low end is guaranteed not to
 * exceed the true chance, so "go" requires it; "uncertain" means improving the population estimate could turn the range into a "go".
 * @param {[number, number]} range
 * @param {number} threshold
 * @returns {"go"|"uncertain"|"no"} */
export function chanceRangeVerdict(range, threshold) {
    const lo = Math.min(range[0], range[1]), hi = Math.max(range[0], range[1]);
    if (lo > threshold) return "go";
    if (hi > threshold) return "uncertain";
    return "no";
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/bladeburner-logic.test.js` -> 2 passing.

- [ ] **Step 5: Wire bladeburner.js**

Line 1, old:
```js
import { log, disableLogs, getConfiguration, instanceCount, getNsDataThroughFile, runCommand, getFilePath, getActiveSourceFiles, formatNumberShort, formatDuration } from './helpers.js'
```
new:
```js
import { log, disableLogs, getConfiguration, instanceCount, getNsDataThroughFile, runCommand, getFilePath, getActiveSourceFiles, formatNumberShort, formatDuration } from './helpers.js'
import { chanceRangeVerdict } from './lib/bladeburner-logic.js'
```

Line 44, old:
```js
    ['blackop-success-threshold', 0.99], // Black ops are attempted only when their chance exceeds this (failure is very costly, and their estimate can be optimistic)
```
new:
```js
    ['blackop-success-threshold', 0.99], // Black ops are attempted only when the LOW end of their estimated chance range exceeds this (failure costs 10-20k rank, HP and a team member)
```

Lines 247-252, old:
```js
    // Black ops ignore population (src/Bladeburner/Actions/BlackOperation.ts getPopulationSuccessFactor() = 1), so their estimated and real
    // chances are identical, but Action.ts getSuccessRange still multiplies one end of the returned range by pop/popEst. One end of the pair
    // is therefore the true chance; we use the max (exact when the population is over-estimated, optimistic otherwise - hence the separate,
    // stricter --blackop-success-threshold).
    const blackOpsChance = nextBlackOp === null || rank < blackOpsRanks[nextBlackOp] ? [0, 0] : // Insufficient rank for blackops means chance is zero
        (([lo, hi]) => [Math.max(lo, hi), Math.max(lo, hi)])((await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Black Operations", [nextBlackOp]))[nextBlackOp]);
```
new:
```js
    // Black ops ignore population (src/Bladeburner/Actions/BlackOperation.ts getPopulationSuccessFactor() = 1), so their estimated and real
    // chances are identical, but Action.ts getSuccessRange still returns [real * r, real] when the population is over-estimated (r = pop/popEst < 1)
    // and [real, real * r] when it is under-estimated. Only the LOW end never exceeds the true chance, so the go/no-go uses it (minChance /
    // chanceRangeVerdict), and a range that straddles --blackop-success-threshold is resolved first by improving the population estimate
    // (populationUncertain below): both Field Analysis and Investigation/Undercover move popEst toward pop, and lo == hi only when popEst == pop.
    const blackOpsChance = nextBlackOp === null || rank < blackOpsRanks[nextBlackOp] ? [0, 0] : // Insufficient rank for blackops means chance is zero
        (([lo, hi]) => [Math.min(lo, hi), Math.max(lo, hi)])((await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Black Operations", [nextBlackOp]))[nextBlackOp]);
```

Lines 296-297, old:
```js
        // We should deal with population uncertainty if its causing some mission to be on the verge of our success threshold
        let populationUncertain = candidateActions.some(a => maxChance(a) > options['success-threshold'] && minChance(a) < options['success-threshold']);
```
new:
```js
        // We should deal with population uncertainty if it is causing some mission (including the next BlackOp, at its own threshold) to straddle its success threshold
        let populationUncertain = candidateActions.some(a => chanceRangeVerdict(getChance(a), thresholdFor(a)) == "uncertain");
```

Lines 317-318, old:
```js
        if (!bestActionName) // If there were none, allow us to fall-back to an action with a minimum chance >50%, and maximum chance > threshold
            bestActionName = candidateActions.filter(a => minChance(a) > 0.5 && maxChance(a) > thresholdFor(a) && getCount(a) >= 1)[0];
```
new:
```js
        if (!bestActionName) // If there were none, allow us to fall-back to an action with a minimum chance >50%, and maximum chance > threshold (never a BlackOp: its range is resolved first)
            bestActionName = candidateActions.filter(a => a != nextBlackOp && minChance(a) > 0.5 && maxChance(a) > thresholdFor(a) && getCount(a) >= 1)[0];
```

(The go path needs no change: with `populationUncertain` false, `chanceFn` is `minChance` and `getTargetLevel` for a non-levelable BlackOp returns `chance > threshold ? 0 : null`, i.e. go only when the low end clears 0.99.)

- [ ] **Step 6: Checks**

`node --check bladeburner.js && node --check lib/bladeburner-logic.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs bladeburner.js` -> `bladeburner.js: +[] -[]`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs lib/bladeburner-logic.js` -> `+[] -[]`
`node --test` -> 132 pass.

- [ ] **Step 7: In-game check**

Save with rank above the next BlackOp's requirement (`run bladeburner.js --tail` prints the remaining BlackOps with their ranks at startup). Watch the `Switched to Bladeburner ...` lines: while the BlackOp's `Success Chance: X% to Y%` shows two different numbers, the script must be on Undercover / Investigation / Tracking / Field Analysis (`High population uncertainty in <city>` or an operation with a range) and must never start `Black Operations`. Once the summary shows a single number above 99 %, it starts the BlackOp. To force the situation, wait for a random population event (every 4-10 min the estimate drifts) or `run bladeburner.js --blackop-success-threshold 0.999` on a save where the BlackOp shows `99.5% to 100%`.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/bladeburner-logic.js test/bladeburner-logic.test.js bladeburner.js && git commit -m "bladeburner: BlackOp go/no-go on the low chance end, resolve the range first (BB-1)"`

---

### Task 4: GG-1 - equipment, ascension and training steered by the task's stat weights

**Files:**
- Create: `lib/gang-logic.js`
- Create: `test/gangs-logic.test.js`
- Modify: `gangs.js` lines 1-4 (import), 17, 56, 147, 199, 266, 270, 422, 432-460 (`tryAscendMembers`), 462-479 (`isNearAscension` + new helpers), 506-524 (`tryUpgradeMembers` loop)

**Interfaces:**
- Produces `lib/gang-logic.js`: `export const gangStatKeys`, `export const trainingTaskStats`, `export function taskStatWeights(taskStats): {[stat]: number}`, `export function equipmentScore(equipStats, weights): number`, `export function rankEquipment(candidates: {score, cost, ...}[]): same[]`, `export function weightedStat(memberInfo, weights, stripEquipment = false): number`, `export function weightedAscensionGain(ascResult, memberInfo, weights): number`, `export function pickTrainingTask(weights, roll = null): string`.
- Produces in gangs.js: `function referenceTaskFor(memberName: string|null): string`, `function memberWeights(memberName: string|null): {[stat]: number}`, `async function tryAscendMembers(ns, myGangInfo, dictMembers)` (new third parameter), `function isNearAscension(memberIndex, memberInfo)` (new second parameter). Tasks 5, 6 and 9 rely on these exact names.
- Consumes gangs.js globals `allTaskStats` (from `ns.gang.getTaskStats`, which carries `hackWeight..chaWeight` - the game's tasks.ts weights - so no copy of the table is needed), `assignedTasks`, `crimes`, `myGangMembers`, `isHackGang`.

- [ ] **Step 1: Write the failing tests**

Create `test/gangs-logic.test.js`:
```js
// Pure decision helpers of gangs.js (lib/gang-logic.js) checked against the task weights and formulas of src/Gang.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedStat, weightedAscensionGain, pickTrainingTask } from "../lib/gang-logic.js";

// src/Gang/data/tasks.ts:317-332 and :295-311 (no agiWeight on either)
const terrorism = { hackWeight: 20, strWeight: 20, defWeight: 20, dexWeight: 20, chaWeight: 20, difficulty: 36 };
const trafficking = { hackWeight: 30, strWeight: 5, defWeight: 5, dexWeight: 30, chaWeight: 30, difficulty: 36 };

test("GG-1: task weights are the game's weights / 100, missing weights are 0", () => {
    assert.deepEqual(gangStatKeys, ["hack", "str", "def", "dex", "agi", "cha"]);
    assert.deepEqual(taskStatWeights(terrorism), { hack: 0.2, str: 0.2, def: 0.2, dex: 0.2, agi: 0, cha: 0.2 });
    assert.deepEqual(taskStatWeights({ hackWeight: 100 }), { hack: 1, str: 0, def: 0, dex: 0, agi: 0, cha: 0 });
    assert.deepEqual(taskStatWeights(undefined), { hack: 0, str: 0, def: 0, dex: 0, agi: 0, cha: 0 });
});

test("GG-1: equipment is scored by the weight of the stats it multiplies (GangMember.ts applyUpgrade)", () => {
    const w = taskStatWeights(trafficking);
    assert.ok(Math.abs(equipmentScore({ agi: 1.6 }, w) - 0) < 1e-12);                // Bionic Legs: agility has no weight in Human Trafficking
    assert.ok(Math.abs(equipmentScore({ hack: 1.15 }, w) - 0.045) < 1e-12);          // Neuralstimulator: 0.3 * 0.15
    assert.ok(Math.abs(equipmentScore({ str: 1.5, agi: 1.5 }, w) - 0.025) < 1e-12);  // Synthetic Heart: 0.05 * 0.5
    assert.ok(Math.abs(equipmentScore({ hack: 1.05 }, w) - 0.015) < 1e-12);          // NUKE Rootkit
    assert.equal(equipmentScore(undefined, w), 0);
});

test("GG-1: rankEquipment puts the best score per dollar first and zero-score items last (cheapest first)", () => {
    const w = taskStatWeights(trafficking);
    const items = [
        { name: "Bionic Legs", cost: 10e9, score: equipmentScore({ agi: 1.6 }, w) },
        { name: "Neuralstimulator", cost: 10e9, score: equipmentScore({ hack: 1.15 }, w) },
        { name: "Synthetic Heart", cost: 25e9, score: equipmentScore({ str: 1.5, agi: 1.5 }, w) },
        { name: "NUKE Rootkit", cost: 5e6, score: equipmentScore({ hack: 1.05 }, w) },
        { name: "Baseball Bat", cost: 1e6, score: equipmentScore({ str: 1.04, def: 1.04 }, w) },
        { name: "Bionic Arms", cost: 3e9, score: 0 },
    ];
    assert.deepEqual(rankEquipment(items).map(i => i.name),
        ["Baseball Bat", "NUKE Rootkit", "Neuralstimulator", "Synthetic Heart", "Bionic Arms", "Bionic Legs"]);
    assert.equal(items[0].name, "Bionic Legs", "input array is not mutated");
});

test("GG-1: ascension gain is weighted by each stat's contribution to the task", () => {
    const w = taskStatWeights(terrorism);
    const member = { hack: 50, str: 1000, def: 1000, dex: 1000, agi: 1000, cha: 50 };
    const asc = { respect: 1, hack: 1, str: 1.6, def: 1.6, dex: 1.6, agi: 1.6, cha: 1 };
    // (0.2*50*1 + 3 * 0.2*1000*1.6 + 0.2*50*1) / (0.2*50 + 3 * 0.2*1000 + 0.2*50) = 980 / 620
    assert.ok(Math.abs(weightedAscensionGain(asc, member, w) - 980 / 620) < 1e-12);
    // Agility alone does nothing for Terrorism
    assert.equal(weightedAscensionGain({ hack: 1, str: 1, def: 1, dex: 1, agi: 2, cha: 1 }, member, w), 1);
    // A member with no weighted stats yet: fall back to the best single-stat ratio so it can still ascend
    assert.equal(weightedAscensionGain(asc, { hack: 0, str: 0, def: 0, dex: 0, agi: 0, cha: 0 }, w), 1.6);
});

test("GG-1: weightedStat can strip equipment multipliers (lost on ascension)", () => {
    const w = taskStatWeights(terrorism);
    const member = { hack: 100, str: 300, def: 300, dex: 300, agi: 300, cha: 100, hack_mult: 1, str_mult: 3, def_mult: 3, dex_mult: 3, agi_mult: 3, cha_mult: 1 };
    assert.ok(Math.abs(weightedStat(member, w) - 0.2 * (100 + 900 + 100)) < 1e-9);
    assert.ok(Math.abs(weightedStat(member, w, true) - 0.2 * (100 + 300 + 100)) < 1e-9);
});

test("GG-1: training task follows the weight mass (Terrorism: 60 % combat, 20 % hacking, 20 % charisma)", () => {
    const w = taskStatWeights(terrorism);
    assert.equal(pickTrainingTask(w), "Train Combat");
    assert.equal(pickTrainingTask(w, 0.59), "Train Combat");
    assert.equal(pickTrainingTask(w, 0.61), "Train Hacking");
    assert.equal(pickTrainingTask(w, 0.81), "Train Charisma");
    assert.equal(pickTrainingTask(taskStatWeights({ hackWeight: 80, chaWeight: 20 })), "Train Hacking"); // Cyberterrorism
    assert.equal(pickTrainingTask(taskStatWeights({ hackWeight: 80, chaWeight: 20 }), 0.9), "Train Charisma");
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/gangs-logic.test.js` -> `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the module**

Create `lib/gang-logic.js`:
```js
// Pure decision helpers for gangs.js. No ns dependency, so this file is unit-tested in Node (test/gangs-logic.test.js).
// Stat names are only ever strings here (never bare identifiers or object-literal keys) because the game charges RAM for any identifier
// whose name equals an NS function ("hack").
export const gangStatKeys = ["hack", "str", "def", "dex", "agi", "cha"];

// Which stats each training task raises (src/Gang/data/tasks.ts: Train Combat str/def/dex/agi 25 each, Train Hacking hack 100, Train Charisma cha 100)
export const trainingTaskStats = { "Train Combat": ["str", "def", "dex", "agi"], "Train Hacking": ["hack"], "Train Charisma": ["cha"] };

/** @param {GangTaskStats} taskStats From ns.gang.getTaskStats (src/Gang/data/tasks.ts hackWeight..chaWeight)
 * @returns {{[stat: string]: number}} The share (0..1) of the task's statWeight carried by each stat
 * (src/Gang/formulas/formulas.ts: statWeight = sum over stats of weight/100 * stat) */
export function taskStatWeights(taskStats) {
    return Object.fromEntries(gangStatKeys.map(s => [s, (taskStats?.[`${s}Weight`] ?? 0) / 100]));
}

/** @param {EquipmentStats} equipStats From ns.gang.getEquipmentStats: per-stat multipliers (absent = 1)
 * @param {{[stat: string]: number}} weights From taskStatWeights
 * @returns {number} Fractional increase of the task's statWeight this equipment gives a member with equal stats
 * (an upgrade multiplies exactly the stats it lists: src/Gang/GangMember.ts applyUpgrade) */
export function equipmentScore(equipStats, weights) {
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * ((equipStats?.[s] ?? 1) - 1), 0);
}

/** Order purchase candidates best value first: score per dollar descending; zero-score items last, cheapest first. Does not mutate the input.
 * @template T
 * @param {(T & {score: number, cost: number})[]} candidates
 * @returns {(T & {score: number, cost: number})[]} */
export function rankEquipment(candidates) {
    return candidates.slice().sort((a, b) => (b.score / b.cost) - (a.score / a.cost) || a.cost - b.cost);
}

/** @param {GangMemberInfo} memberInfo From ns.gang.getMemberInformation
 * @param {{[stat: string]: number}} weights
 * @param {boolean} stripEquipment Divide each stat by its equipment multiplier (`${stat}_mult`), which ascension resets to 1
 * @returns {number} sum over stats of weight * stat */
export function weightedStat(memberInfo, weights, stripEquipment = false) {
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * memberInfo[s] / (stripEquipment ? (memberInfo[`${s}_mult`] || 1) : 1), 0);
}

/** @param {GangMemberAscension} ascResult From ns.gang.getAscensionResult: per-stat newMult/oldMult
 * @param {GangMemberInfo} memberInfo
 * @param {{[stat: string]: number}} weights
 * @returns {number} The factor by which the member's weighted statWeight for the task grows once its exp is recovered */
export function weightedAscensionGain(ascResult, memberInfo, weights) {
    const before = weightedStat(memberInfo, weights);
    if (!(before > 0)) return Math.max(...gangStatKeys.map(s => ascResult[s] ?? 1));
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * memberInfo[s] * (ascResult[s] ?? 1), 0) / before;
}

/** Choose a training task by the share of the task's weight each one raises.
 * @param {{[stat: string]: number}} weights
 * @param {number|null} roll A number in [0, 1) for a weighted random pick, or null for the deterministic best
 * @returns {string} "Train Combat" | "Train Hacking" | "Train Charisma" */
export function pickTrainingTask(weights, roll = null) {
    const masses = Object.entries(trainingTaskStats).map(([taskName, stats]) => [taskName, stats.reduce((sum, s) => sum + (weights[s] ?? 0), 0)]);
    const total = masses.reduce((sum, [, mass]) => sum + mass, 0);
    if (roll === null || !(total > 0)) return masses.reduce((best, cur) => cur[1] > best[1] ? cur : best)[0];
    let acc = 0;
    for (const [taskName, mass] of masses) {
        acc += mass / total;
        if (roll < acc) return taskName;
    }
    return masses[masses.length - 1][0];
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/gangs-logic.test.js` -> 6 passing.

- [ ] **Step 5: Wire gangs.js**

Lines 1-4, old:
```js
import {
    log, getConfiguration, instanceCount, getNsDataThroughFile, getActiveSourceFiles, runCommand, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration
} from './helpers.js'
```
new:
```js
import {
    log, getConfiguration, instanceCount, getNsDataThroughFile, getActiveSourceFiles, runCommand, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration
} from './helpers.js'
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedAscensionGain, pickTrainingTask } from './lib/gang-logic.js'
```

Line 17, old:
```js
const offStatCostPenalty = 50; // Equipment that doesn't contribute to our main stats suffers a percieved cost penalty of this multiple
```
new:
```js
const offStatCostPenalty = 50; // Equipment that adds nothing to the member's task (score 0, e.g. agility for Terrorism) suffers a perceived cost penalty of this multiple
```

Line 56: delete `let importantStats = [];`. Line 147: delete `    importantStats = isHackGang ? ["hack"] : ["str", "def", "dex", "agi"];`.

Line 199, old:
```js
        assignedTasks[member.name] = (member.task && member.task !== "Unassigned") ? member.task : ("Train " + (isHackGang ? "Hacking" : "Combat"));
```
new:
```js
        assignedTasks[member.name] = (member.task && member.task !== "Unassigned") ? member.task : pickTrainingTask(memberWeights(member.name));
```

Line 266, old:
```js
    if (!options['no-auto-ascending']) await tryAscendMembers(ns, myGangInfo); // Ascend members if we deem it a good time
```
new:
```js
    if (!options['no-auto-ascending']) await tryAscendMembers(ns, myGangInfo, dictMembers); // Ascend members if we deem it a good time
```

Lines 269-270, old:
```js
    // There's a chance we do training instead of work for this next tick. If training, we primarily train our main stat, with a small chance to train less-important stats
    const task = Math.random() >= pctTraining ? null : "Train " + (Math.random() < 0.1 ? "Charisma" : Math.random() < (isHackGang ? 0.1 : 0.9) ? "Combat" : "Hacking")
```
new:
```js
    // There's a chance we do training instead of work for this next tick. The stat trained follows the weights of the gang's reference crime
    // (e.g. Terrorism: 60% combat, 20% hacking, 20% charisma), since those weights are what the respect/money formulas reward.
    const task = Math.random() >= pctTraining ? null : pickTrainingTask(memberWeights(null), Math.random());
```

Line 422, old:
```js
        assignedTasks[newMemberName] = "Train " + (isHackGang ? "Hacking" : "Combat");
```
new:
```js
        assignedTasks[newMemberName] = pickTrainingTask(memberWeights(null));
```

`tryAscendMembers`, lines 430-460, old:
```js
/** @param {NS} ns
 * Check if any members are deemed worth ascending to increase a stat multiplier **/
async function tryAscendMembers(ns, myGangInfo) {
    const dictAscensionResults = await getGangInfoDict(ns, myGangMembers, 'getAscensionResult');
    lastAscensionResults = dictAscensionResults;
    // Ascending deducts the member's earned respect from the gang (src/Gang/Gang.ts ascendMember: respect -= res.respect).
    // Recruiting the (n+1)th member requires 5^(n - 3 + 1) respect (src/Gang/Gang.ts respectForNextRecruit, Constants: numFreeMembers=3,
    // recruitThresholdBase=5, MaximumGangMembers=12), so until we have 12 members, don't ascend if it would put us below the next recruit threshold.
    const guardRecruits = !options['disable-ascend-recruit-guard'] && myGangMembers.length < 12;
    const respectNeededForNextRecruit = guardRecruits ? await getNsDataThroughFile(ns, 'ns.gang.respectForNextRecruit()') : 0;
    let projectedRespect = myGangInfo.respect;
    for (let i = 0; i < myGangMembers.length; i++) {
        const member = myGangMembers[i];
        const ascResult = dictAscensionResults[member];
        if (!ascResult || !importantStats.some(stat => ascResult[stat] >= getAscendThreshold(i)))
            continue;
        if (guardRecruits && projectedRespect - ascResult.respect < respectNeededForNextRecruit) {
            log(ns, `INFO: Not ascending member ${member} yet: it would cost ${formatNumberShort(ascResult.respect)} respect, leaving ` +
                `${formatNumberShort(projectedRespect - ascResult.respect)} < ${formatNumberShort(respectNeededForNextRecruit)} needed to recruit member #${myGangMembers.length + 1}.`);
            continue;
        }
        if (undefined !== (await getNsDataThroughFile(ns, `ns.gang.ascendMember(ns.args[0])`, null, [member]))) {
            log(ns, `SUCCESS: Ascended member ${member} to increase multis by ${importantStats.map(s => `${s} -> ${ascResult[s].toFixed(2)}x`).join(", ")}`, false, 'success');
            lastMemberReset[member] = Date.now();
            projectedRespect -= ascResult.respect;
            delete lastAscensionResults[member]; // No longer near ascension
        }
        else
            log(ns, `ERROR: Attempt to ascended member ${member} failed. Go investigate!`, false, 'error');
    }
}
```
new:
```js
/** @param {NS} ns
 * @param {GangGenInfo} myGangInfo
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMembers
 * Check if any members are deemed worth ascending to increase a stat multiplier **/
async function tryAscendMembers(ns, myGangInfo, dictMembers) {
    const dictAscensionResults = await getGangInfoDict(ns, myGangMembers, 'getAscensionResult');
    lastAscensionResults = dictAscensionResults;
    // Ascending deducts the member's earned respect from the gang (src/Gang/Gang.ts ascendMember: respect -= res.respect).
    // Recruiting the (n+1)th member requires 5^(n - 3 + 1) respect (src/Gang/Gang.ts respectForNextRecruit, Constants: numFreeMembers=3,
    // recruitThresholdBase=5, MaximumGangMembers=12), so until we have 12 members, don't ascend if it would put us below the next recruit threshold.
    const guardRecruits = !options['disable-ascend-recruit-guard'] && myGangMembers.length < 12;
    const respectNeededForNextRecruit = guardRecruits ? await getNsDataThroughFile(ns, 'ns.gang.respectForNextRecruit()') : 0;
    let projectedRespect = myGangInfo.respect;
    for (let i = 0; i < myGangMembers.length; i++) {
        const member = myGangMembers[i];
        const ascResult = dictAscensionResults[member];
        if (!ascResult || !dictMembers[member]) continue;
        // Weight each stat's ascension gain by its contribution to the member's task (src/Gang/formulas/formulas.ts statWeight), so an agility
        // gain does not trigger an ascension for a Terrorism member, and a hack or charisma gain does count.
        const weights = memberWeights(member);
        const ascGain = weightedAscensionGain(ascResult, dictMembers[member], weights);
        if (ascGain < getAscendThreshold(i)) continue;
        if (guardRecruits && projectedRespect - ascResult.respect < respectNeededForNextRecruit) {
            log(ns, `INFO: Not ascending member ${member} yet: it would cost ${formatNumberShort(ascResult.respect)} respect, leaving ` +
                `${formatNumberShort(projectedRespect - ascResult.respect)} < ${formatNumberShort(respectNeededForNextRecruit)} needed to recruit member #${myGangMembers.length + 1}.`);
            continue;
        }
        if (undefined !== (await getNsDataThroughFile(ns, `ns.gang.ascendMember(ns.args[0])`, null, [member]))) {
            log(ns, `SUCCESS: Ascended member ${member}: ${referenceTaskFor(member)} stat weight x${ascGain.toFixed(2)} ` +
                `(${gangStatKeys.filter(s => weights[s] > 0).map(s => `${s} -> ${ascResult[s].toFixed(2)}x`).join(", ")})`, false, 'success');
            lastMemberReset[member] = Date.now();
            projectedRespect -= ascResult.respect;
            delete lastAscensionResults[member]; // No longer near ascension
        }
        else
            log(ns, `ERROR: Attempt to ascended member ${member} failed. Go investigate!`, false, 'error');
    }
}
```

`isNearAscension`, lines 469-479, old:
```js
/** @param {number} memberIndex
 * @returns {boolean} Whether this member is within --equipment-ascend-proximity of their ascension threshold on any important stat.
 * Equipment (but not augmentations) is cleared on ascend (src/Gang/GangMember.ts ascend(): upgrades.length = 0), so buying it now would be a waste. */
function isNearAscension(memberIndex) {
    const proximity = options['equipment-ascend-proximity'];
    if (options['no-auto-ascending'] || !(proximity > 0)) return false;
    const ascResult = lastAscensionResults[myGangMembers[memberIndex]];
    if (!ascResult) return false;
    const gainNeeded = (getAscendThreshold(memberIndex) - 1) * (1 - proximity);
    return importantStats.some(stat => (ascResult[stat] - 1) >= gainNeeded);
}
```
new:
```js
/** @param {number} memberIndex
 * @param {GangMemberInfo} memberInfo
 * @returns {boolean} Whether this member is within --equipment-ascend-proximity of their ascension threshold (task-weighted, see tryAscendMembers).
 * Equipment (but not augmentations) is cleared on ascend (src/Gang/GangMember.ts ascend(): upgrades.length = 0), so buying it now would be a waste. */
function isNearAscension(memberIndex, memberInfo) {
    const proximity = options['equipment-ascend-proximity'];
    if (options['no-auto-ascending'] || !(proximity > 0)) return false;
    const ascResult = lastAscensionResults[myGangMembers[memberIndex]];
    if (!ascResult || !memberInfo) return false;
    const gainNeeded = (getAscendThreshold(memberIndex) - 1) * (1 - proximity);
    return (weightedAscensionGain(ascResult, memberInfo, memberWeights(myGangMembers[memberIndex])) - 1) >= gainNeeded;
}

/** @param {string|null} memberName
 * @returns {string} The crime whose stat weights steer this member's equipment, ascension and training: its own assigned crime, else the gang's
 * most common assigned crime, else the top task of this gang type (nobody is on crime yet, e.g. everyone is training). null = the gang as a whole. */
function referenceTaskFor(memberName) {
    if (memberName != null && crimes.includes(assignedTasks[memberName])) return assignedTasks[memberName];
    const counts = {};
    for (const m of myGangMembers)
        if (crimes.includes(assignedTasks[m])) counts[assignedTasks[m]] = (counts[assignedTasks[m]] || 0) + 1;
    const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return mostCommon ? mostCommon[0] : (isHackGang ? "Cyberterrorism" : "Terrorism");
}

/** @param {string|null} memberName
 * @returns {{[stat: string]: number}} The stat weights (src/Gang/data/tasks.ts, via ns.gang.getTaskStats) of the task steering this member */
function memberWeights(memberName) {
    return taskStatWeights(allTaskStats[referenceTaskFor(memberName)]);
}
```

`tryUpgradeMembers`, lines 506-524, old:
```js
    // Find out what outstanding equipment can be bought within our budget
    const nearAscension = myGangMembers.map((_, i) => isNearAscension(i));
    for (const equip of equipments) {
        if (augBudget <= 0) break;
        for (const member of Object.values(dictMembers)) { // Get this equip for each member before considering the next most expensive equip
            if (augBudget <= 0) break;
            // Bit of a hack: Inflate the "cost" of equipment that doesn't contribute to our main stats so that we don't purchase them unless we have ample cash
            let percievedCost = equip.cost * (Object.keys(equip.stats).some(stat => importantStats.some(i => stat.includes(i))) ? 1 : offStatCostPenalty);
            if (percievedCost > augBudget) continue;
            if (equip.type != "Augmentation" && percievedCost > budget) continue;
            // Non-augmentation equipment is lost on ascension, so don't buy it for members about to ascend
            if (equip.type != "Augmentation" && nearAscension[myGangMembers.indexOf(member.name)]) continue;
            if (!member.upgrades.includes(equip.name) && !member.augmentations.includes(equip.name)) {
                purchaseOrder.push({ member: member.name, type: equip.type, equipmentName: equip.name, cost: equip.cost });
                budget -= equip.cost;
                augBudget -= equip.cost;
            }
        }
    }
    await doUpgradePurchases(ns, purchaseOrder);
```
new:
```js
    // Score every outstanding piece of equipment for every member by how much it raises the stat weight of the member's task (respect/money scale
    // with sum weight_s * stat_s, src/Gang/formulas/formulas.ts, and an upgrade multiplies exactly the stats it lists, GangMember.ts applyUpgrade),
    // then buy best value (score per dollar) first within the budgets.
    const nearAscension = myGangMembers.map((name, i) => isNearAscension(i, dictMembers[name]));
    const candidates = [];
    for (const member of Object.values(dictMembers)) {
        const weights = memberWeights(member.name);
        for (const equip of equipments) {
            if (member.upgrades.includes(equip.name) || member.augmentations.includes(equip.name)) continue;
            // Non-augmentation equipment is lost on ascension, so don't buy it for members about to ascend
            if (equip.type != "Augmentation" && nearAscension[myGangMembers.indexOf(member.name)]) continue;
            candidates.push({ member: member.name, equip, cost: equip.cost, score: equipmentScore(equip.stats, weights) });
        }
    }
    for (const { member, equip, cost, score } of rankEquipment(candidates)) {
        if (augBudget <= 0) break;
        // Equipment that adds nothing to the member's task only helps territory power (GangMember.ts calculatePower sums all six stats), so inflate its cost
        const percievedCost = cost * (score > 0 ? 1 : offStatCostPenalty);
        if (percievedCost > augBudget) continue;
        if (equip.type != "Augmentation" && percievedCost > budget) continue;
        purchaseOrder.push({ member, type: equip.type, equipmentName: equip.name, cost });
        budget -= cost;
        augBudget -= cost;
    }
    await doUpgradePurchases(ns, purchaseOrder);
```

- [ ] **Step 6: Checks**

`node --check gangs.js && node --check lib/gang-logic.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs gangs.js` -> `gangs.js: +[] -[]`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs lib/gang-logic.js` -> `lib/gang-logic.js: +[] -[]`
`grep -n importantStats gangs.js` -> no output.
`node --test` -> 138 pass.

- [ ] **Step 7: In-game check**

Combat gang on Terrorism / Human Trafficking with >= $1B (so budgets are not divided): `run gangs.js --tail`. On the next territory tick the `SUCCESS: Purchased N gang member upgrades` line must list rootkits (`NUKE Rootkit`, `Soulstealer Rootkit`, ...) and cheap weapons/armor before any `Bionic Legs`; `Bionic Legs`/`Bionic Arms` (agility-only) must appear only once the other augmentations are owned. Ascension lines read `Ascended member Thug N: Terrorism stat weight x1.xx (hack -> ..., str -> ..., def -> ..., dex -> ..., cha -> ...)` with no `agi`. Training ticks show `Train Hacking` / `Train Charisma` about 20 % of the time each for a Terrorism gang. `mem gangs.js` must equal its value before the change.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/gang-logic.js test/gangs-logic.test.js gangs.js && git commit -m "gangs: steer equipment, ascension and training by task stat weights (GG-1)"`

---

### Task 5: GG-3 - territory tick tracking by counting `ns.gang.nextUpdate()` cycles

Depends on Task 4 (`memberWeights`, `pickTrainingTask`, `tryAscendMembers(ns, myGangInfo, dictMembers)`).

**Files:**
- Modify: `lib/gang-logic.js` (append)
- Modify: `test/gangs-logic.test.js` (import line + append)
- Modify: `gangs.js` lines 7, 21-33 (territory globals), 79 (`disable-next-update`), 99-106 (main loop), 148-150 and 201-204 (`initialize`), 207-273 (`mainLoop` + `onTerritoryTick`), 546-581 (`waitForGameUpdate`)

**Interfaces:**
- Produces `export function missedGangCycles(elapsedMs: number, cyclesPerUpdate: number): number` and `export function nextUpdateHasTerritoryTick(cyclesSinceTick: number|null, cyclesPerUpdate: number, cyclesPerTick = 100): boolean`.
- Produces in gangs.js: `async function awaitGangUpdate(ns): Promise<number>` (cycles processed), `async function onTerritoryTick(ns)` (no second parameter any more), globals `cyclesSinceTerritoryTick`, `lastUpdateResolvedAt`, `territoryCyclesPerTick`, `territoryTickTime` (const, 20000). Task 6 adds to `mainLoop`/`onTerritoryTick` exactly as written here.
- Consumes `getGangCyclesPerUpdate(ns)`, `gangCyclesPerNormalUpdate`, `gangCyclesPerBonusUpdate` (existing).

- [ ] **Step 1: Write the failing tests**

Change the import line of `test/gangs-logic.test.js` to:
```js
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedStat, weightedAscensionGain, pickTrainingTask, missedGangCycles, nextUpdateHasTerritoryTick } from "../lib/gang-logic.js";
```
Append:
```js
// GG-3: territory/power are processed once every 100 gang cycles (Constants.ts CyclesPerTerritoryAndPowerUpdate), i.e. during every 10th
// normal update (10 cycles each) or every 4th bonus-time update (25 cycles each). ns.gang.nextUpdate() resolves with cycles * 200 ms.
test("GG-3: the update after 90 counted cycles carries the territory tick", () => {
    assert.equal(nextUpdateHasTerritoryTick(80, 10), false);
    assert.equal(nextUpdateHasTerritoryTick(90, 10), true);
    assert.equal(nextUpdateHasTerritoryTick(95, 10), true);
    assert.equal(nextUpdateHasTerritoryTick(null, 10), false);
    assert.equal(nextUpdateHasTerritoryTick(75, 25), true); // bonus time: 4 updates of 25 cycles
    assert.equal(nextUpdateHasTerritoryTick(50, 25), false);
});

test("GG-3: updates that resolved while no nextUpdate() was pending are estimated from the wall clock (one per 2 s)", () => {
    assert.equal(missedGangCycles(1900, 10), 0);
    assert.equal(missedGangCycles(2100, 10), 10);
    assert.equal(missedGangCycles(4500, 10), 20);
    assert.equal(missedGangCycles(0, 10), 0);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/gangs-logic.test.js` -> SyntaxError: `missedGangCycles` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `lib/gang-logic.js`:
```js

/** ns.gang.nextUpdate() only reports updates that resolve while a promise is pending (src/Gang/Gang.ts process: the resolver is created on demand),
 * so updates that pass while the script is busy must be estimated: one update of `cyclesPerUpdate` cycles every cyclesPerUpdate * 200 ms.
 * @returns {number} Gang cycles processed during `elapsedMs` with no pending nextUpdate() */
export function missedGangCycles(elapsedMs, cyclesPerUpdate) {
    return cyclesPerUpdate * Math.floor(elapsedMs / (cyclesPerUpdate * 200));
}

/** @param {number|null} cyclesSinceTick Cycles counted since the last observed territory tick (null = no tick observed yet)
 * @param {number} cyclesPerUpdate 10 in normal play, 25 in bonus time
 * @param {number} cyclesPerTick src/Gang/data/Constants.ts CyclesPerTerritoryAndPowerUpdate
 * @returns {boolean} Whether the NEXT gang update will include the territory tick (Gang.ts processTerritoryAndPowerGains) */
export function nextUpdateHasTerritoryTick(cyclesSinceTick, cyclesPerUpdate, cyclesPerTick = 100) {
    return cyclesSinceTick != null && cyclesSinceTick + cyclesPerUpdate >= cyclesPerTick;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/gangs-logic.test.js` -> 8 passing.

- [ ] **Step 5: Rewrite the gangs.js tick loop**

Import line (added in Task 4), new:
```js
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedAscensionGain, pickTrainingTask, missedGangCycles, nextUpdateHasTerritoryTick } from './lib/gang-logic.js'
```

Line 7, old:
```js
const updateInterval = 200; // We can improve our timing by updating more often than gang stats do (which is every 2 seconds for stats, every 20 seconds for territory)
```
new:
```js
const territoryTickTime = 20000; // Milliseconds between territory ticks in normal play (100 cycles x 200 ms, src/Gang/data/Constants.ts CyclesPerTerritoryAndPowerUpdate)
```

Lines 21-33, old:
```js
// Territory-related variables
const gangsByPower = ["Speakers for the Dead", "The Dark Army", "The Syndicate", "Tetrads", "Slum Snakes", /* Hack gangs don't scale as far */ "The Black Hand", /* "NiteSec" Been there, not fun. */]
const territoryEngageThreshold = 0.60; // Minimum average win chance (of gangs with territory) before we engage other clans
let territoryTickDetected = false;
let territoryTickTime = 20000; // Est. milliseconds until territory *ticks*. Can vary if processing offline time
let territoryTickWaitPadding = 200; // Start waiting this many milliseconds before we think territory will tick, in case it ticks early (increases automatically after misfires)
let consecutiveTerritoryDetections = 0; // Used to reduce padding if things get back on track.
let territoryNextTick = null; // The next time territory will tick
let isReadyForNextTerritoryTick = false;
let warfareFinished = false;
let lastTerritoryPower = 0;
let lastOtherGangInfo = null;
let lastLoopTime = null;
```
new:
```js
// Territory-related variables
const gangsByPower = ["Speakers for the Dead", "The Dark Army", "The Syndicate", "Tetrads", "Slum Snakes", /* Hack gangs don't scale as far */ "The Black Hand", /* "NiteSec" Been there, not fun. */]
const territoryEngageThreshold = 0.60; // Minimum average win chance (of gangs with territory) before we engage other clans
const territoryCyclesPerTick = 100; // src/Gang/data/Constants.ts CyclesPerTerritoryAndPowerUpdate: territory/power are processed once every 100 gang cycles (every 10th normal update)
let cyclesSinceTerritoryTick = null; // Gang cycles processed since the last observed territory tick (null until the first one is observed)
let lastUpdateResolvedAt = 0; // Date.now() when ns.gang.nextUpdate() last resolved, to estimate updates that passed while we were busy (no resolver pending)
let isReadyForNextTerritoryTick = false; // True while members have been moved to Territory Warfare for the coming tick
let warfareFinished = false;
let lastOtherGangInfo = null;
```

Line 79: delete `    ['disable-next-update', false], // Set to true to poll for gang updates (legacy) rather than awaiting ns.gang.nextUpdate()`.

Lines 99-106, old:
```js
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `WARNING: gangs.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(updateInterval);
    }
```
new (the loop is paced by `awaitGangUpdate` inside `mainLoop`; a throw after it is followed by the next await, so there is no hot loop):
```js
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `WARNING: gangs.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
            await ns.sleep(1000);
        }
    }
```

Lines 148-150, old:
```js
    territoryNextTick = lastTerritoryPower = lastOtherGangInfo = null;
    territoryTickDetected = isReadyForNextTerritoryTick = warfareFinished = false;
    territoryTickWaitPadding = updateInterval;
```
new:
```js
    cyclesSinceTerritoryTick = lastOtherGangInfo = null;
    lastUpdateResolvedAt = 0;
    isReadyForNextTerritoryTick = warfareFinished = false;
```

Lines 201-204, old:
```js
    // Peform all updates / actions normally performed on territory tick (every 20 seconds) once before starting the main loop
    lastLoopTime = Date.now()
    await onTerritoryTick(ns, myGangInfo);
    lastTerritoryPower = myGangInfo.power;
```
new:
```js
    // Peform all updates / actions normally performed on territory tick (every 20 seconds) once before starting the main loop
    await onTerritoryTick(ns);
```

Lines 207-273 (`mainLoop` and `onTerritoryTick`), old: the whole of both functions as at HEAD (from `/** @param {NS} ns\n * Executed every `interval` **/` through the closing brace of `onTerritoryTick`). new:
```js
/** @param {NS} ns
 * Executed once per gang update (every 2 s in normal play, every 200 ms in bonus time) **/
async function mainLoop(ns) {
    const processedCycles = await awaitGangUpdate(ns); // 0 GB; resolves right after the game processes gang gains (src/Gang/Gang.ts process)
    // Every territory tick gives every NPC gang a power gain (src/Gang/Gang.ts processTerritoryAndPowerGains), so a change in their info marks a tick
    const otherGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getAllGangInformation()'); // Returns dict of { [gangName]: { "power": Number, "territory": Number } }
    const tickObserved = lastOtherGangInfo != null && JSON.stringify(otherGangInfo) != JSON.stringify(lastOtherGangInfo);
    lastOtherGangInfo = otherGangInfo;
    if (tickObserved) {
        if (cyclesSinceTerritoryTick == null)
            log(ns, `INFO: Observed a territory tick. Members will be moved to Territory Warfare for the one update that carries each tick (every ${territoryCyclesPerTick} cycles).`);
        else if (Math.abs(cyclesSinceTerritoryTick - territoryCyclesPerTick) > processedCycles)
            log(ns, `INFO: Territory ticked after ${cyclesSinceTerritoryTick} counted cycles (expected ${territoryCyclesPerTick}). Resynchronizing.`);
        cyclesSinceTerritoryTick = 0;
        await onTerritoryTick(ns); // Do most things only once per territory tick (restores crime tasks first)
    } else if (!warfareFinished && !isReadyForNextTerritoryTick && nextUpdateHasTerritoryTick(cyclesSinceTerritoryTick, getGangCyclesPerUpdate(ns), territoryCyclesPerTick)) {
        // The next update carries the territory tick, and power is computed from whoever is on Territory Warfare at that moment (Gang.ts calculatePower)
        isReadyForNextTerritoryTick = true;
        await updateMemberActivities(ns, null, "Territory Warfare", await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()'));
    }
}

/** Await the next gang update (ns.gang.nextUpdate(), 0 GB) and keep the territory cycle counter up to date.
 * @param {NS} ns
 * @returns {Promise<number>} The number of gang cycles the update processed **/
async function awaitGangUpdate(ns) {
    // Updates that happen while no nextUpdate() promise is pending are not reported (Gang.ts: the resolver is created on demand), so estimate those
    // from the wall clock: one update per 2 s in normal play. The counter is not used in bonus time (see mainLoop), so no estimate is needed there.
    if (cyclesSinceTerritoryTick != null && lastUpdateResolvedAt > 0 && getGangCyclesPerUpdate(ns) == gangCyclesPerNormalUpdate)
        cyclesSinceTerritoryTick += missedGangCycles(Date.now() - lastUpdateResolvedAt, gangCyclesPerNormalUpdate);
    const processedMs = await ns.gang.nextUpdate(); // Resolves with cycles * 200 ms (src/Gang/Gang.ts process: GangPromise.resolve(cycles * MilliPerCycle))
    lastUpdateResolvedAt = Date.now();
    const processedCycles = Math.round(processedMs / 200);
    if (cyclesSinceTerritoryTick != null) cyclesSinceTerritoryTick += processedCycles;
    return processedCycles;
}

/** @param {NS} ns
 * Do some things only once per territory tick **/
async function onTerritoryTick(ns) {
    const myGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    log(ns, `Territory tick: power ${formatNumberShort(myGangInfo.power)}, territory ${(100 * myGangInfo.territory).toFixed(2)}%`);
    // Update gang members in case someone died in a clash
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    let dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    // First thing: members moved to Territory Warfare for the tick go back to their crimes. Every update spent on warfare forfeits that update's
    // respect/money for the whole gang (Gang.ts processGains reads member.getTask() at each update), so this must not wait for the housekeeping below.
    if (isReadyForNextTerritoryTick) {
        await updateMemberActivities(ns, dictMembers);
        Object.values(dictMembers).forEach(m => m.task = assignedTasks[m.name] ?? m.task); // Keep our copy in step so the call below doesn't re-issue the same orders
        isReadyForNextTerritoryTick = false;
    }
    const canRecruit = await getNsDataThroughFile(ns, 'ns.gang.canRecruitMember()');
    if (canRecruit) {
        await doRecruitMember(ns); // Recruit new members if available
        dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    }
    if (!options['no-auto-ascending']) await tryAscendMembers(ns, myGangInfo, dictMembers); // Ascend members if we deem it a good time
    await tryUpgradeMembers(ns, dictMembers, myGangInfo); // Upgrade members if possible
    await enableOrDisableWarfare(ns, myGangInfo); // Update whether we should be participating in gang warfare
    // There's a chance we do training instead of work for this next tick. The stat trained follows the weights of the gang's reference crime
    // (e.g. Terrorism: 60% combat, 20% hacking, 20% charisma), since those weights are what the respect/money formulas reward.
    const task = Math.random() >= pctTraining ? null : pickTrainingTask(memberWeights(null), Math.random());
    await updateMemberActivities(ns, dictMembers, task); // Set everyone working on the next activity
    if (!task) await optimizeGangCrime(ns, await waitForGameUpdate(ns, myGangInfo));  // Finally, see if we can improve rep gain rates by micro-optimizing individual member crimes
}
```

`waitForGameUpdate`, lines 546-581, old: the whole function including the preceding `let sequentialMisfires = 0;` and its doc comment. new:
```js
let sequentialMisfires = 0;

/** Helper to wait for the game to update stats (typically 2 seconds per cycle)
 * @param {NS} ns
 * @param {GangGenInfo} oldGangInfo
 * @returns {Promise<GangGenInfo>} **/
async function waitForGameUpdate(ns, oldGangInfo) {
    if (!myGangMembers.some(member => !assignedTasks[member].includes("Train")))
        return oldGangInfo; // Ganginfo will never change if all members are training, so don't wait for an update
    await awaitGangUpdate(ns); // Resolves right after the game next processes gang gains (within 2 s, much less in bonus time), keeping the tick counter in step
    const latestGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    if (JSON.stringify(latestGangInfo) != JSON.stringify(oldGangInfo)) {
        sequentialMisfires = 0;
        return latestGangInfo;
    }
    sequentialMisfires++;
    log(ns, `WARNING: Gang info did not change across a gang update.\n${JSON.stringify(oldGangInfo)}\n===\n${JSON.stringify(latestGangInfo)}`,
        false, sequentialMisfires < 2 ? null : 'warning'); // Only pop-up an alert if this happens twice in a row (or more)
    return latestGangInfo;
}
```

- [ ] **Step 6: Checks**

`node --check gangs.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs gangs.js` -> `gangs.js: +[] -[]`
`grep -n "updateInterval\|territoryTickDetected\|territoryNextTick\|territoryTickWaitPadding\|lastLoopTime\|lastTerritoryPower\|disable-next-update\|consecutiveTerritoryDetections" gangs.js` -> no output.
`node --test` -> 140 pass.

- [ ] **Step 7: In-game check**

`run gangs.js --tail` in normal play (no bonus time: the Gang page shows no "bonus time" banner). Expected log sequence: `INFO: Observed a territory tick.` within 20 s, then every 20 s exactly one `Assigned N/M gang member tasks (Territory Warfare)` about 2 s before the next `Territory tick: power ...` line, followed immediately by `Assigned N/M gang member tasks (<crimes>)` (the restore happens before recruiting/ascending/buying). There must be no `Waiting for territory to tick`, `Power stats weren't updated` or `Max wait time` lines, and `Resynchronizing` may appear at most once per several minutes (it means a whole update was missed; the next tick self-corrects). On the Gang page, Power must increase every 20 s and Respect must keep growing between ticks. RAM: `mem gangs.js` unchanged from Task 4.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/gang-logic.js test/gangs-logic.test.js gangs.js && git commit -m "gangs: track territory ticks by counting nextUpdate() cycles, drop the 200 ms polling (GG-3)"`

---

### Task 6: GG-2 - no pre-tick warfare swap in bonus time, housekeeping on a wall-clock timer

Depends on Task 5.

**Files:**
- Modify: `gangs.js`: territory globals (after `lastOtherGangInfo`), `mainLoop`, `onTerritoryTick` (as written in Task 5)

**Interfaces:**
- Produces global `let lastHousekeepingTime = 0`.
- Consumes `getGangCyclesPerUpdate(ns)`, `gangCyclesPerBonusUpdate`, `territoryTickTime`, `onTerritoryTick(ns)`, `updateMemberActivities(ns)`.

- [ ] **Step 1: Add the global**

After the line `let lastOtherGangInfo = null;` add:
```js
let lastHousekeepingTime = 0; // Date.now() of the last onTerritoryTick run (bonus time runs it on a wall-clock timer instead of per tick)
```

- [ ] **Step 2: Bonus-time branch in `mainLoop`**

In `mainLoop`, directly after `const processedCycles = await awaitGangUpdate(ns);` insert:
```js
    if (getGangCyclesPerUpdate(ns) == gangCyclesPerBonusUpdate) {
        // Bonus time (after being offline): 25 cycles per 200 ms update, a territory tick every 800 ms. The pre-tick swap cannot keep up (the
        // housekeeping alone takes seconds, during which the whole gang would sit on Territory Warfare earning nothing, Gang.ts processGains),
        // so leave everyone on their crimes and run the housekeeping on a wall-clock timer. The tick phase is re-observed once bonus time ends.
        if (isReadyForNextTerritoryTick) {
            await updateMemberActivities(ns);
            isReadyForNextTerritoryTick = false;
        }
        if (Date.now() - lastHousekeepingTime >= territoryTickTime) await onTerritoryTick(ns);
        cyclesSinceTerritoryTick = null;
        lastOtherGangInfo = null;
        return;
    }
```

- [ ] **Step 3: Stamp the housekeeping time**

In `onTerritoryTick`, make the first statement:
```js
    lastHousekeepingTime = Date.now();
```
(before `const myGangInfo = ...`).

- [ ] **Step 4: Checks**

`node --check gangs.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs gangs.js` -> `+[] -[]`; `node --test` -> 140 pass (no new pure logic: the decision is `getBonusTime() >= 5000`, already encoded in `getGangCyclesPerUpdate`).

- [ ] **Step 5: In-game check**

Export a save with a gang, wait >= 30 minutes (or use any older export), import it (Options > Import): the game grants the offline cycles, so the Gang page shows a bonus-time banner for several minutes. `run gangs.js --tail` immediately. While the banner is up: no `Assigned ... (Territory Warfare)` line may appear, `Territory tick: power ...` lines come every ~20 s of wall-clock (not every 800 ms), and the Gang page's Respect grows at the accelerated rate continuously. When the banner disappears: `INFO: Observed a territory tick.` appears within 20 s and the Task 5 pattern (swap, tick, restore every 20 s) resumes.

- [ ] **Step 6: Commit (user triggers)**

`git add gangs.js && git commit -m "gangs: keep members on crime through bonus time, housekeeping on a wall-clock timer (GG-2)"`

---

### Task 7: SL-3 - sleeves 5 and 6 default to Infiltrate Synthoids

**Files:**
- Modify: `lib/sleeve-logic.js` (append)
- Modify: `test/sleeve-logic.test.js` (import line + append)
- Modify: `sleeve.js` import line, lines 377-386

**Interfaces:**
- Produces `export function bladeburnerSleeveTasks(enableTeamBuilding: boolean): [string, string?][]` (index = sleeve number).
- Consumes sleeve.js `options['enable-bladeburner-team-building']`; the chaos escalation at line 407 and the cooldown fallback are untouched.

- [ ] **Step 1: Write the failing test**

Import line of `test/sleeve-logic.test.js`:
```js
import { trainingCostPerExp, canAffordTraining, karmaRatePerAttempt, shouldFillWithKarmaHomicide, bladeburnerSleeveTasks } from "../lib/sleeve-logic.js";
```
Append:
```js
// SL-3: each infiltrating sleeve adds sqrt(n)/2 count per minute to EVERY contract and operation (Bladeburner.ts sleeveSupport /
// SleeveInfiltrateWork.ts), worth several rank/min; a stat-1 sleeve on Field Analysis or Diplomacy is worth ~0.2 rank/min or nothing.
test("SL-3: by default only sleeves 1-3 take contracts, everyone else infiltrates", () => {
    const tasks = bladeburnerSleeveTasks(false);
    assert.equal(tasks.length, 8);
    assert.deepEqual(tasks[1], ["Take on contracts", "Retirement"]);
    assert.deepEqual(tasks[2], ["Take on contracts", "Bounty Hunter"]);
    assert.deepEqual(tasks[3], ["Take on contracts", "Tracking"]);
    for (const i of [0, 4, 5, 6, 7]) assert.deepEqual(tasks[i], ["Infiltrate Synthoids"], `sleeve ${i}`);
});

test("SL-3: team building only changes sleeves 0 and 7", () => {
    const tasks = bladeburnerSleeveTasks(true);
    assert.deepEqual(tasks[0], ["Support main sleeve"]);
    assert.deepEqual(tasks[7], ["Recruitment"]);
    for (const i of [4, 5, 6]) assert.deepEqual(tasks[i], ["Infiltrate Synthoids"], `sleeve ${i}`);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/sleeve-logic.test.js` -> SyntaxError: `bladeburnerSleeveTasks` not exported.

- [ ] **Step 3: Implement**

Append to `lib/sleeve-logic.js`:
```js

/** Default bladeburner task per sleeve index. Sleeve 0 may still be used for faction work (unless --disable-follow-player). Each contract type can
 * only be performed by one sleeve at a time (sleeves 1-3). Everyone else infiltrates: each infiltrating sleeve adds sqrt(n)/2 count per minute to
 * every contract and operation (src/Bladeburner/Bladeburner.ts sleeveSupport, SleeveInfiltrateWork.ts), i.e. several rank per minute of
 * Assassination / Stealth Retirement count, far more than a low-stat sleeve's own Field Analysis (0.1 rank per 30 s) or Diplomacy. Chaos-driven
 * Diplomacy is assigned separately (sleeve.js pickSleeveTask escalation by city chaos).
 * @param {boolean} enableTeamBuilding The --enable-bladeburner-team-building option
 * @returns {[string, string?][]} [action, contractName?] by sleeve index */
export function bladeburnerSleeveTasks(enableTeamBuilding) {
    return [
        /*0*/enableTeamBuilding ? ["Support main sleeve"] : ["Infiltrate Synthoids"],
        /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
        /*4*/["Infiltrate Synthoids"], /*5*/["Infiltrate Synthoids"], /*6*/["Infiltrate Synthoids"],
        /*7*/enableTeamBuilding ? ["Recruitment"] : ["Infiltrate Synthoids"],
    ];
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/sleeve-logic.test.js` -> 6 passing.

- [ ] **Step 5: Wire sleeve.js**

Import line, new:
```js
import { canAffordTraining, karmaRatePerAttempt, shouldFillWithKarmaHomicide, bladeburnerSleeveTasks } from './lib/sleeve-logic.js'
```
Lines 377-386, old:
```js
        // Hack: Without paying much attention to what's happening in bladeburner, pre-assign a variety of tasks by sleeve index
        const bbTasks = [
            // Note: Sleeve 0 might still be used for faction work (unless --disable-follow-player is set), so don't assign them a 'unique' task
            /*0*/options['enable-bladeburner-team-building'] ? ["Support main sleeve"] : ["Infiltrate Synthoids"],
            // Note: Each contract type can only be performed by one sleeve at a time (similar to working for factions)
            /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
            // Other bladeburner work can be duplicated, but tackling a variety is probably useful. Overrides occur below
            /*4*/["Infiltrate Synthoids"], /*5*/["Diplomacy"], /*6*/["Field Analysis"],
            /*7*/options['enable-bladeburner-team-building'] ? ["Recruitment"] : ["Infiltrate Synthoids"]
        ];
```
new:
```js
        // Pre-assign tasks by sleeve index (lib/sleeve-logic.js bladeburnerSleeveTasks): contracts for sleeves 1-3, Infiltrate Synthoids for the
        // rest, since every infiltrating sleeve adds contract/operation count for the player. Chaos and cooldown overrides occur below.
        const bbTasks = bladeburnerSleeveTasks(options['enable-bladeburner-team-building']);
```

- [ ] **Step 6: Checks**

`node --check sleeve.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs sleeve.js` -> `+[] -[]`; `node --test` -> 142 pass.

- [ ] **Step 7: In-game check**

Save in bladeburner (SF7, in the division), current city chaos < 40: `run sleeve.js --tail`. Sleeves 4-7 must log `Set sleeve N to Bladeburner Infiltrate Synthoids`; no sleeve logs `Field Analysis`, and `Diplomacy` appears only for sleeve i once the city's chaos exceeds (10 - i) x 10 (e.g. sleeve 7 at chaos > 30). On the Bladeburner page the contract/operation counts must rise faster than before (about +0.1/min each per added infiltrator).

- [ ] **Step 8: Commit (user triggers)**

`git add lib/sleeve-logic.js test/sleeve-logic.test.js sleeve.js && git commit -m "sleeve: sleeves 5 and 6 infiltrate instead of Diplomacy / Field Analysis (SL-3)"`

---

### Task 8: BB-2 - population uncertainty resolved by the best estimate improvement per second, Tracking dropped

Depends on Task 3.

**Files:**
- Modify: `lib/bladeburner-logic.js` (append)
- Modify: `test/bladeburner-logic.test.js` (import line + append)
- Modify: `bladeburner.js` import line, line 185, lines 298-302

**Interfaces:**
- Produces `export function fieldAnalysisEffect(hackingLevel, intelligence, charisma, analysisMult = 1): number` (percent per 30 s action) and `export function rankPopulationActions(candidates: {name, pctPerSuccess, chance, timeMs, count}[]): string[]`.
- Produces in bladeburner.js `async function refreshPlayer(ns): Promise<Player>` (also used by Task 10).
- Consumes bladeburner.js locals `minChance`, `maxChance`, `getCount`, `unreservedActions`, `populationActions`, `candidateActions`, global `player`.

- [ ] **Step 1: Write the failing tests**

Import line of `test/bladeburner-logic.test.js`:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions } from "../lib/bladeburner-logic.js";
```
Append:
```js
// BB-2: estimate improvement per completion (Bladeburner.ts completeOperation / completeAction): Undercover 0.8 % and Investigation 0.4 % per
// success, Field Analysis eff % per 30 s where eff = 0.04*hack^0.3 + 0.04*int^0.9 + 0.02*cha^0.3 (x bladeburner_analysis mult);
// Tracking moves the estimate by an absolute 100-1000 people on a ~1e9 population and is no longer a candidate.
test("BB-2: Field Analysis effectiveness matches Bladeburner.ts", () => {
    assert.ok(Math.abs(fieldAnalysisEffect(1, 1, 1) - 0.1) < 1e-12);
    const expected = 0.04 * Math.pow(1000, 0.3) + 0.04 * Math.pow(50, 0.9) + 0.02 * Math.pow(500, 0.3);
    assert.ok(Math.abs(fieldAnalysisEffect(1000, 50, 500) - expected) < 1e-12);
    assert.ok(Math.abs(fieldAnalysisEffect(1000, 50, 500, 2) - 2 * expected) < 1e-12);
});

test("BB-2: population actions are ranked by expected estimate improvement per second, zero-count actions dropped", () => {
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 0.9, timeMs: 50000, count: 3 }, // 1.44e-5 %/ms
        { name: "Investigation", pctPerSuccess: 0.4, chance: 1, timeMs: 40000, count: 3 },          // 1.0e-5
        { name: "Field Analysis", pctPerSuccess: 0.6, chance: 1, timeMs: 30000, count: Infinity },  // 2.0e-5
    ]), ["Field Analysis", "Undercover Operation", "Investigation"]);
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 1, timeMs: 50000, count: 0 },
        { name: "Field Analysis", pctPerSuccess: 0.1, chance: 1, timeMs: 30000, count: Infinity },
    ]), ["Field Analysis"]);
});

test("BB-2: ties keep the given order (rank-earning operations listed first win)", () => {
    assert.deepEqual(rankPopulationActions([
        { name: "Undercover Operation", pctPerSuccess: 0.8, chance: 1, timeMs: 40000, count: 1 },
        { name: "Field Analysis", pctPerSuccess: 0.8, chance: 1, timeMs: 40000, count: Infinity },
    ]), ["Undercover Operation", "Field Analysis"]);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/bladeburner-logic.test.js` -> SyntaxError: `fieldAnalysisEffect` not exported.

- [ ] **Step 3: Implement**

Append to `lib/bladeburner-logic.js`:
```js

/** Field Analysis improves the current city's population estimate by this percent per 30 s action
 * (src/Bladeburner/Bladeburner.ts completeAction, FieldAnalysis: eff = 0.04*hack^0.3 + 0.04*int^0.9 + 0.02*cha^0.3, x mults.bladeburner_analysis)
 * @param {number} hackingLevel @param {number} intelligence @param {number} charisma @param {number} analysisMult player.mults.bladeburner_analysis */
export function fieldAnalysisEffect(hackingLevel, intelligence, charisma, analysisMult = 1) {
    return (0.04 * Math.pow(hackingLevel, 0.3) + 0.04 * Math.pow(intelligence, 0.9) + 0.02 * Math.pow(charisma, 0.3)) * analysisMult;
}

/** Rank estimate-improving actions by expected improvement per second (pctPerSuccess x chance / time). Actions with no count left are dropped;
 * ties keep the input order, so list the rank-earning operations first.
 * @param {{name: string, pctPerSuccess: number, chance: number, timeMs: number, count: number}[]} candidates
 * @returns {string[]} Action names, best first */
export function rankPopulationActions(candidates) {
    return candidates
        .map((c, i) => ({ i, name: c.name, rate: c.count > 0 && c.timeMs > 0 ? c.pctPerSuccess * Math.min(1, Math.max(0, c.chance)) / c.timeMs : -1 }))
        .filter(c => c.rate >= 0)
        .sort((a, b) => b.rate - a.rate || a.i - b.i)
        .map(c => c.name);
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/bladeburner-logic.test.js` -> 5 passing.

- [ ] **Step 5: Wire bladeburner.js**

Import line, new:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions } from './lib/bladeburner-logic.js'
```

After the `getBBDictByActionType` helper (line 111-112) add:
```js
/** @param {NS} ns
 * Refresh the cached player object (used for Field Analysis effectiveness and Diplomacy rate, which depend on current skills) */
async function refreshPlayer(ns) { return player = await getNsDataThroughFile(ns, 'ns.getPlayer()'); }
```

Line 185, old:
```js
    const populationActions = ["Undercover Operation", "Investigation", "Tracking"];
```
new:
```js
    // Actions that improve the population estimate by a percentage (Bladeburner.ts: Undercover 0.8 %, Investigation 0.4 % per success). Tracking
    // only moves it by 100-1000 people (improvePopulationEstimateByCount) on a ~1e9 population and is useless for this. Field Analysis is added
    // in the uncertain branch below since it is a general action (never reserved, unlimited count).
    const populationActions = ["Undercover Operation", "Investigation"];
```

Lines 298-302, old:
```js
        // If current population uncertainty is such that some actions have a maxChance of ~100%, but not a minChance of ~100%,
        //   focus on actions that improve the population estimate, otherwise, reserve these actions for later
        // TODO: "Field Analysis" is the only population action that scales with player stats, so we should calculate and sort by
        //       "effectiveness per second" of each and see which is the most worthwhile way of improving the population estimate.
        candidateActions = populationUncertain ? populationActions : unreservedActions;
```
new:
```js
        // If current population uncertainty is such that some actions have a maxChance above threshold, but not a minChance, focus on the action
        // that improves the population estimate fastest (expected % per second, lib/bladeburner-logic.js rankPopulationActions); otherwise,
        // reserve the population actions for later
        if (populationUncertain) {
            await refreshPlayer(ns); // Field Analysis effectiveness depends on current hacking / intelligence / charisma
            const popActionTimes = await getNsDataThroughFile(ns,
                'Object.fromEntries(JSON.parse(ns.args[0]).map(([t, n]) => [n, ns.bladeburner.getActionTime(t, n)]))',
                '/Temp/bladeburner-population-action-times.txt',
                [JSON.stringify([["Operations", "Undercover Operation"], ["Operations", "Investigation"], ["General", "Field Analysis"]])]);
            const expectedChance = a => (minChance(a) + maxChance(a)) / 2;
            candidateActions = rankPopulationActions([
                { name: "Undercover Operation", pctPerSuccess: 0.8, chance: expectedChance("Undercover Operation"), timeMs: popActionTimes["Undercover Operation"], count: getCount("Undercover Operation") },
                { name: "Investigation", pctPerSuccess: 0.4, chance: expectedChance("Investigation"), timeMs: popActionTimes["Investigation"], count: getCount("Investigation") },
                { name: "Field Analysis", pctPerSuccess: fieldAnalysisEffect(player.skills.hacking, player.skills.intelligence, player.skills.charisma, player.mults.bladeburner_analysis), chance: 1, timeMs: popActionTimes["Field Analysis"], count: Number.POSITIVE_INFINITY },
            ]);
        } else
            candidateActions = unreservedActions;
```
The loop that follows (`for (const a of candidateActions.filter(a => getCount(a) >= 1))` with `chanceFn = maxChance`) is unchanged: it takes the first ranked action whose max chance meets the threshold (Field Analysis, a general action, always does), so the `if (populationUncertain) { bestActionName = "Field Analysis" ... }` fallback at line 327-329 becomes unreachable but is left in place.

- [ ] **Step 6: Checks**

`node --check bladeburner.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs bladeburner.js` -> `bladeburner.js: +[hacking={] -[]` (namespace key from `player.skills.hacking`, 0 GB; sleeve.js carries the same at HEAD). Anything else listed must be renamed.
`node --test` -> 145 pass.

- [ ] **Step 7: In-game check**

`run bladeburner.js --tail`. When the log shows an operation with a range (`Success Chance: 80.0% to 96.0%`) the next `Switched to Bladeburner ...` must be `Operations "Undercover Operation"`, `Operations "Investigation"` or `General "Field Analysis"` - never `Contracts "Tracking"` - and the range must narrow over the next few completions until a single value is shown. `mem bladeburner.js` unchanged from Task 3 (the `hacking` property costs nothing).

- [ ] **Step 8: Commit (user triggers)**

`git add lib/bladeburner-logic.js test/bladeburner-logic.test.js bladeburner.js && git commit -m "bladeburner: resolve population uncertainty by improvement per second, drop Tracking (BB-2)"`

---

### Task 9: GG-4 - retrain after ascension until the task-weighted stats recover

Depends on Tasks 4 and 5.

**Files:**
- Modify: `lib/gang-logic.js` (append)
- Modify: `test/gangs-logic.test.js` (import line + append)
- Modify: `gangs.js` import line, line 66 (`min-training-ticks`), line 43 (`lastMemberReset`), `doRecruitMember`, `tryAscendMembers` (ascension guard + reset line), `optimizeGangCrime` lines 302-303 and 355-358, and the two `doRecruitMember` call sites (`initialize` line 200, `onTerritoryTick`)

**Interfaces:**
- Produces `export function retrainTargetFor(preWeightedStat: number, recoveryFraction: number): number|null` and `export function needsRetraining(currentWeightedStat: number, target: number|null): boolean`.
- Produces in gangs.js global `let retrainTarget = {}` (member name -> target or null) and `async function doRecruitMember(ns, dictMembers = null)`.
- Consumes `weightedStat`, `memberWeights`, `pickTrainingTask` (Task 4).

- [ ] **Step 1: Write the failing tests**

Import line of `test/gangs-logic.test.js`:
```js
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedStat, weightedAscensionGain, pickTrainingTask, missedGangCycles, nextUpdateHasTerritoryTick, retrainTargetFor, needsRetraining } from "../lib/gang-logic.js";
```
Append:
```js
// GG-4: ascension zeroes exp and clears equipment (GangMember.ts ascend), so the member restarts at skill ~= its ascension multiplier. Train until
// the task-weighted, equipment-stripped stat is back to a fraction of its pre-ascension value instead of a blind 200 s.
test("GG-4: retraining lasts until the equipment-stripped weighted stat recovers the configured fraction", () => {
    const w = taskStatWeights(terrorism);
    const before = { hack: 50, str: 1000, def: 1000, dex: 1000, agi: 1000, cha: 50, hack_mult: 1, str_mult: 2, def_mult: 2, dex_mult: 2, agi_mult: 2, cha_mult: 1 };
    const target = retrainTargetFor(weightedStat(before, w, true), 0.9); // 0.9 * 0.2 * (50 + 3 * 500 + 50) = 288
    assert.ok(Math.abs(target - 288) < 1e-9);
    const noMults = { hack_mult: 1, str_mult: 1, def_mult: 1, dex_mult: 1, agi_mult: 1, cha_mult: 1 };
    const justAscended = { hack: 7, str: 7, def: 7, dex: 7, agi: 7, cha: 7, ...noMults };
    assert.equal(needsRetraining(weightedStat(justAscended, w, true), target), true);
    const nearlyThere = { hack: 7, str: 470, def: 470, dex: 470, agi: 470, cha: 7, ...noMults }; // 0.2 * (7 + 1410 + 7) = 284.8
    assert.equal(needsRetraining(weightedStat(nearlyThere, w, true), target), true);
    const recovered = { hack: 7, str: 480, def: 480, dex: 480, agi: 480, cha: 7, ...noMults };  // 0.2 * (7 + 1440 + 7) = 290.8
    assert.equal(needsRetraining(weightedStat(recovered, w, true), target), false);
});

test("GG-4: no target means no gate; a zero fraction disables it", () => {
    assert.equal(retrainTargetFor(0, 0.9), null);
    assert.equal(retrainTargetFor(620, 0), null);
    assert.equal(needsRetraining(5, null), false);
    assert.equal(needsRetraining(5, 4), false);
    assert.equal(needsRetraining(3, 4), true);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/gangs-logic.test.js` -> SyntaxError: `retrainTargetFor` not exported.

- [ ] **Step 3: Implement**

Append to `lib/gang-logic.js`:
```js

/** @param {number} preWeightedStat The member's task-weighted, equipment-stripped stat before the ascension (weightedStat(..., true))
 * @param {number} recoveryFraction The --retrain-recovery-fraction option
 * @returns {number|null} The weighted stat to train back up to, or null for no gate */
export function retrainTargetFor(preWeightedStat, recoveryFraction) {
    return preWeightedStat > 0 && recoveryFraction > 0 ? preWeightedStat * recoveryFraction : null;
}

/** @returns {boolean} Whether the member must keep training to reach its retrain target */
export function needsRetraining(currentWeightedStat, target) {
    return target != null && currentWeightedStat < target;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/gangs-logic.test.js` -> 10 passing.

- [ ] **Step 5: Wire gangs.js**

Import line, new:
```js
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedStat, weightedAscensionGain, pickTrainingTask, missedGangCycles, nextUpdateHasTerritoryTick, retrainTargetFor, needsRetraining } from './lib/gang-logic.js'
```

Line 43, old:
```js
let lastMemberReset = {}; // Tracks when each member last ascended
```
new:
```js
let retrainTarget = {}; // Member -> task-weighted, equipment-stripped stat to train back up to after an ascension / recruit (null = no gate), see needsRetraining
```

Line 61 (comment only), old:
```js
    ['no-training', false], // Don't train unless all other tasks generate no gains or the member ascended recently (--min-training-ticks)
```
new:
```js
    ['no-training', false], // Don't train unless all other tasks generate no gains or the member is rebuilding after an ascension / recruit (--retrain-recovery-fraction)
```

Line 66, old:
```js
    ['min-training-ticks', 10], // Require this many ticks of training after ascending or recruiting to rebuild stats
```
new:
```js
    ['retrain-recovery-fraction', 0.9], // After ascending, keep a member training until its task-weighted stats (equipment excluded) recover this fraction of their pre-ascension value; recruits train until they reach this fraction of the weakest existing member. Members still retraining are not ascended again. 0 to disable.
```

`doRecruitMember`, lines 414-428, old:
```js
/** @param {NS} ns
 * Recruit new members if available **/
async function doRecruitMember(ns) {
    let i = 0, newMemberName;
    do { newMemberName = `Thug ${++i}`; } while (myGangMembers.includes(newMemberName) || myGangMembers.includes(newMemberName + " Understudy"));
    if (i < myGangMembers.length) newMemberName += " Understudy"; // Pay our respects to the deceased
    if (await getNsDataThroughFile(ns, `ns.gang.canRecruitMember() && ns.gang.recruitMember(ns.args[0])`, '/Temp/gang-recruit-member.txt', [newMemberName])) {
        myGangMembers.push(newMemberName);
        assignedTasks[newMemberName] = pickTrainingTask(memberWeights(null));
        lastMemberReset[newMemberName] = Date.now();
        log(ns, `SUCCESS: Recruited a new gang member "${newMemberName}"!`, false, 'success');
    } else {
        log(ns, `ERROR: Failed to recruit a new gang member "${newMemberName}"!`, false, 'error');
    }
}
```
new:
```js
/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}|null} dictMembers Current members (used to size the recruit's training target)
 * Recruit new members if available **/
async function doRecruitMember(ns, dictMembers = null) {
    let i = 0, newMemberName;
    do { newMemberName = `Thug ${++i}`; } while (myGangMembers.includes(newMemberName) || myGangMembers.includes(newMemberName + " Understudy"));
    if (i < myGangMembers.length) newMemberName += " Understudy"; // Pay our respects to the deceased
    if (await getNsDataThroughFile(ns, `ns.gang.canRecruitMember() && ns.gang.recruitMember(ns.args[0])`, '/Temp/gang-recruit-member.txt', [newMemberName])) {
        myGangMembers.push(newMemberName);
        assignedTasks[newMemberName] = pickTrainingTask(memberWeights(null));
        // Train the recruit until it catches up with the weakest existing member (task-weighted, equipment excluded)
        const weakest = Math.min(...Object.values(dictMembers ?? {}).map(m => weightedStat(m, memberWeights(m.name), true)));
        retrainTarget[newMemberName] = Number.isFinite(weakest) ? retrainTargetFor(weakest, options['retrain-recovery-fraction']) : null;
        log(ns, `SUCCESS: Recruited a new gang member "${newMemberName}"!` + (retrainTarget[newMemberName] ? ` Training until task-weighted stats reach ${retrainTarget[newMemberName].toFixed(0)}.` : ''), false, 'success');
    } else {
        log(ns, `ERROR: Failed to recruit a new gang member "${newMemberName}"!`, false, 'error');
    }
}
```
Call sites: in `initialize`, old `    while (myGangMembers.length < 3) await doRecruitMember(ns); // We should be able to recruit our first three members immediately (for free)` -> new `    while (myGangMembers.length < 3) await doRecruitMember(ns, dictMembers); // We should be able to recruit our first three members immediately (for free)`. In `onTerritoryTick`, old `        await doRecruitMember(ns); // Recruit new members if available` -> new `        await doRecruitMember(ns, dictMembers); // Recruit new members if available`.

`tryAscendMembers`: after `        const weights = memberWeights(member);` and before `        const ascGain = ...` insert:
```js
        // Still rebuilding from the last ascension / recruit: ascending again now would compound the exp loss (GangMember.ts ascend zeroes all exp)
        if (needsRetraining(weightedStat(dictMembers[member], weights, true), retrainTarget[member])) continue;
```
and replace `            lastMemberReset[member] = Date.now();` with:
```js
            retrainTarget[member] = retrainTargetFor(weightedStat(dictMembers[member], weights, true), options['retrain-recovery-fraction']); // Pre-ascension value (dictMembers predates the ascend)
```

`optimizeGangCrime`, line 303, old:
```js
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
```
new:
```js
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    // Members that have recovered their pre-ascension stats (task-weighted, equipment excluded) may leave training
    for (const member of myGangMembers)
        if (retrainTarget[member] != null && !needsRetraining(weightedStat(dictMembers[member], memberWeights(member), true), retrainTarget[member])) {
            log(ns, `INFO: ${member} has recovered its pre-ascension stats (task-weighted ${retrainTarget[member].toFixed(0)}). Returning to crime.`);
            delete retrainTarget[member];
        }
```
Lines 355-358, old:
```js
            // Find the crime with the best gain (If we can't generate value for any tasks, then we should only be training)
            const bestTask = taskRates[0][optStat] == 0 || (Date.now() - (lastMemberReset[member] || 0) < options['min-training-ticks'] * territoryTickTime) ?
                taskRates.find(t => t.name === ("Train " + (isHackGang ? "Hacking" : "Combat"))) :
                (totalWanted > wantedGainTolerance || sustainableTasks.length == 0) ? taskRates.find(t => t.name === strWantedReduction) : sustainableTasks[0];
```
new:
```js
            // Find the crime with the best gain (If we can't generate value for any tasks, or the member is still rebuilding stats after an
            // ascension / recruit (retrainTarget), then we should only be training the stats its task weights most)
            const bestTask = taskRates[0][optStat] == 0 || retrainTarget[member] != null ?
                taskRates.find(t => t.name === pickTrainingTask(memberWeights(member))) :
                (totalWanted > wantedGainTolerance || sustainableTasks.length == 0) ? taskRates.find(t => t.name === strWantedReduction) : sustainableTasks[0];
```
Line 553 in `waitForGameUpdate` (`assignedTasks[member].includes("Train")`) still matches all three training tasks - no change.

- [ ] **Step 6: Checks**

`node --check gangs.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs gangs.js` -> `+[] -[]`; `grep -n "lastMemberReset\|min-training-ticks" gangs.js` -> no output; `node --test` -> 147 pass.

- [ ] **Step 7: In-game check**

`run gangs.js --tail` with a gang that ascends (e.g. `--ascend-multi-threshold 1.02` to force one soon). After `SUCCESS: Ascended member Thug N: ...`, that member must stay on `Train Combat` (or Hacking/Charisma per the weights) through the following optimizations (`Optimized gang member crimes` lines) and must not appear in another `Ascended` line until `INFO: Thug N has recovered its pre-ascension stats (task-weighted ...). Returning to crime.` is logged, typically 4-12 minutes later; on the Gang page its Str/Def/Dex should be within ~10 % of their pre-ascension values (minus equipment) at that moment. A new recruit logs `Training until task-weighted stats reach X` and stays on training until it matches the weakest member.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/gang-logic.js test/gangs-logic.test.js gangs.js && git commit -m "gangs: retrain after ascension until task-weighted stats recover (GG-4)"`

---

### Task 10: BB-3 - Diplomacy when every city is above the chaos cliff, lower Stealth Retirement gate

Depends on Task 8 (`refreshPlayer`).

**Files:**
- Modify: `lib/bladeburner-logic.js` (append)
- Modify: `test/bladeburner-logic.test.js` (import line + append)
- Modify: `bladeburner.js` import line, argsSchema (new option after `max-chaos`), lines 228-237 (city selection: hoist the acceptable-city list), 281-288 (action selection chain)

**Interfaces:**
- Produces `export function chaosDifficultyMult(chaos, chaosThreshold = 50): number`, `export function diplomacyPctPerMinute(charisma): number`, `export function diplomacyMinutesTo(chaos, target, charisma): number`, `export function shouldRunDiplomacy(chaos, chaosThreshold, charisma, expectedStayMinutes): boolean`.
- Produces in bladeburner.js local `const citiesWithinChaos` in `mainLoop`.
- Consumes `refreshPlayer(ns)`, `chaosByCity`, `currentCity`, `antiChaosOperation`, `getCount`, `minChance`.

- [ ] **Step 1: Write the failing tests**

Import line of `test/bladeburner-logic.test.js`:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyPctPerMinute, diplomacyMinutesTo, shouldRunDiplomacy } from "../lib/bladeburner-logic.js";
```
Append:
```js
// BB-3: chaos above 50 multiplies action difficulty by sqrt(1 + chaos - 50) (Action.ts getChaosSuccessFactor) - a cliff, not a slope to
// --max-chaos. Diplomacy removes cha^0.045 + cha/1000 percent of the current city's chaos per 60 s (Bladeburner.ts getDiplomacyPercentage,
// City.ts changeChaosByPercentage: chaos *= 1 + p/100).
test("BB-3: chaos penalty is a cliff at 50", () => {
    assert.equal(chaosDifficultyMult(50), 1);
    assert.equal(chaosDifficultyMult(0), 1);
    assert.ok(Math.abs(chaosDifficultyMult(51) - Math.SQRT2) < 1e-12);
    assert.ok(Math.abs(chaosDifficultyMult(100) - Math.sqrt(51)) < 1e-12);
});

test("BB-3: diplomacy rate and time to reach the threshold", () => {
    assert.ok(Math.abs(diplomacyPctPerMinute(500) - (Math.pow(500, 0.045) + 0.5)) < 1e-12); // ~1.82 %/min
    assert.equal(diplomacyMinutesTo(40, 50, 500), 0);
    const minutes = diplomacyMinutesTo(60, 50, 500);
    assert.ok(minutes > 9 && minutes < 11, `expected ~10 minutes, got ${minutes}`);
});

test("BB-3: Diplomacy beats working under the penalty over an hour's stay, never at or below the threshold, not for a short stay", () => {
    assert.equal(shouldRunDiplomacy(60, 50, 500, 60), true);  // ~10 min of Diplomacy vs ~42 min-equivalents of rank lost
    assert.equal(shouldRunDiplomacy(51, 50, 100, 60), true);  // ~1.5 min vs ~17.6
    assert.equal(shouldRunDiplomacy(50, 50, 500, 60), false);
    assert.equal(shouldRunDiplomacy(60, 50, 500, 5), false);  // 9.9 min > 5 * 0.70
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/bladeburner-logic.test.js` -> SyntaxError: `chaosDifficultyMult` not exported.

- [ ] **Step 3: Implement**

Append to `lib/bladeburner-logic.js`:
```js

/** Chaos above the threshold multiplies action difficulty (src/Bladeburner/Actions/Action.ts getChaosSuccessFactor: sqrt(1 + chaos - 50)) */
export function chaosDifficultyMult(chaos, chaosThreshold = 50) {
    return chaos > chaosThreshold ? Math.sqrt(1 + chaos - chaosThreshold) : 1;
}

/** Diplomacy lowers the current city's chaos by this percent per 60 s action (Bladeburner.ts getDiplomacyPercentage: cha^0.045 + cha/1000) */
export function diplomacyPctPerMinute(charisma) {
    return Math.pow(charisma, 0.045) + charisma / 1000;
}

/** Minutes of Diplomacy needed to bring chaos down to target (each action: chaos *= 1 - pct/100, City.ts changeChaosByPercentage) */
export function diplomacyMinutesTo(chaos, target, charisma) {
    if (chaos <= target) return 0;
    return Math.log(chaos / target) / -Math.log(1 - diplomacyPctPerMinute(charisma) / 100);
}

/** Run Diplomacy when it pays for itself: the time it takes to get back under the threshold is less than the rank-time the penalty would waste
 * over the expected stay. With chance divided by mult, the level model (bladeburner.js getTargetLevel) loses at least the fraction 1 - 1/mult of
 * the rank rate (the real loss is larger: levels drop by log(mult)/log(difficultyFac) and reward with them), so this is a conservative test. */
export function shouldRunDiplomacy(chaos, chaosThreshold, charisma, expectedStayMinutes) {
    if (chaos <= chaosThreshold) return false;
    const lostFraction = 1 - 1 / chaosDifficultyMult(chaos, chaosThreshold);
    return diplomacyMinutesTo(chaos, chaosThreshold, charisma) < expectedStayMinutes * lostFraction;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/bladeburner-logic.test.js` -> 8 passing.

- [ ] **Step 5: Wire bladeburner.js**

Import line, new:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyMinutesTo, shouldRunDiplomacy } from './lib/bladeburner-logic.js'
```

argsSchema, after line 47 (`['max-chaos', 100], ...`) add:
```js
    ['chaos-diplomacy-horizon-minutes', 60], // When every city is above --chaos-recovery-threshold and no Stealth Retirement is available, run Diplomacy if it pays for itself over this expected stay (lib/bladeburner-logic.js shouldRunDiplomacy)
```

Lines 228-237, old:
```js
    // GENERAL CASE: GO TO HIGHEST-POPULATION CITY
    if (!goToCity) { // Otherwise, cities with higher populations give better operation chances
        // Try to narrow down the cities we wish to work in to the ones with no chaos penalties
        let acceptableCities = cityNames.filter(city => chaosByCity[city] <= options['chaos-recovery-threshold']);
        // Pick the city (within chaos thresholds) with the highest population to maximize success chance.
        // If no city is within thresholds, the largest population city will be picked regardless of chaos
        [goToCity, population] = getMaxKeyValue(populationByCity, acceptableCities.length > 0 ? acceptableCities : cityNames);
        travelReason = `Highest population (${formatNumberShort(population)}) city, with chaos ${chaosByCity[goToCity].toFixed(1)}` +
            (acceptableCities.length == 0 ? ` (all cities above chaos threshold of ${options['chaos-recovery-threshold']})` : '');
    }
```
new:
```js
    // GENERAL CASE: GO TO HIGHEST-POPULATION CITY
    // Cities with no chaos penalty (chaos above --chaos-recovery-threshold multiplies action difficulty by sqrt(1 + chaos - 50), Action.ts getChaosSuccessFactor)
    const citiesWithinChaos = cityNames.filter(city => chaosByCity[city] <= options['chaos-recovery-threshold']);
    if (!goToCity) { // Otherwise, cities with higher populations give better operation chances
        // Pick the city (within chaos thresholds) with the highest population to maximize success chance.
        // If no city is within thresholds, the largest population city will be picked regardless of chaos (and Diplomacy considered below)
        [goToCity, population] = getMaxKeyValue(populationByCity, citiesWithinChaos.length > 0 ? citiesWithinChaos : cityNames);
        travelReason = `Highest population (${formatNumberShort(population)}) city, with chaos ${chaosByCity[goToCity].toFixed(1)}` +
            (citiesWithinChaos.length == 0 ? ` (all cities above chaos threshold of ${options['chaos-recovery-threshold']})` : '');
    }
```

Lines 281-288, old:
```js
    } // If current city chaos is greater than our threshold, keep it low with "Stealth Retirement" if odds are good
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.99) {
        bestActionName = antiChaosOperation;
        reason = `Chaos is high: ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} (--chaos-recovery-threshold) ${actionSummaryString(bestActionName)}`;
    } // If current city chaos is very high, we should be very wary of the snowballing effects, and try to reduce it.
    else if (chaosByCity[currentCity] > options['max-chaos']) {
        bestActionName = getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.8 ? antiChaosOperation : "Diplomacy";
        reason = `Out of ${antiChaosOperation}s, and chaos ${chaosByCity[currentCity].toFixed(2)} is higher than --max-chaos ${options['max-chaos']}`;
    }
```
new:
```js
    } // If current city chaos is greater than our threshold, keep it low with "Stealth Retirement" if odds are good. Above the threshold every
    // action already runs at 1/sqrt(1 + chaos - 50) of its chance, so the normal --success-threshold is the right gate here, not 99%.
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > options['success-threshold']) {
        bestActionName = antiChaosOperation;
        reason = `Chaos is high: ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} (--chaos-recovery-threshold) ${actionSummaryString(bestActionName)}`;
    } // No Stealth Retirement to spend and no city under the threshold to move to: the penalty is a cliff at 50 (x1.41 at 51, x7 at 100), so spend
    // Diplomacy time now if it pays for itself over the expected stay (lib/bladeburner-logic.js shouldRunDiplomacy)
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && citiesWithinChaos.length == 0 &&
        shouldRunDiplomacy(chaosByCity[currentCity], options['chaos-recovery-threshold'], (await refreshPlayer(ns)).skills.charisma, options['chaos-diplomacy-horizon-minutes'])) {
        bestActionName = "Diplomacy";
        reason = `Chaos ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} in every city (x${chaosDifficultyMult(chaosByCity[currentCity], options['chaos-recovery-threshold']).toFixed(2)} difficulty); ` +
            `Diplomacy at charisma ${player.skills.charisma} needs ~${formatDuration(60000 * diplomacyMinutesTo(chaosByCity[currentCity], options['chaos-recovery-threshold'], player.skills.charisma))}`;
    } // If current city chaos is very high, we should be very wary of the snowballing effects, and try to reduce it.
    else if (chaosByCity[currentCity] > options['max-chaos']) {
        bestActionName = getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.8 ? antiChaosOperation : "Diplomacy";
        reason = `Out of ${antiChaosOperation}s, and chaos ${chaosByCity[currentCity].toFixed(2)} is higher than --max-chaos ${options['max-chaos']}`;
    }
```

- [ ] **Step 6: Checks**

`node --check bladeburner.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs bladeburner.js` -> `bladeburner.js: +[hacking={] -[]` (same as Task 8; nothing new); `grep -n "acceptableCities" bladeburner.js` -> no output; `node --test` -> 150 pass.

- [ ] **Step 7: In-game check**

`run bladeburner.js --chaos-recovery-threshold 5 --tail` on a save where every city has chaos > 5 (normal mid-game saves do; check the Bladeburner page): the log must show `Switched to Bladeburner General "Diplomacy" (Chaos X > 5 in every city (x... difficulty); Diplomacy at charisma N needs ~...)` and the current city's chaos must fall by about `cha^0.045 + cha/1000` percent per minute until it is <= 5, after which contracts/operations resume. With the real default (50) the branch only fires once all six cities exceed 50 (long runs); the Stealth Retirement change is visible whenever chaos > 50 in the current city: `Chaos is high: ... Stealth Retirement Operation Success Chance: 9x.x%` is now started at chances between 90 % and 99 %.

- [ ] **Step 8: Commit (user triggers)**

`git add lib/bladeburner-logic.js test/bladeburner-logic.test.js bladeburner.js && git commit -m "bladeburner: Diplomacy when every city is past the chaos cliff, 90% Stealth Retirement gate (BB-3)"`

---

### Task 11: BB-4 - bulk skill purchases, cached max levels, `nextUpdate()` pacing

**Files:**
- Modify: `lib/bladeburner-logic.js` (append)
- Modify: `test/bladeburner-logic.test.js` (import line + append)
- Modify: `bladeburner.js` import line, lines 33 (globals), 93-94 (main loop sleep), 253-258 (max levels), 433-461 (`spendSkillPoints`)

**Interfaces:**
- Produces `export function planSkillUpgradeCount(costForOne, costForTwo, adjustment, nextBestPerceivedCost, unspent, maxCount = Infinity): number`.
- Produces in bladeburner.js globals `cachedMaxLevels`, `maxLevelsRank`.
- Consumes `getBBInfo`, `getBBDict`, `getMinKeyValue`, `skillNames`, `costAdjustments`, `ns.bladeburner.nextUpdate()` (0 GB), `ns.bladeburner.getSkillUpgradeCost(name, count)` and `upgradeSkill(name, count)` (src/NetscriptFunctions/Bladeburner.ts:241-259).

- [ ] **Step 1: Write the failing test**

Import line of `test/bladeburner-logic.test.js`:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyPctPerMinute, diplomacyMinutesTo, shouldRunDiplomacy, planSkillUpgradeCount } from "../lib/bladeburner-logic.js";
```
Append:
```js
// BB-4: Skill.ts calculateCost is linear in level (baseCost + costInc * level, x BitNode mult), so the per-level increment is
// costForTwo - 2 * costForOne. Cloak at level 10: cost for one 13, for two 27 (increment ~1.1, rounded).
test("BB-4: bulk count stops at the perceived-cost crossover, at affordability, and at max level", () => {
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 1000), 8);      // levels 11..18 cost 14..21, x1.5 stays <= 30 up to 20 (8 levels)
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 50), 3);        // 13 + 14 + 15 = 42 <= 50, +16 would exceed
    assert.equal(planSkillUpgradeCount(13, 27, 1.5, 30, 1000, 2), 2);   // max level cap (Overclock 90)
    assert.equal(planSkillUpgradeCount(13, 27, 1, 100, 12), 0);         // cannot afford even one
    assert.equal(planSkillUpgradeCount(13, 27, 1, Infinity, 100), 6);   // no competing skill: 13+14+15+16+17+18 = 93
    assert.equal(planSkillUpgradeCount(13, 26, 1, 13, 39), 3);          // flat cost (rounding hid the increment): 3 x 13
    assert.equal(planSkillUpgradeCount(0, 0, 1, 10, 10), 0);            // unusable cost (null/Infinity from the API become 0/Infinity)
});
```

- [ ] **Step 2: Run, expect failure**

`node --test test/bladeburner-logic.test.js` -> SyntaxError: `planSkillUpgradeCount` not exported.

- [ ] **Step 3: Implement**

Append to `lib/bladeburner-logic.js`:
```js

/** How many levels of the chosen skill to buy at once. The cost of the next level grows linearly (src/Bladeburner/Skill.ts calculateCost:
 * baseCost + costInc * level, times the BitNode multiplier), so the per-level increment is recovered from the API cost of one and of two levels.
 * Keep buying while the next level's perceived cost (x adjustment) is still no worse than the best other skill's perceived cost, and it is affordable.
 * @param {number} costForOne ns.bladeburner.getSkillUpgradeCost(name, 1)
 * @param {number} costForTwo ns.bladeburner.getSkillUpgradeCost(name, 2)
 * @param {number} adjustment The skill's costAdjustments factor
 * @param {number} nextBestPerceivedCost The lowest perceived cost among the other skills (Infinity if none)
 * @param {number} unspent Skill points available
 * @param {number} maxCount Levels left before the skill's max level
 * @returns {number} Levels to buy (0 = none) */
export function planSkillUpgradeCount(costForOne, costForTwo, adjustment, nextBestPerceivedCost, unspent, maxCount = Infinity) {
    if (!(costForOne > 0) || costForOne > unspent) return 0;
    const increment = Math.max(0, costForTwo - 2 * costForOne);
    let count = 1, total = costForOne;
    while (count < maxCount) {
        const marginal = costForOne + count * increment;
        if (marginal * adjustment > nextBestPerceivedCost || total + marginal > unspent) break;
        total += marginal;
        count++;
    }
    return count;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test test/bladeburner-logic.test.js` -> 9 passing.

- [ ] **Step 5: Wire bladeburner.js**

Import line, new:
```js
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyMinutesTo, shouldRunDiplomacy, planSkillUpgradeCount } from './lib/bladeburner-logic.js'
```

Line 33, old:
```js
let skillNames, generalActionNames, contractNames, operationNames, remainingBlackOpsNames, blackOpsRanks;
```
new:
```js
let skillNames, generalActionNames, contractNames, operationNames, remainingBlackOpsNames, blackOpsRanks; // blackOpsRanks is fetched once at startup (gatherBladeburnerInfo)
let cachedMaxLevels = {}, maxLevelsRank = -1; // Action max levels only rise on a success (Bladeburner.ts completeAction), which also changes rank: refetched when rank changes
```

Lines 93-94, old:
```js
        const nextTaskComplete = currentTaskEndTime - Date.now();
        await ns.sleep(Math.min(options['update-interval'], nextTaskComplete > 0 ? nextTaskComplete : Number.MAX_VALUE));
```
new:
```js
        const nextTaskComplete = currentTaskEndTime - Date.now();
        await ns.sleep(Math.min(options['update-interval'], nextTaskComplete > 0 ? nextTaskComplete : Number.MAX_VALUE));
        // Re-read state right after the next bladeburner tick (1 s, faster in bonus time) rather than mid-tick. 0 GB (RamCostGenerator.ts CycleTiming).
        try { await ns.bladeburner.nextUpdate(); } catch { /* Not in bladeburner (yet); mainLoop reports it */ }
```

Lines 253-258, old:
```js
    // Gather current/max levels of levelable actions so we can tune them to meet our success threshold (4 GB each, ram-dodged)
    let currentLevels = {}, maxLevels = {};
    if (!options['disable-action-leveling']) {
        currentLevels = { ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Operations", operationNames) };
        maxLevels = { ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Operations", operationNames) };
    }
```
new:
```js
    // Gather current/max levels of levelable actions so we can tune them to meet our success threshold (4 GB each, ram-dodged).
    // Max levels only change on a successful action (Bladeburner.ts completeAction), which also changes rank, so they are cached until rank moves.
    let currentLevels = {}, maxLevels = {};
    if (!options['disable-action-leveling']) {
        currentLevels = { ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Operations", operationNames) };
        if (rank != maxLevelsRank) {
            cachedMaxLevels = { ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Operations", operationNames) };
            maxLevelsRank = rank;
        }
        maxLevels = cachedMaxLevels;
    }
```

`spendSkillPoints`, lines 433-461, old: the whole function. new:
```js
/** @param {NS} ns
 * Decides how to spend skill points. */
async function spendSkillPoints(ns) {
    while (true) { // Loop until we determine there's nothing left to spend skill points on
        const unspent = await getBBInfo(ns, 'getSkillPoints()');
        if (unspent == 0) return;
        const skillLevels = await getBBDict(ns, 'getSkillLevel(%)', skillNames);
        const skillCosts = await getBBDict(ns, 'getSkillUpgradeCost(%)', skillNames);
        // Perceived cost of the next level of each skill (costAdjustments tweak the priority). The API returns null/Infinity for a maxed skill.
        const perceivedCostOf = skillName => (skillName === "Overclock" && skillLevels[skillName] >= 90) ? Number.POSITIVE_INFINITY :
            (skillCosts[skillName] ?? Number.POSITIVE_INFINITY) * (costAdjustments[skillName] || 1);
        const [skillToUpgrade, minPercievedCost] = getMinKeyValue(Object.fromEntries(skillNames.map(s => [s, perceivedCostOf(s)])));
        // If the percieved or actual cost of the next best upgrade is too high, save our remaining points for later
        if (skillToUpgrade == null || minPercievedCost > unspent || skillCosts[skillToUpgrade] > unspent) return;
        // Buy in bulk: getSkillUpgradeCost(name, count) / upgradeSkill(name, count) take a count (closed-form cost, src/Bladeburner/Skill.ts calculateCost).
        // Keep buying levels of this skill while its perceived cost stays below the next best skill's, and we can afford them.
        const costForTwo = await getBBInfo(ns, `getSkillUpgradeCost(ns.args[0], ns.args[1])`, skillToUpgrade, 2);
        const nextBestPerceivedCost = Math.min(...skillNames.filter(s => s != skillToUpgrade).map(perceivedCostOf));
        const maxCount = skillToUpgrade === "Overclock" ? 90 - skillLevels[skillToUpgrade] : Number.POSITIVE_INFINITY;
        let count = planSkillUpgradeCount(skillCosts[skillToUpgrade], Number.isFinite(costForTwo) ? costForTwo : 2 * skillCosts[skillToUpgrade],
            costAdjustments[skillToUpgrade] || 1, nextBestPerceivedCost, unspent, maxCount);
        let success = count > 0 && await getBBInfo(ns, `upgradeSkill(ns.args[0], ns.args[1])`, skillToUpgrade, count);
        if (!success && count > 1) { // The bulk cost estimate rounds; fall back to a single level, which we verified is affordable
            count = 1;
            success = await getBBInfo(ns, `upgradeSkill(ns.args[0], ns.args[1])`, skillToUpgrade, count);
        }
        if (success)
            log(ns, `SUCCESS: Upgraded Bladeburner skill ${skillToUpgrade} by ${count} level${count == 1 ? '' : 's'} (${skillLevels[skillToUpgrade]} -> ${skillLevels[skillToUpgrade] + count})`, false, options['toast-upgrades'] ? 'success' : undefined);
        else
            log(ns, `WARNING: Something went wrong while trying to upgrade Bladeburner skill ${skillToUpgrade}. ` +
                `Currently have ${unspent} SP, upgrade should cost ${skillCosts[skillToUpgrade]} SP.`, false, 'warning');
        await ns.sleep(10);
    }
}
```

- [ ] **Step 6: Checks**

`node --check bladeburner.js`
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs bladeburner.js` -> `bladeburner.js: +[hacking={, nextUpdate=RamCostConstants.CycleTiming] -[]` - both 0 GB (CycleTiming is 0 in RamCostGenerator.ts:79; `hacking` is a namespace key). Anything else must be renamed.
`node --test` -> 151 pass.

- [ ] **Step 7: In-game check**

`mem bladeburner.js` must print the same value as at HEAD (`nextUpdate` is free). Give the division a skill-point windfall (`run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_SP --liquidate` with hashes available, or wait for a rank-up): `run bladeburner.js --tail` must log `SUCCESS: Upgraded Bladeburner skill <name> by N levels (a -> b)` with N > 1 within one loop, and the Skills page must show 0 unspent SP shortly after, with Overclock never above 90. The `Switched to Bladeburner ...` lines keep appearing within ~1 s of an action's completion (the loop still wakes on `currentTaskEndTime`).

- [ ] **Step 8: Commit (user triggers)**

`git add lib/bladeburner-logic.js test/bladeburner-logic.test.js bladeburner.js && git commit -m "bladeburner: bulk skill purchases, cached max levels, nextUpdate pacing (BB-4)"`

---

### Task 12: SL-4 - fetch `getResetInfo` once, `getNumSleeves` every 60 s

Depends on Task 1 (the `training-cap-seconds` line).

**Files:**
- Modify: `sleeve.js` globals (after line 57), `main()` after the SF10 check (line 82), `mainLoop` lines 185 and 196-200

**Interfaces:**
- Produces globals `let resetInfo`, `let numSleevesExpiry = 0`, `const numSleevesRefreshInterval = 60 * 1000`.
- Consumes nothing new. No pure logic to extract (the change is which loop the two fetches live in).

- [ ] **Step 1: Globals**

After line 57 (`let options;`) add:
```js
let resetInfo; // ns.getResetInfo(): lastNodeReset / bitNodeOptions never change within a BitNode (this script is restarted on a new one), so it is fetched once in main()
let numSleevesExpiry = 0; // The sleeve count only changes on a Covenant purchase (BN10), so it is refreshed every numSleevesRefreshInterval
const numSleevesRefreshInterval = 60 * 1000;
```

- [ ] **Step 2: Fetch once in `main()`**

Lines 81-82, old:
```js
    if (!(10 in ownedSourceFiles))
        return ns.tprint("WARNING: You cannot run sleeve.js until you do BN10.");
```
new:
```js
    if (!(10 in ownedSourceFiles))
        return ns.tprint("WARNING: You cannot run sleeve.js until you do BN10.");
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    // Honour the "disableSleeveExpAndAugmentation" bitnode option (sleeves gain no exp and cannot buy augs, so training/aug-buying is pointless)
    sleeveExpDisabled = resetInfo.bitNodeOptions?.disableSleeveExpAndAugmentation ?? false;
    numSleevesExpiry = 0;
```

- [ ] **Step 3: Cache in `mainLoop`**

Line 185, old:
```js
    numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
```
new:
```js
    if (Date.now() >= numSleevesExpiry) {
        numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
        numSleevesExpiry = Date.now() + numSleevesRefreshInterval;
    }
```
Lines 196-200, old:
```js
    // Get time in current bitnode (to cap how long we'll train sleeves)
    const resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const timeInBitnode = Date.now() - resetInfo.lastNodeReset;
    // Honour the "disableSleeveExpAndAugmentation" bitnode option (sleeves gain no exp and cannot buy augs, so training/aug-buying is pointless)
    sleeveExpDisabled = resetInfo.bitNodeOptions?.disableSleeveExpAndAugmentation ?? false;
```
new:
```js
    // Get time in current bitnode (to cap how long we'll train sleeves); resetInfo is fetched once in main()
    const timeInBitnode = Date.now() - resetInfo.lastNodeReset;
```

- [ ] **Step 4: Checks**

`node --check sleeve.js`; `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs sleeve.js` -> `+[] -[]`; `grep -c "getResetInfo" sleeve.js` -> `1`; `node --test` -> 151 pass.

- [ ] **Step 5: In-game check**

`run sleeve.js --tail`: sleeves are assigned exactly as before (same `Set sleeve N to ...` lines). Open the Active Scripts panel while the script runs: the per-second flicker of `/Temp/getResetInfo.js` and `/Temp/sleeve-getNumSleeves.js` entries is gone (they appear once at start, then `getNumSleeves` once a minute). In BN10, buy a sleeve from The Covenant: the new sleeve receives its first task within 60 s. Kill and restart the script after an augmentation install: `sleeveExpDisabled` behaviour (no training in a `disableSleeveExpAndAugmentation` node) is unchanged since `main()` re-fetches.

- [ ] **Step 6: Commit (user triggers)**

`git add sleeve.js && git commit -m "sleeve: fetch getResetInfo once and getNumSleeves every minute (SL-4)"`

---

## Skipped

- None of the section 3 findings are marked "suspected"; all twelve (GG-1..4, SL-1..4, BB-1..4) are planned above. GG-2 is "mechanism confirmed, magnitude estimated" and BB-1 "mechanism confirmed, frequency estimated" - both in scope per the brief.
- Not planned (not findings, or outside the brief's scope list): the spec's remark that the `ascend-multi-threshold` 1.05 spacing floor is too low (Task 9's "no ascension while retraining" guard removes the harm without changing the upstream default); SL-4's suggestion to raise the sleeve loop `interval` to 5-10 s (the brief lists only the two cached fetches); the $12 000/s training over-reservation (`costByNextLoop`, listed as checked-OK).

## Self-review

**Spec coverage** (every confirmed finding in section 3 -> task): SL-2 -> Task 1; SL-1 -> Task 2; BB-1 -> Task 3; GG-1 -> Task 4; GG-3 -> Task 5; GG-2 -> Task 6; SL-3 -> Task 7; BB-2 -> Task 8; GG-4 -> Task 9; BB-3 -> Task 10; BB-4 -> Task 11; SL-4 -> Task 12. Ordering follows impact (high: SL-2, SL-1, BB-1; medium: GG-1, GG-2, SL-3, BB-2; low: GG-4, BB-3, BB-4, SL-4) except that GG-3 (low) precedes GG-2 because GG-2's bonus-time branch is written against GG-3's rewritten loop, and GG-4 follows GG-1/GG-3 because it uses `memberWeights` and the `dictMembers` plumbing they introduce.

**Placeholder scan**: no "TBD"/"TODO"/"similar to"/"handle edge cases" in any step; every code step shows the exact old and new text or the full new function; every check step has a command and an expected output; every in-game step names the terminal command and the log lines to look for. Design decisions stated inline: cost-per-exp gate at $2500 (Task 1), karma gate 0.1 (Task 2), verdict on the sorted pair with `lo > threshold` (Task 3), reference crime = own / most common / top task and value-per-dollar ranking with the 50x penalty only for score 0 (Task 4), cycle counting with wall-clock compensation and NPC-power observation (Task 5), crime-only in bonus time (Task 6), midpoint chance for the estimate-improving operations (Task 8), equipment-stripped weighted stat at 0.9 with "weakest member" targets for recruits and no re-ascension while retraining (Task 9), conservative `1 - 1/mult` loss model over a 60-minute horizon (Task 10), increment from two API costs with single-level fallback (Task 11).

**Name/signature consistency across tasks**:
- `lib/sleeve-logic.js`: `trainingCostPerExp(shock)`, `canAffordTraining(shock, maxCostPerExp)` (T1); `karmaRatePerAttempt(successChance, sync)`, `shouldFillWithKarmaHomicide(successChance, sync, minRate)` (T2); `bladeburnerSleeveTasks(enableTeamBuilding)` (T7). sleeve.js import line grows in T1 -> T2 -> T7 exactly as quoted.
- `lib/bladeburner-logic.js`: `chanceRangeVerdict(range, threshold)` (T3); `fieldAnalysisEffect(hackingLevel, intelligence, charisma, analysisMult)`, `rankPopulationActions(candidates)` (T8); `chaosDifficultyMult`, `diplomacyPctPerMinute`, `diplomacyMinutesTo`, `shouldRunDiplomacy` (T10); `planSkillUpgradeCount(costForOne, costForTwo, adjustment, nextBestPerceivedCost, unspent, maxCount)` (T11). bladeburner.js `refreshPlayer(ns)` is defined in T8 and used in T8 and T10; `citiesWithinChaos` defined and used in T10.
- `lib/gang-logic.js`: `gangStatKeys`, `trainingTaskStats`, `taskStatWeights`, `equipmentScore`, `rankEquipment`, `weightedStat(memberInfo, weights, stripEquipment)`, `weightedAscensionGain(ascResult, memberInfo, weights)`, `pickTrainingTask(weights, roll)` (T4); `missedGangCycles`, `nextUpdateHasTerritoryTick` (T5); `retrainTargetFor`, `needsRetraining` (T9). gangs.js: `referenceTaskFor(memberName)`, `memberWeights(memberName)`, `tryAscendMembers(ns, myGangInfo, dictMembers)`, `isNearAscension(memberIndex, memberInfo)` (T4) are called with those arities in T5's `onTerritoryTick` and T9; `awaitGangUpdate(ns)`, `onTerritoryTick(ns)`, `territoryTickTime` (const), `territoryCyclesPerTick`, `cyclesSinceTerritoryTick`, `lastUpdateResolvedAt` (T5) are used by T6 (`lastHousekeepingTime`) and T9 (`doRecruitMember(ns, dictMembers)` call inside T5's `onTerritoryTick`). `lastMemberReset` survives T4/T5 unchanged and is removed only in T9, where every reference is replaced.
- Test counts: 126 at HEAD, +2 (T1) 128, +2 (T2) 130, +2 (T3) 132, +6 (T4) 138, +2 (T5) 140, +0 (T6) 140, +2 (T7) 142, +3 (T8) 145, +2 (T9) 147, +3 (T10) 150, +1 (T11) 151, +0 (T12) 151.
