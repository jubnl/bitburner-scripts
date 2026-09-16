# Functional fixes — in-game verification checklist

This is a checklist for the 56 plan tasks that fixed the findings of `docs/audit/2026-09-15-functional-review.md`, on branch `game-optimisation-3.0`, commits `4edb810..52c78d3` (56 plan tasks, then an 8-commit final fix wave b10d64a..52c78d3).
The Node suite (`node --test` from the scripts repo root) passes all 259 tests, and the darknet headless loot smoke (`tools/harness`, fixture rebuilt from HEAD `9a17233`) passed with an empty `=== errors ===` section — but every step below runs against the live game and none of it has been observed there yet.
Each task lists the exact terminal commands and the exact log lines / observations to look for, and — where the source states it — what the old, buggy behaviour looked like for comparison.

---

## Hacking (daemon.js and friends)

### A1 — HC-1 (commits c82cb4c..e8bc10e)
Launch batch tasks just-in-time and chain rounds back-to-back instead of scheduling a whole batch at once.

1. `run daemon.js -v` (kills the previous instance), then `tail daemon.js`.
2. Within ~2 loops: `Queued N x (H:.. W:.. G:.. W²:..) ... starting <time> (M tasks now queued)` for the first target, then every second `INFO: Launched k of k due tasks (M still queued, 0 failed)` with small k (~`4 * loopInterval / cycle-timing-delay`, ~2 per target per loop), M decreasing over ~weaken-time. Before the fix: one `Scheduled N x ...` line and all 4N scripts started at once.
3. `ps daemon-0` (or the largest purchased server): the `/Remote/hack-target.js` count for one target stays well under N and turns over continuously; a few seconds later `ps` shows different `Batch <n>-hack` numbers.
4. Chaining: the next `Queued N x ...` line for the same target starts about `cycle-timing-delay` after the previous round's last batch (or check with `-v --run-once`'s `logSchedule`: new round's first `Hack - End` is 2 s after the previous round's last `Hack - End`). No `Misfire: ... started ... ms too late` toasts beyond an occasional <100 ms one.
5. After 10 minutes, compare HUD "Script income" ($/s) against the same save pre-change (expect roughly 2x per GB once RAM-bound, at minimum no drop); the daemon status line's `RAM Utilization: ... Max Targets: ...` should climb without `servers failed to be scheduled` lines.
6. Stress test: `run daemon.js -v --max-batches 200 --cycle-timing-delay 1000` — the `Launched ... (x failed)` counter should stay 0 or be followed by `Max Targets` decreasing (back-off), never a stream of misfire toasts.
7. Fix-round addition — stock manipulation flag: with `run daemon.js -v --stock-manipulation-focus` and an open position that reverses, when the log shows `INFO: Killing N pids running /Remote/hack-target.js with stock manipulation in the wrong direction.`, `ps` on a purchased server should show newly launched `Batch <n>-hack` processes carrying `0` (not `1`) as their 5th argument (the stock flag), and no further kill lines should appear for that target while the position holds.
8. Fix-round addition — prep-regression checkpoint: in steady state, no `WARNING n: Server was prepped, but now at security ...` lines should appear while a target is chaining; if one does, that target should stop producing `Queued N x ...` lines until a `Prepping with ... (target)` line appears, after which chaining resumes.
9. Fix-round addition — batch drops: under `--max-batches 200 --cycle-timing-delay 1000`, any `Could not launch ... Dropping it and the N later task(s) of that batch.` line should be followed by a verbose `... f failed, d dropped with their batch` count and no misfire toasts for that batch; the target's security should not creep up over the following minutes.

### A2 — HC-2 (commits 5b315bf..ecf621a)
Track purchased-server spend separately from home-upgrade spend so `host-manager.js`'s budget isn't drained by RAM purchases.

1. `run host-manager.js --budget 1e12 --absolute-reserve 0 --reserve-percent 0 --utilization-trigger 0` on a save with cash for one server; after `SUCCESS: Purchased server daemon-N ... for $X`, `cat /Temp/host-manager-spend.txt` shows `{"resetKey":<number>,"spent":X}`; run again and `spent` grows by the second cost.
2. `run daemon.js -v`: the `INFO: Ran tool: host-manager.js with args ["--budget",B,...]` line shows `B = max(0, 0.25 * hacking-since-install - spent, ...)` — compare against `run stats.js` / the HUD "Hacking" income since install. Then `run Tasks/ram-manager.js --budget 0.5` to buy a home RAM upgrade and confirm on the next host-manager launch (32 s later) that `--budget` did **not** drop by the home upgrade cost.
3. `mem daemon.js` and `mem host-manager.js` unchanged from before the edit.

### A3 — HC-3 (commits b2c5e95..d370eba)
Prep a fresh server as a W-G-W mini-batch so the grow lands exactly at min security instead of over-growing.

1. Pick a rooted, hackable server far from prepped (e.g. `run daemon.js -v --run-once` shows `Sec: X of Y` with `X ≈ 3Y`, or freshly root one with `run Tasks/crack-host.js <server>`).
2. `run daemon.js -v`, `tail daemon.js`: the prep line reads `Prepping with A weaken, B grow, C recovery weaken threads ... grow lands at <time>`; `ps <a big purchased server>` right after shows `/Remote/weak-target.js ... prep` scripts (two start times, now and now+1000) but **no** `/Remote/grow-target.js ... prep` until ~`weaken-time - grow-time` later.
3. After one weaken-time (+1 s) the target shows `*` (prepped) in the next `Targetting Order` log, `Sec:` = min and money = max — **one** prep round. Before the fix, the first round left money at ~2.2x instead of 10x on a fresh server, followed by a second `Prepping with ...` line one weaken-time later (possibly with a `WARNING 1: Server was prepped, but now at security ...`).
4. No `Misfire: Grow achieved no growth` toast for prep grows.
5. Fix-round addition: with two targets both due for prep in the same tick, and RAM tight enough that one target's prep batch fails to launch, `tail daemon.js` should show only the target whose own task actually failed logging `WARN: Failed to launch the prep weaken threads for <name> ...` and landing in the `failed` summary; the other target's prep (whose own tasks all launched) must proceed to `Prepping with ...` normally, even though `launchDueTasks` handled both targets' due tasks in one call.

### A4 — HC-6 (commits d370eba..227010e)
Snapshot used RAM once per loop instead of making a live `ns` call in every sort comparison.

1. `run daemon.js -v`, `tail daemon.js`. The `... Loop Took: Nms` line for a loop that planned a round (a `Queued N x ...` line the same second) must stay well under `maxLoopTime` (1000 ms) with 100 batches; before the fix, on a ~100-host network such a loop overran and logged `were skipped for now (time, RAM, or target + prepping cap reached)`.
2. No new `ERROR: Failed to exec ... threads` lines during a 10-minute run (the snapshot is at most one loop stale, and only conservatively).
3. `run daemon.js -v --run-once`: the `Preferred Server ... resulted in preferred order: ...` free-RAM figures match `free` typed on a few hosts.

