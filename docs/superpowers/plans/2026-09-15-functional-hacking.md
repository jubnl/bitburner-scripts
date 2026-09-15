# Hacking Core Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HWGW scheduler launch batch tasks just in time and chain rounds without gaps, stop home-RAM purchases from vetoing purchased servers, and remove the per-loop bookkeeping that overruns the daemon's loop budget (spec section 1, HC-1..HC-11, all confirmed).

**Architecture:** `daemon.js` keeps its per-batch plan (`getScheduleTiming` / `getScheduleObject`) but holds planned tasks in an in-memory queue that a launcher execs `loopInterval` before each task's start; a target's next round is planned as soon as its current round's last batch begins launching. Per-loop caches (used RAM snapshot, file lists, max RAM) move to "refresh when it changes" cadences. `host-manager.js` records its own purchased-server spend in `/Temp/host-manager-spend.txt` so the daemon's budget no longer sees home upgrades. Every decision changed is extracted into a small exported pure function (all five scripts import cleanly in Node 24, verified) and unit-tested; scheduler behaviour is verified in-game.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22 `node:test` for unit tests, tools/harness for RAM checks and the headless game.

**Spec:** docs/audit/2026-09-15-functional-review.md, section 1.

## Global Constraints

- Never edit anything under /home/jubnl/dev/bitburner/bitburner-src.
- One finding per commit (or one file's worth of tightly related findings); commit message names the finding ID, e.g. `daemon: launch batch tasks just in time (HC-1)`. No Co-Authored-By or session trailers. Never push. Never touch .idea/. Per the user's global rules, stop before each `git commit` and let the user trigger it (the commands below are what to hand them).
- After every script edit run `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>` from `/home/jubnl/dev/bitburner/bitburner-scripts`; any `+[...]` output is a new RAM charge from an identifier whose name equals an NS function (spawn, exec, grow, hack, share, kill, attempt, connect, scan, weaken, run, ps, ls, read, write ...) - rename it. None of the identifiers introduced below collide (checked against RamCostGenerator.ts names).
- Run the full Node suite with a bare `node --test` from the scripts repo root (126 tests pass at HEAD 7d13c98). No globs or pipes on that command.
- Scope discipline: fix the finding, do not refactor around it.
- Line numbers below are as of HEAD 7d13c98 and are quoted per task *before* that task's edits; later tasks in the same file shift lines, so locate by the quoted old code, not the number.
- Exported pure helpers live at the top level of the script (outside `main`), contain no `ns` references, and therefore add no RAM.

## Default changes for the user to approve

| Script / option | Old | New | Why |
|---|---|---|---|
| `Tasks/ram-manager.js --core-max-cash-fraction` (new, branch-added core logic) | n/a (cores bought with any leftover budget) | `0.05` | HC-9: a home core (7.5 b, 56 b, ...) buys 6.25% fewer grow/weaken threads on home only; only buy one when it is under 5% of cash. |
| `Tasks/backdoor-all-servers.js --reserved-home-ram` (upstream option, value unchanged) | `22` = "do not spawn if home free RAM is below 22 GB (assumes 3.6 GB per backdoor)" | `22` = "leave at least 22 GB free on home *after* spawning a backdoor script of its measured size" | HC-11: below SF4.3 a backdoor script costs 33.6 GB, so the old guard never protected anything. |

No other upstream default is changed. `--queue-delay`, `--cycle-timing-delay`, `--max-batches`, `--share-*` keep their values.

---

### Task 1: HC-1 — launch batch tasks just in time and chain rounds

**Files:**
- Modify: `daemon.js` — argsSchema comment lines 61-65 (`max-batches`), VARS lines 105-107 (`maxBatches` TODO), startup resets lines 279-292, `doTargetingLoop` lines 715-1010 (loop head 722-729, `isWorkCapped` 790-795, targeting branch 825-827, TODO comment 904-908, status log 985), `Server.isPrepping`/`isTargeting` lines 1229-1236, `performScheduling` lines 1484-1531.
- Test: `test/daemon-batch-queue.test.js` (new).

**Interfaces:**
- Produces (top-level exports of `daemon.js`, pure):
  - `export function partitionDueTasks(queue, now, leadMs)` → `[due, pending]` where `due` = tasks with `task.start - leadMs <= now`, sorted ascending by `start`; `pending` = the rest in original order.
  - `export function nextRoundStart(now, queueDelay, prevLastBatchStart, cycleTimingDelay)` → `Math.max(now + queueDelay, (prevLastBatchStart ?? 0) + cycleTimingDelay)`.
  - `export function canPlanNextRound(roundInfo, now, leadMs)` → `roundInfo != null && now >= roundInfo.readyAt - leadMs`.
- Produces (inside `main`, used by Task 3): `enqueueTask(target, start, toolShortName, threads, args, threadsByCores = null, allowSplit = null, description = '')`, `async launchDueTasks(ns) → number` (launch failures in this call), `queuedTaskCount(serverName, descriptionPrefix = '')`.
- Consumes: existing `arbitraryExecution`, `getScheduleTiming`, `getScheduleObject`, `getFlagsArgs`, `optimizePerformanceMetrics`, `getTool`. Remote scripts are unchanged (they compute `sleepDuration = start_time - Date.now()` themselves).

Design decision: a task that cannot be exec'd when due is dropped (logged, counted); because tasks launch in start order (W1 at F+δ, W2 at F+3δ, G at F+W-G+2δ, H at F+W-H), RAM pressure drops hacks first, which is the benign failure (no theft, server stays prepped). Launch failures in a loop suppress *new* planning in the next loop and count toward the existing high-utilization back-off, so the daemon self-limits instead of thrashing.

- [ ] **Step 1: Write the failing unit test**

```js
// test/daemon-batch-queue.test.js
// HC-1: pure helpers of the just-in-time batch launcher in daemon.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionDueTasks, nextRoundStart, canPlanNextRound } from "../daemon.js";

test("partitionDueTasks returns due tasks sorted by start and keeps the rest", () => {
    const queue = [{ start: 5000, id: "c" }, { start: 1500, id: "a" }, { start: 2200, id: "b" }, { start: 900, id: "z" }];
    const [due, pending] = partitionDueTasks(queue, 1000, 1000);
    assert.deepEqual(due.map((t) => t.id), ["z", "a"]); // 900 and 1500 are within 1000 ms of now=1000
    assert.deepEqual(pending.map((t) => t.id), ["c", "b"]); // original order preserved
    assert.equal(queue.length, 4, "input is not mutated");
});

test("partitionDueTasks with an empty queue", () => {
    assert.deepEqual(partitionDueTasks([], 0, 1000), [[], []]);
});

test("nextRoundStart continues the previous cadence when it is still in the future", () => {
    // previous round's last batch started at t=10000, cycle 2000 -> next batch at 12000, which is later than now + queueDelay (11000)
    assert.equal(nextRoundStart(10000, 1000, 10000, 2000), 12000);
});

test("nextRoundStart falls back to now + queueDelay when the cadence is in the past or unknown", () => {
    assert.equal(nextRoundStart(50000, 1000, 10000, 2000), 51000);
    assert.equal(nextRoundStart(50000, 1000, undefined, 2000), 51000);
});

test("canPlanNextRound is true once the last batch's first task is due to launch", () => {
    const round = { lastBatchStart: 20000, readyAt: 20500, nextBatchNumber: 40 };
    assert.equal(canPlanNextRound(round, 19000, 1000), false);
    assert.equal(canPlanNextRound(round, 19500, 1000), true);
    assert.equal(canPlanNextRound(round, 25000, 1000), true);
    assert.equal(canPlanNextRound(undefined, 25000, 1000), false);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd /home/jubnl/dev/bitburner/bitburner-scripts && node --test test/daemon-batch-queue.test.js`
Expected: FAIL — `SyntaxError: The requested module '../daemon.js' does not provide an export named 'partitionDueTasks'`.

- [ ] **Step 3: Add the pure helpers to `daemon.js`**

Insert after `autocomplete` (after line 86, before `// script entry point`):

```js
// --- HC-1: just-in-time batch launcher helpers (pure; exported for unit tests, they reference no ns function so they cost no RAM) ---

/** Splits the launch queue into the tasks that must be exec'd now (start within `leadMs` of `now`, sorted by start) and the rest.
 * @param {{start: number}[]} queue
 * @returns {[due: {start: number}[], pending: {start: number}[]]} */
export function partitionDueTasks(queue, now, leadMs) {
    const due = [], pending = [];
    for (const task of queue) (task.start - leadMs <= now ? due : pending).push(task);
    due.sort((a, b) => a.start - b.start);
    return [due, pending];
}

/** The batch start time of a target's next round: continue the previous round's cadence (one cycle-timing-delay after its last batch) when that
 * is still at least queueDelay away, otherwise start queueDelay from now. Never plans a batch whose first task would already be overdue. */
export function nextRoundStart(now, queueDelay, prevLastBatchStart, cycleTimingDelay) {
    return Math.max(now + queueDelay, (prevLastBatchStart ?? 0) + cycleTimingDelay);
}

/** Whether a target's next round may be planned yet: once the launcher has launched (or will launch within `leadMs`) the first task of the
 * current round's last batch. Planning earlier would size the next round against RAM the current round has not claimed yet.
 * @param {{lastBatchStart: number, readyAt: number, nextBatchNumber: number}|undefined} roundInfo */
export function canPlanNextRound(roundInfo, now, leadMs) {
    return roundInfo != null && now >= roundInfo.readyAt - leadMs;
}
```

- [ ] **Step 4: Run the unit test**

Run: `node --test test/daemon-batch-queue.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the queue state, launcher and helpers inside `main`**

In the VARS block, replace lines 105-107:

```js
    let maxBatches = 0; // (Set in command line args) The max number of batches this daemon will spool up to avoid running out of IRL ram (TODO: Stop wasting RAM by scheduling batches so far in advance. e.g. Grind XP while waiting for cycle start!)
```
with
```js
    let maxBatches = 0; // (Set in command line args) The max number of batches this daemon will plan per round for one target (each is 4 queued tasks until launched)
    // HC-1: planned batch/prep tasks waiting to be exec'd. launchDueTasks() execs each one loopInterval before its planned start time; the remote
    // scripts sleep the remainder via additionalMsec, so a script only holds RAM for (about) its own duration instead of for the whole round.
    let batchQueue = (/**@returns{{target: Server, start: number, toolShortName: string, threads: number, threadsByCores: ((cores: number) => number)|null, args: any[], allowSplit: boolean|null, description: string}[]}*/() => [])();
    // HC-1: per target, where its current round of batches ends (used to chain the next round without a gap) - see performScheduling
    let roundState = (/**@returns{{[serverName: string]: {lastBatchStart: number, readyAt: number, nextBatchNumber: number}}}*/() => ({}))();
    let launchFailuresThisLoop = 0, launchFailuresLastLoop = 0; // Queued tasks that could not be exec'd when due (out of RAM). Throttles new planning.
```

In `startup`, after `psCache = {};` (line 284) add:

```js
        batchQueue = [], roundState = {}, launchFailuresThisLoop = launchFailuresLastLoop = 0; // HC-1 launcher state
```

After `doRoot` (after line 712, before `// Main targeting loop`) add:

```js
    /** HC-1: put a planned task on the launch queue. `args` must be the complete remote-script args (target, start, duration, description, flags...)
     * @param {Server} target */
    function enqueueTask(target, start, toolShortName, threads, args, threadsByCores = null, allowSplit = null, description = '') {
        batchQueue.push({ target, start, toolShortName, threads, threadsByCores, args, allowSplit, description });
    }

    /** HC-1: number of queued (not yet launched) tasks against a server, optionally only those whose description starts with a prefix ("Batch", "prep") */
    function queuedTaskCount(serverName, descriptionPrefix = '') {
        return batchQueue.filter(t => t.target.name == serverName && t.description.startsWith(descriptionPrefix)).length;
    }

    /** HC-1: exec every queued task whose planned start is within loopInterval. A task that cannot be started (no RAM) is dropped and counted;
     * because tasks are launched in start order (W1, W2, grow, then hack last), RAM pressure drops hacks first, which leaves the target prepped.
     * @param {NS} ns
     * @returns {Promise<number>} launch failures in this call */
    async function launchDueTasks(ns) {
        if (batchQueue.length == 0) return 0;
        const [due, pending] = partitionDueTasks(batchQueue, Date.now(), loopInterval);
        batchQueue = pending;
        let failures = 0;
        for (const task of due) {
            const ok = await arbitraryExecution(ns, getTool(task.toolShortName), task.threads, task.args, undefined, undefined, task.allowSplit, task.threadsByCores);
            if (ok == false) {
                failures++;
                if (verbose || failures == 1)
                    log(ns, `WARNING: Could not launch ${task.threads}x ${task.toolShortName} "${task.description}" against ${task.target.name} ` +
                        `(due to start in ${Math.round(task.start - Date.now())} ms): insufficient RAM. Dropping it.`, false, 'warning');
            }
        }
        launchFailuresThisLoop += failures;
        if (verbose && due.length > 0)
            log(ns, `INFO: Launched ${due.length - failures} of ${due.length} due tasks (${batchQueue.length} still queued, ${failures} failed)`);
        return failures;
    }
```

- [ ] **Step 6: Wire the launcher into the targeting loop**

Replace lines 722-724:
```js
                let start = Date.now();
                psCache = {}; // Clear the cache of the process list we update once per loop
```
with
```js
                let start = Date.now();
                psCache = {}; // Clear the cache of the process list we update once per loop
                launchFailuresLastLoop = launchFailuresThisLoop; launchFailuresThisLoop = 0;
                await launchDueTasks(ns); // HC-1: exec batch/prep tasks that are due, before any of the slower bookkeeping below
```

Replace lines 790-795:
```js
                let workCapped = false;
                // Function to assess whether we've hit some cap that should prevent us from scheduling any more work
                let isWorkCapped = () => workCapped = workCapped || failed.length > 0 // Scheduling fails when there's insufficient RAM. We've likely encountered a "soft cap" on ram utilization e.g. due to fragmentation
                    || getTotalNetworkUtilization() >= maxUtilization // "hard cap" on ram utilization, can be used to reserve ram or reduce the rate of encountering the "soft cap"
                    || targeting.length >= maxTargets // variable cap on the number of simultaneous targets
                    || (targeting.length + prepping.length) >= (maxTargets + maxPreppingAtMaxTargets); // Only allow a couple servers to be prepped in advance when at max-targets
```
with
```js
                let workCapped = false;
                // HC-1: continuing an active target's rounds is capped only by RAM (the target-count caps below govern *new* targets)
                const isContinuationCapped = () => failed.length > 0 || launchFailuresLastLoop > 0 || getTotalNetworkUtilization() >= maxUtilization;
                // Function to assess whether we've hit some cap that should prevent us from scheduling any more work
                let isWorkCapped = () => workCapped = workCapped || failed.length > 0 // Scheduling fails when there's insufficient RAM. We've likely encountered a "soft cap" on ram utilization e.g. due to fragmentation
                    || launchFailuresLastLoop > 0 // HC-1: queued tasks could not be launched last loop - the network is over-committed, plan nothing new
                    || getTotalNetworkUtilization() >= maxUtilization // "hard cap" on ram utilization, can be used to reserve ram or reduce the rate of encountering the "soft cap"
                    || targeting.length >= maxTargets // variable cap on the number of simultaneous targets
                    || (targeting.length + prepping.length) >= (maxTargets + maxPreppingAtMaxTargets); // Only allow a couple servers to be prepped in advance when at max-targets
```

Replace lines 825-827:
```js
                    } else if (await server.isTargeting()) { // Note servers already being targeted from a prior loop
                        targeting.push(server); // TODO: Switch to continuously queing batches in the seconds leading up instead of far in advance with large delays
                    } else if (await server.isPrepping()) { // Note servers already being prepped from a prior loop
```
with
```js
                    } else if (await server.isTargeting()) { // Note servers already being targeted from a prior loop
                        targeting.push(server);
                        // HC-1: chain rounds. Once the last batch of the current round has begun launching, plan the next round so that its first
                        // hack lands one cycle-timing-delay after this round's last hack (previously a target idled a full weaken-time between rounds).
                        // A targeted server is momentarily un-prepped between each hack landing and its W2, so do not route this through prepServer.
                        if (!xpOnly && canPlanNextRound(roundState[server.name], Date.now(), loopInterval) && !isContinuationCapped()) {
                            const performanceSnapshot = optimizePerformanceMetrics(ns, server);
                            if (server.actualPercentageToSteal() === 0)
                                log(ns, `INFO: Not enough free RAM to plan the next round for ${server.name} yet (RAM Utilization: ${(getTotalNetworkUtilization() * 100).toFixed(2)}%). Will retry next loop.`);
                            else if (true != await performScheduling(ns, server, performanceSnapshot))
                                log(ns, `WARNING: Failed to plan the next round for ${server.name}. Will retry next loop.`, false, 'warning');
                        }
                    } else if (await server.isPrepping()) { // Note servers already being prepped from a prior loop
```

Replace the TODO at lines 904-908:
```js
                // If we've been at low utilization for longer than the max hack cycle out of all our targets, we can add a target.
                // 
                // TODO: Make better use of RAM by prepping more targets. Try not scheduling batches way in advance with a sleep, but instead
                //       witholding batches until they're closer to when they need to be kicked off.
                //       We can add logic to kill lower priority tasks using RAM (such as share, and scripts targetting low priority targets)
                //       if necessary to free up ram for new high-priority target batches.
```
with
```js
                // If we've been at low utilization for longer than the max hack cycle out of all our targets, we can add a target.
                // (HC-1: batches are now queued and launched just in time by launchDueTasks, so utilization reflects scripts that are actually running.)
                // TODO: We could kill lower priority tasks using RAM (such as share, and scripts targetting low priority targets)
                //       if necessary to free up ram for new high-priority target batches.
```

Before line 985 (`// Log some status updates`) add:
```js
                await launchDueTasks(ns); // HC-1: tasks planned this loop whose start is imminent (first W1 is due queueDelay + delayInterval from planning)
```

- [ ] **Step 7: Make `isPrepping` / `isTargeting` see queued tasks**

Replace lines 1229-1236:
```js
        async isPrepping(useCache = true) {
            this._isPrepping ??= await this.isSubjectOfRunningScript(process => process.args.length > 3 && process.args[3] == "prep", useCache);
            return this._isPrepping;
        }
        async isTargeting(useCache = true) {
            this._isTargeting ??= await this.isSubjectOfRunningScript(process => process.args.length > 3 && process.args[3].startsWith('Batch'), useCache);
            return this._isTargeting;
        }
```
with
```js
        async isPrepping(useCache = true) { // HC-1: queued (not yet launched) prep tasks count too
            this._isPrepping ??= queuedTaskCount(this.name, "prep") > 0 ||
                await this.isSubjectOfRunningScript(process => process.args.length > 3 && process.args[3] == "prep", useCache);
            return this._isPrepping;
        }
        async isTargeting(useCache = true) { // HC-1: queued (not yet launched) batch tasks count too
            this._isTargeting ??= queuedTaskCount(this.name, "Batch") > 0 ||
                await this.isSubjectOfRunningScript(process => process.args.length > 3 && process.args[3].startsWith('Batch'), useCache);
            return this._isTargeting;
        }
```

- [ ] **Step 8: Rewrite `performScheduling` to queue instead of exec**

Replace the whole function (lines 1484-1531) with:

```js
    /** Plans one round of batches against a prepped target and queues every task for launchDueTasks (HC-1: nothing is exec'd here).
     * @param {NS} ns
     * @param {Server} currentTarget
     * @returns {Promise<boolean|undefined>} true if a round was queued */
    async function performScheduling(ns, currentTarget, snapshot) {
        const start = Date.now();
        const scheduledTasks = [];
        if (!snapshot) return;
        const maxCycles = Math.min(snapshot.optimalPacedCycles, snapshot.maxCompleteCycles);
        if (maxCycles === 0)
            return log(ns, `WARNING: Attempt to schedule ${getTargetSummary(currentTarget)} returned 0 max cycles? ${JSON.stringify(snapshot)}`, false, 'warning');
        if (currentTarget.getHackThreadsNeeded() === 0)
            return log(ns, `WARNING: Attempted to schedule empty cycle ${maxCycles} x ${getTargetSummary(currentTarget)}? ${JSON.stringify(snapshot)}`, false, 'warning');
        // Note: A guard used to live here to stop scheduling once a batch's last task would *start* after the first batch's hack *resolves*
        // (the server is then briefly not at min security). It was dead code (it compared against an undefined `newBatch.firstFire`, so it
        // only ever compared the first batch against itself) and it is not needed: our remote scripts start immediately and bundle their wait
        // into `additionalMsec`, and the game fixes a task's duration the moment the script starts (hack/grow/weaken time at the *current*
        // security + additionalMsec, src/Netscript/NetscriptHelpers.tsx hack()), so a task's planned start time cannot change its duration.
        // Batch spacing (cycleTimingDelay = 4 x the gap between task resolutions, see getScheduleTiming) keeps resolution windows from
        // overlapping, and the number of batches is bounded by optimalPacedCycles (~ weaken time / cycle-timing-delay) and --max-batches.
        // HC-1: continue the previous round's cadence when it is still in the future (so rounds chain with no gap), else start after queueDelay
        const previousRound = roundState[currentTarget.name];
        const firstBatchStart = nextRoundStart(Date.now(), queueDelay, previousRound?.lastBatchStart, cycleTimingDelay);
        const batchNumberBase = previousRound?.nextBatchNumber ?? 0; // Keeps "Batch N-..." descriptions unique across overlapping rounds
        let lastBatch = 0, cyclesScheduled = 0;
        while (cyclesScheduled < maxCycles) {
            const newBatchStart = new Date((cyclesScheduled === 0) ? firstBatchStart : lastBatch.getTime() + cycleTimingDelay);
            lastBatch = new Date(newBatchStart.getTime());
            const batchTiming = getScheduleTiming(newBatchStart, currentTarget);
            if (verbose && runOnce) logSchedule(ns, batchTiming, currentTarget); // Special log for troubleshooting batches
            scheduledTasks.push(getScheduleObject(ns, batchTiming, currentTarget, batchNumberBase + scheduledTasks.length));
            cyclesScheduled++;
        }

        for (const schedObj of scheduledTasks) {
            for (const schedItem of schedObj.scheduleItems) {
                const discriminationArg = `Batch ${schedObj.batchNumber}-${schedItem.description}`;
                // Args spec: [0: Target, 1: DesiredStartTime (used to delay tool start), 2: ExpectedEndTime (informational), 3: Duration (informational), 4: DoStockManipulation, 5: DisableWarnings]
                const args = [currentTarget.name, schedItem.start.getTime(), schedItem.end - schedItem.start, discriminationArg];
                args.push(...getFlagsArgs(schedItem.toolShortName, currentTarget.name));
                if (options.i && currentTerminalServer?.name == currentTarget.name && schedItem.toolShortName == "hack")
                    schedItem.toolShortName = "manualhack";
                // HC-1: queue it; launchDueTasks execs it loopInterval before schedItem.start. grow/weaken items carry a cores-aware thread count
                enqueueTask(currentTarget, schedItem.start.getTime(), schedItem.toolShortName, schedItem.threadsNeeded, args, schedItem.threadsByCores ?? null, null, discriminationArg);
            }
        }
        const lastSched = scheduledTasks[scheduledTasks.length - 1];
        roundState[currentTarget.name] = {
            lastBatchStart: lastSched.batchStart.getTime(),
            readyAt: Math.min(...lastSched.scheduleItems.map(i => i.start.getTime())), // When the last batch begins launching, the next round may be planned
            nextBatchNumber: batchNumberBase + scheduledTasks.length,
        };
        if (verbose)
            log(ns, `Queued ${cyclesScheduled} x ${getTargetSummary(currentTarget)} starting ${formatDateTime(new Date(firstBatchStart))} ` +
                `(${batchQueue.length} tasks now queued) Took: ${Date.now() - start}ms`);
        currentTarget.previousCycle = `${cyclesScheduled} x ${getTargetSummary(currentTarget)}`
        return true;
    }
```

Also update the `max-batches` comment (lines 61-65) from:
```js
    // Maximum overlapping cycles to schedule in advance for one target. Note that once scheduled, we must wait for all batches to complete before we can schedule more.
    // The number of batches that fit is ~ weaken-time / cycle-timing-delay, so halving the delay (above) needs roughly double the batches to fully use the window.
    // Each batch is 4 running scripts, so very high values (e.g. 200 for --cycle-timing-delay 1000) cost IRL RAM/CPU for the game to track.
```
to:
```js
    // Maximum overlapping cycles to plan per round for one target. The next round is planned as soon as the last batch of the current one begins
    // launching (HC-1), so rounds chain without a gap. The number of batches that fit is ~ weaken-time / cycle-timing-delay, so halving the delay
    // (above) needs roughly double the batches to fully use the window. Each batch is 4 scripts (queued until ~1 s before their start), so very
    // high values (e.g. 200 for --cycle-timing-delay 1000) cost IRL RAM/CPU for the game to track.
```

- [ ] **Step 9: Syntax, RAM and unit checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]` and 131 tests pass (126 + 5).

- [ ] **Step 10: In-game verification**

In the game terminal (any save where daemon.js is running with at least one hackable target, e.g. `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz`):
1. `run daemon.js -v` (it kills the previous instance), then `tail daemon.js`.
2. Within ~2 loops the log shows `Queued N x (H:.. W:.. G:.. W²:..) ... starting <time> (M tasks now queued)` for the first target, then every second `INFO: Launched k of k due tasks (M still queued, 0 failed)` with small k (about `4 * loopInterval / cycle-timing-delay` = 2 per target per loop) and M decreasing over ~weaken-time. Previously the equivalent was one `Scheduled N x ...` line and all 4N scripts started at once.
3. `ps daemon-0` (or `ps` on whichever purchased server is largest, see `scan-analyze`): the number of `/Remote/hack-target.js` processes for one target is well under N at any moment and turns over continuously; `ps` a few seconds later shows different `Batch <n>-hack` numbers.
4. Chaining: when the log line `Queued N x ...` for the same target appears again, its `starting <time>` is about `cycle-timing-delay` after the previous round's last batch (verify with `-v --run-once`'s `logSchedule` output if needed: the new round's first `Hack - End` is 2 s after the previous round's last `Hack - End`). No `Misfire: ... started ... ms too late` toasts beyond the occasional <100 ms one.
5. After 10 minutes compare the HUD "Script income" ($/s) against the same save before the change (the spec predicts roughly 2x per GB once RAM is the bottleneck; at minimum it must not drop) and check the daemon status line `RAM Utilization: ... Max Targets: ...` climbs (more targets fit) without `servers failed to be scheduled` lines.
6. Stress: `run daemon.js -v --max-batches 200 --cycle-timing-delay 1000`; the `Launched ... (x failed)` counter should stay 0 or be followed by `Max Targets` decreasing (back-off), never by a stream of misfire toasts.

- [ ] **Step 11: Commit (user triggers)**

```
git add daemon.js test/daemon-batch-queue.test.js
git commit -m "daemon: launch batch tasks just in time and chain rounds (HC-1)"
```

---

### Task 2: HC-2 — separate purchased-server spend from home-upgrade spend

**Files:**
- Modify: `host-manager.js` — globals lines 11-16, `main` lines 43-96 (after `costByRamExponent` line 61; reserve-by-time block lines 144-155), success branch lines 252-256.
- Modify: `daemon.js` — VARS (add `lastAugReset` next to `bitNodeN`, line 165), `startup` line 313 (`bitNodeN = resetInfo.currentNode;`), `getHostManagerBudget` lines 491-503, top-level exports.
- Test: `test/host-manager-spend.test.js` (new), `test/daemon-host-manager-budget.test.js` (new).

**Interfaces:**
- Produces `host-manager.js`: `export function readSpendRecord(text, resetKey) → number` (money spent on purchased servers while `resetKey` matches; 0 for empty/invalid/other key). Writes `/Temp/host-manager-spend.txt` as `{"resetKey": <ns.getResetInfo().lastAugReset>, "spent": <number>}` after each purchase/upgrade.
- Produces `daemon.js`: `export function parseSpendRecord(text, resetKey) → number` (same contract, duplicated rather than imported so daemon's RAM calculation never walks host-manager.js), `export function computeHostManagerBudget(maxSpendFraction, hackingIncome, totalIncome, purchasedServerSpend) → number`.
- Consumes: `ns.getResetInfo()` (1 GB, ram-dodged; daemon already fetches it in `startup`), `ns.read`/`ns.write` (0 GB).

Design decision: host-manager records what it actually paid (the `cost` it logs) keyed by `lastAugReset`, because an augmentation install deletes purchased servers and resets `sinceInstall` income, so the budget and the spend must reset together; `getMoneySources().sinceInstall.servers` is no longer used for the budget (it stays cached for other uses).

- [ ] **Step 1: Write the failing unit tests**

```js
// test/host-manager-spend.test.js
// HC-2: host-manager.js keeps its own purchased-server spend record so daemon.js's budget is not debited by home RAM/core upgrades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSpendRecord } from "../host-manager.js";

