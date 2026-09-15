# Stocks, Hacknet, Stanek, Go Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed section-5 findings so stockmaster redeploys reversal cash and polls on market ticks, Stanek's peak charge follows home RAM, hacknet new-node pricing and loop cadence are sane, hash contracts are only generated when they get solved, the Stanek layout tool scores like the game, and go.js stops launching five temp scripts per move.

**Architecture:** Every fix lives in the script that owns the decision; decision logic that changed is extracted into a small exported pure function in that same script (all six scripts import cleanly in Node 24, verified at HEAD 7d13c98) and unit-tested with `node --test`. ST-1 spans stanek.js (a new `--top-up` mode) and autopilot.js (re-launches stanek.js once home RAM has doubled, reusing the existing "daemon vacates home while stanek.js runs" mechanism). Behaviour that depends on the game (tick timing, RAM allocation, formulas API) is verified in-game with the exact commands given per task.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22+ `node:test` for unit tests (Node 24.14.1 installed), tools/harness for RAM checks and the headless game.

**Spec:** docs/audit/2026-09-15-functional-review.md, section 5.

## Global Constraints

- Never edit anything under /home/jubnl/dev/bitburner/bitburner-src.
- One finding per commit; commit message names the finding ID, e.g. `stockmaster: drop the fracB gate post-4S (SM-1)`. No Co-Authored-By or session trailers. Never push. Never touch .idea/.
- After every script edit run `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>` from the scripts repo root; any `+[...]` output is a new RAM charge from an identifier whose name equals an NS function. The one deliberate exception is Task 3 (`nextUpdate`, cost `RamCostConstants.CycleTiming` = 0 GB, see the task). Darknet files are not touched by this plan.
- Run the full Node suite with a bare `node --test` from the scripts repo root (126 tests pass at HEAD; each task states the expected count after it).
- Line numbers below are as of HEAD 7d13c98. Tasks 1, 3, 6 and 7 all edit stockmaster.js, so after Task 1 and Task 3 the later stockmaster line numbers drift by a few lines; match on the quoted old text, not the number.
- Scope discipline: fix the finding, do not refactor around it. Upstream oddities noticed while reading (e.g. the inverted `owned ?` ternary in the stockmaster "not bought" log, the `boosterScore || 0 > currentBestScore` precedence in optimize-stanek.js) are NOT in scope; leave them.

## Default changes for the user to approve

No upstream (alainbryden) default value changes. HN-2 is fixed inside hacknet-upgrade-manager.js so daemon.js's `--interval 0` kick-start keeps its meaning (buy as fast as possible while purchases succeed) and only the idle case is throttled; daemon.js line 377 is left alone.

New branch-added options (listed for visibility, all default to the behaviour described in their task):

| Script | Option | Default | Task |
|---|---|---|---|
| stanek.js | `--top-up` | false | ST-1 |
| stanek.js | `--top-up-min-gain` | 1.5 | ST-1 |
| stanek.js | `--top-up-timeout` | 600 (s) | ST-1 |
| spend-hacknet-hashes.js | `--require-contractor` | true | HN-4 |
| spend-hacknet-hashes.js | `--contractor-max-age` | 300 (s) | HN-4 |

---

### Task 1: SM-1 — drop the fracB liquidity gate once we have 4S data

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/stockmaster.js` lines 192-195 (the gate) and add one exported function after line 250 (`getTimeInBitnode`). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/stockmaster-buy-gate.test.js` (new).

**Interfaces:**
- Produces `export function canAffordToBuy(pre4s, money, reserve, corpus, fracB, fracH, commissionCost): boolean` in stockmaster.js. Consumed by the main loop only.

- [ ] **Step 1: Write the failing test**

Create `test/stockmaster-buy-gate.test.js`:

```js
// SM-1: pre-4S the upstream --fracB liquidity gate stands; post-4S any cash above the --fracH floor plus two commissions is invested at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAffordToBuy } from "../stockmaster.js";

const commission = 100_000;

test("pre-4S keeps the fracB liquidity gate and ignores fracH", () => {
    assert.equal(canAffordToBuy(true, 41, 0, 100, 0.4, 0.1, commission), true);
    assert.equal(canAffordToBuy(true, 39, 0, 100, 0.4, 0.1, commission), false);
    assert.equal(canAffordToBuy(true, 39, 0, 100, 0.4, 0.001, commission), false);
});

test("post-4S buys once spendable cash exceeds the fracH floor by two commissions", () => {
    const corpus = 10e9;
    assert.equal(canAffordToBuy(false, 0.1 * corpus + 2 * commission + 1, 0, corpus, 0.4, 0.1, commission), true);
    assert.equal(canAffordToBuy(false, 0.1 * corpus + 2 * commission, 0, corpus, 0.4, 0.1, commission), false);
    assert.equal(canAffordToBuy(false, 0.2 * corpus, 0, corpus, 0.4, 0.1, commission), true); // 20% cash: the old 40% gate blocked this
    assert.equal(canAffordToBuy(false, 0.2 * corpus, 0.15 * corpus, corpus, 0.4, 0.1, commission), false); // the reserve is not spendable
    assert.equal(canAffordToBuy(false, 0.01 * corpus, 0, corpus, 0.4, 0.001, commission), true); // autopilot's BN8 fracH
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/stockmaster-buy-gate.test.js` → fails with `SyntaxError: The requested module '../stockmaster.js' does not provide an export named 'canAffordToBuy'`.

- [ ] **Step 3: Implement**

In stockmaster.js replace lines 192-195:

```js
            // If we haven't gone above a certain liquidity threshold, don't attempt to buy more stock
            // Avoids death-by-a-thousand-commissions before we get super-rich, stocks are capped, and this is no longer an issue
            // BUT may mean we miss striking while the iron is hot while waiting to build up more funds.
            if (playerStats.money / corpus > fracB) {
```

with:

```js
            // If we haven't gone above a certain liquidity threshold, don't attempt to buy more stock
            // Avoids death-by-a-thousand-commissions before we get super-rich, stocks are capped, and this is no longer an issue
            // BUT may mean we miss striking while the iron is hot while waiting to build up more funds.
            // SM-1: post-4S the cash freed by cycle reversals (src/StockMarket/StockMarket.ts: 45% of stocks flip every 75 ticks) must be
            // redeployed at once, because the freshly reversed stocks have the largest known |p-0.5|; so --fracB only applies pre-4S.
            if (canAffordToBuy(pre4s, playerStats.money, reserve, corpus, fracB, fracH, commission)) {
```

After line 250 (`function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }`) insert:

```js
/** SM-1: whether the cash on hand justifies a round of purchases this loop.
 * Pre-4S: the upstream --fracB liquidity gate (cash must be at least fracB of corpus). Post-4S: buy whenever the spendable cash
 * (money - reserve) exceeds the --fracH cash floor by more than two commissions; the per-stock estEndOfCycleValue check in the
 * main loop already prevents micro-buys, and a 100k commission is irrelevant once the corpus is in the billions.
 * @param {boolean} pre4s @param {number} money @param {number} reserve @param {number} corpus
 * @param {number} fracB @param {number} fracH @param {number} commissionCost */
export function canAffordToBuy(pre4s, money, reserve, corpus, fracB, fracH, commissionCost) {
    if (pre4s) return money / corpus > fracB;
    return money - reserve > fracH * corpus + 2 * commissionCost;
}
```

- [ ] **Step 4: Run tests and checks**

`node --test test/stockmaster-buy-gate.test.js` → 2 pass. `node --test` → 128 pass.
`node --check stockmaster.js` → no output. `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs stockmaster.js` → `stockmaster.js: +[] -[]`.

- [ ] **Step 5: In-game check**

With 4S owned: `run stockmaster.js --tail --noisy`. After the next market cycle (log line `N Stocks appear to be reversing their outlook`), the `Sold all ... positions` lines must be followed within the same tick by `Buying`/`Shorting` lines, even when the status line shows cash well under 40% of corpus (e.g. holdings 8b, cash 2b). Before this fix the log showed only sales and no purchases in that situation.

- [ ] **Step 6: Commit**

`git add stockmaster.js test/stockmaster-buy-gate.test.js && git commit -m "stockmaster: drop the fracB gate post-4S (SM-1)"`

---

### Task 2: ST-1 — re-charge Stanek after home RAM has doubled