### A5 — HC-5 (commits d370eba..227010e)
Keep the `ns.ls` remote-file cache across loops instead of re-listing every loop.

1. `run daemon.js -v`; watch `tail daemon.js`: `Loop Took: Nms` for loops that schedule a target drops further (one `ns.ls` round trip per used host was removed), and `Copying /Remote/... to <host>` lines appear once per host, not every minute.
2. Wipe test: `run cleanup.js` (or `rm /Remote/hack-target.js` on one purchased server), then within a minute confirm the daemon logs `Copying ... dependencies from home to <host>` again and batches resume on that host (`ps <host>` shows `/Remote/*` scripts) — the cache-invalidation paths work.

### A6 — HC-4 (commits d370eba..227010e)
Only share spare RAM while the player is doing faction work, not unconditionally.

1. On a save with SF4 and > 1 TB network RAM, `run daemon.js -v`, then commit a crime (or `run work-for-factions.js --fast-crimes-only`) so `getCurrentWork` is CRIME. Within 60 s `cat /Temp/share-active.txt` prints `false` and `ps home` shows no `/Remote/share.js`; the tail shows XP-farm scheduling instead (verbose: `... threads will fire against <server> ... (for Hack Exp)`).
2. Start faction work (Factions > work): within 60 s `/Temp/share-active.txt` is `true` and `Creating N share threads ...` lines resume.
3. `mem daemon.js` unchanged.

### A7 — HC-10 (commits 5672e40..38e1b67)
Refresh `getServerMaxRam` only when a purchase could have changed it, not every loop.

1. `run daemon.js -v`; `cat /Temp/getServerMaxRam-all.txt` is unchanged between loops (rewritten only on real content change); check `Loop Took:` instead — it drops by one temp-script round trip (typically 5-20 ms).
2. Buy home RAM (`run Tasks/ram-manager.js --budget 0.5`, or via the tech store) while daemon runs: within 60 s (or ~15 s if ram-manager was launched by daemon) the status line's `RAM Utilization: X of Y` shows the new total `Y`, and gates such as `stats.js` (`reqRam(64)`) fire at the next 60-loop check.
3. Let host-manager buy a server: it appears in the target order / RAM total on the next loop as before.

### A8 — HC-7 + HC-8 (commits 38e1b67..542fe7f)
Rank the basic Hack-XP farm by unweighted grow-exp rate instead of a cost-weighted rate; note the ranking cost model.

1. `run analyze-hack.js --all`, then `cat /Temp/analyze-hack.txt`: every entry has `growExpRate`. For a server whose `requiredHackingSkill` is close to the player's level, `expRate` should sit noticeably below `growExpRate x (1.75 x growTime) / hackCost x 1.04`-scaled peers, while `growExpRate` ranks it purely by `hackExp / growTime` (e.g. early on, `n00dles` beats `joesguns` on both; a 3x-security server near the level cap moves up in the grow ranking).
2. `run daemon.js -v` right after an install (`--initial-hack-xp-time 10`): the `INFO: Running Hack XP-focused cycles ...` block names the server with the best `growExpRate`, and `xpTarget.timeToWeaken()` is still under 10 s.

### A9 — HC-9 (commits ece0e4e..19b5dd7 + 9375a28)
Gate home core purchases on a small fraction of cash instead of buying whenever nominally affordable.

`run Tasks/ram-manager.js --budget 0.5 --reserve 0` on a save with home at max RAM (or a budget too small for the next RAM doubling) and cash between 7.5b and 150b: the log shows `Not upgrading home cores from 1 to 2 (cost: $7.500b): it must fit ... at most 5.0% of cash ...` and `mem` stays unchanged. With cash > 150b it logs `SUCCESS: Upgraded home cores from 1 to 2`.

### A10 — HC-11 (commits 19b5dd7..4eb3d21)
Calibrate the backdoor RAM guard to the script's real measured cost instead of a hardcoded guess.

1. `mem Tasks/backdoor-all-servers.js` unchanged. `run Tasks/backdoor-all-servers.js` with several servers to backdoor on a save **below SF4.3** (e.g. the BN1x3 save if SF4 < 3 there; otherwise check `mem Tasks/backdoor-all-servers.js.backdoor-one.js` = 3.6 GB and step 2 applies instead): `tail` shows `Each backdoor script needs 33.6 GB ...`, backdoors start one after another only while `home free - 33.6 >= 22`; the old `WARN: Couldn't initiate a new backdoor of "<server>" (insufficient RAM?)` line no longer appears — the script now stops with `Home has X GB free ...` and resumes on the next periodic run.
2. At SF4.3, `Each backdoor script needs 3.6 GB` and behaviour matches the old guard within 3.6 GB.

---

## Gang / Sleeve / Bladeburner

In-game checks below assume a save with SF2 (gangs), SF10 (sleeves), SF7 (bladeburner API). The `lib/*.js` files (`lib/gang-logic.js`, `lib/sleeve-logic.js`, `lib/bladeburner-logic.js`) must be present on `home`; if pulled with `git-pull.js`, add `--new-file lib/gang-logic.js --new-file lib/sleeve-logic.js --new-file lib/bladeburner-logic.js` the first time.

### B1 — SL-2 (commits e8bc10e..ec179fd)
Gate sleeve training on cost-per-exp instead of a flat 2-hour cap.

`run sleeve.js --tail`. With a sleeve at shock <= 90 and money above reserve, the log must show `SUCCESS: Set sleeve N to train strength (Powerhouse Gym)` within a few seconds, and Str must rise on the Sleeves page. A sleeve at shock > 90 must show no `train ...` assignment. `run sleeve.js --training-cap-seconds 60` on a node older than a minute must show no training at all (the cap option still works when set).

### B2 — SL-1 (commits ec179fd..b145725)
Never block sleeve assignment on sync; Homicide-for-karma is only a qualifying filler task, not a blocker.

Save with SF2 owned, no gang, karma > -54000, fresh sleeves. `run sleeve.js --tail`: no sleeve may log `syncing...`; sleeves get recovery / training / bladeburner / faction work as applicable, never `committing Homicide ... because we want gang karma`. Then `run sleeve.js --karma-homicide-min-rate 0 --tail`: sleeves that reach the bottom of the task list now log `committing Homicide ... because we want gang karma (earning 0.0% ...)`, proving the gate is the only thing holding them back. `run sleeve.js --sync-first --tail` still logs `syncing...`.

### B3 — BB-1 (commits d1adb59..5b315bf)
Resolve the BlackOp success-chance range first; go/no-go decided on the low end of that range.