test("readSpendRecord returns the recorded spend for the current install", () => {
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: 4.5e9 }), 1700000000000), 4.5e9);
});

test("readSpendRecord returns 0 for another install, an empty file, or garbage", () => {
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1600000000000, spent: 4.5e9 }), 1700000000000), 0);
    assert.equal(readSpendRecord("", 1700000000000), 0);
    assert.equal(readSpendRecord("not json", 1700000000000), 0);
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: "NaN" }), 1700000000000), 0);
    assert.equal(readSpendRecord(JSON.stringify({ resetKey: 1700000000000, spent: -5 }), 1700000000000), 0);
});
```

```js
// test/daemon-host-manager-budget.test.js
// HC-2: the host-manager budget must only be debited by purchased-server spend, never by home RAM/core upgrades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHostManagerBudget, parseSpendRecord } from "../daemon.js";

test("budget is 25% of hack income minus purchased-server spend", () => {
    assert.equal(computeHostManagerBudget(0.25, 100e9, 120e9, 5e9), 20e9);
});

test("budget ignores home upgrades: 14.7b of home RAM does not veto servers", () => {
    // Spec HC-2: after home reaches 4 TB (~14.7b under the old accounting) host-manager was not launched until hack income exceeded ~59b.
    // With purchased spend tracked separately (0 here), 10b of hack income already yields a 2.5b budget.
    assert.equal(computeHostManagerBudget(0.25, 10e9, 30e9, 0), 2.5e9);
});