Design decision: autopilot drives the top-up (it already relaunches daemon with `--reserved-ram 1E100` whenever stanek.js is running, so daemon's home batches drain), and stanek.js gets a `--top-up` mode that gives each stat fragment exactly one charge that is at least `--top-up-min-gain` (1.5) times its current `highestCharge`, waiting up to `--top-up-timeout` (600 s) for home RAM to free up, then runs the completion script (daemon.js) as usual. A charge below the peak only adds `threads/highestCharge` of a charge (src/CotMG/StaneksGift.ts:33-39), which is worth nothing, so waiting for the gain is mandatory.

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/stanek.js` lines 23 (argsSchema), 31 (globals), 55 (after `maxCharges = ...`), 116 (completion log), 136-143 (`getFragmentsToCharge` head), 180-193 (`tryChargeAllFragments`); `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js` lines 113, 683-692, 699-701. Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/stanek-topup.test.js` (new).

**Interfaces:**
- Produces `export function selectTopUpFragments(fragments, toppedUpIds, attempts): ActiveFragment[]` in stanek.js.
- stanek.js CLI: `--top-up` (bool), `--top-up-min-gain` (number), `--top-up-timeout` (seconds). autopilot.js passes `--top-up` on every launch after the first one in a reset.

- [ ] **Step 1: Write the failing test**

Create `test/stanek-topup.test.js`:

```js
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
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/stanek-topup.test.js` → `SyntaxError: The requested module '../stanek.js' does not provide an export named 'selectTopUpFragments'`.

- [ ] **Step 3: Implement stanek.js**

(a) After line 23 (`['reputation-threshold', 0.2], ...`) add to `argsSchema`:

```js
    // ST-1: the Stanek bonus scales with ln(highest single charge + 1) (src/CotMG/formulas/effect.ts), so home RAM bought after the initial
    // charging is wasted on Stanek unless every fragment gets one more charge with the larger RAM. autopilot.js re-launches this script with
    // --top-up once home RAM has doubled since the last charge.
    ['top-up', false], // Give each stat fragment one charge that beats its current peak (highestCharge) and exit, instead of charging to --max-charges
    ['top-up-min-gain', 1.5], // In --top-up mode only charge a fragment when the free threads are at least this multiple of its current peak (a smaller charge adds threads/peak of a charge, worth ~nothing)
    ['top-up-timeout', 600], // In --top-up mode give up (and still run --on-completion-script) after this many seconds if home RAM never frees up enough
```

(b) Replace line 31:

```js
let options, currentServer, maxCharges, idealReservedRam, chargeAttempts, sf4Level, shouldContinueForAug;
```

with:

```js
let options, currentServer, maxCharges, idealReservedRam, chargeAttempts, sf4Level, shouldContinueForAug;
let topUp, topUpDeadline, toppedUp; // ST-1 --top-up state: mode flag, Date.now() deadline, Set of fragment ids charged above their previous peak this run
```

(c) After line 55 (`maxCharges = options['max-charges']; // Don't bother adding charges beyond this amount`) add:

```js
    topUp = options['top-up'];
    topUpDeadline = Date.now() + options['top-up-timeout'] * 1000;
    toppedUp = new Set();
```

(d) Replace line 116:

```js
    log(ns, `SUCCESS: All stanek fragments at desired charge ${maxCharges}`, true, 'success');
```

with:

```js
    if (topUp) {
        const pending = selectTopUpFragments(await getActiveFragments(ns), toppedUp, chargeAttempts).length;
        log(ns, pending == 0 ? `SUCCESS: Stanek top-up complete: ${toppedUp.size} fragments were charged above their previous peak.` :
            `WARNING: Stanek top-up timed out (--top-up-timeout ${options['top-up-timeout']}s): ${toppedUp.size} fragments charged, ` +
            `${pending} never saw ${options['top-up-min-gain']}x their peak in free threads.`, true, pending == 0 ? 'success' : 'warning');
    } else
        log(ns, `SUCCESS: All stanek fragments at desired charge ${maxCharges}`, true, 'success');
```

(e) In `getFragmentsToCharge`, after line 140 (the `return undefined;` of the "fragments were cleared" error and its closing `}`), i.e. between:

```js
        return undefined;
    }
    // If we have SF4, get our updated faction rep, and determine if we should continue past --max-charges to earn rep for the next augmentation
```

insert:

```js
    if (topUp) { // ST-1: one peak-raising charge per stat fragment, then stop (no --max-charges / reputation logic)
        const pending = selectTopUpFragments(fragments, toppedUp, chargeAttempts);
        if (pending.length == 0 || Date.now() > topUpDeadline) return [];
        log(ns, `Top-up: ${pending.length}/${fragments.length} fragments still need a charge of >= ${options['top-up-min-gain']}x their peak:\n` +
            pending.map(f => `Fragment ${String(f.id).padStart(2)} at [${f.x},${f.y}] Peak: ${formatNumberShort(f.highestCharge)} Charges: ${f.numCharge.toFixed(1)}`).join('\n'));
        return pending;
    }
```

(f) In `tryChargeAllFragments`, replace lines 180-193:

```js
        const threads = Math.floor((availableRam - reservedRam) / 2.0);
        if (threads <= 0) {
            log(ns, `WARNING: Insufficient free RAM on ${currentServer} to charge Stanek ` +
                `(${formatRam(availableRam)} free - ${formatRam(reservedRam)} reserved). Will try again later...`);
            continue;
        }
        const pid = ns.run(chargeScript, { threads: threads, temporary: true }, fragment.x, fragment.y);
        if (!pid) {
            log(ns, `WARNING: Failed to charge Stanek with ${threads} threads thinking there was ${formatRam(availableRam)} free on ${currentServer}. ` +
                `Check if another script is fighting stanek.js for RAM. Will try again later...`);
            continue;
        }
        await waitForProcessToComplete(ns, pid);
        chargeAttempts[fragment.id] = 1 + (chargeAttempts[fragment.id] || 0);
```

with:

```js
        const threads = Math.floor((availableRam - reservedRam) / 2.0);
        if (threads <= 0) {
            log(ns, `WARNING: Insufficient free RAM on ${currentServer} to charge Stanek ` +
                `(${formatRam(availableRam)} free - ${formatRam(reservedRam)} reserved). Will try again later...`);
            continue;
        }
        if (topUp && threads < options['top-up-min-gain'] * fragment.highestCharge) { // ST-1: a charge below the peak is wasted, wait for daemon's home scripts to drain
            log(ns, `Top-up: ${threads} free threads on ${currentServer} is below ${options['top-up-min-gain']}x the peak charge ` +
                `(${formatNumberShort(fragment.highestCharge)}) of fragment ${fragment.id}. Waiting for RAM to free up...`);
            continue;
        }
        const pid = ns.run(chargeScript, { threads: threads, temporary: true }, fragment.x, fragment.y);
        if (!pid) {
            log(ns, `WARNING: Failed to charge Stanek with ${threads} threads thinking there was ${formatRam(availableRam)} free on ${currentServer}. ` +
                `Check if another script is fighting stanek.js for RAM. Will try again later...`);
            continue;
        }
        await waitForProcessToComplete(ns, pid);
        chargeAttempts[fragment.id] = 1 + (chargeAttempts[fragment.id] || 0);
        if (topUp) toppedUp.add(fragment.id);
```

(g) After the closing `}` of `tryChargeAllFragments` (line 195) add:

```js
/** ST-1: the stat fragments (id < 100) that have not yet received a peak-raising charge in this --top-up run, skipping fragments that
 * were flagged as not accepting charge (chargeAttempts == 2, see getFragmentsToCharge).
 * @param {ActiveFragment[]} fragments @param {Set<number>} toppedUpIds @param {{[id: number]: number}} attempts */
export function selectTopUpFragments(fragments, toppedUpIds, attempts) {
    return fragments.filter(f => f.id < 100 && !toppedUpIds.has(f.id) && (attempts[f.id] || 0) < 2);
}
```

- [ ] **Step 4: Implement autopilot.js**

(a) Replace line 113:

```js
    let acceptedStanek = false, stanekLaunched = false;
```

with:

```js
    let acceptedStanek = false, stanekLaunched = false;
    let stanekChargedHomeRam = 0; // ST-1: home RAM when stanek.js was last launched; a --top-up charge is due once home RAM has doubled since
```

(b) Replace lines 683-692:

```js
        // Once stanek's gift is accepted, launch it once per reset before we launch daemon (Note: stanek's gift is auto-purchased by faction-manager.js on your first install)
        let stanekRunning = (13 in unlockedSFs) && findScript('stanek.js') !== undefined;
        if ((13 in unlockedSFs) && !stanekLaunched && !stanekRunning && installedAugmentations.includes(augStanek)) {
            stanekLaunched = true; // Once we've know we've launched stanek once, we never have to again this reset.
            const stanekArgs = ["--on-completion-script", getFilePath('daemon.js')]
            if (options['no-tail-windows']) stanekArgs.push('--no-tail'); // Relay the option to suppress tail windows
            if (daemonArgs.length >= 0) stanekArgs.push("--on-completion-script-args", JSON.stringify(daemonArgs)); // Pass in all the args we wanted to run daemon.js with
            launchScriptHelper(ns, 'stanek.js', stanekArgs);
            stanekRunning = true;
        }
```

with:

```js
        // Once stanek's gift is accepted, launch it once per reset before we launch daemon (Note: stanek's gift is auto-purchased by faction-manager.js on your first install)
        // ST-1: the Stanek bonus scales with ln(highest single charge + 1) (src/CotMG/formulas/effect.ts), so once home RAM has doubled since the
        // last charge, launch stanek.js again in --top-up mode (one peak-raising charge per fragment). While it runs, daemon is kept off home (below).
        let stanekRunning = (13 in unlockedSFs) && findScript('stanek.js') !== undefined;
        const stanekTopUpDue = stanekLaunched && homeRam >= 2 * stanekChargedHomeRam;
        if ((13 in unlockedSFs) && (!stanekLaunched || stanekTopUpDue) && !stanekRunning && installedAugmentations.includes(augStanek)) {
            const stanekArgs = ["--on-completion-script", getFilePath('daemon.js')]
            if (stanekLaunched) stanekArgs.push("--top-up"); // Not the first charge this reset: only raise each fragment's peak
            stanekLaunched = true; // Once we've know we've launched stanek once, we never have to again this reset (except for top-ups).
            stanekChargedHomeRam = homeRam;
            if (options['no-tail-windows']) stanekArgs.push('--no-tail'); // Relay the option to suppress tail windows
            if (daemonArgs.length >= 0) stanekArgs.push("--on-completion-script-args", JSON.stringify(daemonArgs)); // Pass in all the args we wanted to run daemon.js with
            launchScriptHelper(ns, 'stanek.js', stanekArgs);
            stanekRunning = true;
        }
```

(c) Replace lines 699-701:

```js
        let launchDaemon = !existingDaemon || daemonArgs.some(arg => !existingDaemon.args.includes(arg) && !Number.isFinite(arg)) ||
            // Special cases: We also must relaunch daemon if it is running with certain flags we wish to remove
            (["--xp-only"].some(arg => !daemonArgs.includes(arg) && existingDaemon.args.includes(arg)))
```

with:

```js
        let launchDaemon = !existingDaemon || daemonArgs.some(arg => !existingDaemon.args.includes(arg) && !Number.isFinite(arg)) ||
            // Special cases: We also must relaunch daemon if it is running with certain flags we wish to remove
            (["--xp-only"].some(arg => !daemonArgs.includes(arg) && existingDaemon.args.includes(arg))) ||
            // ST-1: a running daemon that already had a (finite) --reserved-ram (SF4 < 3 case above) must still be relaunched to vacate home for stanek.js
            (stanekRunning && !existingDaemon.args.includes(1E100))
```

- [ ] **Step 5: Run tests and checks**

`node --test test/stanek-topup.test.js` → 2 pass. `node --test` → 130 pass.
`node --check stanek.js && node --check autopilot.js` → no output.
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs stanek.js` → `stanek.js: +[] -[]`; same for autopilot.js.

- [ ] **Step 6: In-game check**

1. `mem stanek.js` before and after: identical (no new NS calls).
2. Manual top-up with a stanek grid already charged: note a fragment's `Peak` from `run stanek.js --tail` startup output (or `ns.stanek.activeFragments()` in the REPL), then buy home RAM so free RAM is at least 1.5x the peak's RAM (2 GB per thread), then `run stanek.js --top-up --tail`. Expect per-fragment `Top-up: ... Waiting for RAM to free up...` lines only while home is busy, one charge script per fragment, and the final toast `SUCCESS: Stanek top-up complete: N fragments were charged above their previous peak.` `ns.stanek.activeFragments()` must show every stat fragment's `highestCharge` increased and `numCharge` rescaled to about `old * oldPeak / newPeak + 1`.
3. Timeout path: `run stanek.js --top-up --top-up-timeout 20 --top-up-min-gain 1000 --tail` → after ~20 s the `WARNING: Stanek top-up timed out` toast, and the completion script (none given) is skipped without error.
4. autopilot path: with autopilot.js running and stanek accepted, run `/Tasks/ram-manager.js` (or buy home RAM manually) until home RAM doubles. autopilot's log must show `Launched stanek.js ... with args: [--on-completion-script, daemon.js, --top-up, ...]`, then `Relaunching daemon.js` with `--reserved-ram 1e+100`, and after stanek.js exits a fresh daemon.js without it.

- [ ] **Step 7: Commit**

`git add stanek.js autopilot.js test/stanek-topup.test.js && git commit -m "stanek/autopilot: top-up charge after home RAM doubles (ST-1)"`

---

### Task 3: SM-2 — wait on market ticks and fetch all stock data with one temp script

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/stockmaster.js` lines 31 (comment), 171-175 (history-building wait), 238 (loop wait), 255-263 (add `getStockRefreshDict` after `getStockInfoDict`), 300-306 and 324-338 (`refresh`), 567-574 (`tryGet4SApi`). No unit test (all game-side); in-game verification below.

**Interfaces:**
- Produces `async function getStockRefreshDict(ns, has4s)` (module-private) returning `{[sym]: [ask, bid, vol|null, forecast|null, position|null]}`.
- `getStockInfoDict` is unchanged and still used for `getMaxShares` (init) and `getPosition` (liquidate).

- [ ] **Step 1: Implement the tick wait**

Replace line 31:

```js
let sleepInterval = 1000;
```

with:

```js
let sleepInterval = 1000; // Only used while waiting for TIX API access. SM-2: the trading loop waits on ns.stock.nextUpdate() (0 GB) instead of polling
```

Replace lines 171-175:

```js
            if (pre4s && allStocks[0].priceHistory.length < minTickHistory) {
                log(ns, `Building a history of stock prices (${allStocks[0].priceHistory.length}/${minTickHistory})...`);
                await ns.sleep(sleepInterval);
                continue;
            }
```

with:

```js
            if (pre4s && allStocks[0].priceHistory.length < minTickHistory) {
                log(ns, `Building a history of stock prices (${allStocks[0].priceHistory.length}/${minTickHistory})...`);
                await ns.stock.nextUpdate();
                continue;
            }
```

Replace line 238:

```js
        await ns.sleep(sleepInterval);
```

with:

```js
        // SM-2: prices, forecasts, volatility and positions only change on a market tick (src/StockMarket/StockMarket.ts processStockPrices,
        // every 6 s or 4 s when catching up) or through our own trades (which `continue` above), so wait for the next tick (0 GB).
        await ns.stock.nextUpdate();
```

- [ ] **Step 2: Implement the single refresh temp script**

After line 263 (the closing `};` of `getStockInfoDict`) add:

```js
/** SM-2: collect ask price, bid price, (with 4S) volatility and forecast, and (unless mocking) our position for every symbol with a
 * single temporary script, instead of one temp script per stock function. The temp script differs pre/post 4S and in mock mode, so
 * each variant gets its own file name (helpers.js warns whenever a temp script is overwritten with different contents).
 * Temp script RAM: 4S variant 2+2+2.5+2.5+2 + 1.6 base = 12.6 GB, pre-4S 7.6 GB (src/Netscript/RamCostGenerator.ts GetStock/BuySellStock).
 * @param {NS} ns @param {boolean} has4s
 * @returns {Promise<{[sym: string]: [number, number, number|null, number|null, [number, number, number, number]|null]}>} */
async function getStockRefreshDict(ns, has4s) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) throw new Error(`No WSE API Access yet, this call to refresh stock info is premature.`);
    const perSymbol = `[ns.stock.getAskPrice(sym), ns.stock.getBidPrice(sym), ` +
        (has4s ? `ns.stock.getVolatility(sym), ns.stock.getForecast(sym)` : `null, null`) + `, ` +
        (mock ? `null` : `ns.stock.getPosition(sym)`) + `]`;
    return await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(sym => [sym, ${perSymbol}]))`,
        `/Temp/stock-refresh${has4s ? '-4s' : '-pre4s'}${mock ? '-mock' : ''}.txt`, allStockSymbols);
}
```

In `refresh`, replace lines 300-306:

```js
    // Dodge hefty RAM requirements by spawning a sequence of temporary scripts to collect info for us one function at a time
    const dictAskPrices = await getStockInfoDict(ns, 'getAskPrice');
    const dictBidPrices = await getStockInfoDict(ns, 'getBidPrice');
    const dictVolatilities = !has4s ? null : await getStockInfoDict(ns, 'getVolatility');
    const dictForecasts = !has4s ? null : await getStockInfoDict(ns, 'getForecast');
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');
    const ticked = allStocks.some(stk => stk.ask_price != dictAskPrices[stk.sym]); // If any price has changed since our last update, the stock market has "ticked"