Save with rank above the next BlackOp's requirement (`run bladeburner.js --tail` prints remaining BlackOps with their ranks at startup). Watch `Switched to Bladeburner ...`: while the BlackOp's `Success Chance: X% to Y%` shows two different numbers, the script must stay on Undercover / Investigation / Tracking / Field Analysis (`High population uncertainty in <city>` or an operation with a range) and must never start `Black Operations`. Once the summary collapses to a single number above 99%, it starts the BlackOp. To force it: wait for a random population event (drifts every 4-10 min), or `run bladeburner.js --blackop-success-threshold 0.999` on a save where the BlackOp shows `99.5% to 100%`.

### B4 — GG-1 (commits 9abfc00..4a4d557)
Steer gang equipment, ascension and training by the task's stat weights instead of a fixed priority order.

Combat gang on Terrorism / Human Trafficking with >= $1B (so budgets aren't split): `run gangs.js --tail`. On the next territory tick, `SUCCESS: Purchased N gang member upgrades` must list rootkits (`NUKE Rootkit`, `Soulstealer Rootkit`, ...) and cheap weapons/armor before any `Bionic Legs`; agility-only augs (`Bionic Legs`/`Bionic Arms`) appear only once the other augmentations are owned. Ascension lines read `Ascended member Thug N: Terrorism stat weight x1.xx (hack -> ..., str -> ..., def -> ..., dex -> ..., cha -> ...)` with no `agi`. Training ticks show `Train Hacking` / `Train Charisma` about 20% of the time each for a Terrorism gang. `mem gangs.js` unchanged from before the change.

### B5 — GG-3 (commits 227010e..47c9bd9)
Track territory ticks by counting `ns.gang.nextUpdate()` cycles instead of 200 ms polling.

`run gangs.js --tail` in normal play (no bonus-time banner on the Gang page). Expected sequence: `INFO: Observed a territory tick.` within 20 s, then every 20 s exactly one `Assigned N/M gang member tasks (Territory Warfare)` about 2 s before the next `Territory tick: power ...` line, immediately followed by `Assigned N/M gang member tasks (<crimes>)` (restore happens before recruiting/ascending/buying). No `Waiting for territory to tick`, `Power stats weren't updated` or `Max wait time` lines; `Resynchronizing` may appear at most once per several minutes. On the Gang page, Power increases every 20 s and Respect keeps growing between ticks. `mem gangs.js` unchanged from Task B4 (GG-1).

### B6 — GG-2 (commits 47c9bd9..8087c23)
No pre-tick Territory Warfare swap during bonus time; housekeeping runs on a wall-clock timer instead of counting cycles that don't apply in bonus time.

Export a save with a gang, wait >= 30 minutes (or use any older export), import it: the game grants offline cycles, so the Gang page shows a bonus-time banner for several minutes. `run gangs.js --tail` immediately. While the banner is up: no `Assigned ... (Territory Warfare)` line may appear, `Territory tick: power ...` lines come every ~20 s of wall-clock (not every 800 ms), and Respect grows at the accelerated rate continuously. When the banner disappears: `INFO: Observed a territory tick.` appears within 20 s and the B5 pattern (swap, tick, restore every 20 s) resumes.

### B7 — SL-3 (commits 8087c23..cf460c9)
Sleeves 5 and 6 default to Infiltrate Synthoids instead of Diplomacy / Field Analysis.

Save in bladeburner (SF7, in the division), current city chaos < 40: `run sleeve.js --tail`. Sleeves 4-7 must log `Set sleeve N to Bladeburner Infiltrate Synthoids`; no sleeve logs `Field Analysis`; `Diplomacy` appears only for sleeve i once the city's chaos exceeds `(10 - i) x 10` (e.g. sleeve 7 at chaos > 30). On the Bladeburner page, contract/operation counts should rise faster than before (~+0.1/min per added infiltrator).

### B8 — BB-2 (commits cf460c9..746662c)
Resolve population uncertainty by the best estimate-improvement-per-second action; drop Tracking as an uncertainty-resolving choice.

`run bladeburner.js --tail`. When the log shows an operation with a range (`Success Chance: 80.0% to 96.0%`), the next `Switched to Bladeburner ...` must be `Operations "Undercover Operation"`, `Operations "Investigation"` or `General "Field Analysis"` — never `Contracts "Tracking"` — and the range must narrow over the next few completions until a single value is shown. `mem bladeburner.js` unchanged from Task B3 (the `player.skills.hacking` access costs nothing extra).

### B9 — GG-4 (commits 37aba54..b3b3490)
Retrain a gang member after ascension until its task-weighted stats recover, instead of returning it to crime immediately.

`run gangs.js --tail --ascend-multi-threshold 1.02` (forces an ascension soon) against a gang with at least one member. After `SUCCESS: Ascended member Thug N: ...`, that member must stay on `Train Combat` / `Train Hacking` / `Train Charisma` (per `pickTrainingTask(memberWeights(member))`) through subsequent `Optimized gang member crimes` lines, and must not appear in another `Ascended` line until `INFO: Thug N has recovered its pre-ascension stats (task-weighted ...). Returning to crime.` is logged (typically 4-12 minutes later); at that moment the Gang page's Str/Def/Dex (minus equipment) should be within ~10% of pre-ascension values. A freshly recruited member logs `Training until task-weighted stats reach X` and stays on training until it matches the weakest existing member's task-weighted stat.

### B10 — BB-3 (commits cf460c9..746662c)
Run Diplomacy only when every city is above the real chaos cliff (the game's hardcoded 50, not `--chaos-recovery-threshold`); lower the Stealth Retirement chaos-recovery gate.

`run bladeburner.js --chaos-recovery-threshold 5 --tail` on a save where every city has chaos > 5 (check the Bladeburner page): the log must show `Switched to Bladeburner General "Diplomacy" (Chaos X > 5 in every city (x... difficulty); Diplomacy at charisma N needs ~...)`, and the current city's chaos must fall by about `cha^0.045 + cha/1000` percent per minute until it is <= 5, after which contracts/operations resume. With the real default (50) the branch only fires once all six cities exceed 50 (long runs); the Stealth Retirement gate change is visible whenever chaos > 50 in the current city: `Chaos is high: ... Stealth Retirement Operation Success Chance: 9x.x%` now starts at chances between 90% and 99% (previously required >99%). Note: `chaosDifficultyMult`/`shouldRunDiplomacy` use the game's hardcoded difficulty-cliff constant of 50 (`Action.ts` `getChaosSuccessFactor`); `--chaos-recovery-threshold` only ever set the Diplomacy *target*, never the cliff itself — this was the review finding fixed here.

### B11 — BB-4 (commits cf460c9..746662c)
Bulk skill purchases, cached skill max-levels, and `nextUpdate()`-paced loop instead of a 1 s poll.

`mem bladeburner.js` must print the same value as at HEAD (`nextUpdate` is free). Give the division a skill-point windfall (`run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_SP --liquidate` with hashes available, or wait for a rank-up): `run bladeburner.js --tail` must log `SUCCESS: Upgraded Bladeburner skill <name> by N levels (a -> b)` with N > 1 within one loop, and the Skills page must show 0 unspent SP shortly after, with Overclock never above 90. `Switched to Bladeburner ...` lines keep appearing within ~1 s of an action's completion (the loop still wakes on `currentTaskEndTime`).

### B12 — SL-4 (commits 8087c23..cf460c9)
Fetch `getResetInfo` once at startup and `getNumSleeves` every 60 s instead of every loop.

`run sleeve.js --tail`: sleeves are assigned exactly as before (same `Set sleeve N to ...` lines). Open the Active Scripts panel while the script runs: the per-second flicker of `/Temp/getResetInfo.js` and `/Temp/sleeve-getNumSleeves.js` entries is gone (they appear once at start, then `getNumSleeves` once a minute). In BN10, buy a sleeve from The Covenant: the new sleeve receives its first task within 60 s. Kill and restart the script after an augmentation install: `sleeveExpDisabled` behaviour (no training in a `disableSleeveExpAndAugmentation` node) is unchanged since `main()` re-fetches.

---

## Darknet

### C0 — R15 (commits 4edb810..c82cb4c)
Treat an `Invalid host` throw from `connectToSession` as a deleted server, so a host removed from the network while offline no longer wedges the controller.

Reproduce the live report: with the controller running and at least one cracked host, wait for a network deletion (`run darknet.js --status` shows `known N` drop, or watch the darknet map), then save, reload the page, and `run darknet.js`. The controller log must show no `ERROR: darknet controller loop failed ... Invalid host`; `run darknet.js --status` lists the deleted name under `last failures:` with nothing after it (its `online` is false and it has left `cracked`); `cat darknet/state.txt` keeps being rewritten (its `plan.charismaGoal` and `stats` keep moving). Before the fix: the loop failed at the same host every 10 s forever and nothing marked it offline; the hand workaround was `run darknet.js --kill` then editing the dead host's `servers`/`passwords` entries out of `darknet/state.txt` with `nano`.

### C1 — R1 (commits b145725..b8b64a3)
Infer the current labyrinth from installed augmentations (the game's own source of truth), not from `state.labs.completed`, which a reload can wipe.

1. Load a save with darknet access (any lab progress, ideally past a first install so a stale `state.labs.completed` would previously have been wrong).
2. Let a normal loop run (or delete `darknet/state.txt`) so `state.labs.completed` starts fresh or stale.
3. `run darknet.js --status`.
4. Confirm the `lab:` line names the lab consistent with the currently *installed* labyrinth augmentations (W1ngs of Icarus / B00ts of Perseus / H4mmer of Daedalus / St4ff of Asclepius / L4w of Bayes / B1ade of Solomonoff / Red Pill order), and `completed N` equals the count of those augmentations actually installed — not the number of labs finished in the current darknet session.
5. Most useful case: right after installing an augmentation (which wipes both the in-game darknet and `darknet/state.txt`), confirm the very next `--status` after one loop already names the *new* current lab, not `th3_l4byr1nth`. Before the fix, with a wiped `state.labs.completed`, `currentLab` fell back to lab index 0 until an agent happened to probe near the new lab.

### C2 — R2 (commits b8b64a3..b0b381c)
Balanced mode switches to labyrinth mode when the frontier is blocked by an air gap, instead of staying stuck in loot mode.

1. Load a save with darknet access, ideally with lab progress; delete `darknet/state.txt` to reset state.
2. Run `darknet.js` in balanced mode and probe servers to build a frontier.
3. With a frontier at depth 7 (row 8 minus 1) and a lab at depth 19 or deeper: confirm `chooseMode` switches to `"labyrinth"` mode instead of staying in `"loot"` mode.
4. Confirm frontiers at rows that are still crackable (e.g. depth 6 for row 7) correctly stay in `"loot"` mode.
5. Confirm frontiers past air gaps but within reach stay in `"loot"` mode until the next gap.

### C3 — R3 (commits b0b381c..d1adb59)
Never charge a migration on a stasis-pinned host, and never pin the migration target itself.

With the controller running in labyrinth mode, `run darknet.js --status`: confirm no host name appears both after `migration targets:` and after `stasis links: ... (planned:`.

### C4 — R4 (commits ecf621a..8a22e9f)
Heartbleed only for oracle (feedback-giving) crack models; skip and order non-oracle-charisma-gated cracks by charisma instead of blocking them.

1. Launch the controller and let the agent reach a live neighbour whose `modelId` is `TopPass` (feedback-free) and whose `requiredCharismaSkill` is above the player's current charisma.
2. `tail` the agent's `darknet/crack.js` process log for that host: expect only `Connecting to ... with password` lines, no `Attempting to extract data` (heartbleed) lines — `TopPass` is not in `FEEDBACK_MODELS`, so `wantsFeedback` is false regardless of charisma.
3. `run darknet.js --status`: "last failures" should show no `charisma` (451) failure reason for any feedback-free model (those never call `ns.dnet.heartbleed`).
4. Confirm an oracle-model host (e.g. `NIL`) above the charisma bar is only *deprioritised*, not skipped entirely — `crackOrder` never drops a non-oracle host regardless of `requiredCharismaSkill`; only oracle hosts above the charisma bar are pushed later in the crack order. Crossing the bar (either direction) changes the ordering on the next tick since `crackOrder` is recomputed from `cmd.charisma` every loop.
5. `mem darknet/agent.js` → 4.50 GB; `mem darknet/crack.js` → 2.95 GB (unchanged).

### C5 — R12 (commits 8a22e9f..16fde3b)
Size the crack reserve to the threads the agent will actually launch, instead of an artificial 4-thread cap.

1. Load save with game 3.0.1.
2. Monitor the darknet agent's reserve calculation during a crack phase.
3. Verify that a pending crack with `cmd.threads.crack > 4` now properly reserves resources for all commanded threads.
4. Confirm filler workers yield appropriately when more than 4 crack threads are commanded.

### C6 — R5 (commits 16fde3b..4bbcec6)
One lab authentication delay per step: read the walker's position and walls from the move reply instead of a separate probe call.

With a walker running (`run darknet.js --mode labyrinth` on a save with a lab-adjacent cracked host and enough charisma), `tail darknet/lab.js host:<lab> --port 15` on the walk host: the log shows one `labreport` line followed only by `Connecting to <lab> with password 'north'...`-style lines (no further `labreport` lines) until a restart/351/503, and the controller's `walkers` column advances roughly twice as fast per minute as before. `mem darknet/lab.js` still reports 3.95 GB.

### C7 — R11 (commits 6ac3fcc..87dad44)
Charisma goal is `required + 1` (walkers and labyrinth mode need charisma strictly above the lab's gate).

`cat /Temp/darknet-charisma-goal.txt` shows a value one above the lowest blocking `requiredCharismaSkill` / lab gate shown by `run darknet.js --status`.

### C8 — R6 (commits b3b3490..bf2b479 + 49fe495)
`crack.js` renews its claim on a host every minute while still cracking, so a long crack isn't mistaken for abandoned and duplicated.

1. Load the game with the darknet crawler running (branch `game-optimisation-3.0`).
2. `mem darknet/crack.js` → confirm 2.95 GB (unchanged).
3. Find or wait for a long oracle crack (a `2G_cellular` or `Factori-Os` host, modelId in `FEEDBACK_MODELS`) so the attempt loop runs past 60 s more than once.
4. While that `crack.js` is still running past the 2-minute mark, `run darknet.js --status` (or inspect the controller's in-memory state): confirm the host stays listed as claimed by the original agent, with `crackClaimAt` updated (not stuck at the launch timestamp).
5. `ps <otherHost>` on every other agent-controlled host during that window: confirm no second `crack.js` was launched against the same target host.
6. Check the controller log/stats for that crack's eventual `reason`: confirm it is not `timeouts` caused by a duplicate-heartbleed race (the R6 symptom).

### C9 — R7 (commits bf2b479..f74c2d7)
A walk host gives the walker every thread that fits (after fixed reserves); `--lab-threads` is only an optional cap, not the default.

1. `run darknet.js --mode labyrinth`.
2. Once a walker is assigned to a lab-adjacent host (e.g. 128 GB max RAM), `ps <walkHost>` should show `darknet/lab.js` running with `(maxRam - 4.5 - 0.5 - 13.65) / 3.95` threads (27 on a 128 GB host) — i.e. it keeps only the stasis reservation, not the old 6-thread cap.
3. `run darknet.js --status`: confirm the walk host still appears under `stasis links:` (`darknet/stasis.js` still managed to link despite the walker taking the rest of the RAM).
4. Repeat with `--lab-threads 6` set explicitly and confirm the walker is capped at 6 threads on the same host.

### C10 — R8 (commits 49fe495..617bbfe)
Give each lab walker its own direction preference (derived from its pid) so multiple walkers don't collide on the same path; default to one walker.

1. Launch the darknet controller against a live labyrinth with the default config (no `--lab-walkers` override), e.g. `run darknet.js --lab-threads 6`.
2. Confirm the controller starts exactly one `darknet/lab.js` walker on the current lab host (was three before this change) — check `ps` on the walk host or the controller's status/roster output.
3. Start two walkers deliberately (`--lab-walkers 2`, or run `darknet/lab.js <lab>` twice by hand on two hosts) and log each walker's first move direction (e.g. via `ns.print`, or a temporary trace). Confirm the two walkers' first moves differ (their pids differ, so `walkerOrder(ns.pid)` differs, so the tie-break at the shared `[1,1]` start sends them down different branches at the first fork with more than one open direction).
4. Let a single default walker run a full lab to confirm it still solves normally (no regression from the tie-break reorder) — watch for the `"the_great_work"` cache / reward augmentation being queued as before.

### C11 — R9 (commits e369e68..e1c889c + ece0e4e)
Filler sizing: cap phish threads network-wide (a few deep hosts), size promote per held stock symbol, and share whatever RAM is left.

1. `run darknet.js --status` (after two loops, once darknet.js has been looping a couple of minutes): confirm `phish threads planned: 14` (or less with few hosts) and `promote threads planned: 24 x <held symbol count>` (0 if nothing held).
2. `ps <deepestHost>` on one of the deepest cracked hosts: confirm `darknet/phish.js` is running with the planned thread count, and (once `/Temp/share-active.txt` is `true`, e.g. during faction/company work) `Remote/share.js` also shows up alongside it on a host with spare RAM left after phish.
3. `ps <45GBhost>` (or any host in the 16-64 GB band the old 64 GB floor used to exclude): confirm `darknet/promote.js` is running there once stockmaster.js holds a position.
4. Confirm a walk host (one in `plan.walkHosts`) still shows neither phish, promote, nor share — only `darknet/lab.js`.

### C12 — R10 (commits 9375a28..02c4fda)
Remove island migration entirely; the game's own island mover handles isolated hosts, so the controller no longer needs to.

1. Load a save where loot mode is active and an island exists (a host whose own agent's `ps` shows it running, but which no other host's neighbour-probe results include).
2. `run darknet.js --status`: expect `migration targets: (none)` even while the island exists.
3. `ps <anyHost>` for every non-lab host: `darknet/migrate.js` should not appear anywhere outside labyrinth mode.
4. Watch the island's host over several cycles: its agent should keep reporting (it should never appear in `last failures:`) and it should come back into the depth histogram once the game moves it.

### C13 — R13 (commits 02c4fda..f851471)
`pushFiles` only scps to a host when its cached contents actually differ, instead of re-pushing to every host every loop.

1. Start `darknet.js` on home with a settled network (all currently-crackable hosts already cracked and pushed at least once).
2. `tail darknet.js` on home over a few loop intervals: confirm there is no longer a burst of `scp` lines every ~10 s once the network has settled.
3. `run darknet.js --status`: confirm `online` status still updates for hosts (proves the liveness probe via `trySession`/`connectToSession` still runs every loop even when the scp is skipped).
4. Trigger a `.data.txt` clue solve or a fresh crack that adds a new password entry; confirm every commandable host receives a push that loop (`ls <host> darknet/passwords.txt` shows the updated size/timestamp on multiple hosts, not just the newly cracked one).
5. `run darknet.js --kill` then `run darknet.js` again: confirm every host receives a push on the very first loop after restart (a new controller starts with an empty `lastPushed` cache).

### C14 — R14 (commits f851471..3b4ff2a)
`2G_cellular` reads the password's mismatch index from the authenticate delay instead of one heartbleed call per attempt.

1. On a `2G_cellular` neighbour, run the cracking agent and `tail darknet/crack.js host:<name> --port 15`.
2. Confirm the log shows a run of `Connecting to <name> with password '...'` lines with at most one `Attempting to extract data` (heartbleed) line per confirmed prefix character, not one per attempt.
3. `run darknet.js --status` should record the win under `cracks: 2G_cellular` with the same attempt count as before this change (the timing change never adds attempts, only removes heartbleeds).
4. With the browser tab backgrounded (Bitburner clamps background timers to ~1 s), confirm the crack still finishes — a throttled timer only costs an extra heartbleed via the ambiguous/over-tolerance path, never a wrong prefix character.

### C15 — headless smoke run, all R1-R15 regression sweep (fixture rebuilt from HEAD 9a17233; no separate code commit)
End-to-end headless harness run exercising every darknet finding above, in addition to whatever the user does by hand in a live session.

1. RAM check: `FIXTURE=./fixture-darknet-loot.json.gz SCRIPTS=darknet.js,darknet/agent.js,darknet/crack.js,darknet/lab.js,darknet/phish.js,darknet/promote.js,darknet/migrate.js,darknet/stasis.js,darknet/realloc.js,darknet/cache.js node drv.mjs s8-mem.mjs` → `darknet.js` 6.15GB, `agent.js` 4.50GB, `crack.js` 2.95GB, `lab.js` 3.95GB, `phish.js` 3.65GB, `promote.js` 3.65GB, `migrate.js` 5.65GB, `stasis.js` 13.65GB, `realloc.js` 2.65GB, `cache.js` 3.85GB (the `WORKER_RAM` table in `darknet/lib.js`); any other number is a RAM regression.
2. Loot run with a reload (R4, R6, R9, R10, R12, R13, R15) — **already run and passed**: `FIXTURE=./fixture-darknet-loot.json.gz MODE=loot SECONDS=1200 RELOAD=1 PROFILE=./profile-loot ... node drv.mjs s12-verify.mjs`. Result per the ledger: errors section empty; 32 cracked / 36 known, 21 agents running, fillers phish x4 / promote x3 within RAM (log: `tools/harness/run.log`).
3. Labyrinth run (R1, R2, R3, R5, R7, R8, R11) — still to run: `FIXTURE=./fixture-darknet-lab.json.gz MODE=labyrinth SECONDS=2400 PROFILE=./profile-lab ... node drv.mjs s12-verify.mjs`. Assert in `run-lab.log`: `labs:` DBG line has `"current":"th3_l4byr1nth"` and `"completed":[]` (R1 on a fresh save); `walkers` has at most one entry (R8) with `steps` > 0 or a set `rewardQueuedAt`; `ram <walkHost>` shows `lab.jsx<N>` with `N = floor((maxRam - 4.5 - 0.5 - 13.65) / 3.95)` when pinned, else `floor((maxRam - 5) / 3.95)` (R7); no host appears in both `migrationTargets` and `stasisTargets` of the `plan:` line (R3); `charisma goal file:` is one above a `requiredCharismaSkill`/lab gate (R11); `=== errors ===` section empty.
4. Kill step: `FIXTURE=./fixture-darknet-lab.json.gz PROFILE=./profile-lab node drv.mjs s13-kill.mjs` → no `darknet/` process left on darkweb or any known host.
5. Note: the stock-profit magnitude part of R9 ("promote raises a held position's profit") was explicitly left unverified/skipped by the implementation plan — it depends on stockmaster holding a correctly-forecast position; measure with `run darknet.js --status` (`promote calls:`) against realised stockmaster profit if you want to confirm it, and `PROMOTE_THREADS_PER_SYMBOL` is the constant to lower if it doesn't pay off.

---

## Progression

Test save for these checks: `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz` (BN1, SF1-4). Import via Options > Import save on a throwaway profile; the headless harness (`/home/jubnl/dev/bitburner/tools/harness/README.md`) can drive the same save if a browser isn't at hand.

### D1 — PR-1 (commits 4a4d557..656549c + 37aba54)
Earn the Silhouette faction invite via CFO (800k company rep, Business track) instead of grinding all the way to CTO (3.2M rep).

1. `run work-for-factions.js --first Silhouette --no-tail-windows`, then `tail work-for-factions.js`.
2. Expect, in order: `You must be a CTO, CFO or CEO of a company to earn an invite to "Silhouette". Working towards CFO (800,000 company rep, x0.75 if the company server is backdoored)...`, then `Going to work for Company "<picked company>" next...`, then the usual promotion/status lines quoting `800,000` (or `600,000` if backdoored) as the target.
3. Once the rep target is reached, either: `Applied to "<company>" for a 'Business' position (expecting tier 4).` followed by `SUCCESS: We are now "Chief Financial Officer" ...` and `Joined faction "Silhouette"`; or `Cannot become 'Business' #4 ... charisma ...` (expected on the low-charisma test save — the key point is the loop exits at 800k instead of continuing toward 10M/3.2M).
4. `mem work-for-factions.js` must print the same value as before the change.

### D2 — PR-2 (commits 617bbfe..e369e68)
`--install-for-augs` must also fire for an augmentation that is already queued for purchase, not just one bought after the flag was set.

On a save with at least one cheap affordable aug: `run faction-manager.js --purchase` once so it's *queued* (confirm with `run faction-manager.js` — appears under "awaiting install"), then `run autopilot.js --install-for-augs "<that aug's exact name>" --disable-auto-destroy-bn` and `tail autopilot.js`. Within one loop, expect the status to move from `Waiting for N new augs ...` to `Reserving ... to install ...` / `Invoking ascend.js at ...` (kill `autopilot.js` / `ascend.js` immediately if you don't want the install to actually happen). Before the fix, the same setup stayed on `Waiting for N new augs` forever.

### D3 — PR-3 (commit 9a17233)
Never auto-join a city faction just because its invite happened to arrive first — joining one bans the others for the reset.

1. Ensure no city faction is joined yet, player in Sector-12 with > $15m so a Sector-12 invite is pending (`ns.singularity.checkFactionInvitations()` lists a city faction).
2. `run work-for-factions.js --get-invited-to-every-faction --no-tail-windows`, `tail work-for-factions.js`. Expected: `INFO: Not auto-joining city faction invite(s) Sector-12 (joining one bans the others for this reset). They will be joined when they come up in the work order.` and Sector-12 NOT in `ns.getPlayer().factions`.
3. Later, when Aevum comes up in Strategy 1 (default `preferredEarlyFactionOrder`): `Travelled from ... to Aevum` / `Joined faction "Aevum"` — the deliberate path.
4. Re-run with `--first Sector-12` instead: the invite is joined immediately (`Joined faction "Sector-12"`).
5. `mem ascend.js` unchanged from before this change.

### D4 — PR-4 (commit 1d57084)
Grind combat stats with the best combat-exp/s crime (e.g. Mug) instead of a fixed Homicide/Heist tier order.

Test save (fresh combat stats, karma near 0): `run work-for-factions.js --first Tetrads --fast-crimes-only --no-tail-windows` (Tetrads needs 75 of each combat stat and -18 karma). `tail work-for-factions.js`. Expected: first `Committing "Homicide" ... until we reach ... -18 Karma` (karma path unchanged); once karma is satisfied and only stats remain, `Committing "Mug" (xx% success) until we reach 75 of each combat stat` — never `"Homicide"` in the 50-75% chance range during that phase. Without `--fast-crimes-only` and with high stats, `"Assassination"` appears only once its chance is above ~67%.

### D5 — PR-5 (commit dadb9ab)
Check money and installed-aug counts before grinding for Daedalus / The Covenant / Illuminati invites, instead of starting the grind and discovering the gate too late.

Test save (few installed augs, < $75b): `run work-for-factions.js --first The_Covenant --no-tail-windows`, `tail work-for-factions.js`. Expected immediately: `Cannot join faction "The Covenant" because you have N of the 20 installed augmentations required.` and no `Committing "..."` / `Started studying` lines for it. Before the fix, the same command started a crime or an Algorithms-class grind first.

### D6 — PR-6 (commit 59c8957)
Buy NeuroFlux Governor levels from a joined faction that already has enough reputation before falling back to donations.

Dry run, no `--purchase`. On a save that has joined at least one faction with rep above the next NF level's requirement, and at least one other joined, donation-unlocked faction with less reputation: `run faction-manager.js -v`. Expect `Getting NF from faction <most-rep faction> (rep: ...)`, then the purchase-order rows: `NeuroFlux Governor Level N` names the most-rep (free) faction for the first several levels, switching to `Faction: <donation faction>` exactly at the first level whose `Requires ... reputation` exceeds the free faction's current rep; the `Donate: {...}` summary line only names the donation faction. Before the fix, every NF row named only the donation faction.

### D7 — PR-7 (commit 3910308)
`autopilot.js` computes stock portfolio value once per loop and moves slow-changing checks (augs/bladeburner/casino) to the 10 s cadence instead of every ~2 s tick.

`run autopilot.js` on the test save, `tail autopilot.js`: no `ERROR`/`ReferenceError` lines over 2 minutes; the casino decision line (`Waiting a minute to establish player income ...` or `Skipping running casino.js ...`) still appears within 10 s of start; the status line still updates. On the Active Scripts page, `/Temp/*.js` churn per ~2 s tick should be visibly lower than before (~5 short-lived scripts instead of 7-14).

### D8 — PR-obs (commits 3ca0b48, 98f938b, d98bbb2)
Three low-severity observational fixes (NaN in a method-sort comparator, an install-countdown value being overwritten, a stale comment). No in-game check step is specified for this task in the brief or its report — it is code-only cleanup verified by the Node suite and `collide.mjs`.

---

## Money-side

### E1 — SM-1 (commits 656549c..b2c5e95)
Drop the hardcoded `fracB > 0.4` liquidity gate for stock re-buys once 4S market data is owned.

With 4S owned: `run stockmaster.js --tail --noisy`. After the next market cycle (log line `N Stocks appear to be reversing their outlook`), the `Sold all ... positions` lines must be followed within the same tick by `Buying`/`Shorting` lines, even when the status line shows cash well under 40% of corpus (e.g. holdings 8b, cash 2b). Before the fix, the log showed only sales and no purchases in that situation.

### E2 — ST-1 (commits 4bbcec6..9abfc00)
Re-charge Stanek fragments after home RAM doubles, instead of leaving them capped at their old peak charge.

1. `mem stanek.js` before and after: identical (no new NS calls).
2. Manual top-up: with a Stanek grid already charged, note a fragment's `Peak` from `run stanek.js --tail` startup output (or `ns.stanek.activeFragments()`), buy home RAM so free RAM is at least 1.5x the peak's RAM (2 GB/thread), then `run stanek.js --top-up --tail`. Expect per-fragment `Top-up: ... Waiting for RAM to free up...` lines only while home is busy, one charge script per fragment, and the final toast `SUCCESS: Stanek top-up complete: N fragments were charged above their previous peak.` `ns.stanek.activeFragments()` must show every stat fragment's `highestCharge` increased and `numCharge` rescaled to about `old * oldPeak / newPeak + 1`.
3. Timeout path: `run stanek.js --top-up --top-up-timeout 20 --top-up-min-gain 1000 --tail` → after ~20 s, `WARNING: Stanek top-up timed out`, and the (unset) completion script is skipped without error.
4. Autopilot path: with `autopilot.js` running and Stanek accepted, run `/Tasks/ram-manager.js` (or buy home RAM manually) until home RAM doubles. autopilot's log must show `Launched stanek.js ... with args: [--on-completion-script, daemon.js, --top-up, ...]`, then `Relaunching daemon.js` with `--reserved-ram 1e+100`, and after stanek.js exits, a fresh daemon.js without it.

### E3 — SM-2 (commits e1c889c..5672e40)
Wait on real market ticks instead of polling every second, and fetch all stock data with one temp script instead of one per function.

1. `mem stockmaster.js` before and after: identical.
2. `run stockmaster.js --tail` with TIX + 4S: the status line now changes once per ~6 s (one market tick) instead of every second; `ls /Temp/ | grep stock-` shows `stock-refresh-4s.txt`/`.js`. Delete `/Temp/stock-getAskPrice.txt` and `/Temp/stock-getForecast.txt` and wait 30 s: they are not recreated. No `WARNING: Had to overwrite temp script` tprint.
3. Pre-4S on a save without 4S: same, with `stock-refresh-pre4s.*`; and no `stock-has4SData.txt` refresh while cash is far below the 4S budget — delete it and confirm it stays gone until the corpus can afford `25e9 * FourSigmaMarketDataApiCost`.
4. `run stockmaster.js --mock --tail` on a 4S save: uses `stock-refresh-4s-mock.*` and continues to paper-trade correctly.
5. After a cycle reversal with `--noisy`: sales and re-buys still happen within one tick (E1/SM-1 behaviour intact).

### E4 — HN-1 (commit 9cadfaf)
Price a new hacknet node as its own base cost plus the catch-up upgrades needed to match the worst existing node, instead of just the base cost.

1. `mem hacknet-upgrade-manager.js` before and after: identical.
2. With Formulas.exe owned and at least one hacknet node/server, create `/Temp/hn1-check.js`:
   ```js
   import { costToMatchStats } from '/hacknet-upgrade-manager.js';
   export async function main(ns) {
       const m = ns.getPlayer().mults, s = ns.hacknet.getNodeStats(0), isServer = ns.hacknet.hashCapacity() > 0;
       const f = isServer ? ns.formulas.hacknetServers : ns.formulas.hacknetNodes;
       const viaFormulas = f.levelUpgradeCost(1, s.level - 1, m.hacknet_node_level_cost) + f.ramUpgradeCost(1, Math.log2(s.ram), m.hacknet_node_ram_cost) + f.coreUpgradeCost(1, s.cores - 1, m.hacknet_node_core_cost);
       ns.tprint(`node 0 (${s.level}/${s.ram}/${s.cores}, server=${isServer}): formulas ${viaFormulas} transcription ${costToMatchStats(isServer, s.level, s.ram, s.cores, m)}`);
   }
   ```
   `run /Temp/hn1-check.js` → the two printed numbers match (to floating-point noise).
3. `run hacknet-upgrade-manager.js --max-payoff-time 1E100h --max-spend 1 --tail` (spend limit 1 so nothing buys): the status line for a new node reads `... a new node "hacknet-node-N" for $X (+ $Y of upgrades to match hacknet-node-K) ... production P payoff time: T` where `P` equals node K's production and `T = (X + Y) / (P * hash value)`.

### E5 — HN-2 (commit 009800d)
Stop busy-looping while the next hacknet purchase is unaffordable; throttle the idle loop.

`run hacknet-upgrade-manager.js -c --max-payoff-time 1E100h --interval 0 --reserve 1e300 --tail` (the reserve makes every purchase unaffordable): the log shows `The next best purchase would be ... but the cost exceeds the our current available funds` once, and game FPS stays normal (before the fix this visibly stuttered the UI). Kill it. Then `run hacknet-upgrade-manager.js -c --max-payoff-time 1h --interval 0 --tail` with money available: purchases still print back-to-back with no 200 ms gaps between successive `Purchased ...` lines.

### E6 — SM-3 (commit b7f1dee)
Apply the position diversification cap only pre-4S; post-4S, `maxShares` is the only position limit.

With 4S and a corpus small relative to `maxShares * price` (early after buying 4S): `run stockmaster.js --tail --noisy`; after the first purchase round the best-ER stock's position (the `Buying ... (x/maxShares)` line, or `Pos:` with `--show-market-summary`) exceeds 34% of holdings — before the fix it stopped at 34-35%. Pre-4S saves: unchanged, cap still logged as `capped at 34.0% by --diversification`.

### E7 — SM-4 (commit 0bcf1f7)
Compute pre-4S volatility over a near-term window instead of a long lagging one.

Pre-4S save with darknet promotions active (`darknet.js` running, `promote.js` workers visible in `ps`): `run stockmaster.js --show-market-summary --tail`. In the summary window, the `Vol:` column of promoted (held) stocks should drop within ~10 ticks after the `Market day 1` line (cycle start) instead of staying at its pre-cycle peak for 75+ ticks; unpromoted stocks show `Vol:` within about ±10% of what the old build showed for them.

### E8 — HN-4 (commit bee1624)
Only generate coding contracts from hacknet hashes while `Tasks/contractor.js` is actually running to consume them (tracked via a heartbeat file); fix a stale contract-purpose comment.

1. `mem spend-hacknet-hashes.js` and `mem /Tasks/contractor.js` before and after: identical.
2. With `daemon.js` running (it launches `contractor.js` every 27 s): `cat /Temp/contractor-heartbeat.txt` shows a recent ms timestamp that changes every ~27 s. `run spend-hacknet-hashes.js --liquidate --tail` (needs hacknet servers, SF9) logs `Spent 25.000 hashes on 1x 'Generate Coding Contract'` as before.
3. Kill `daemon.js`, wait 5 minutes, restart `spend-hacknet-hashes.js --liquidate --tail`: only `Sell for Money` purchases appear. `run spend-hacknet-hashes.js --liquidate --require-contractor false --tail` generates contracts again despite the stale/missing heartbeat.

### E9 — ST-2 (commit f0d8f28)
Score Stanek fragment layouts by fragment power with multiplicative boosters, instead of a flat `N * (1 + 0.1 * k)` scoring rule.

`run optimize-stanek.js` (offline tool; needs Stanek's Gift accepted for `ns.stanek.fragmentDefinitions()`): it still prints one score and one JSON layout per board size 3x3..5x6; scores are now non-integers like `9.68` (sum of powers times 1.1^k) instead of the old `N*(1+0.1*k)` pattern; in the printed layouts, boosters now sit next to id 6 (HackingMoney, power 2) and id 21 (HacknetCost, power 2) fragments rather than id 25 (Rep, power 0.5).

### E10 — GO-3 (commit 5758d6b)
Call the Go analysis functions directly once `go.js` has spare home RAM, instead of always ram-dodging through temp scripts.

1. `mem go.js` before and after: identical (the whole point — if it grew by 60 GB, a function name leaked as an identifier).
2. On a home with >= 80 GB free: `run go.js --tail`. Within the first game, the log shows `INFO: go.js RAM allocation raised from X GB to X+60 GB: Go analysis functions are now called directly (no temp scripts).`; `ps`/`top` shows go.js at `X+60` GB; moves continue with no `Dynamic RAM usage calculated to be greater than RAM allocation` error; `rm /Temp/go-analysis-getChains.txt` is not recreated over the next game; with `--logtime`, move latency drops by roughly 100-200 ms per move.
3. On a home with < 80 GB free: the log shows `INFO: go.js could not raise its RAM allocation to ... GB (host has ... GB free). Still ram-dodging Go analysis.` (or nothing, if the free-RAM check fails first), and `/Temp/go-analysis-*.txt` keep refreshing every move, exactly as before.
4. Re-check `mem go.js` after the run: still identical to the before-run value.

---

## Final fix wave (b10d64a..52c78d3)

### FW-1 — HC-1 follow-ups (b10d64a, a028940, efaf8d7)
Adaptive JIT lead time (`max(loopInterval, last loop duration)`), a per-loop late-launch WARNING, RAM gates that count this loop's launch failures, `roundState` pruning, a chaining regression logged once.
1. `run daemon.js --tail` on the BN1 test save for 10 minutes. Expected: no `WARNING: N of M due tasks launched late` line while the status line's loop time stays under 1 s; if the game is throttled (background tab), the warning appears at most once per loop and disappears again when the loop time recovers.
2. Trigger a RAM squeeze (`run share.js` with most of home RAM, or buy no servers): after a `dropped batch` warning the same loop must not start a new round for any target (no `Batch ... scheduled` lines until the next loop without failures).
3. A chaining regression (`WARNING: ... regressed` on a target) must appear once per event, not twice on consecutive loops.

### FW-2 — PR-6 follow-up (ef0edb5)
Pinned NeuroFlux source factions survive the donation consolidation pass.
1. Same dry run as D6 with three or more joined factions offering NeuroFlux: every `NeuroFlux Governor Level N` row names the faction that also appears in `Donate: {...}` (or a free-rep faction); no `Using alternative faction ... for "NeuroFlux Governor"` line may follow a level that was costed against another faction.

### FW-3 — R10 / R13 / R14 follow-ups (d8242bf, dd36e53, 62e3080)
Dead `neighboursAt` field removed, push cache reset on a fresh state, 2G_cellular race fallback documented and unit-tested. No in-game check beyond C10-C14: after an augmentation install, `darknet.js` must push its worker files to every host again (`ls` on a cracked host shows fresh `darknet/*.js` timestamps).

## Test save and harness

- BN1 test save (used by the Progression checks above, and reusable for the others): `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz` (BN1, SF1-4). Import via Options > Import save on a throwaway profile.
- Headless harness (can drive the same save without a browser, and is what ran the darknet C15 loot smoke): `/home/jubnl/dev/bitburner/tools/harness/README.md`.