test("budget falls back to 0.1% of total income and never goes negative", () => {
    assert.equal(computeHostManagerBudget(0.25, 0, 50e12, 0), 50e9); // hack income disabled, 0.1% of total
    assert.equal(computeHostManagerBudget(0.25, 1e9, 1e9, 10e9), 0);
});

test("parseSpendRecord mirrors host-manager's record format", () => {
    assert.equal(parseSpendRecord(JSON.stringify({ resetKey: 42, spent: 7e8 }), 42), 7e8);
    assert.equal(parseSpendRecord(JSON.stringify({ resetKey: 41, spent: 7e8 }), 42), 0);
    assert.equal(parseSpendRecord("", 42), 0);
});
```

- [ ] **Step 2: Run them to verify failure**

Run: `node --test test/host-manager-spend.test.js test/daemon-host-manager-budget.test.js`
Expected: FAIL — `does not provide an export named 'readSpendRecord'` / `'computeHostManagerBudget'`.

- [ ] **Step 3: Implement the record in `host-manager.js`**

After line 16 (`let budget;`) add:

```js
let resetKey; // ns.getResetInfo().lastAugReset - the spend record only counts within one augmentation install
// HC-2: running total of what this script paid for purchased servers this install. daemon.js reads it for host-manager's budget instead of
// ns.getMoneySources().sinceInstall.servers, which the game also debits for home RAM/core upgrades (src/NetscriptFunctions/Singularity.ts
// upgradeHomeRam / upgradeHomeCores: Player.loseMoney(cost, "servers"); src/utils/MoneySourceTracker.ts has a single `servers` bucket).
const SPEND_RECORD_FILE = '/Temp/host-manager-spend.txt';

/** Parses the spend record file. Returns the money spent on purchased servers while `resetKey` matches, else 0 (an install deletes purchased servers).
 * @param {string} text contents of SPEND_RECORD_FILE
 * @param {number} resetKey ns.getResetInfo().lastAugReset
 * @returns {number} */
export function readSpendRecord(text, resetKey) {
    try {
        const record = JSON.parse(text || 'null');
        const spent = Number(record?.spent);
        return record?.resetKey === resetKey && Number.isFinite(spent) ? Math.max(0, spent) : 0;
    } catch { return 0; }
}

/** Adds a purchase to the spend record (HC-2)
 * @param {NS} ns */
function recordSpend(ns, cost) {
    const spent = readSpendRecord(ns.read(SPEND_RECORD_FILE), resetKey) + cost;
    ns.write(SPEND_RECORD_FILE, JSON.stringify({ resetKey, spent }), 'w');
}
```

After line 61 (`costByRamExponent = await getNsDataThroughFile(...)`) add:

```js
    resetKey = (await getNsDataThroughFile(ns, 'ns.getResetInfo()')).lastAugReset; // HC-2: keys the purchased-server spend record
```

Replace line 148:
```js
        const timeSinceLastAug = Date.now() - (await getNsDataThroughFile(ns, 'ns.getResetInfo()')).lastAugReset;
```
with
```js
        const timeSinceLastAug = Date.now() - resetKey; // (fetched once in main)
```

Replace lines 252-256:
```js
    else {
        log(ns, `SUCCESS: ${isUpgrade ? 'Upgraded' : 'Purchased'} server ${purchasedServer} with ${formatRam(maxRamPossibleToBuy)} ` +
            `RAM for ${formatMoney(cost)} (budget was ${formatMoney(spendableMoney)})`, true, 'success');
        budget -= cost;
    }
```
with
```js
    else {
        log(ns, `SUCCESS: ${isUpgrade ? 'Upgraded' : 'Purchased'} server ${purchasedServer} with ${formatRam(maxRamPossibleToBuy)} ` +
            `RAM for ${formatMoney(cost)} (budget was ${formatMoney(spendableMoney)})`, true, 'success');
        budget -= cost;
        recordSpend(ns, cost); // HC-2: daemon.js debits its host-manager budget by this record, not by the game's "servers" money source
    }
```

- [ ] **Step 4: Implement the budget in `daemon.js`**

Top-level, after the HC-1 helpers, add:

```js
// --- HC-2: host-manager budget helpers (pure) ---

/** Mirror of host-manager.js readSpendRecord (duplicated so daemon.js's RAM calculation never walks host-manager.js):
 * money host-manager.js spent on purchased servers while `resetKey` (ns.getResetInfo().lastAugReset) matches, else 0. */
export function parseSpendRecord(text, resetKey) {
    try {
        const record = JSON.parse(text || 'null');
        const spent = Number(record?.spent);
        return record?.resetKey === resetKey && Number.isFinite(spent) ? Math.max(0, spent) : 0;
    } catch { return 0; }
}

/** How much host-manager.js may still spend on purchased servers this install: the larger of `maxSpendFraction` of hack income and 0.1% of all
 * income (for BNs where hack income is crippled but hack exp still matters), minus what it already spent on purchased servers, floored at 0. */
export function computeHostManagerBudget(maxSpendFraction, hackingIncome, totalIncome, purchasedServerSpend) {
    return Math.max(0, maxSpendFraction * hackingIncome - purchasedServerSpend, totalIncome * 0.001 - purchasedServerSpend);
}
```

In the VARS block, replace line 165:
```js
    let bitNodeN = 1; // The bitnode we're in
```
with
```js
    let bitNodeN = 1; // The bitnode we're in
    let lastAugReset = 0; // ns.getResetInfo().lastAugReset - keys host-manager.js's purchased-server spend record (HC-2)
```

In `startup`, replace line 313:
```js
        bitNodeN = resetInfo.currentNode;
```
with
```js
        bitNodeN = resetInfo.currentNode;
        lastAugReset = resetInfo.lastAugReset;
```

Replace `getHostManagerBudget` (lines 490-503):
```js
    /** Periodic scripts helper function: Get how much we're willing to spend on new servers (host-manager.js budget) */
    function getHostManagerBudget() {
        const serverSpend = -(moneySources?.sinceInstall?.servers ?? 0); // This is given as a negative number (profit), we invert it to get it as a positive expense amount
        const budget = Math.max(0,
            // Ensure the total amount of money spent on new servers is less than the configured max spend amount
            options['max-purchased-server-spend'] * (moneySources?.sinceInstall?.hacking ?? 0) - serverSpend,
            // Special-case support: In some BNs hack income is severely penalized (or zero) but earning hack exp is still useful.
            // To support these, always allow a small percentage (0.1%) of our total earnings (including other income sources) to be spent on servers
            (moneySources?.sinceInstall?.total ?? 0) * 0.001 - serverSpend);
        //log(ns, `Math.max(0, ${options['max-purchased-server-spend']} * (${formatMoney(moneySources?.sinceInstall?.hacking)} ?? 0) - ${formatMoney(serverSpend)}, ` +
        //    `(${formatMoney(moneySources?.sinceInstall?.total)} ?? 0) * 0.001 - ${formatMoney(serverSpend)}) = ${formatMoney(budget)}`);
        return budget;
    }