```

with:

```js
    // SM-2: dodge the hefty RAM requirements of the stock functions with ONE temporary script that collects every value for every symbol
    const dictStockInfo = await getStockRefreshDict(ns, has4s);
    const dictAskPrices = Object.fromEntries(allStocks.map(stk => [stk.sym, dictStockInfo[stk.sym][0]]));
    const ticked = allStocks.some(stk => stk.ask_price != dictAskPrices[stk.sym]); // If any price has changed since our last update, the stock market has "ticked"
```

(lines 308-319, the tick-timing warnings, keep using `dictAskPrices` unchanged.)

Replace lines 324-325:

```js
        stk.ask_price = dictAskPrices[sym]; // The amount we would pay if we bought the stock (higher than 'price')
        stk.bid_price = dictBidPrices[sym]; // The amount we would recieve if we sold the stock (lower than 'price')
```

with:

```js
        const [askPrice, bidPrice, volatility, forecastProb, position] = dictStockInfo[sym];
        stk.ask_price = askPrice; // The amount we would pay if we bought the stock (higher than 'price')
        stk.bid_price = bidPrice; // The amount we would recieve if we sold the stock (lower than 'price')
```

Replace lines 329-330:

```js
        stk.vol = has4s ? dictVolatilities[sym] : stk.vol;
        stk.prob = has4s ? dictForecasts[sym] : stk.prob;
```

with:

```js
        stk.vol = has4s ? volatility : stk.vol;
        stk.prob = has4s ? forecastProb : stk.prob;
```

Replace line 334:

```js
        stk.position = mock ? null : dictPositions[sym];
```

with:

```js
        stk.position = mock ? null : position;
```

- [ ] **Step 3: Move tryGet4SApi's access checks behind the budget test**

Replace lines 567-574:

```js
    if (await checkAccess(ns, 'has4SDataTixApi')) return false; // Only return true if we just bought it
    const cost4sData = 1E9 * bitNodeMults.FourSigmaMarketDataCost;
    const cost4sApi = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost;
    const has4S = await checkAccess(ns, 'has4SData');
    const totalCost = (has4S ? 0 : cost4sData) + cost4sApi;
    // Liquidate shares if it would allow us to afford 4S API data
    if (totalCost > budget) /* Need to reserve some money to invest */
        return false;
```

with:

```js
    // SM-2: the caller has just confirmed we lack the 4S TIX API (pre4s), so it is not re-checked here, and the has4SData check (a temp
    // script) only runs once the cheapest possible purchase (the API alone) fits the budget.
    const cost4sData = 1E9 * bitNodeMults.FourSigmaMarketDataCost;
    const cost4sApi = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost;
    if (cost4sApi > budget) /* Need to reserve some money to invest */
        return false;
    const has4S = await checkAccess(ns, 'has4SData');
    const totalCost = (has4S ? 0 : cost4sData) + cost4sApi;
    // Liquidate shares if it would allow us to afford 4S API data
    if (totalCost > budget)
        return false;
```

- [ ] **Step 4: Checks**

`node --check stockmaster.js` → no output. `node --test` → 130 pass (unchanged).
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs stockmaster.js` → `stockmaster.js: +[nextUpdate=RamCostConstants.CycleTiming] -[]`. This is the one expected hit: `nextUpdate` is a real NS call whose cost constant `CycleTiming` is 0 (src/Netscript/RamCostGenerator.ts:79 and :131), so the script's RAM does not change; the in-game `mem` check below is the proof. Any other name in `+[...]` is a bug.

- [ ] **Step 5: In-game check**

1. `mem stockmaster.js` before and after the edit: identical.
2. `run stockmaster.js --tail` with TIX + 4S. The log's status line now changes once per ~6 s (one market tick) instead of every second; `ls /Temp/ | grep stock-` shows `stock-refresh-4s.txt` and `.js`; `rm /Temp/stock-getAskPrice.txt` and `rm /Temp/stock-getForecast.txt` then wait 30 s: they are not recreated. No `WARNING: Had to overwrite temp script` tprint appears.
3. Pre-4S on a save without 4S: same, with `stock-refresh-pre4s.*`, and no `stock-has4SData.txt` refresh while cash is far below the 4S budget (`rm /Temp/stock-has4SData.txt`, it stays gone until the corpus can afford 25b x FourSigmaMarketDataApiCost).
4. `run stockmaster.js --mock --tail` on a 4S save uses `stock-refresh-4s-mock.*` and trades on paper as before.
5. After a cycle reversal with `--noisy`, sales and re-buys still happen in one tick (Task 1 behaviour intact).

- [ ] **Step 6: Commit**

`git add stockmaster.js && git commit -m "stockmaster: wait on stock ticks and refresh with one temp script (SM-2)"`

---