```
with
```js
    /** Periodic scripts helper function: Get how much we're willing to spend on new servers (host-manager.js budget).
     * HC-2: debited only by what host-manager.js itself paid for purchased servers this install (its /Temp/host-manager-spend.txt record).
     * ns.getMoneySources().sinceInstall.servers is NOT used: the game books home RAM and core upgrades under that same "servers" source
     * (src/NetscriptFunctions/Singularity.ts upgradeHomeRam/upgradeHomeCores -> Player.loseMoney(cost, "servers")), so ram-manager.js's home
     * purchases (9-140x more expensive per GB than purchased servers) used to consume this budget and veto server purchases. */
    function getHostManagerBudget() {
        const serverSpend = parseSpendRecord(ns.read('/Temp/host-manager-spend.txt'), lastAugReset); // ns.read is free
        return computeHostManagerBudget(options['max-purchased-server-spend'], moneySources?.sinceInstall?.hacking ?? 0, moneySources?.sinceInstall?.total ?? 0, serverSpend);
    }
```

- [ ] **Step 5: Run tests, syntax and RAM checks**

Run: `node --check host-manager.js && node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs host-manager.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: both `+[] -[]`; 138 tests pass (131 + 7). host-manager.js already referenced `ns.read` and `ns.write`? It referenced `ns.read` (line 91) but not `ns.write`; `write` costs 0 GB (RamCostGenerator.ts:623), so collide prints `+[]`.

- [ ] **Step 6: In-game verification**

1. `run host-manager.js --budget 1e12 --absolute-reserve 0 --reserve-percent 0 --utilization-trigger 0` on a save with cash for one server; after the `SUCCESS: Purchased server daemon-N ... for $X` toast, `cat /Temp/host-manager-spend.txt` shows `{"resetKey":<number>,"spent":X}`; run it again and `spent` grows by the second cost.
2. `run daemon.js -v`; the `INFO: Ran tool: host-manager.js with args ["--budget",B,...]` line must show `B = max(0, 0.25 * hacking-since-install - spent, ...)` — compare with `run stats.js`/the HUD "Hacking" income since install; then `run Tasks/ram-manager.js --budget 0.5` to buy a home RAM upgrade and confirm on the next host-manager launch (32 s later) that `--budget` did **not** drop by the home upgrade cost.
3. `mem daemon.js` and `mem host-manager.js` unchanged from before the edit.

- [ ] **Step 7: Commit (user triggers)**

```
git add host-manager.js daemon.js test/host-manager-spend.test.js test/daemon-host-manager-budget.test.js
git commit -m "host-manager/daemon: budget purchased servers separately from home upgrades (HC-2)"
```

---

### Task 3: HC-3 — prep as a W-G-W mini-batch so the grow lands at min security

**Files:**
- Modify: `daemon.js` — `prepServer` (lines 1805-1871 before Task 1's edits; locate by `async function prepServer`), top-level exports.
- Test: `test/daemon-prep-timing.test.js` (new).
- Depends on: Task 1 (`enqueueTask`, `launchDueTasks`, queued-task awareness in `isPrepping`).

**Interfaces:**
- Produces `export function prepTiming(now, weakenTime, growTime, delayInterval, needsWeaken = true)` → `{ weakenStart, growStart, weaken2Start }` (ms epoch): with `needsWeaken`, W1 starts now (lands `now + W`), grow starts `now + W - G + δ` (lands `δ` after W1), W2 starts `now + 2δ` (lands `2δ` after W1, i.e. `δ` after the grow); without, everything starts now (security is already at min, W2 still lands after the grow because `W > G`).
- Consumes: `enqueueTask`, `launchDueTasks` (Task 1), `getFlagsArgs`, `weakenThreadsByCores`, `growThreadsByCores`, `getWeakenThreadsNeeded`, `getGrowThreadsNeeded`.

Design decision: the grow's thread count keeps using min security (`getGrowThreadsNeeded` / the formulas mock), which is now correct because the grow resolves after W1; durations are read now at the current (high) security, which is what the game fixes at script start (`src/Netscript/NetscriptHelpers.tsx:544`), and all three scripts start before W1 lands, so the durations stay valid.

- [ ] **Step 1: Write the failing unit test**

```js
// test/daemon-prep-timing.test.js
// HC-3: prep grow must resolve after the prep weaken (grow is sized for min security; the game reads hackDifficulty when the grow resolves,
// src/Server/formulas/grow.ts), and a second weaken must resolve after the grow to remove its hardening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepTiming } from "../daemon.js";

test("W-G-W: weaken lands first, grow one delay later, second weaken one delay after the grow", () => {
    const now = 1_000_000, W = 80_000, G = 64_000, d = 500;
    const t = prepTiming(now, W, G, d);
    assert.equal(t.weakenStart, now);
    assert.equal(t.growStart + G, now + W + d);          // grow lands d after W1
    assert.equal(t.weaken2Start + W, now + W + 2 * d);   // W2 lands d after the grow
    assert.ok(t.growStart < now + W, "grow starts before W1 lands, so its duration (read at current security) stays valid");
    assert.ok(t.weaken2Start < now + W, "W2 starts before W1 lands for the same reason");
});

test("already at min security: grow and W2 start immediately (W2 still lands after the grow since weaken time > grow time)", () => {
    const now = 1_000_000, W = 80_000, G = 64_000, d = 500;
    const t = prepTiming(now, W, G, d, false);
    assert.deepEqual(t, { weakenStart: now, growStart: now, weaken2Start: now });
    assert.ok(t.weaken2Start + W > t.growStart + G);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test test/daemon-prep-timing.test.js`
Expected: FAIL — `does not provide an export named 'prepTiming'`.

- [ ] **Step 3: Add the helper (top-level `daemon.js`, after the HC-2 helpers)**

```js
// --- HC-3: prep timing (pure) ---

/** Start times for a W-G-W prep mini-batch. The game evaluates a grow's growth at the security the target has when the grow RESOLVES
 * (src/Server/formulas/grow.ts calculateServerGrowthLog reads server.hackDifficulty; src/NetscriptFunctions.ts grow applies it after netscriptDelay),
 * and prep grow threads are sized for min security, so the grow must land after the prep weaken (one delayInterval later), and a second weaken
 * must land one delayInterval after the grow to undo its hardening. Each duration is fixed at script start (src/Netscript/NetscriptHelpers.tsx hack()),
 * so all three start before the first weaken lands and use the durations read now (at the current, higher security).
 * @param {number} now ms epoch
 * @param {number} weakenTime ms, at current security
 * @param {number} growTime ms, at current security
 * @param {number} delayInterval ms (cycle-timing-delay / 4)
 * @param {boolean} needsWeaken false when the target is already at min security
 * @returns {{weakenStart: number, growStart: number, weaken2Start: number}} */
export function prepTiming(now, weakenTime, growTime, delayInterval, needsWeaken = true) {
    if (!needsWeaken) return { weakenStart: now, growStart: now, weaken2Start: now };
    return { weakenStart: now, growStart: now + weakenTime - growTime + delayInterval, weaken2Start: now + 2 * delayInterval };
}
```

- [ ] **Step 4: Run the unit test**

Run: `node --test test/daemon-prep-timing.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Rewrite the scheduling half of `prepServer`**

Replace, inside `prepServer`, from the line
```js
            weakenThreadsNeeded += weakenForGrowthThreadsNeeded;
            growThreadsAllowable -= weakenForGrowthThreadsNeeded; // For purposes of logging this below if we fail to schedule all grow threads
        }
```
through the end of the function (`return prepSucceeding;` and its closing `}`), with:

```js
            growThreadsAllowable -= weakenForGrowthThreadsNeeded; // For purposes of logging this below if we fail to schedule all grow threads
            weakenThreadsAllowable -= weakenForGrowthThreadsNeeded; // HC-3: the recovery weaken is a separate task now (W2), reserve its room from W1's allowance
            weaken2ThreadsScheduled = weakenForGrowthThreadsNeeded;
        }

        // HC-3: W-G-W mini-batch. W1 starts now; the grow is timed to land one delay after W1 (so the game applies it at min security, which is what
        // getGrowThreadsNeeded sized it for) and W2 lands one delay after the grow to remove its hardening. All three are queued for launchDueTasks;
        // W1 (and W2, which starts 2 delays from now) are launched below immediately, the grow ~0.2x weaken-time later.
        const timing = prepTiming(start, currentTarget.timeToWeaken(), currentTarget.timeToGrow(), cycleTimingDelay / 4, weakenThreadsNeeded > 0);
        const weakenThreadsScheduled = Math.min(weakenThreadsAllowable, weakenThreadsNeeded);
        if (weakenThreadsScheduled < weakenThreadsNeeded)
            log(ns, `INFO: At this time, we only have enough RAM to schedule ${weakenThreadsScheduled} of the ${weakenThreadsNeeded} ` +
                `prep weaken threads needed to lower the target from current security (${formatNumber(currentTarget.getSecurity())}) ` +
                `to min security (${formatNumber(currentTarget.getMinSecurity())}) (${currentTarget.name})`);
        // Note: prep tasks fire at their planned time from a cold start, so override "silent misfires" (last flag arg) to true
        if (weakenThreadsScheduled > 0)
            enqueueTask(currentTarget, timing.weakenStart, "weak", weakenThreadsScheduled,
                [currentTarget.name, timing.weakenStart, currentTarget.timeToWeaken(), "prep", ...getFlagsArgs("weak", currentTarget.name, false, true)],
                weakenThreadsByCores(weakenThreadsScheduled), null, "prep"); // Fewer threads are needed on hosts with more cores
        if (growThreadsScheduled > 0) {
            enqueueTask(currentTarget, timing.growStart, "grow", growThreadsScheduled,
                [currentTarget.name, timing.growStart, currentTarget.timeToGrow(), "prep", ...getFlagsArgs("grow", currentTarget.name, false, true)],
                // Fewer threads are needed on hosts with more cores. If we could afford the full grow, hosts with cores can compute the exact count from current money
                growThreadsByCores(currentTarget, growThreadsScheduled, growThreadsScheduled == growThreadsNeeded ? currentTarget.getMoney() : null),
                /*allowThreadSplitting*/ true, "prep"); // Special case: for prep we allow grow threads to be split
            enqueueTask(currentTarget, timing.weaken2Start, "weak", weaken2ThreadsScheduled,
                [currentTarget.name, timing.weaken2Start, currentTarget.timeToWeaken(), "prep", ...getFlagsArgs("weak", currentTarget.name, false, true)],
                weakenThreadsByCores(weaken2ThreadsScheduled), null, "prep");
        }
        // Launch what is due now (W1, and W2 which starts 2 delays from now). A failure here means we are out of RAM despite the checks above.
        const prepSucceeding = (await launchDueTasks(ns)) == 0;
        if (!prepSucceeding)
            log(ns, `WARN: Failed to launch the prep weaken threads for ${currentTarget.name} despite there ostensibly being room for ${weakenThreadsAllowable} (see warning above)`);

        // Log a summary of what we did here today
        if (verbose && prepSucceeding && (weakenThreadsScheduled > 0 || growThreadsScheduled > 0))
            log(ns, `Prepping with ${weakenThreadsScheduled} weaken, ${growThreadsScheduled} grow, ${weaken2ThreadsScheduled} recovery weaken threads ` +
                `(${weakenThreadsNeeded || 0} / ${growThreadsNeeded || 0} needed) grow lands at ${formatDateTime(new Date(timing.growStart + currentTarget.timeToGrow()))}` +
                ' ETA ' + Math.floor((currentTarget.timeToWeaken() + cycleTimingDelay / 2) / 1000) + 's (' + currentTarget.name + ')' +
                ' Took: ' + (Date.now() - start) + 'ms');
        return prepSucceeding;
    }
```

Also change the declaration line earlier in `prepServer`
```js
        let growThreadsAllowable, growThreadsNeeded, growThreadsScheduled = 0;
```
to
```js
        let growThreadsAllowable, growThreadsNeeded, growThreadsScheduled = 0, weaken2ThreadsScheduled = 0;
```
and delete the now-unused `let now = new Date(start.valueOf());` line (timing comes from `prepTiming(start, ...)`).

- [ ] **Step 6: Checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]`; 140 tests pass.

- [ ] **Step 7: In-game verification**

1. Pick a rooted, hackable server that is far from prepped (e.g. after `run daemon.js -v --run-once` note a target listed with `Sec: X of Y` where `X ≈ 3Y`, or `run Tasks/crack-host.js <server>` on a fresh one).
2. `run daemon.js -v`, `tail daemon.js`: the prep line now reads `Prepping with A weaken, B grow, C recovery weaken threads ... grow lands at <time>`; `ps <a big purchased server>` right after shows `/Remote/weak-target.js ... prep` scripts (two start times: now and now+1000) but **no** `/Remote/grow-target.js ... prep` until ~`weaken-time - grow-time` later (`INFO: Launched ...` lines in the tail).
3. After one weaken-time (+1 s) the target appears with `*` (prepped) in the next `Targetting Order` log and `Sec:` equals `min` and money equals max — i.e. **one** prep round. Before the fix, the first round left money at ~2.2x instead of 10x on a fresh server and a second `Prepping with ...` line followed one weaken-time later (`WARNING 1: Server was prepped, but now at security ...` may also have appeared).
4. The `Misfire: Grow achieved no growth` toast must not appear for prep grows.

- [ ] **Step 8: Commit (user triggers)**

```
git add daemon.js test/daemon-prep-timing.test.js
git commit -m "daemon: prep as a W-G-W mini-batch so the grow resolves at min security (HC-3)"
```

---

### Task 4: HC-6 — snapshot used RAM once per loop instead of live calls in every sort comparison

**Files:**
- Modify: `daemon.js` — `exec` wrapper (lines 680-702), `doRoot` (706-712), loop head (after `psCache = {};`, line 724), `Server` constructor/`usedRam`/`ramAvailable` (1162-1174, 1329-1330), `arbitraryExecution` exec result (1776-1780), sort cache (2268-2288). Locate by quoted code after Tasks 1-3.
- Test: none (in-game only; there is no pure decision, only cache plumbing).

**Interfaces:**
- Produces (inside `main`): `Server.refreshUsedRam()` (one `ns.getServerUsedRam` call, marks the free-RAM sort dirty), `Server.noteRamUsed(gb)` (local increment after a successful exec), module flag `_freeRamSortDirty`.
- Consumes: `getAllServersByFreeRam`, `getNetworkStats`, `Tool.getMaxThreads` (all read `ramAvailable()` and therefore the snapshot).

Design decision: the snapshot is refreshed for every server once at the top of the loop (about 100 cheap API calls), incremented locally for each exec the daemon performs, and refreshed for the host after helper/periodic scripts are launched on it, so within a loop the daemon's own view is exact and other scripts' RAM is at most one loop stale (a conservative error: RAM freed mid-loop is not seen until the next loop).

- [ ] **Step 1: Add the snapshot to `Server`**

In the constructor, after `this._hasRootCached = null; ...` add:
```js
            this._usedRam = null; // HC-6: per-loop snapshot of ns.getServerUsedRam (refreshUsedRam), kept current locally by noteRamUsed after each exec
```
Replace
```js
        usedRam() { return this.ns.getServerUsedRam(this.name); }
        ramAvailable(ignoreReservedRam = false) { return this.totalRam(ignoreReservedRam) - this.usedRam(); }
```
with
```js
        usedRam() { return this._usedRam ??= this.ns.getServerUsedRam(this.name); } // HC-6: snapshot (see refreshUsedRam / noteRamUsed)
        /** HC-6: re-read this host's used RAM from the game (one 0.05 GB API call). Done once per loop for every host, and for a host right
         * after a helper script was exec'd on it outside arbitraryExecution. */
        refreshUsedRam() { this._usedRam = this.ns.getServerUsedRam(this.name); _freeRamSortDirty = true; }
        /** HC-6: account for RAM a script we just started on this host will hold, without asking the game again
         * @param {number} gb threads x script cost */
        noteRamUsed(gb) { if (this._usedRam != null) this._usedRam += gb; _freeRamSortDirty = true; }
        ramAvailable(ignoreReservedRam = false) { return this.totalRam(ignoreReservedRam) - this.usedRam(); }
```

- [ ] **Step 2: Refresh once per loop and after helper launches**

Loop head: after `await launchDueTasks(ns); // HC-1 ...` insert *before* it (the launcher must see fresh numbers):
```js
                for (const server of getAllServers()) server.refreshUsedRam(); // HC-6: one used-RAM snapshot per loop; kept current locally by noteRamUsed
```
(so the order is `psCache = {}`, the two launch-failure lines, the refresh loop, `await launchDueTasks(ns)`).

In `exec` (the wrapper), replace
```js
        return pid; // Caller is responsible for handling errors if final pid returned is 0 (indicating failure)
```
with
```js
        if (pid) getServerByName(hostname)?.refreshUsedRam(); // HC-6: helper scripts are not sized by us, re-read the host's used RAM
        return pid; // Caller is responsible for handling errors if final pid returned is 0 (indicating failure)
```
In `doRoot`, after `await waitForProcessToComplete_Custom(ns, getHomeProcIsAlive(ns), pid);` add:
```js
        homeServer?.refreshUsedRam(); // HC-6: crack-host.js has exited, its RAM is free again
```
In `arbitraryExecution`, replace
```js
            if (pid == 0) {
                log(ns, `ERROR: Failed to exec ${tool.name} on server ${targetServer.name} with ${maxThreadsHere} threads`, false, 'error');
                return false;
            }
```
with
```js
            if (pid == 0) {
                log(ns, `ERROR: Failed to exec ${tool.name} on server ${targetServer.name} with ${maxThreadsHere} threads`, false, 'error');
                targetServer.refreshUsedRam(); // HC-6: our snapshot was wrong for this host (a temp script may have fired), re-read it
                return false;
            }
            targetServer.noteRamUsed(maxThreadsHere * tool.cost); // HC-6: keep the snapshot current without another API call
```

- [ ] **Step 3: Sort only when the snapshot changed**

Replace
```js
    const resetServerSortCache = () => _serverListByFreeRam = _serverListByMaxRam = _serverListByTargetOrder = undefined;
```
with
```js
    let _freeRamSortDirty = true; // HC-6: set whenever any server's used RAM snapshot changes; getAllServersByFreeRam re-sorts only then
    const resetServerSortCache = () => { _serverListByFreeRam = _serverListByMaxRam = _serverListByTargetOrder = undefined; _freeRamSortDirty = true; };
```
and replace `getAllServersByFreeRam`:
```js
    /** @returns {Server[]} Sorted by most free (available) ram to least */
    function getAllServersByFreeRam() {
        return _sortServersAndReturn(_serverListByFreeRam ??= getAllServers().slice(), function (a, b) {
            const ramDiff = b.ramAvailable() - a.ramAvailable();
            return ramDiff != 0.0 ? ramDiff : sortServerTieBreaker(a, b);
        });
    }
```
with
```js
    /** @returns {Server[]} Sorted by most free (available) ram to least. HC-6: the comparator reads the per-loop used-RAM snapshot (no API calls),
     * and the list is only re-sorted when some snapshot changed since the last call (every exec changes one, so in practice once per task). */
    function getAllServersByFreeRam() {
        if (_serverListByFreeRam === undefined) { _serverListByFreeRam = getAllServers().slice(); _freeRamSortDirty = true; }
        if (_freeRamSortDirty) {
            _sortServersAndReturn(_serverListByFreeRam, function (a, b) {
                const ramDiff = b.ramAvailable() - a.ramAvailable();
                return ramDiff != 0.0 ? ramDiff : sortServerTieBreaker(a, b);
            });
            _freeRamSortDirty = false;
        }
        return _serverListByFreeRam;
    }
```
(`_freeRamSortDirty` is declared with `let` inside `main` after the `Server` class; the class methods only run after `main` has executed every top-level statement, so there is no temporal-dead-zone access.)

- [ ] **Step 4: Checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]` (`getServerUsedRam` was already referenced); 140 tests pass.

- [ ] **Step 5: In-game verification**

1. `run daemon.js -v`, `tail daemon.js`. The status line `... Loop Took: Nms` for a loop in which a round was planned (a `Queued N x ...` line in the same second) must be well under `maxLoopTime` (1000 ms) with 100 batches; before the fix, on a network of ~100 hosts such a loop overran and logged `were skipped for now (time, RAM, or target + prepping cap reached)`.
2. No new `ERROR: Failed to exec ... threads` lines during a 10-minute run (the snapshot is at most one loop stale, and only in the conservative direction).
3. Sanity: `run daemon.js -v --run-once` prints the same `Preferred Server ... resulted in preferred order: ...` free-RAM figures as `free` typed on a few hosts (the snapshot equals the game's numbers at loop start).

- [ ] **Step 6: Commit (user triggers)**

```
git add daemon.js
git commit -m "daemon: snapshot used RAM once per loop instead of per sort comparison (HC-6)"
```

---

### Task 5: HC-5 — keep the `ns.ls` file cache across loops

**Files:**
- Modify: `daemon.js` — `Server` constructor comment + `resetCaches` (lines 1174-1182), `refreshDynamicServerData` (1121-1152), `arbitraryExecution` exec failure branch (edited in Task 4). Locate by quoted code.
- Test: none (in-game only).

**Interfaces:**
- Produces `Server.resetFileCache()`.
- Consumes: `Server.hasFile` (unchanged: lazily fills `_files` via a ram-dodged `ns.ls`), the HK-F1 `_files?.add(...)` after `scp` (unchanged).

- [ ] **Step 1: Stop resetting `_files` every loop**

Replace
```js
            this._files = (/**@returns{Set<string>}*/() => null)(); // Unfortunately, can't cache this forever because a "kill-all-scripts.js" or "cleanup.js" run will wipe them.
        }
        resetCaches() {
            // Reset any caches that can change over time
            this._isPrepped = this._isPrepping = this._isTargeting = this._isXpFarming =
                this._percentStolenPerHackThread = this._files = null;
            // Once true - Does not need to be reset, because once rooted, this fact will never change
            if (this._hasRootCached == false) this._hasRootCached = null;
        }
```
with
```js
            // HC-5: kept across loops (one ram-dodged ns.ls per host was costing a temp-script round trip per used host per loop). A "kill-all-scripts.js"
            // or "cleanup.js" run can wipe files, so it is dropped when an exec on the host fails (resetFileCache) and on the 60-loop refresh.
            this._files = (/**@returns{Set<string>}*/() => null)();
        }
        resetCaches() {
            // Reset any caches that can change over time (not _files, see resetFileCache)
            this._isPrepped = this._isPrepping = this._isTargeting = this._isXpFarming =
                this._percentStolenPerHackThread = null;
            // Once true - Does not need to be reset, because once rooted, this fact will never change
            if (this._hasRootCached == false) this._hasRootCached = null;
        }
        /** HC-5: forget which files this host has; the next hasFile() re-reads them (and arbitraryExecution re-copies missing tools) */
        resetFileCache() { this._files = null; }