### Task 4: HN-1 — price a new hacknet node as node cost plus the upgrades to match the worst node

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/hacknet-upgrade-manager.js` lines 68 (player mults), 119-125 (worst-node tracking), 138-143 (new node payoff), 155-157 (status strings), plus new exported function and constants after line 63 (`setStatus`). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/hacknet-new-node-cost.test.js` (new).

**Interfaces:**
- Produces `export function costToMatchStats(isServer, level, ram, cores, mults = {}): number` — money to take a fresh node/server (level 1, 1 GB, 1 core) to `(level, ram, cores)`, applying `mults.hacknet_node_level_cost / _ram_cost / _core_cost` (default 1). Transcribed from src/Hacknet/formulas/HacknetNodes.ts and HacknetServers.ts `calculateLevel/Ram/CoreUpgradeCost`.
- Consumes `ns.formulas.hacknetServers|hacknetNodes.levelUpgradeCost(startingLevel, extraLevels, costMult)`, `.ramUpgradeCost(startingRam, extraLevels, costMult)`, `.coreUpgradeCost(startingCore, extraCores, costMult)` (src/NetscriptFunctions/Formulas.ts:258-283, 310-335) when Formulas.exe is available.

- [ ] **Step 1: Write the failing test**

Create `test/hacknet-new-node-cost.test.js`:

```js
// HN-1: costToMatchStats transcribes src/Hacknet/formulas/HacknetServers.ts and HacknetNodes.ts calculateLevel/Ram/CoreUpgradeCost from a
// fresh node (level 1, 1 GB, 1 core). Expected values are computed by hand from src/Hacknet/data/Constants.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costToMatchStats } from "../hacknet-upgrade-manager.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test("a fresh node needs no upgrades", () => {
    assert.equal(costToMatchStats(true, 1, 1, 1), 0);
    assert.equal(costToMatchStats(false, 1, 1, 1), 0);
});

test("hacknet server upgrade costs (10*50e3*1.1^L levels, 200e3*r*1.4^log2(r) ram, 1e6*1.55^(c-1) cores)", () => {
    close(costToMatchStats(true, 3, 1, 1), 10 * 50e3 * (1.1 + 1.1 ** 2)); // 1,155,000
    close(costToMatchStats(true, 1, 4, 1), 1 * 200e3 * 1 + 2 * 200e3 * 1.4); // 760,000
    close(costToMatchStats(true, 1, 1, 3), 1e6 * (1 + 1.55)); // 2,550,000
    close(costToMatchStats(true, 3, 4, 3), 1155000 + 760000 + 2550000);
});

test("hacknet node upgrade costs (500*1.04^(L-1) levels, 30e3*r*1.28^log2(r) ram, 500e3*1.48^(c-1) cores)", () => {
    close(costToMatchStats(false, 3, 1, 1), 500 * (1 + 1.04)); // 1,020
    close(costToMatchStats(false, 1, 4, 1), 30e3 + 2 * 30e3 * 1.28); // 106,800
    close(costToMatchStats(false, 1, 1, 3), 500e3 * (1 + 1.48)); // 1,240,000
});

test("player cost multipliers scale each component independently", () => {
    const mults = { hacknet_node_level_cost: 0.5, hacknet_node_ram_cost: 2, hacknet_node_core_cost: 0.25 };
    close(costToMatchStats(true, 3, 4, 3, mults), 0.5 * 1155000 + 2 * 760000 + 0.25 * 2550000);
});

test("new node payoff is bounded by the upgrade cost, not just the node cost", () => {
    const worstProduction = 1, nodeCost = 1e6, upgrades = costToMatchStats(true, 100, 8192, 16);
    assert.ok(upgrades > 100 * nodeCost); // for early servers the upgrades dominate the price of the assumed production
    assert.ok(worstProduction / (nodeCost + upgrades) < worstProduction / nodeCost);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/hacknet-new-node-cost.test.js` → `SyntaxError: The requested module '../hacknet-upgrade-manager.js' does not provide an export named 'costToMatchStats'`.

- [ ] **Step 3: Implement**

(a) After line 63 (closing `}` of `setStatus`) add:

```js
// HN-1: upgrade cost constants from src/Hacknet/data/Constants.ts (HacknetNodeConstants / HacknetServerConstants)
const hacknetNodeCostConstants = { levelBaseCost: 500, ramBaseCost: 30e3, coreBaseCost: 500e3, upgradeLevelMult: 1.04, upgradeRamMult: 1.28, upgradeCoreMult: 1.48, levelExponentOffset: 1 };
const hacknetServerCostConstants = { levelBaseCost: 10 * 50e3, ramBaseCost: 200e3, coreBaseCost: 1e6, upgradeLevelMult: 1.1, upgradeRamMult: 1.4, upgradeCoreMult: 1.55, levelExponentOffset: 0 };

/** HN-1: money needed to take a fresh node/server (level 1, 1 GB, 1 core) to the given level, ram and cores, transcribed from the game's
 * cost formulas (src/Hacknet/formulas/HacknetNodes.ts and HacknetServers.ts calculateLevelUpgradeCost / calculateRamUpgradeCost /
 * calculateCoreUpgradeCost, which ns.hacknet.get*UpgradeCost and ns.formulas.hacknet* call). Servers: 10*BaseCost*sum_{L=1}^{level-1} 1.1^L;
 * nodes: LevelBaseCost*sum_{L=1}^{level-1} 1.04^(L-1). RAM (both): sum over doublings r=1,2,..,ram/2 of r*RamBaseCost*UpgradeRamMult^log2(r).
 * Cores (both): CoreBaseCost*sum_{c=1}^{cores-1} UpgradeCoreMult^(c-1). Each component is scaled by the player's cost multiplier.
 * @param {boolean} isServer @param {number} level @param {number} ram @param {number} cores
 * @param {{hacknet_node_level_cost?: number, hacknet_node_ram_cost?: number, hacknet_node_core_cost?: number}} mults */
export function costToMatchStats(isServer, level, ram, cores, mults = {}) {
    const c = isServer ? hacknetServerCostConstants : hacknetNodeCostConstants;
    let levelCost = 0;
    for (let l = 1; l < level; l++) levelCost += Math.pow(c.upgradeLevelMult, l - c.levelExponentOffset);
    levelCost *= c.levelBaseCost * (mults.hacknet_node_level_cost ?? 1);
    let ramCost = 0;
    for (let r = 1, n = 0; r < ram; r *= 2, n++) ramCost += r * c.ramBaseCost * Math.pow(c.upgradeRamMult, n);
    ramCost *= mults.hacknet_node_ram_cost ?? 1;
    let coreCost = 0;
    for (let k = 1; k < cores; k++) coreCost += Math.pow(c.upgradeCoreMult, k - 1);
    coreCost *= c.coreBaseCost * (mults.hacknet_node_core_cost ?? 1);
    return levelCost + ramCost + coreCost;
}
```

(b) Replace line 68:

```js
    const currentHacknetMult = ns.getPlayer().mults.hacknet_node_money;
```

with:

```js
    const playerMults = ns.getPlayer().mults;
    const currentHacknetMult = playerMults.hacknet_node_money;
```

(c) Replace lines 119-125:

```js
    let worstNodeProduction = Number.MAX_VALUE; // Used to how productive a newly purchased node might be
    for (var i = 0; i < ns.hacknet.numNodes(); i++) {
        let nodeStats = ns.hacknet.getNodeStats(i);
        if (haveHacknetServers && formulasAvailable) // When a hacknet server runs scripts, nodeStats.production lags behind what it should be for current ram usage. Get the "raw" rate
            nodeStats.production = fnProduction(nodeStats.level, nodeStats.ram, nodeStats.cores);
        // (If we do not have the formulas API yet, we cannot account for this and must simply fall-back to using the production reported by the node)
        worstNodeProduction = Math.min(worstNodeProduction, nodeStats.production);
```

with:

```js
    let worstNodeProduction = Number.MAX_VALUE; // Used to how productive a newly purchased node might be
    let worstNodeStats = null, worstNodeIndex = -1; // HN-1: the (level, ram, cores) a new node must be upgraded to before it produces worstNodeProduction
    for (var i = 0; i < ns.hacknet.numNodes(); i++) {
        let nodeStats = ns.hacknet.getNodeStats(i);
        if (haveHacknetServers && formulasAvailable) // When a hacknet server runs scripts, nodeStats.production lags behind what it should be for current ram usage. Get the "raw" rate
            nodeStats.production = fnProduction(nodeStats.level, nodeStats.ram, nodeStats.cores);
        // (If we do not have the formulas API yet, we cannot account for this and must simply fall-back to using the production reported by the node)
        if (nodeStats.production < worstNodeProduction) [worstNodeStats, worstNodeIndex] = [nodeStats, i];
        worstNodeProduction = Math.min(worstNodeProduction, nodeStats.production);
```

(d) Replace lines 138-143:

```js
    // Compare this to the cost of adding a new node. This is an imperfect science. We are paying to unlock the ability to buy all the same upgrades our
    // other nodes have - all of which have been deemed worthwhile. Not knowing the sum total that will have to be spent to reach that same production,
    // the "most optimistic" case is to treat "price" of all that production to be just the cost of this server, but this is **very** optimistic.
    // In practice, the cost of new hacknodes scales steeply enough that this should come close to being true (cost of server >> sum of cost of upgrades)
    let newNodeCost = ns.hacknet.getPurchaseNodeCost();
    let newNodePayoff = ns.hacknet.numNodes() == ns.hacknet.maxNumNodes() ? 0 : worstNodeProduction / newNodeCost;
```

with:

```js
    // Compare this to the cost of adding a new node. A new node produces next to nothing (level 1, 1 GB, 1 core) until it has been upgraded to
    // match our worst existing node, so (HN-1) the worst node's production is priced at the node cost PLUS the upgrades needed to reach its
    // level, ram and cores: the game's cost formulas via ns.formulas when available, otherwise the same formulas transcribed in costToMatchStats.
    // (Each of those upgrades is later tested against the payoff limit individually, so without this the true payoff of node + upgrades was ~2x the limit.)
    let newNodeCost = ns.hacknet.getPurchaseNodeCost();
    const fnCosts = haveHacknetServers ? ns.formulas.hacknetServers : ns.formulas.hacknetNodes;
    const upgradeCostToMatchWorst = worstNodeStats == null ? 0 : haveFormulas ?
        fnCosts.levelUpgradeCost(1, worstNodeStats.level - 1, playerMults.hacknet_node_level_cost) +
        fnCosts.ramUpgradeCost(1, Math.log2(worstNodeStats.ram), playerMults.hacknet_node_ram_cost) +
        fnCosts.coreUpgradeCost(1, worstNodeStats.cores - 1, playerMults.hacknet_node_core_cost) :
        costToMatchStats(haveHacknetServers, worstNodeStats.level, worstNodeStats.ram, worstNodeStats.cores, playerMults);
    let newNodePayoff = ns.hacknet.numNodes() == ns.hacknet.maxNumNodes() ? 0 : worstNodeProduction / (newNodeCost + upgradeCostToMatchWorst);
```

(`ns.formulas.hacknetServers.levelUpgradeCost(1, 0, m)` returns 0 for `extraLevels < 1`, src/Hacknet/formulas/HacknetServers.ts:21-23, so a worst node at level 1 / 1 GB / 1 core prices at 0 extra.)

(e) Replace lines 155-157:

```js
    let strPurchase = (shouldBuyNewNode ? `a new node "hacknet-node-${ns.hacknet.numNodes()}"` :
        `hacknet-node-${nodeToUpgrade} ${bestUpgrade.name} ${upgradedValue}`) + ` for ${formatMoney(cost)}`;
    let strPayoff = `production ${((shouldBuyNewNode ? newNodePayoff : bestUpgradePayoff) * cost).toPrecision(3)} payoff time: ${formatDuration(1000 * payoffTimeSeconds)}`
```

with:

```js
    let strPurchase = (shouldBuyNewNode ? `a new node "hacknet-node-${ns.hacknet.numNodes()}"` :
        `hacknet-node-${nodeToUpgrade} ${bestUpgrade.name} ${upgradedValue}`) + ` for ${formatMoney(cost)}` +
        (shouldBuyNewNode && upgradeCostToMatchWorst > 0 ? ` (+ ${formatMoney(upgradeCostToMatchWorst)} of upgrades to match hacknet-node-${worstNodeIndex})` : '');
    let strPayoff = `production ${(shouldBuyNewNode ? worstNodeProduction : bestUpgradePayoff * cost).toPrecision(3)} payoff time: ${formatDuration(1000 * payoffTimeSeconds)}`
```

- [ ] **Step 4: Run tests and checks**

`node --test test/hacknet-new-node-cost.test.js` → 5 pass. `node --test` → 135 pass.
`node --check hacknet-upgrade-manager.js` → no output. `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs hacknet-upgrade-manager.js` → `hacknet-upgrade-manager.js: +[] -[]` (`levelUpgradeCost`, `ramUpgradeCost`, `coreUpgradeCost` are formulas functions costing 0 GB; `mem` below confirms).

- [ ] **Step 5: In-game check**

1. `mem hacknet-upgrade-manager.js` before and after: identical.
2. With Formulas.exe and at least one hacknet node, create `/Temp/hn1-check.js`:

```js
import { costToMatchStats } from '/hacknet-upgrade-manager.js';
export async function main(ns) {
    const m = ns.getPlayer().mults, s = ns.hacknet.getNodeStats(0), isServer = ns.hacknet.hashCapacity() > 0;
    const f = isServer ? ns.formulas.hacknetServers : ns.formulas.hacknetNodes;
    const viaFormulas = f.levelUpgradeCost(1, s.level - 1, m.hacknet_node_level_cost) + f.ramUpgradeCost(1, Math.log2(s.ram), m.hacknet_node_ram_cost) + f.coreUpgradeCost(1, s.cores - 1, m.hacknet_node_core_cost);
    ns.tprint(`node 0 (${s.level}/${s.ram}/${s.cores}, server=${isServer}): formulas ${viaFormulas} transcription ${costToMatchStats(isServer, s.level, s.ram, s.cores, m)}`);
}
```

`run /Temp/hn1-check.js` → the two numbers are equal (to floating-point noise).
3. `run hacknet-upgrade-manager.js --max-payoff-time 1E100h --max-spend 1 --tail` (spend limit 1 so nothing is bought): the status line for a new node now reads `... a new node "hacknet-node-N" for $X (+ $Y of upgrades to match hacknet-node-K) ... production P payoff time: T` where P equals node K's production and T = (X + Y) / (P * hash value).

- [ ] **Step 6: Commit**

`git add hacknet-upgrade-manager.js test/hacknet-new-node-cost.test.js && git commit -m "hacknet-upgrade-manager: price new nodes with their catch-up upgrades (HN-1)"`

---

### Task 5: HN-2 — no busy loop while the next purchase is unaffordable