```

- [ ] **Step 2: Invalidate on exec failure and on the 60-loop refresh**

In `arbitraryExecution`'s `if (pid == 0) {` branch (Task 4 added `targetServer.refreshUsedRam();`), add after it:
```js
                targetServer.resetFileCache(); // HC-5: a missing script (files wiped) is one cause of exec returning 0 - re-check and re-copy next time
```
In `refreshDynamicServerData`, after the `dictServerCores = ...` statement add:
```js
        getAllServers().forEach(s => s.resetFileCache()); // HC-5: re-verify remote file lists once a minute instead of every loop
```

- [ ] **Step 3: Checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]`; 140 tests pass.

- [ ] **Step 4: In-game verification**

1. `run daemon.js -v`, then in the terminal `ls /Temp/ | grep ls` is not informative (the file is reused); instead watch `tail daemon.js`: the `Loop Took: Nms` figure for loops that schedule a target drops further (each formerly cost one `ns.ls` round trip per host used, several ms each), and `Copying /Remote/... to <host>` lines appear once per host, not every minute.
2. Wipe test: `run cleanup.js` (or `rm /Remote/hack-target.js` on one purchased server via `connect`/`rm`), then confirm within a minute the daemon logs `Copying ... dependencies from home to <host>` again and batches resume on that host (`ps <host>` shows `/Remote/*` scripts) - the invalidation paths work.

- [ ] **Step 5: Commit (user triggers)**

```
git add daemon.js
git commit -m "daemon: keep the remote file-list cache across loops (HC-5)"
```

---

### Task 6: HC-4 — only share when the player is doing faction work

**Files:**
- Modify: `daemon.js` — VARS (near `lastShareTime`, line 175), `refreshDynamicServerData` (1121-1152), `shouldShare` (958-983), top-level exports. Locate by quoted code.
- Test: `test/daemon-share-gate.test.js` (new).

**Interfaces:**
- Produces `export function isFactionWork(workInfo) → boolean` (`workInfo?.type === "FACTION"`, the `WorkType.FACTION` string of `src/Work/Work.ts` returned by `ns.singularity.getCurrentWork()` via `FactionWork.APICopy`).
- Consumes: existing `getCurrentWorkInfo(ns)` (line 192, ram-dodged `ns.singularity.getCurrentWork()`, `?? {}` when idle), `dictSourceFiles`.

Design decision: refreshed on the existing 60-loop cadence (share runs 10 s per call, so a work-type change is honoured within a minute); without SF4 the work type cannot be read, so sharing stays enabled as before (the player may be working for a faction manually).

- [ ] **Step 1: Write the failing unit test**

```js
// test/daemon-share-gate.test.js
// HC-4: share only multiplies faction-work rep (src/PersonObjects/formulas/reputation.ts), so daemon.js must gate it on the current work type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFactionWork } from "../daemon.js";

test("faction work is recognised from ns.singularity.getCurrentWork()", () => {
    assert.equal(isFactionWork({ type: "FACTION", factionName: "CyberSec", factionWorkType: "hacking", cyclesWorked: 3 }), true);
});

test("everything else is not faction work", () => {
    for (const w of [{ type: "CRIME" }, { type: "COMPANY" }, { type: "CLASS" }, { type: "CREATE_PROGRAM" }, { type: "GRAFTING" }, {}, null, undefined])
        assert.equal(isFactionWork(w), false, JSON.stringify(w));
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test test/daemon-share-gate.test.js`
Expected: FAIL — `does not provide an export named 'isFactionWork'`.

- [ ] **Step 3: Implement**

Top-level (after the HC-3 helper):
```js
// --- HC-4: share gate (pure) ---

/** Whether ns.singularity.getCurrentWork() says the player is working for a faction (src/Work/Work.ts WorkType.FACTION = "FACTION",
 * returned by src/Work/FactionWork.tsx APICopy). The share bonus multiplies only faction-work rep gain
 * (src/PersonObjects/formulas/reputation.ts getHackingWorkRepGain / getFactionSecurityWorkRepGain / getFactionFieldWorkRepGain). */
export function isFactionWork(workInfo) {
    return workInfo?.type === "FACTION";
}
```
VARS, after `let lastShareTime = 0; ...`:
```js
    let isDoingFactionWork = true; // HC-4: refreshed every 60 loops from getCurrentWork (share is useless otherwise). Assumed true without SF4.
```
`refreshDynamicServerData`, after `moneySources = await getNsDataThroughFile(ns, 'ns.getMoneySources()');`:
```js
        // HC-4: share only helps while working for a faction. Without SF4 we cannot ask, so keep sharing enabled (the player may be working manually).
        isDoingFactionWork = (4 in dictSourceFiles) ? isFactionWork(await getCurrentWorkInfo(ns)) : true;
```
Replace
```js
                // Use any unspent RAM on share if we are currently working for a faction
                const maxShareUtilization = options['share-max-utilization']
                const shouldShare = failed.length <= 0 && utilizationPercent < maxShareUtilization && // Only share RAM if we have succeeded in all hack cycle scheduling and have RAM to space
```
with
```js
                // Use any unspent RAM on share if we are currently working for a faction (HC-4: checked via getCurrentWork every 60 loops; when we are not,
                // the RAM stays free for the idle-RAM hack-XP farm above, which share used to starve by pushing utilization to share-max-utilization)
                const maxShareUtilization = options['share-max-utilization']
                const shouldShare = isDoingFactionWork && failed.length <= 0 && utilizationPercent < maxShareUtilization && // Only share RAM if we have succeeded in all hack cycle scheduling and have RAM to space
```

- [ ] **Step 4: Checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]` (`getCurrentWork` was already referenced inside a string, i.e. ram-dodged); 142 tests pass.

- [ ] **Step 5: In-game verification**

1. On a save with SF4 and > 1 TB network RAM, `run daemon.js -v`, then commit a crime from the city (or `run work-for-factions.js --fast-crimes-only`) so that `getCurrentWork` is CRIME. Within 60 s `cat /Temp/share-active.txt` prints `false` and `ps home` shows no `/Remote/share.js`; the tail shows the XP farm scheduling (`... threads will fire against <server> ... (for Hack Exp)` in verbose) instead.
2. Start faction work (Factions > work) and within 60 s `/Temp/share-active.txt` is `true` and `Creating N share threads ...` lines resume.
3. `mem daemon.js` unchanged.

- [ ] **Step 6: Commit (user triggers)**

```
git add daemon.js test/daemon-share-gate.test.js
git commit -m "daemon: only share spare RAM while doing faction work (HC-4)"
```

---

### Task 7: HC-10 — refresh `getServerMaxRam` only when it can have changed

**Files:**
- Modify: `daemon.js` — VARS (near `lastShareTime`), `runPeriodicScripts` (lines 602-622), loop head line 726 (`await updateCachedServerData(ns);`), 60-loop block (749-752), `updateCachedServerData` (1114-1117). Locate by quoted code.
- Test: none (in-game only).

**Interfaces:**
- Produces module variable `maxRamRefreshDueAt` (ms epoch or 0).
- Consumes: `updateCachedServerData(ns)` (unchanged signature; now also calls `resetServerSortCache()` so the max-RAM/free-RAM orders pick up the new sizes), `getStaticServerData` (still calls it when a new host appears, unchanged).

Design decision: max RAM changes only via `ns.cloud.purchaseServer/upgradeServer` and home upgrades (`src/Server/ServerPurchases.ts`, `src/NetscriptFunctions/Singularity.ts`), which the daemon itself launches (host-manager.js / ram-manager.js every 30-32 s), so refresh every 60 loops plus 15 s after either of those tools is launched; new hosts are still refreshed immediately by `buildServerList`.

- [ ] **Step 1: Implement**

VARS, after the HC-4 line:
```js
    let maxRamRefreshDueAt = 0; // HC-10: when > 0, re-read every server's max RAM at this time (set after ram-manager / host-manager are launched)
```
In `runPeriodicScripts`, replace
```js
            if (await tryRunTool(ns, getTool(script))) // Try to run the task
                if (++launched > 1) await ns.sleep(1); // If we successfully launch more than 1 script at a time, yeild execution a moment to give them a chance to complete, so many aren't all fighting for temp RAM at the same time.
```
with
```js
            if (await tryRunTool(ns, getTool(script))) { // Try to run the task
                if (++launched > 1) await ns.sleep(1); // If we successfully launch more than 1 script at a time, yeild execution a moment to give them a chance to complete, so many aren't all fighting for temp RAM at the same time.
                if (script.name.includes('ram-manager.js') || script.name.includes('host-manager.js'))
                    maxRamRefreshDueAt = Date.now() + 15000; // HC-10: these may upgrade home / a purchased server; pick the new size up shortly after
            }
```
Loop head: replace
```js
                await buildServerList(ns, true); // Check if any new servers have been purchased by the external host_manager process
                await updateCachedServerData(ns); // Update server data that only needs to be refreshed once per loop
                await updatePortCrackers(ns); // Check if any new port crackers have been purchased
```
with
```js
                await buildServerList(ns, true); // Check if any new servers have been purchased by the external host_manager process
                if (maxRamRefreshDueAt && Date.now() >= maxRamRefreshDueAt) { // HC-10: ram-manager / host-manager ran a moment ago, sizes may have changed
                    maxRamRefreshDueAt = 0;
                    await updateCachedServerData(ns);
                }
                await updatePortCrackers(ns); // Check if any new port crackers have been purchased