Design decision: keep `--interval` (0 in daemon's kick-start) between successful purchases, and sleep at least 200 ms whenever the loop bought nothing; daemon.js is not changed.

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/hacknet-upgrade-manager.js` line 56 (loop sleep) and add one exported function + constant after `setStatus` (line 63). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/hacknet-idle-interval.test.js` (new).

**Interfaces:**
- Produces `export function nextLoopDelay(interval, moneySpent, idleInterval = 200): number`.

- [ ] **Step 1: Write the failing test**

Create `test/hacknet-idle-interval.test.js`:

```js
// HN-2: --interval 0 (daemon's kick-start) keeps buying back-to-back while purchases succeed, but never polls faster than the idle
// interval while the next purchase is unaffordable (upgradeHacknet returns 0) or nothing is bought (false).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLoopDelay } from "../hacknet-upgrade-manager.js";

test("a successful purchase keeps the configured interval", () => {
    assert.equal(nextLoopDelay(0, 1e6), 0);
    assert.equal(nextLoopDelay(1000, 1e6), 1000);
});

test("no purchase waits at least the idle interval", () => {
    assert.equal(nextLoopDelay(0, 0), 200);
    assert.equal(nextLoopDelay(0, false), 200);
    assert.equal(nextLoopDelay(50, 0), 200);
    assert.equal(nextLoopDelay(1000, 0), 1000);
    assert.equal(nextLoopDelay(0, 0, 500), 500);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/hacknet-idle-interval.test.js` → `SyntaxError: ... does not provide an export named 'nextLoopDelay'`.

- [ ] **Step 3: Implement**

After line 63 (closing `}` of `setStatus`; if Task 4 is done, place this before the HN-1 constants) add:

```js
const minIdleInterval = 200; // HN-2: ms between loops when nothing was bought (e.g. daemon's --interval 0 kick-start waiting for money) instead of ns.sleep(0) spinning ~5 API calls per node per frame

/** HN-2: delay before the next continuous-mode loop: --interval after a successful purchase, at least minIdleInterval otherwise.
 * @param {number} interval @param {number|false} moneySpent upgradeHacknet's return value @param {number} idleInterval */
export function nextLoopDelay(interval, moneySpent, idleInterval = minIdleInterval) {
    return moneySpent > 0 ? interval : Math.max(interval, idleInterval);
}
```

Replace line 56:

```js
        if (continuous) await ns.sleep(interval);
```

with:

```js
        if (continuous) await ns.sleep(nextLoopDelay(interval, moneySpent));
```

`moneySpent` is declared with `const` inside the `try` block on line 42; move the declaration out so it is visible on line 56: replace lines 41-42

```js
        try {
            const moneySpent = upgradeHacknet(ns, maxSpend, maxPayoffTime, options);
```

with

```js
        let moneySpent = 0;
        try {
            moneySpent = upgradeHacknet(ns, maxSpend, maxPayoffTime, options);
```

- [ ] **Step 4: Run tests and checks**

`node --test test/hacknet-idle-interval.test.js` → 2 pass. `node --test` → 137 pass.
`node --check hacknet-upgrade-manager.js` → no output. `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs hacknet-upgrade-manager.js` → `hacknet-upgrade-manager.js: +[] -[]`.

- [ ] **Step 5: In-game check**

`run hacknet-upgrade-manager.js -c --max-payoff-time 1E100h --interval 0 --reserve 1e300 --tail` (the reserve makes every purchase unaffordable): the log shows `The next best purchase would be ... but the cost exceeds the our current available funds` once and the game's FPS stays normal (before the fix this command visibly stuttered the UI). Kill it. Then `run hacknet-upgrade-manager.js -c --max-payoff-time 1h --interval 0 --tail` with money available: purchases still print back-to-back with no 200 ms gaps between successive `Purchased ...` lines.

- [ ] **Step 6: Commit**

`git add hacknet-upgrade-manager.js test/hacknet-idle-interval.test.js && git commit -m "hacknet-upgrade-manager: throttle the idle loop (HN-2)"`

---

### Task 6: SM-3 — apply the diversification cap only pre-4S

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/stockmaster.js` lines 211-213 (budget) and 224-225 (log text), new exported function next to `canAffordToBuy` (Task 1). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/stockmaster-budget.test.js` (new).

**Interfaces:**
- Produces `export function purchaseBudget(pre4s, cash, maxHoldings, diversification, spreadPct, positionValue): number`.

- [ ] **Step 1: Write the failing test**

Create `test/stockmaster-budget.test.js`:

```js
// SM-3: the --diversification cap only applies pre-4S; with exact 4S forecasts the only position limit is the game's maxShares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { purchaseBudget } from "../stockmaster.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test("pre-4S caps a single stock at diversification (+spread) of max holdings, net of the inflated current position", () => {
    close(purchaseBudget(true, 5e9, 10e9, 0.34, 0.01, 0), 3.5e9); // cap binds (35% of 10b)
    close(purchaseBudget(true, 1e9, 1e9, 0.34, 0.01, 0), 3.5e8);
    assert.equal(purchaseBudget(true, 1e8, 10e9, 0.34, 0.01, 0), 1e8); // cash binds
    close(purchaseBudget(true, 5e9, 10e9, 0.34, 0.01, 3e9), 3.5e9 - 3e9 * 1.02); // existing position (inflated by 1.01 + spread) eats the cap
});

test("post-4S the whole cash budget is available for the best stock", () => {
    assert.equal(purchaseBudget(false, 1e9, 10e9, 0.34, 0.01, 0), 1e9);
    assert.equal(purchaseBudget(false, 1e9, 10e9, 0.34, 0.01, 5e9), 1e9);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/stockmaster-budget.test.js` → `SyntaxError: ... does not provide an export named 'purchaseBudget'`.

- [ ] **Step 3: Implement**

Directly after `canAffordToBuy` (added in Task 1) add:

```js
/** SM-3: how much of `cash` may go into one stock this loop. Pre-4S: the --diversification cap (with the spread inflation that avoids
 * repeated micro-buys). Post-4S the forecast is the exact otlkMag (src/NetscriptFunctions/StockMarket.ts getForecast), so no cap: the
 * game's maxShares (applied by the caller) is the only position limit.
 * @param {boolean} pre4s @param {number} cash @param {number} maxHoldings @param {number} diversification @param {number} spreadPct @param {number} positionValue */
export function purchaseBudget(pre4s, cash, maxHoldings, diversification, spreadPct, positionValue) {
    if (!pre4s) return cash;
    return Math.min(cash, maxHoldings * (diversification + spreadPct) - positionValue * (1.01 + spreadPct));
}
```

Replace lines 211-213:

```js
                    // Enforce diversification: Don't hold more than x% of our portfolio as a single stock (as corpus increases, this naturally stops being a limiter)
                    // Inflate our budget / current position value by a factor of stk.spread_pct to avoid repeated micro-buys of a stock due to the buy/ask spread making holdings appear more diversified after purchase
                    let budget = Math.min(cash, maxHoldings * (diversification + stk.spread_pct) - stk.positionValue() * (1.01 + stk.spread_pct))
```

with:

```js
                    // Enforce diversification pre-4S only (SM-3): Don't hold more than x% of our portfolio as a single stock (as corpus increases, this naturally stops being a limiter)
                    // Inflate our budget / current position value by a factor of stk.spread_pct to avoid repeated micro-buys of a stock due to the buy/ask spread making holdings appear more diversified after purchase
                    let budget = purchaseBudget(pre4s, cash, maxHoldings, diversification, stk.spread_pct, stk.positionValue());
```

Replace line 225:

```js
                            `(${(100 * stk.positionValue() / maxHoldings).toFixed(1)}% of corpus, capped at ${(diversification * 100).toFixed(1)}% by --diversification).\n`) +
```

with:

```js
                            `(${(100 * stk.positionValue() / maxHoldings).toFixed(1)}% of corpus${pre4s ? `, capped at ${(diversification * 100).toFixed(1)}% by --diversification` : ''}).\n`) +
```

- [ ] **Step 4: Run tests and checks**

`node --test test/stockmaster-budget.test.js` → 2 pass. `node --test` → 139 pass.
`node --check stockmaster.js` → no output. `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs stockmaster.js` → `stockmaster.js: +[nextUpdate=RamCostConstants.CycleTiming] -[]` (unchanged since Task 3; if Task 3 is not yet done: `+[] -[]`).

- [ ] **Step 5: In-game check**

With 4S and a corpus small relative to `maxShares * price` (early after buying 4S): `run stockmaster.js --tail --noisy`; after the first purchase round the best-ER stock's position (the `Buying ... (x/maxShares)` line, or the `Pos:` column with `--show-market-summary`) exceeds 34% of holdings; before the fix it stopped at 34-35%. Pre-4S saves: unchanged behaviour (cap still logged as `capped at 34.0% by --diversification`).

- [ ] **Step 6: Commit**

`git add stockmaster.js test/stockmaster-budget.test.js && git commit -m "stockmaster: diversification cap only pre-4S (SM-3)"`

---

### Task 7: SM-4 — pre-4S volatility over the near-term window

Design decision: volatility = max single-tick move over the most recent `nearTermForecastWindowLength` (10) ticks, scaled by `(n+1)/n` so the expectation of the max of n uniform draws equals the true `mv` (the 151-tick max had expectation 0.993 mv; unscaled, a 10-tick max would be 9% low).

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/stockmaster.js` lines 365-366, new exported function next to `purchaseBudget`. Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/stockmaster-volatility.test.js` (new).

**Interfaces:**
- Produces `export function estimateVolatility(priceHistory, windowLength): number` (history is newest-first, as `updateForecast` keeps it).

- [ ] **Step 1: Write the failing test**

Create `test/stockmaster-volatility.test.js`:

```js
// SM-4: pre-4S volatility is the largest single-tick move over the near-term window only (a darknet-promoted stock's volatility decays
// x0.4 every cycle, src/StockMarket/StockMarket.ts scaleDarknetVolatilityIncreases), unbiased by (n+1)/n for the max of n uniform draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateVolatility } from "../stockmaster.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("uses only the newest windowLength moves (history is newest-first)", () => {
    // moves (newest first): 1%, 2%, 3%, then an old 50% spike outside a 3-move window
    const history = [103.02, 102, 100, 100 / 1.03, 200 / 1.03, 200 / 1.03];
    close(estimateVolatility(history, 3), 0.03 * 4 / 3);
    close(estimateVolatility(history, 5), 0.5 * 6 / 5); // a wider window still sees the spike
});

test("window is clipped to the available history and empty history gives 0", () => {
    close(estimateVolatility([101, 100], 10), 0.01 * 2 / 1);
    assert.equal(estimateVolatility([100], 10), 0);
    assert.equal(estimateVolatility([], 10), 0);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/stockmaster-volatility.test.js` → `SyntaxError: ... does not provide an export named 'estimateVolatility'`.

- [ ] **Step 3: Implement**

Directly after `purchaseBudget` add:

```js
/** SM-4: pre-4S volatility estimate: the largest single-tick move (|newer - older| / older, i.e. the game's `av`) over the most recent
 * `windowLength` ticks of a newest-first price history, scaled by (n+1)/n because the expected max of n draws of av ~ U(0, mv) is n/(n+1)*mv.
 * A cycle-long window would keep a darknet-promoted stock's peak volatility for two cycles after its x0.4 per-cycle decay.
 * @param {number[]} priceHistory @param {number} windowLength */
export function estimateVolatility(priceHistory, windowLength) {
    const n = Math.min(windowLength, priceHistory.length - 1);
    if (n <= 0) return 0;
    let maxMove = 0;
    for (let idx = 1; idx <= n; idx++)
        maxMove = Math.max(maxMove, Math.abs(priceHistory[idx - 1] - priceHistory[idx]) / priceHistory[idx]);
    return maxMove * (n + 1) / n;
}
```

Replace lines 365-366:

```js
        // Volatility is easy - the largest observed % movement in a single tick
        if (!has4s) stk.vol = stk.priceHistory.reduce((max, price, idx) => Math.max(max, idx == 0 ? 0 : Math.abs(stk.priceHistory[idx - 1] - price) / price), 0);
```

with:

```js
        // Volatility is easy - the largest observed % movement in a single tick. SM-4: only over the near-term window, because a darknet-promoted
        // stock's volatility decays x0.4 at every market cycle and the full 151-tick history would keep its peak for two cycles.
        if (!has4s) stk.vol = estimateVolatility(stk.priceHistory, nearTermForecastWindowLength);
```

- [ ] **Step 4: Run tests and checks**

`node --test test/stockmaster-volatility.test.js` → 2 pass. `node --test` → 141 pass.
`node --check stockmaster.js` → no output. collide.mjs output unchanged from the previous stockmaster task.

- [ ] **Step 5: In-game check**

Pre-4S save with darknet promotions active (`darknet.js` running, `promote.js` workers visible in `ps`): `run stockmaster.js --show-market-summary --tail`. In the summary window the `Vol:` column of promoted (held) stocks drops within ~10 ticks after the `Market day 1` line (cycle start) instead of staying at its pre-cycle peak for 75+ ticks; unpromoted stocks show `Vol:` values within about ±10% of what the old build showed for them.

- [ ] **Step 6: Commit**

`git add stockmaster.js test/stockmaster-volatility.test.js && git commit -m "stockmaster: pre-4S volatility over the near-term window (SM-4)"`

---

### Task 8: HN-4 — correct the contract comment and only generate contracts while contractor.js runs

Design decision: `Tasks/contractor.js` is a periodic script (daemon.js launches it every 27 s, line 409), so an `isRunning` check would almost always say "not running"; instead contractor.js writes a heartbeat `/Temp/contractor-heartbeat.txt` (`ns.write`, 0 GB) on every run and spend-hacknet-hashes.js (`ns.read`, 0 GB) only generates contracts while that heartbeat is younger than `--contractor-max-age` (300 s). If daemon runs contractor.js off-home (low home RAM) the heartbeat lands elsewhere and no contracts are generated, which is the safe direction.

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/spend-hacknet-hashes.js` lines 14 (comment), 19 (argsSchema, append two options), 72-73 (`isWorthBuying`), 79-81 (startup log), plus an exported function after line 28; `/home/jubnl/dev/bitburner/bitburner-scripts/Tasks/contractor.js` line 9 (add heartbeat). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/spend-hashes-contractor.test.js` (new).

**Interfaces:**
- Produces `export function contractorIsActive(heartbeatText, nowMs, maxAgeMs): boolean` and `export const contractorHeartbeatFile = '/Temp/contractor-heartbeat.txt'` in spend-hacknet-hashes.js. Tasks/contractor.js writes the same path (literal, to keep contractor.js's imports unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/spend-hashes-contractor.test.js`:

```js
// HN-4: contracts are only generated while Tasks/contractor.js has written its heartbeat recently (contracts nobody solves are worth nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contractorIsActive, contractorHeartbeatFile } from "../spend-hacknet-hashes.js";

test("heartbeat path is the one contractor.js writes", () => {
    assert.equal(contractorHeartbeatFile, "/Temp/contractor-heartbeat.txt");
});

test("active only while the heartbeat is younger than max age", () => {
    const now = 1_700_000_000_000;
    assert.equal(contractorIsActive(String(now - 10_000), now, 300_000), true);
    assert.equal(contractorIsActive(String(now - 300_000), now, 300_000), true);
    assert.equal(contractorIsActive(String(now - 300_001), now, 300_000), false);
});

test("missing or malformed heartbeat is inactive", () => {
    assert.equal(contractorIsActive("", Date.now(), 300_000), false);
    assert.equal(contractorIsActive("not a number", Date.now(), 300_000), false);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/spend-hashes-contractor.test.js` → `SyntaxError: ... does not provide an export named 'contractorIsActive'`.

- [ ] **Step 3: Implement spend-hacknet-hashes.js**

(a) Replace line 14:

```js
    ['max-contract-cost-ratio', 40], // Only generate a contract while its hash cost (25 * (contracts generated + 1)) is at most this many times the 'Sell for Money' cost (4 hashes). A contract pays >= $25m * difficulty (v3.0: 75e6 * difficulty * BN mult / 3), so at the default ratio (160 hashes = $40m) it is still a bargain.
```

with:

```js
    ['max-contract-cost-ratio', 40], // Only generate a contract while its hash cost (25 * (contracts generated + 1)) is at most this many times the 'Sell for Money' cost (4 hashes). A generated contract's reward is picked uniformly from faction rep, all-faction rep, company rep and money (v3.0 src/CodingContract/ContractGenerator.ts getRandomReward), and the money reward is 75e6 * difficulty * BN mult * scaling (src/PersonObjects/Player/PlayerObjectGeneralMethods.ts), so the expected money is only a quarter of that; at the default ratio (160 hashes = $40m of 'Sell for Money') it is still a bargain, and the reputation rewards are the real value. Only at most 6 contracts per install are this cheap (the level resets on install).
    ['require-contractor', true], // HN-4: only generate contracts while Tasks/contractor.js has run recently (it writes /Temp/contractor-heartbeat.txt on every run; daemon.js launches it every 27 s). Contracts nobody solves are worth nothing.
    ['contractor-max-age', 300], // (seconds) How old the contractor heartbeat may be for --require-contractor
```

(b) After line 28 (`const minTimeBetweenToasts = 5000; ...`) add:

```js
export const contractorHeartbeatFile = '/Temp/contractor-heartbeat.txt'; // HN-4: written by Tasks/contractor.js on every run (ms timestamp)

/** HN-4: whether the contract solver ran recently enough for a generated contract to get solved.
 * @param {string} heartbeatText contents of contractorHeartbeatFile (a Date.now() string, or '' when missing) @param {number} nowMs @param {number} maxAgeMs */
export function contractorIsActive(heartbeatText, nowMs, maxAgeMs) {
    const lastRun = Number(heartbeatText);
    return heartbeatText != '' && Number.isFinite(lastRun) && nowMs - lastRun <= maxAgeMs;
}
```

(c) Replace lines 71-73:

```js
    // Predicate: an action is worth buying unless it is our (implicit) contract generation and contracts have become too expensive relative to money
    const isWorthBuying = (spendAction) => spendAction != generateContract || !contractsBeforeMoney ||
        ns.hacknet.hashCost(generateContract) <= maxContractCostRatio * ns.hacknet.hashCost(sellForMoney);
```

with:

```js
    // Predicate: an action is worth buying unless it is our (implicit) contract generation and contracts have become too expensive relative to money,
    // or (HN-4) nobody is around to solve them (contractor.js heartbeat too old; ns.read is 0 GB)
    const isWorthBuying = (spendAction) => spendAction != generateContract || !contractsBeforeMoney ||
        (ns.hacknet.hashCost(generateContract) <= maxContractCostRatio * ns.hacknet.hashCost(sellForMoney) &&
            (!options['require-contractor'] || contractorIsActive(ns.read(contractorHeartbeatFile), Date.now(), options['contractor-max-age'] * 1000)));
```

(d) Replace lines 79-81:

```js
    if (contractsBeforeMoney)
        ns.print(`Will prefer '${generateContract}' over '${sellForMoney}' while a contract costs at most ${maxContractCostRatio}x the money cost ` +
            `(--contracts-before-money / --max-contract-cost-ratio).`);
```

with:

```js
    if (contractsBeforeMoney)
        ns.print(`Will prefer '${generateContract}' over '${sellForMoney}' while a contract costs at most ${maxContractCostRatio}x the money cost ` +
            `(--contracts-before-money / --max-contract-cost-ratio)` + (options['require-contractor'] ?
                ` and Tasks/contractor.js has run in the last ${options['contractor-max-age']}s (--require-contractor).` : '.'));
```

- [ ] **Step 4: Implement the heartbeat in Tasks/contractor.js**

Replace line 9:

```js
    disableLogs(ns, ["scan"]);
```

with:

```js
    disableLogs(ns, ["scan"]);
    ns.write('/Temp/contractor-heartbeat.txt', String(Date.now()), 'w'); // HN-4: lets spend-hacknet-hashes.js know that generated contracts will get solved (0 GB)
```

- [ ] **Step 5: Run tests and checks**

`node --test test/spend-hashes-contractor.test.js` → 3 pass. `node --test` → 144 pass.
`node --check spend-hacknet-hashes.js && node --check Tasks/contractor.js` → no output.
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs spend-hacknet-hashes.js` → `spend-hacknet-hashes.js: +[] -[]` (`read` costs 0); `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs Tasks/contractor.js` → `Tasks/contractor.js: +[] -[]` (`write` costs 0).

- [ ] **Step 6: In-game check**

1. `mem spend-hacknet-hashes.js` and `mem /Tasks/contractor.js` before and after: identical.
2. With daemon.js running (it launches contractor.js every 27 s): `cat /Temp/contractor-heartbeat.txt` shows a recent ms timestamp that changes every ~27 s. `run spend-hacknet-hashes.js --liquidate --tail` (hacknet servers, SF9) logs `Spent 25.000 hashes on 1x 'Generate Coding Contract'` as before.
3. Kill daemon.js (`kill daemon.js`), wait 5 min, restart spend-hacknet-hashes.js with `--liquidate --tail`: only `Sell for Money` purchases appear. `run spend-hacknet-hashes.js --liquidate --require-contractor false --tail` generates contracts again.

- [ ] **Step 7: Commit**

`git add spend-hacknet-hashes.js Tasks/contractor.js test/spend-hashes-contractor.test.js && git commit -m "spend-hacknet-hashes: generate contracts only while contractor.js runs (HN-4)"`

---

### Task 9: ST-2 — score Stanek layouts by fragment power with multiplicative boosters

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/optimize-stanek.js` lines 319-325 (`planBoosters` leaf score), new exported function after `planBoosters` (line 353). Test: `/home/jubnl/dev/bitburner/bitburner-scripts/test/optimize-stanek-score.test.js` (new).

**Interfaces:**
- Produces `export function scoreLayout(stats, boosters): number` where each element is a `Placement` (`{ key, fragment: { power }, adjacentBoosters: Int16Array }` for stats; `{ key, fragment: { power } }` for boosters).

- [ ] **Step 1: Write the failing test**

Create `test/optimize-stanek-score.test.js`:

```js
// ST-2: a layout is worth the sum over stat fragments of power x (product of the powers of the distinct adjacent boosters), which is how the
// game values it (src/CotMG/StaneksGift.ts effect: boost *= neighbour.fragment().power; src/CotMG/formulas/effect.ts: effect ~ power * boost).
// Fragment powers from src/CotMG/Fragment.ts: Hacking 1, HackingSpeed 1.3, HackingMoney 2, HackingGrow 0.5, Rep 0.5, boosters 1.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLayout } from "../optimize-stanek.js";

const stat = (key, power, adjacentBoosterKeys) => ({ key, fragment: { power }, adjacentBoosters: Int16Array.from(adjacentBoosterKeys) });
const booster = (key) => ({ key, fragment: { power: 1.1 } });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("no boosters: the sum of the fragment powers", () => {
    close(scoreLayout([stat(0, 1, []), stat(1, 2, []), stat(2, 0.5, [])], []), 3.5);
});

test("boosters multiply each adjacent stat by 1.1 per distinct booster", () => {
    close(scoreLayout([stat(0, 2, [7, 8]), stat(1, 0.5, [8])], [booster(7), booster(8)]), 2 * 1.1 * 1.1 + 0.5 * 1.1);
    close(scoreLayout([stat(0, 2, [7, 8])], [booster(7)]), 2 * 1.1); // booster 8 is not placed
});

test("a booster next to HackingMoney (power 2) beats one next to Rep (power 0.5)", () => {
    const layoutA = scoreLayout([stat(0, 2, [7]), stat(1, 0.5, [])], [booster(7)]);
    const layoutB = scoreLayout([stat(0, 2, []), stat(1, 0.5, [7])], [booster(7)]);
    assert.ok(layoutA > layoutB);
});
```

- [ ] **Step 2: Run it, expect an import failure**

`node --test test/optimize-stanek-score.test.js` → `SyntaxError: ... does not provide an export named 'scoreLayout'`.

- [ ] **Step 3: Implement**

Replace lines 319-325:

```js
    if (availableCount == 0) {
        const { stats, boosters } = plan;

        let score = 0;
        for (let i = 0; i < boosters.length; i++)
            score += boosterStatAdjacencies[boosters[i].key];
        score = stats.length * (1 + 0.1 * score); // piecesPlaced*(1+0.1*numAdjacencies)
```

with:

```js
    if (availableCount == 0) {
        const { stats, boosters } = plan;
        const score = scoreLayout(stats, boosters); // ST-2: power-weighted, boosters multiply (was piecesPlaced*(1+0.1*numAdjacencies))
```

After the closing `}` of `planBoosters` (line 353) add:

```js
/** ST-2: score a layout the way the game values it: each stat fragment's effect is proportional to its own power times the product of the
 * powers (1.1 each) of the distinct boosters touching it (src/CotMG/StaneksGift.ts effect, src/CotMG/formulas/effect.ts CalculateEffect).
 * Adding a stat or a booster never lowers the score, so planStats/planBoosters may keep scoring only maximal booster sets.
 * @param {Placement[]} stats @param {Placement[]} boosters @return {number} */
export function scoreLayout(stats, boosters) {
    let score = 0;
    for (const stat of stats) {
        let boost = 1;
        for (const booster of boosters)
            if (stat.adjacentBoosters.includes(booster.key)) boost *= booster.fragment.power;
        score += stat.fragment.power * boost;
    }
    return score;
}
```

- [ ] **Step 4: Run tests and checks**

`node --test test/optimize-stanek-score.test.js` → 3 pass. `node --test` → 147 pass.
`node --check optimize-stanek.js` → no output. `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs optimize-stanek.js` → `optimize-stanek.js: +[] -[]`.

- [ ] **Step 5: In-game check**

`run optimize-stanek.js` (offline tool, needs Stanek's Gift accepted for `ns.stanek.fragmentDefinitions()`): it still prints one score and one JSON layout per board size 3x3..5x6, scores are now non-integers like `9.68` (sum of powers times 1.1^k) instead of `N*(1+0.1*k)`, and in the printed layouts the boosters sit next to the id 6 (HackingMoney, power 2) and id 21 (HacknetCost, power 2) fragments rather than id 25 (Rep, 0.5).

- [ ] **Step 6: Commit**

`git add optimize-stanek.js test/optimize-stanek-score.test.js && git commit -m "optimize-stanek: score layouts by power with multiplicative boosters (ST-2)"`

---

### Task 10: GO-3 — call the Go analysis functions directly once the host has spare RAM

Design decision: the five functions cost 60 GB of *static* RAM if referenced by name (src/Netscript/RamCostGenerator.ts:304-315), so instead of a second script variant, go.js grows its own allocation at runtime with `ns.ramOverride(current + 60)` (0 GB; src/NetscriptFunctions.ts:1240, documented in NetscriptDefinitions.d.ts:8408-8425) once its host has at least 80 GB free, and then calls the functions through string-keyed property access: the static RAM calculator only counts `Identifier` nodes (src/Script/RamCalculations.ts:407 and :436, a `Literal` property is not visited), while the dynamic check (src/Netscript/NetscriptHelpers.tsx updateDynamicRam) charges each function once against the enlarged allocation. The switch is attempted once per game; on failure (not enough free RAM) the temp-script path stays.

**Files:** Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js` lines 146-166 (ram-dodging helpers), 189-190 (`playGo` start), 386-393 (`checkNewGame`). No unit test (game RAM machinery); in-game verification below.

**Interfaces:**
- Module-private `async function tryEnableDirectAnalysis(ns)` and flag `directAnalysis`; the five `go_*` helpers keep their signatures.

- [ ] **Step 1: Implement**

Replace lines 146-166:

```js
    // Ram-dodging helpers (Allows the script to only require as much RAM as its most expensive function)
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_getBoardState(ns) {
        return await getNsDataThroughFile(ns, `ns.go.getBoardState()`);
    }
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_analysis_getControlledEmptyNodes(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`);
    }
    /** @param {NS} ns @returns {Promise<boolean[][]>} */
    async function go_analysis_getValidMoves(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getLiberties(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getChains(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`);
    }
```

with:

```js
    // Ram-dodging helpers (Allows the script to only require as much RAM as its most expensive function)
    // GO-3: getBoardState / getValidMoves / getChains / getLiberties / getControlledEmptyNodes cost 4+8+16+16+16 = 60 GB of static RAM when
    // referenced by name (src/Netscript/RamCostGenerator.ts), so by default each is fetched through a temp script (5 launches per move). Once
    // our host has plenty of free RAM we grow this script's allocation with ns.ramOverride (0 GB) and call them directly through a string-keyed
    // property lookup: the static RAM calculator only counts Identifier nodes (src/Script/RamCalculations.ts), and the dynamic check
    // (src/Netscript/NetscriptHelpers.tsx updateDynamicRam) charges each function once against the enlarged allocation.
    const directAnalysisRam = 60;
    const directAnalysisMinFreeRam = 80; // Only switch with this much free on our host (leaves ~20 GB for other scripts' temp scripts)
    let directAnalysis = false;
    const goApi = () => ns.go, goAnalysis = () => ns.go.analysis;

    /** Switch to direct Go analysis calls if our host has >= directAnalysisMinFreeRam GB free. Called once per game; cheap no-op once enabled.
     * @param {NS} ns */
    async function tryEnableDirectAnalysis(ns) {
        if (directAnalysis) return;
        const freeRam = await getNsDataThroughFile(ns, 'ns.getServerMaxRam(ns.getHostname()) - ns.getServerUsedRam(ns.getHostname())', '/Temp/go-host-free-ram.txt');
        if (freeRam < directAnalysisMinFreeRam) return;
        const currentRam = ns.ramOverride(); // No argument: returns the current allocation unchanged
        const newRam = ns.ramOverride(currentRam + directAnalysisRam);
        directAnalysis = newRam >= currentRam + directAnalysisRam;
        log(ns, directAnalysis ? `INFO: go.js RAM allocation raised from ${currentRam} GB to ${newRam} GB: Go analysis functions are now called directly (no temp scripts).` :
            `INFO: go.js could not raise its RAM allocation to ${currentRam + directAnalysisRam} GB (host has ${freeRam.toFixed(1)} GB free). Still ram-dodging Go analysis.`);
    }
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_getBoardState(ns) {
        if (directAnalysis) return goApi()["getBoardState"]();
        return await getNsDataThroughFile(ns, `ns.go.getBoardState()`);
    }
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_analysis_getControlledEmptyNodes(ns) {
        if (directAnalysis) return goAnalysis()["getControlledEmptyNodes"]();
        return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`);
    }
    /** @param {NS} ns @returns {Promise<boolean[][]>} */
    async function go_analysis_getValidMoves(ns) {
        if (directAnalysis) return goAnalysis()["getValidMoves"]();
        return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getLiberties(ns) {
        if (directAnalysis) return goAnalysis()["getLiberties"]();
        return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getChains(ns) {
        if (directAnalysis) return goAnalysis()["getChains"]();
        return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`);
    }
```

Replace lines 189-190:

```js
    async function playGo(ns) {
        const startBoard = await go_getBoardState(ns)
```

with:

```js
    async function playGo(ns) {
        await tryEnableDirectAnalysis(ns); // GO-3
        const startBoard = await go_getBoardState(ns)
```

Replace lines 386-393:

```js
    async function checkNewGame(ns, gameInfo) {
        if (gameInfo.type === "gameOver") {
            if (runOnce) ns.exit()
            await startNewGame(ns);
            turn = 0
            ns.clearLog()
        }
    }
```

with:

```js
    async function checkNewGame(ns, gameInfo) {
        if (gameInfo.type === "gameOver") {
            if (runOnce) ns.exit()
            await startNewGame(ns);
            turn = 0
            ns.clearLog()
            await tryEnableDirectAnalysis(ns); // GO-3: re-check once per game, home RAM grows over the run
        }
    }
```

- [ ] **Step 2: Checks**

`node --check go.js` → no output. `node --test` → 147 pass (unchanged).
`node /home/jubnl/dev/bitburner/tools/harness/collide.mjs go.js` → `go.js: +[] -[]` (`ramOverride` costs 0; the five function names appear only inside string literals, which neither collide.mjs nor the game's static calculator count).

- [ ] **Step 3: In-game check**

1. `mem go.js` before and after: identical (this is the whole point; if it grew by 60 GB a function name leaked as an identifier).
2. On a home with >= 80 GB free: `run go.js --tail`. Within the first game the log shows `INFO: go.js RAM allocation raised from X GB to X+60 GB: Go analysis functions are now called directly`. `ps` / `top` shows go.js at X+60 GB. Moves continue with no `Dynamic RAM usage calculated to be greater than RAM allocation` error, and `rm /Temp/go-analysis-getChains.txt` is not recreated over the next game. Move latency (with `--logtime`) drops by roughly 100-200 ms per move.
3. On a home with < 80 GB free: the log shows `could not raise its RAM allocation` (or nothing if the free-RAM check fails first) and `/Temp/go-analysis-*.txt` keep being refreshed every move, exactly as before.

- [ ] **Step 4: Commit**

`git add go.js && git commit -m "go: call analysis functions directly when the host has spare RAM (GO-3)"`

---

## Skipped (suspected findings, per the brief)

- **GO-1** (13x13 default vs favor farming): suspected; the pattern engine's win rate on small boards is unverified.
- **GO-2** (Slum Snakes ordering vs cheat success): suspected.
- **HN-3** (hash valuation ignores server boosts): suspected; the value of +2% max money depends on daemon's utilisation.

## Self-review

**Spec coverage (section 5, confirmed findings):**

| Finding | Task |
|---|---|
| SM-1 fracB gate post-4S | Task 1 |
| SM-2 tick polling, five temp scripts, tryGet4SApi checks | Task 3 |
| SM-3 diversification cap post-4S | Task 6 |
| SM-4 pre-4S volatility window | Task 7 |
| HN-1 new-node payoff pricing | Task 4 |
| HN-2 `--interval 0` busy loop | Task 5 |
| HN-4 contract comment + contractor gate | Task 8 |
| ST-1 Stanek top-up after home RAM doubles | Task 2 |
| ST-2 layout score | Task 9 |
| GO-3 five temp scripts per move | Task 10 |
| GO-1, GO-2, HN-3 | Skipped (suspected) |

**Placeholder scan:** no TBD/TODO/"similar to"/"handle edge cases"; every step shows the exact old and new code, the exact test file contents, and the exact commands with expected output. Expected `node --test` totals: 126 → 128 (T1) → 130 (T2) → 130 (T3) → 135 (T4) → 137 (T5) → 139 (T6) → 141 (T7) → 144 (T8) → 147 (T9) → 147 (T10).

**Name/signature consistency:** `canAffordToBuy(pre4s, money, reserve, corpus, fracB, fracH, commissionCost)` (T1 code = T1 test); `purchaseBudget(pre4s, cash, maxHoldings, diversification, spreadPct, positionValue)` (T6); `estimateVolatility(priceHistory, windowLength)` (T7); `costToMatchStats(isServer, level, ram, cores, mults)` (T4 code, test and in-game script); `nextLoopDelay(interval, moneySpent, idleInterval)` (T5); `contractorIsActive(heartbeatText, nowMs, maxAgeMs)` and `contractorHeartbeatFile` = `/Temp/contractor-heartbeat.txt` (T8, same literal in Tasks/contractor.js); `selectTopUpFragments(fragments, toppedUpIds, attempts)` (T2, used in three places in stanek.js); `scoreLayout(stats, boosters)` (T9). Task 3 introduces `getStockRefreshDict(ns, has4s)` and keeps `getStockInfoDict(ns, stockFunction)` for `getMaxShares`/`getPosition`. Tasks 4 and 5 both insert code after `setStatus` in hacknet-upgrade-manager.js and both touch the `moneySpent`/`playerMults` area; the order (T4 then T5) is reflected in the line references. The collide.mjs exception for `nextUpdate` (T3) is the only expected non-empty `+[...]`.