```
60-loop block: replace
```js
                if (loops % 60 == 0) { // For more expensive updates, only do these every so often
                    // Pull additional data about servers that infrequently changes
                    await refreshDynamicServerData(ns);
```
with
```js
                if (loops % 60 == 0) { // For more expensive updates, only do these every so often
                    // Pull additional data about servers that infrequently changes
                    await updateCachedServerData(ns); // HC-10: max RAM (was every loop; it only changes via purchases we trigger, see maxRamRefreshDueAt)
                    await refreshDynamicServerData(ns);
```
`updateCachedServerData`: replace
```js
    /** Refresh information about servers that should be updated once per loop, but doesn't need to be up-to-the-second.
     * @param {NS} ns */
    async function updateCachedServerData(ns) {
        //if (verbose) log(ns, `updateCachedServerData`);
        dictServerMaxRam = await getServersDict(ns, 'getServerMaxRam');
    }
```
with
```js
    /** Refresh every server's max RAM (one temp script). HC-10: called when a host is added, every 60 loops, and ~15 s after ram-manager.js or
     * host-manager.js is launched - max RAM only changes through those purchases (src/Server/ServerPurchases.ts, src/NetscriptFunctions/Singularity.ts upgradeHomeRam).
     * @param {NS} ns */
    async function updateCachedServerData(ns) {
        //if (verbose) log(ns, `updateCachedServerData`);
        dictServerMaxRam = await getServersDict(ns, 'getServerMaxRam');
        resetServerSortCache(); // Sizes may have changed: re-sort by max / free RAM on next use
    }
```

- [ ] **Step 2: Checks**

Run: `node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: `daemon.js: +[] -[]`; 142 tests pass.

- [ ] **Step 3: In-game verification**

1. `run daemon.js -v`; `ls /Temp/` then `cat /Temp/getServerMaxRam-all.txt` is unchanged between loops (the file is only rewritten by the temp script when its content differs, so instead check the tail: `Loop Took:` drops by one temp-script round trip, typically 5-20 ms).
2. Buy home RAM (`run Tasks/ram-manager.js --budget 0.5` with cash, or via the tech store) while daemon runs: within 60 s (or ~15 s if ram-manager was launched by daemon) the status line's `RAM Utilization: X of Y` shows the new total `Y`, and helper gates such as `stats.js` (`reqRam(64)`) fire at the next 60-loop check.
3. Let host-manager buy a server: it appears in the target order / RAM total on the next loop as before (new-host path unchanged).

- [ ] **Step 4: Commit (user triggers)**

```
git add daemon.js
git commit -m "daemon: refresh server max RAM only when purchases can have changed it (HC-10)"
```

---

### Task 8: HC-7 + HC-8 — unweighted grow-XP rate for the basic XP farm; ranking cost model note

**Files:**
- Modify: `analyze-hack.js` — `getRatesAtHackLevel` lines 118-145, unlocked/locked maps lines 155-179, JSON output lines 206-210; top-level export.
- Modify: `daemon.js` — `Server.getExpPerSecond` (line 1188), `getXPFarmTargetsByExp` (1874-1878), `dictServerProfitInfo` type comment (line 1092).
- Test: `test/analyze-hack-xp-rates.test.js` (new).

**Interfaces:**
- Produces `analyze-hack.js`: `export function xpRatesPerRamSecond(hackExp, hackChance, hackCost, growRam, growTime) → { expRate, growExpRate }`; `/Temp/analyze-hack.txt` entries gain `growExpRate`.
- Produces `daemon.js`: `Server.getGrowExpPerSecond()`.
- Consumes: `dictServerProfitInfo` (daemon), `getBestXPFarmTarget` / `getXPFarmTargetsByExp` (used by `kickstartHackXp`, the idle-RAM farm and `--xp-only`).

Design decision: `expRate` (chance-weighted, hack-based) stays for `--xp-only`/advanced mode; the basic farm (weaken while above min security, else grow, which always succeed and give the full `calculateHackingExpGain` per thread: `src/NetscriptFunctions.ts:295-300, 371-376`) ranks by `growExpRate = hackExp / (grow_ram * growTime)`. HC-8 needs no formula change: after Task 1 the daemon holds a hack thread for hackTime (+ up to loopInterval) and a grow for growTime, which is what `hackCost`/`growCost` already model; a comment records that so nobody "fixes" the ranking toward the old 1.5x-weaken-time behaviour.

- [ ] **Step 1: Write the failing unit test**

```js
// test/analyze-hack-xp-rates.test.js
// HC-7: the basic (weaken/grow) XP farm must rank targets by an unweighted grow-exp rate; only hack-based farming is chance-weighted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { xpRatesPerRamSecond } from "../analyze-hack.js";

test("expRate keeps the chance-weighted hack formula (failed hack = 1/4 exp, plus recovery weaken cost)", () => {
    const hackExp = 30, hackChance = 0.5, hackCost = 1.7 * 10000 + 1.75 * 40000 * 0.002 / 0.05;
    const { expRate } = xpRatesPerRamSecond(hackExp, hackChance, hackCost, 1.75, 32000);
    const expected = hackExp * (hackChance + (1 - hackChance) / 4) * (1 + 0.002 / 0.05) / hackCost * 1000;
    assert.ok(Math.abs(expRate - expected) < 1e-12);
});

test("growExpRate ignores hack chance and charges only the grow's own RAM-time", () => {
    const a = xpRatesPerRamSecond(30, 0.55, 20000, 1.75, 32000); // server near the player's level: chance 0.55
    const b = xpRatesPerRamSecond(30, 1.0, 20000, 1.75, 32000);  // easy server: chance 1
    assert.equal(a.growExpRate, b.growExpRate, "chance does not matter for grow/weaken exp");
    assert.equal(a.growExpRate, 30 / (1.75 * 32000) * 1000);
    assert.ok(a.expRate < b.expRate, "the hack-based rate is still chance-weighted");
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test test/analyze-hack-xp-rates.test.js`
Expected: FAIL — `does not provide an export named 'xpRatesPerRamSecond'`.

- [ ] **Step 3: Implement in `analyze-hack.js`**

After `autocomplete` (line 15) add:
```js
/** Hack-exp rates per RAM-second, relative units (HC-7).
 * expRate: per hack thread, weighted by success chance (a failed hack grants 1/4 exp, src/Netscript/NetscriptHelpers.tsx hack()) and including the weaken
 *   needed to undo the hack's hardening - the right ranking for hack-based (--xp-only / advanced) XP farming.
 * growExpRate: per grow thread. grow() and weaken() grant calculateHackingExpGain * threads unconditionally (src/NetscriptFunctions.ts grow/weaken),
 *   grow takes 0.8x weaken time, and a grow at max money adds no security (src/Server/ServerHelpers.ts processSingleServerGrowth only fortifies when
 *   money changed), so the basic weaken/grow farm needs no chance weighting and no recovery weaken. */
export function xpRatesPerRamSecond(hackExp, hackChance, hackCost, growRam, growTime) {
    const expectedExpPerHackThread = hackExp * (hackChance + (1 - hackChance) / 4);
    return {
        expRate: expectedExpPerHackThread * (1 + 0.002 / 0.05) / hackCost * 1000,
        growExpRate: hackExp / (growRam * growTime) * 1000,
    };
}
```
In `getRatesAtHackLevel`, replace lines 118-122:
```js
        // Compute the cost (ram*seconds) for each tool, including the weaken threads needed to undo its security hardening
        // (hack +0.002 / grow +0.004 per thread, weaken -0.05 per thread: src/Server/data/Constants.ts ServerFortifyAmount / ServerWeakenAmount)
        const weakenCost = weaken_ram * weakenTime;
        const growCost = grow_ram * growTime + weakenCost * 0.004 / 0.05;
        const hackCost = hack_ram * hackTime + weakenCost * 0.002 / 0.05;
```
with
```js
        // Compute the cost (ram*seconds) for each tool, including the weaken threads needed to undo its security hardening
        // (hack +0.002 / grow +0.004 per thread, weaken -0.05 per thread: src/Server/data/Constants.ts ServerFortifyAmount / ServerWeakenAmount)
        // HC-8: this assumes a thread holds RAM for its own duration, which daemon.js now does (batch tasks are exec'd about 1 s before they start,
        // HC-1); do not scale these toward weaken time.
        const weakenCost = weaken_ram * weakenTime;
        const growCost = grow_ram * growTime + weakenCost * 0.004 / 0.05;
        const hackCost = hack_ram * hackTime + weakenCost * 0.002 / 0.05;
```
Replace lines 135-137:
```js
        // A failed hack still grants 1/4 of the exp of a successful one (src/Netscript/NetscriptHelpers.tsx hack(): expGainedOnFailure = expGainedOnSuccess / 4)
        const expectedExpPerHackThread = hackExp * (hackChance + (1 - hackChance) / 4);
        const expRate = expectedExpPerHackThread * (1 + 0.002 / 0.05) / (hackCost) * 1000;
```
with
```js
        // A failed hack still grants 1/4 of the exp of a successful one (src/Netscript/NetscriptHelpers.tsx hack(): expGainedOnFailure = expGainedOnSuccess / 4);
        // the basic weaken/grow farm gets the unweighted growExpRate (HC-7)
        const { expRate, growExpRate } = xpRatesPerRamSecond(hackExp, hackChance, hackCost, grow_ram, growTime);
```
Replace line 144 `return [theoreticalGainRate, cappedGainRate, expRate];` with `return [theoreticalGainRate, cappedGainRate, expRate, growExpRate];`.
Replace line 157:
```js
            [server.theoreticalGainRate, server.gainRate, server.expRate] = getRatesAtHackLevel(server, player, player.skills.hacking);
```
with
```js
            [server.theoreticalGainRate, server.gainRate, server.expRate, server.growExpRate] = getRatesAtHackLevel(server, player, player.skills.hacking);
```
Replace lines 168-174:
```js
            const [bestUnlockedScaledGainRate, _, bestUnlockedScaledExpRate] = getRatesAtHackLevel(best_unlocked_server, player, server.requiredHackingSkill);
            const gainRateScaleFactor = bestUnlockedScaledGainRate ? best_unlocked_server.theoreticalGainRate / bestUnlockedScaledGainRate : 1;
            const expRateScaleFactor = bestUnlockedScaledExpRate ? best_unlocked_server.expRate / bestUnlockedScaledExpRate : 1;
            const [theoreticalGainRate, cappedGainRate, expRate] = getRatesAtHackLevel(server, player, server.requiredHackingSkill);
            // Apply the scaling factors, as well as the same cap as above
            server.theoreticalGainRate = theoreticalGainRate * gainRateScaleFactor;
            server.expRate = expRate * expRateScaleFactor;
```
with
```js
            const [bestUnlockedScaledGainRate, _, bestUnlockedScaledExpRate, bestUnlockedScaledGrowExpRate] = getRatesAtHackLevel(best_unlocked_server, player, server.requiredHackingSkill);
            const gainRateScaleFactor = bestUnlockedScaledGainRate ? best_unlocked_server.theoreticalGainRate / bestUnlockedScaledGainRate : 1;
            const expRateScaleFactor = bestUnlockedScaledExpRate ? best_unlocked_server.expRate / bestUnlockedScaledExpRate : 1;
            const growExpRateScaleFactor = bestUnlockedScaledGrowExpRate ? best_unlocked_server.growExpRate / bestUnlockedScaledGrowExpRate : 1;
            const [theoreticalGainRate, cappedGainRate, expRate, growExpRate] = getRatesAtHackLevel(server, player, server.requiredHackingSkill);
            // Apply the scaling factors, as well as the same cap as above
            server.theoreticalGainRate = theoreticalGainRate * gainRateScaleFactor;
            server.expRate = expRate * expRateScaleFactor;
            server.growExpRate = growExpRate * growExpRateScaleFactor;
```
Replace lines 206-210:
```js
    ns.write('/Temp/analyze-hack.txt', JSON.stringify(server_eval.map(s => ({
        hostname: s.hostname,
        gainRate: s.gainRate,
        expRate: s.expRate
    }))), "w");
```
with
```js
    ns.write('/Temp/analyze-hack.txt', JSON.stringify(server_eval.map(s => ({
        hostname: s.hostname,
        gainRate: s.gainRate,
        expRate: s.expRate,
        growExpRate: s.growExpRate // HC-7: unweighted weaken/grow exp rate for daemon.js's basic XP farm
    }))), "w");
```

- [ ] **Step 4: Consume it in `daemon.js`**

Replace line 1092's type comment `{gainRate: number, expRate: number}` with `{gainRate: number, expRate: number, growExpRate: number}`.
Replace
```js
        getExpPerSecond() { return dictServerProfitInfo ? dictServerProfitInfo[this.name]?.expRate ?? 0 : (1 / dictServerMinSecurityLevels[this.name] ?? 0); }
```
with
```js
        getExpPerSecond() { return dictServerProfitInfo ? dictServerProfitInfo[this.name]?.expRate ?? 0 : (1 / dictServerMinSecurityLevels[this.name] ?? 0); }
        /** HC-7: exp per RAM-second of the basic weaken/grow farm (unweighted by hack chance). Falls back to getExpPerSecond for old analyze-hack output. */
        getGrowExpPerSecond() { return dictServerProfitInfo?.[this.name]?.growExpRate ?? this.getExpPerSecond(); }
```
Replace `getXPFarmTargetsByExp`:
```js
    /** @returns {Server[]} All hackable servers, in order of best Hack Exp to worst */
    function getXPFarmTargetsByExp() {
        return getAllServers().filter(server => (server.hasRoot() || server.canCrack()) && server.canHack() && server.shouldHack())
            .sort((a, b) => b.getExpPerSecond() - a.getExpPerSecond());
    }
```
with
```js
    /** @returns {Server[]} All hackable servers, in order of best Hack Exp to worst. HC-7: --xp-only farms with hack() (chance-weighted expRate);
     * otherwise the farm only runs weaken/grow, which always succeed, so rank by the unweighted growExpRate. */
    function getXPFarmTargetsByExp() {
        const rate = /** @param {Server} s */ s => xpOnly ? s.getExpPerSecond() : s.getGrowExpPerSecond();
        return getAllServers().filter(server => (server.hasRoot() || server.canCrack()) && server.canHack() && server.shouldHack())
            .sort((a, b) => rate(b) - rate(a));
    }
```

- [ ] **Step 5: Checks**

Run: `node --check analyze-hack.js && node --check daemon.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs analyze-hack.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs daemon.js && node --test`
Expected: both `+[] -[]`; 144 tests pass.

- [ ] **Step 6: In-game verification**

1. `run analyze-hack.js --all` then `cat /Temp/analyze-hack.txt`: every entry has `growExpRate`; for a server whose `requiredHackingSkill` is close to the player's level, `expRate` is noticeably below `growExpRate x (1.75 x growTime) / (hackCost) x 1.04`-scaled peers while `growExpRate` ranks it by `hackExp / growTime` only (e.g. `joesguns` vs `n00dles` early: `n00dles` wins on both; a 3x-security server near the level cap moves up in the grow ranking).
2. `run daemon.js -v` right after an install (`--initial-hack-xp-time 10`): the `INFO: Running Hack XP-focused cycles ...` block names the server with the best `growExpRate`, and `xpTarget.timeToWeaken()` is still under 10 s.

- [ ] **Step 7: Commit (user triggers)**

```
git add analyze-hack.js daemon.js test/analyze-hack-xp-rates.test.js
git commit -m "analyze-hack/daemon: rank the basic XP farm by unweighted grow exp; note the cost model (HC-7, HC-8)"
```

---

### Task 9: HC-9 — gate home core purchases on a small fraction of cash

**Files:**
- Modify: `Tasks/ram-manager.js` — argsSchema lines 5-11, `main` lines 27-30, `buyHomeCores` lines 67-95; top-level export.
- Test: `test/ram-manager-cores.test.js` (new).

**Interfaces:**
- Produces `export function coreWithinBudget(cost, cash, spendable, maxCashFraction) → boolean` (`cost <= spendable && cost <= cash * maxCashFraction`).
- New option `['core-max-cash-fraction', 0.05]` (listed under "Default changes").

- [ ] **Step 1: Write the failing unit test**

```js
// test/ram-manager-cores.test.js
// HC-9: a home core costs 1e9 * 7.5^cores (src/PersonObjects/Player/PlayerObjectServerMethods.ts) for a 6.25% thread saving on home-run grow/weaken
// only, so it must be a small fraction of cash, not just "whatever budget is left after RAM".
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreWithinBudget } from "../Tasks/ram-manager.js";

test("the spec's example is refused: 40b cash, 10b left after RAM, 7.5b core", () => {
    assert.equal(coreWithinBudget(7.5e9, 40e9, 10e9, 0.05), false);
});

test("a core is bought when it fits the leftover budget and is under the cash fraction", () => {
    assert.equal(coreWithinBudget(7.5e9, 200e9, 10e9, 0.05), true);   // 3.75% of cash
    assert.equal(coreWithinBudget(7.5e9, 200e9, 5e9, 0.05), false);   // budget too small
    assert.equal(coreWithinBudget(56.25e9, 1e12, 100e9, 0.05), false); // 5.6% of cash
    assert.equal(coreWithinBudget(56.25e9, 1.2e12, 100e9, 0.05), true); // 4.7% of cash
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test test/ram-manager-cores.test.js`
Expected: FAIL — `does not provide an export named 'coreWithinBudget'`.

- [ ] **Step 3: Implement**

argsSchema: after the `['no-cores', false],` line add
```js
    // HC-9: only buy a core if it costs at most this fraction of current cash (cores cost 1e9 * 7.5^cores and only improve home-run grow/weaken/share by 6.25% each)
    ['core-max-cash-fraction', 0.05],
```
After `autocomplete` add:
```js
/** HC-9: whether a home core purchase is sensible: it must fit the budget left after RAM upgrades AND be at most `maxCashFraction` of current cash.
 * A core (7.5 b, 56 b, 422 b, ...) buys 6.25% fewer grow/weaken/share threads on home only (src/Server/ServerHelpers.ts getCoreBonus = 1 + (cores - 1) / 16),
 * while the same money buys orders of magnitude more purchased-server RAM (src/Server/ServerPurchases.ts). */
export function coreWithinBudget(cost, cash, spendable, maxCashFraction) {
    return cost <= spendable && cost <= cash * maxCashFraction;
}
```
In `main`, replace
```js
    if (!options['no-cores'] && spendable > 0)
        await buyHomeCores(ns, spendable, money);
```
with
```js
    if (!options['no-cores'] && spendable > 0)
        await buyHomeCores(ns, spendable, money, options['core-max-cash-fraction']);
```
In `buyHomeCores`, change the signature to `async function buyHomeCores(ns, spendable, money, maxCashFraction)` and replace
```js
        if (spendable < cost) {
            log(ns, `Money we're allowed to spend (${formatMoney(spendable)}) is less than the cost (${formatMoney(cost)}) to upgrade ${upgradeDesc}`);
            return spendable;
        }
```
with
```js
        if (!coreWithinBudget(cost, money, spendable, maxCashFraction)) { // HC-9
            log(ns, `Not upgrading ${upgradeDesc}: it must fit the remaining budget (${formatMoney(spendable)}) and be at most ` +
                `${(maxCashFraction * 100).toFixed(1)}% of cash (${formatMoney(money * maxCashFraction)}) - set --core-max-cash-fraction to change this.`);
            return spendable;
        }
```

- [ ] **Step 4: Checks**

Run: `node --check Tasks/ram-manager.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs Tasks/ram-manager.js && node --test`
Expected: `Tasks/ram-manager.js: +[] -[]`; 146 tests pass.

- [ ] **Step 5: In-game verification**

`run Tasks/ram-manager.js --budget 0.5 --reserve 0` on a save with home at max RAM (or a budget too small for the next RAM doubling) and cash between 7.5 b and 150 b: the log shows `Not upgrading home cores from 1 to 2 (cost: $7.500b): it must fit ... at most 5.0% of cash ...` and `mem` stays unchanged. With cash > 150 b it logs `SUCCESS: Upgraded home cores from 1 to 2`.

- [ ] **Step 6: Commit (user triggers)**

```
git add Tasks/ram-manager.js test/ram-manager-cores.test.js
git commit -m "ram-manager: only buy a home core when it is a small fraction of cash (HC-9)"
```

---

### Task 10: HC-11 — calibrate the backdoor RAM guard to the script's real cost

**Files:**
- Modify: `Tasks/backdoor-all-servers.js` — argsSchema line 5, `scriptPath` block lines 74-78, guard lines 86-91; top-level export.
- Test: `test/backdoor-ram-guard.test.js` (new).

**Interfaces:**
- Produces `export function canSpawnBackdoor(homeFreeRam, reservedHomeRam, backdoorRam) → boolean` (`homeFreeRam - backdoorRam >= reservedHomeRam`).
- Consumes: `ns.getScriptRam` (0.1 GB, ram-dodged through the existing `getNsDataThroughFile`, so the script's own RAM is unchanged).

- [ ] **Step 1: Write the failing unit test**

```js
// test/backdoor-ram-guard.test.js
// HC-11: backdoor-one.js costs 1.6 + SF4Cost(2) GB = 33.6 GB below SF4.3, 8.6 GB at SF4.2, 3.6 GB at SF4.3 (src/Netscript/RamCostGenerator.ts SF4Cost),
// so the guard must use the measured cost and keep the reserve free *after* spawning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSpawnBackdoor } from "../Tasks/backdoor-all-servers.js";

test("SF4.3: 3.6 GB script, 22 GB reserve", () => {
    assert.equal(canSpawnBackdoor(30, 22, 3.6), true);
    assert.equal(canSpawnBackdoor(25, 22, 3.6), false);
});

test("below SF4.3: 33.6 GB script - the old '22 GB free' guard would have let ns.run fail instead", () => {
    assert.equal(canSpawnBackdoor(40, 22, 33.6), false);
    assert.equal(canSpawnBackdoor(56, 22, 33.6), true);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test test/backdoor-ram-guard.test.js`
Expected: FAIL — `does not provide an export named 'canSpawnBackdoor'`.

- [ ] **Step 3: Implement**

Replace line 5:
```js
    ['reserved-home-ram', 22], // Don't spawn additional backdoor scripts if home free ram dips below this amount (each parallel backdoor consumes 3.6 GB)
```
with
```js
    ['reserved-home-ram', 22], // Leave at least this much home RAM free after spawning a backdoor script (HC-11: its cost is measured - 3.6 GB at SF4.3, 8.6 GB at SF4.2, 33.6 GB below)
```
After `autocomplete` add:
```js
/** HC-11: may another backdoor-one.js be spawned on home? Its RAM is 1.6 GB base + installBackdoor (2 GB x 16 below SF4.2, x 4 at SF4.2, x 1 at SF4.3:
 * src/Netscript/RamCostGenerator.ts SF4Cost), so the guard uses the measured cost and keeps `reservedHomeRam` free after the spawn. */
export function canSpawnBackdoor(homeFreeRam, reservedHomeRam, backdoorRam) {
    return homeFreeRam - backdoorRam >= reservedHomeRam;
}
```
Replace lines 74-78:
```js
        // Collect information about any servers still being backdoored (from a prior run), so we can skip them
        let scriptPath = getFilePath('/Tasks/backdoor-all-servers.js.backdoor-one.js');
```
with
```js
        // Collect information about any servers still being backdoored (from a prior run), so we can skip them
        let scriptPath = getFilePath('/Tasks/backdoor-all-servers.js.backdoor-one.js');
        // HC-11: the per-backdoor cost depends on the SF4 level (33.6 GB below SF4.3), measure it rather than assuming 3.6 GB
        const backdoorRam = await getNsDataThroughFile(ns, 'ns.getScriptRam(ns.args[0], "home")', '/Temp/backdoor-one-ram.txt', [scriptPath]);
        ns.print(`Each backdoor script needs ${backdoorRam} GB; will keep ${options['reserved-home-ram']} GB of home RAM free.`);
```
Replace lines 86-91:
```js
            // If we're running low on home ram, don't spawn any more backdoor scripts
            const homeFreeRam = await getNsDataThroughFile(ns,
                'ns.getServerMaxRam(ns.args[0]) - ns.getServerUsedRam(ns.args[0])',
                '/Temp/getServerFreeRam.txt', ["home"]);
            if (homeFreeRam < options['reserved-home-ram'])
                return log(ns, `WARNING: Home is low on RAM, will skip backdooring remaining servers.`);
```
with
```js
            // If we're running low on home ram, don't spawn any more backdoor scripts
            const homeFreeRam = await getNsDataThroughFile(ns,
                'ns.getServerMaxRam(ns.args[0]) - ns.getServerUsedRam(ns.args[0])',
                '/Temp/getServerFreeRam.txt', ["home"]);
            if (!canSpawnBackdoor(homeFreeRam, options['reserved-home-ram'], backdoorRam)) // HC-11
                return log(ns, `WARNING: Home has ${homeFreeRam.toFixed(1)} GB free; a backdoor needs ${backdoorRam} GB and we keep ` +
                    `${options['reserved-home-ram']} GB free, so the remaining servers will be backdoored later.`);
```

- [ ] **Step 4: Checks**

Run: `node --check Tasks/backdoor-all-servers.js && node /home/jubnl/dev/bitburner/tools/harness/collide.mjs Tasks/backdoor-all-servers.js && node --test`
Expected: `Tasks/backdoor-all-servers.js: +[] -[]` (`getScriptRam` only appears inside a string); 148 tests pass.

- [ ] **Step 5: In-game verification**

1. `mem Tasks/backdoor-all-servers.js` unchanged. `run Tasks/backdoor-all-servers.js` with several servers to backdoor on a save **below SF4.3** (e.g. the BN1x3 save if SF4 < 3 there; otherwise `mem Tasks/backdoor-all-servers.js.backdoor-one.js` shows 3.6 GB and step 2 applies): `tail` shows `Each backdoor script needs 33.6 GB ...`, backdoors are started one after another only while `home free - 33.6 >= 22`, and the previous `WARN: Couldn't initiate a new backdoor of "<server>" (insufficient RAM?)` line no longer appears - the script stops with the new `Home has X GB free ...` warning instead and resumes on the next periodic run.
2. At SF4.3, `Each backdoor script needs 3.6 GB` and behaviour matches the old guard within 3.6 GB.

- [ ] **Step 6: Commit (user triggers)**

```
git add Tasks/backdoor-all-servers.js test/backdoor-ram-guard.test.js
git commit -m "backdoor-all-servers: size the home RAM guard by the measured backdoor cost (HC-11)"
```

---

## Skipped

None. Every finding in section 1 (HC-1..HC-11) is marked confirmed and is planned above. Section 1's "Formula-by-formula comparison" found no numerically wrong formula, so nothing else in this area needs a task.

## Self-review

**Spec coverage** (section 1 findings → tasks):

| Finding | Task |
|---|---|
| HC-1 JIT launching / round chaining | Task 1 |
| HC-2 host-manager budget vs home upgrades | Task 2 |
| HC-3 prep W-G-W | Task 3 |
| HC-4 share gated on faction work | Task 6 |
| HC-5 `ns.ls` cache reset every loop | Task 5 |
| HC-6 live `getServerUsedRam` per comparison | Task 4 |
| HC-7 XP-farm ranking chance-weighted | Task 8 |
| HC-8 ranking cost model vs RAM held | Task 8 (comment only; the behaviour change is Task 1, after which the model is correct) |
| HC-9 home cores | Task 9 |
| HC-10 per-loop `getServerMaxRam` sweep | Task 7 |
| HC-11 backdoor RAM guard | Task 10 |

Task order is by impact (HC-1, HC-2, HC-3, HC-6, HC-5, HC-4, HC-10, HC-7/8, HC-9, HC-11) except that Task 3 (HC-3) must follow Task 1 because it queues its tasks through `enqueueTask`/`launchDueTasks`; every other task is independently committable (Task 5's exec-failure hook is inserted next to Task 4's line but does not depend on it).

**Placeholder scan:** no "TBD", "TODO (new)", "similar to", "handle edge cases", or "add tests" in the steps; every implementation step quotes the old lines and the new lines or a complete new function; every test step shows the full test file; every commit step gives the exact command.

**Name/signature consistency across tasks:**
- `enqueueTask(target, start, toolShortName, threads, args, threadsByCores = null, allowSplit = null, description = '')` defined in Task 1, called with that argument order in Task 1 (`performScheduling`) and Task 3 (`prepServer`: `..., weakenThreadsByCores(...), null, "prep"` and `..., growThreadsByCores(...), true, "prep"`).
- `launchDueTasks(ns) → number of failures` defined in Task 1, used as `(await launchDueTasks(ns)) == 0` in Task 3 and as a bare `await` in the loop.
- `queuedTaskCount(serverName, descriptionPrefix)` used with `"prep"` and `"Batch"` in Task 1; descriptions written are exactly `"prep"` (Task 3) and `` `Batch ${n}-${desc}` `` (Task 1).
- `roundState[name] = { lastBatchStart, readyAt, nextBatchNumber }` written in `performScheduling` and read by `canPlanNextRound` / `nextRoundStart` (Task 1 test uses the same three keys).
- `Server.refreshUsedRam()` / `noteRamUsed(gb)` / `_freeRamSortDirty` (Task 4) and `Server.resetFileCache()` (Task 5) are the only new `Server` members besides `getGrowExpPerSecond()` (Task 8); `updateCachedServerData` (Task 7) calls the pre-existing `resetServerSortCache`, redefined in Task 4 to also set the dirty flag.
- `parseSpendRecord` (daemon) and `readSpendRecord` (host-manager) share the file format `{resetKey, spent}` and file name `/Temp/host-manager-spend.txt`; `lastAugReset` (daemon) and `resetKey` (host-manager) are both `ns.getResetInfo().lastAugReset`.
- Test counts: 126 at HEAD, +5 (T1) = 131, +7 (T2) = 138, +2 (T3) = 140, +2 (T6) = 142, +2 (T8) = 144, +2 (T9) = 146, +2 (T10) = 148; Tasks 4, 5, 7 add none.
