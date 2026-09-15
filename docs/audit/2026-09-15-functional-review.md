# Functional review of the automation scripts against Bitburner v3.0.1 (2026-09-15)

Branch reviewed: `game-optimisation-3.0` at `abf045d` (after all high/medium fixes of the correctness audit
`2026-09-15-in-game-audit.md`). Question asked: are the automations well done, do they actually advance the game,
and how well-optimised are their calculations at each step. Every claim below cites the script lines and the decisive
game source lines (`/home/jubnl/dev/bitburner/bitburner-src/src`); findings already in the correctness audit are not
repeated.

Method: five independent reviewers, one per subsystem (hacking core; progression/singularity; gangs, sleeves and
bladeburner; darknet crawler; stocks/hacknet/stanek/go). The coordinator re-read the game source for every high
finding (labyrinth identification and stasis immutability in the darknet, the Silhouette job path, sleeve sync and
shock rates, the BlackOp success range) and corrected one reviewer error (Silhouette CFO numbers, see section 2).

Totals: 11 high, 20 medium, 26 low (57 findings). None fixed yet.

## Executive summary

The formula layer is in good shape: nearly every game formula the scripts re-implement (hack chance, percent stolen,
growth, security deltas, gang gains, stock forecast estimator, hacknet production, stanek charge, cheat chance,
favor/donation, augmentation price scaling) is an exact transcription of v3.0.1. Where the automation falls short is
one level up: *when* those formulas are evaluated, what the scheduler does with the answer, and a handful of
strategic assumptions that the game does not share. The most valuable fixes, in order of expected impact:

1. **HWGW scheduler holds RAM for wait + run and idles each target half the time** (HC-1). Every batch script is
   launched up front and sleeps inside `additionalMsec`, so it reserves RAM for ~1.5x weaken-time instead of its own
   duration (about 2.4x the RAM per batch), and no new round starts until the last batch of the previous one lands
   (under 50 % duty, ~25-40 % when `--max-batches 100` binds). Just-in-time launching from the existing plan would
   roughly double hack income per GB. This is the single biggest lever in the repo.
2. **Sleeves never train and can stall on Synchronize for a day** (SL-1, SL-2). `train-max-shock 10` cannot be met
   inside `training-cap-seconds` 2 h (shock decays at most 0.0015/s, 100 -> 10 takes ~17 h), so sleeves keep stats ~1
   and every stat-scaled sleeve job (faction rep, homicide karma, bladeburner contracts, the branch's darknet-charisma
   study) is inert. Separately, with SF2 owned and no gang, every sleeve is parked on Synchronize (0.001 sync/s,
   ~27 h) before doing anything else, for karma that a stat-1 sleeve cannot produce anyway.
3. **The darknet controller cannot find the current labyrinth after any reset and cannot cross air gaps reliably**
   (R1, R2, R3). Every install wipes the darknet and the controller's completed-lab list; the game picks the lab from
   owned augmentations and wires it only to the deepest row, so from the second lab on the planner targets the wrong
   lab, plans no gap crossing, and (when it does) may charge a migration on a stasis-pinned host the game refuses to
   move. Plus every crack heartbleeds even on the 13 feedback-free models (R4), and each maze step costs two lab
   delays when one would do (R5). Together these decide whether the labyrinth rewards are ever reached.
4. **host-manager's budget is debited by home RAM and core purchases** (HC-2). The game books both under the
   `servers` money source, so after home reaches 4 TB the far cheaper purchased servers are not bought until hack
   income since install exceeds ~59 b.
5. **BlackOps can be launched at 70-80 % real chance while reporting 100 %** (BB-1). The script takes `max(lo, hi)`
   of the estimated range, which equals `real x pop/popEst` whenever the population is under-estimated; a failure
   costs 10-20 k rank, hospitalisation and a team member. Use `min` and resolve the range first.
6. **Silhouette is ground to CTO (3.2M company rep) when CFO (800k) also qualifies** (progression 1).
7. **Stanek is charged once at start-of-run home RAM** (ST-1) although the bonus scales with the largest single
   charge ever made; one top-up charge after each home-RAM doubling would nearly double the Stanek bonus mid-run.
8. **Gang equipment/ascension/training are steered by the wrong stats** (GG-1): agility has zero weight in Terrorism
   and Human Trafficking while hack+cha carry 40-60 %, so $10 B augments that add nothing are bought before rootkits
   that add 4.5 %. And in bonus time the pre-tick warfare swap cannot keep up with 800 ms territory ticks (GG-2).
9. **stockmaster's `fracB` gate leaves reversal cash idle for whole cycles post-4S** (SM-1), ~5-10 % of stock income,
   worst in BN8.
10. **Efficiency**: most scripts fan out 5-20 ram-dodging temp scripts per loop for values that change on a much
    slower cadence (daemon `ns.ls` cache reset every loop and a full server re-sort per task, HC-5/HC-6; autopilot,
    sleeve, bladeburner, stockmaster, go). The zero-RAM `nextUpdate()` functions (gang, bladeburner, stock) are
    unused where they would remove the polling entirely.

Cross-cutting patterns:
- *Formulas right, timing wrong*: prep grow resolves at pre-weaken security (HC-3), rep-rate sampling assumes one tick
  (progression 8), migration charge on immutable hosts (R3), gang bonus-time thrash (GG-2).
- *Thresholds that cannot be met or are off by one*: sleeve training gates (SL-2), darknet charisma goal one point
  below the underleveled-penalty cut-off (R11), chaos tolerated between 50 and 100 while the penalty cliff is at 50
  (BB-3), Volhaven join order locking out five city factions for a reset (progression 3).
- *Branch additions that need economic re-tuning*: darknet filler sizing (phish saturates at ~10 threads network-wide,
  promote starved below 64 GB hosts, R9), share suppresses the XP farm without checking faction work (HC-4).

## Findings by area

| Area | High | Medium | Low | Section |
|---|---|---|---|---|
| Hacking core (daemon, host-manager, Remote, Tasks) | HC-1, HC-2 | HC-3..HC-6 | HC-7..HC-11 | 1 |
| Progression (autopilot, faction-manager, work-for-factions, crime) | Silhouette | install-for-augs, city factions, stat-grind crime | invite grinding, NF sourcing, temp scripts, rep sampling | 2 |
| Gangs / sleeves / bladeburner | SL-1, SL-2, BB-1 | GG-1, GG-2, SL-3, BB-2 | GG-3, GG-4, BB-3, BB-4, SL-4 | 3 |
| Darknet crawler | R1..R5 | R6..R11 | R12..R14 | 4 |
| Stocks / hacknet / stanek / go | - | SM-1, ST-1, GO-1 | SM-2..4, HN-1..4, ST-2, GO-2, GO-3 | 5 |

Suggested fix order if these are taken on: HC-1, SL-2, SL-1, R1+R2+R3, BB-1, HC-2, R4+R5, ST-1, GG-1, Silhouette,
then the mediums by area. The reviewers' full reports follow unchanged (except the Silhouette correction).

---

# Section 1: Hacking core

Scripts: `/home/jubnl/dev/bitburner/bitburner-scripts` (branch `game-optimisation-3.0`, HEAD `abf045d`).
Game: `/home/jubnl/dev/bitburner/bitburner-src/src` (v3.0.1). Every game line quoted below was read in this review.
Findings already in `docs/audit/2026-09-15-in-game-audit.md` (HK-F1..F12) are not repeated.

Files read in full: `daemon.js`, `analyze-hack.js` (it produces the ranking daemon consumes), `host-manager.js`,
`Remote/{hack,grow,weak,share,manualhack}-target.js`, `Tasks/{ram-manager,backdoor-all-servers,tor-manager,program-manager,contractor}.js`,
`Tasks/backdoor-all-servers.js.backdoor-one.js`; `helpers.js` ram-dodging core (`getNsDataThroughFile_Custom`, `runCommand_Custom`,
`waitForProcessToComplete_Custom`, `autoRetry`, `scanAllServers`).
Game: `Hacking.ts`, `Server/formulas/grow.ts`, `Server/ServerHelpers.ts`, `Server/Server.ts`, `Server/data/Constants.ts`, `Constants.ts`,
`Netscript/NetscriptHelpers.tsx` (`hack`, `netscriptDelay`), `NetscriptFunctions.ts` (`grow`, `weaken`, `share`, `hackAnalyze*`, `growthAnalyze*`, `get*Time`),
`NetscriptFunctions/Formulas.ts`, `NetscriptFunctions/Singularity.ts` (tor/program/backdoor/home upgrades), `NetscriptFunctions/Cloud.ts`,
`Server/ServerPurchases.ts`, `DarkWeb/DarkWebItems.ts`, `NetworkShare/Share.ts`, `PersonObjects/formulas/{reputation,intelligence}.ts`,
`PersonObjects/Player/PlayerObjectServerMethods.ts`, `Faction/FactionJoinCondition.ts`, `Faction/FactionInfo.tsx`, `Netscript/RamCostGenerator.ts`,
`utils/MoneySourceTracker.ts`, `BitNode/BitNodeMultipliers.ts`.

## Summary

| Sev | ID | Status | Finding |
|---|---|---|---|
| high | HC-1 | confirmed | HWGW batches are all launched up-front and sleep inside `additionalMsec`, so every script holds RAM for its wait *and* its run (~2-2.5x the RAM-time of just-in-time launching), and a target is idle for a full weaken-time between rounds (<50% duty; ~25% when `--max-batches 100` binds) |
| high | HC-2 | confirmed | `host-manager.js`'s budget ("25% of hack income minus server spend") is debited by home RAM and home core purchases, because the game books those under the same `servers` money source; ram-manager (50% of cash every 30 s) therefore starves purchased servers, which are 9-140x cheaper per GB |
| medium | HC-3 | confirmed | Prep fires grow and weaken at the same instant; grow resolves at 0.8x weaken-time, i.e. at the *pre-weaken* security, but its thread count is computed for *min* security. A freshly rooted server (security = 3x min) gets ~1/3 of the planned growth and needs a second weaken-time to prep |
| medium | HC-4 | confirmed | `share` is scheduled whenever RAM is free, without checking that the player is doing faction work (the only thing the share bonus multiplies), and by design pushes utilisation to 80%, which silently zeroes the idle-RAM hack-XP farm |
| medium | HC-5 | confirmed | `Server._files` (the `ns.ls` cache) is reset every loop, so every host that receives a task pays one temp-script round trip per loop; with dozens of hosts this alone can exhaust `maxLoopTime` |
| medium | HC-6 | confirmed | `getAllServersByFreeRam()` re-sorts the whole server list with two live `ns.getServerUsedRam` calls per comparison on *every* `arbitraryExecution` call (up to 400 per target per loop) |
| low | HC-7 | confirmed | The XP-farm target ranking is weighted by hack success chance, but the non-`--xp-only` farm only runs weaken/grow, which always succeed |
| low | HC-8 | confirmed | `analyze-hack.js` costs a hack thread at `hackTime` RAM-seconds, but the daemon actually holds it for ~1.5x weaken-time; the ranking is biased toward hack-thread-heavy servers |
| low | HC-9 | confirmed | `ram-manager.js` buys home cores (7.5b, 56b, 422b ...) with leftover budget for a 6.25% thread saving on home-run grow/weaken only |
| low | HC-10 | confirmed | `getServerMaxRam` for every server is re-fetched through a temp script every loop although it only changes when a server is bought/upgraded |
| low | HC-11 | confirmed | `backdoor-all-servers.js --reserved-home-ram 22` is calibrated for SF4.3 (3.6 GB per backdoor); below SF4.3 each backdoor script needs 33.6 GB so the guard never protects anything |

---

## HC-1 (high, confirmed): batches are pre-launched and sleep in-script, so RAM is held ~2-2.5x longer than necessary and each target idles half the time

- Script: `daemon.js:825-826` (no new batches while any `Batch*` script is alive), `:1393-1394` (`optimalPacedCycles = floor(W / cycleTimingDelay) - 1`), `:1501-1508` (all batches planned at once, `newBatchStart = lastBatch + cycleTimingDelay`), `:1518` (every task `exec`'d immediately), `:1562-1569` (hack of the first batch resolves at `fromDate + W`); `Remote/hack-target.js:16-26` (the wait is bundled into `additionalMsec`; the script lives from exec until the operation resolves).
- Game: `src/Netscript/NetscriptHelpers.tsx:544` and `src/NetscriptFunctions.ts:277, 353`

```ts
const hackingTime = calculateHackingTime(server, Player) + additionalMsec / 1000.0;   // NetscriptHelpers.tsx:544
const growTime = calculateGrowTime(server, Player) + additionalMsec / 1000.0;         // NetscriptFunctions.ts:277
const weakenTime = calculateWeakenTime(server, Player) + additionalMsec / 1000.0;     // NetscriptFunctions.ts:353
```
  and `NetscriptHelpers.tsx:419-433` (`netscriptDelay` is a plain `setTimeout`; the worker stays alive - and its RAM reserved - for the whole delay).

- What the script assumes: launching all N batches at once and letting each script sleep is "free"; the TODOs at `daemon.js:107` and `:905-907` show the author knows it is not.
- What actually happens (with `W` = weaken time, `D` = `--cycle-timing-delay` 2000 ms, `q` = `--queue-delay` 1000 ms, `N = floor(W/D) - 1`):
  - The first hack lands at `T0 + q + W`; the last W2 lands at `T0 + q + (N-1)D + W + 1500` ≈ `T0 + 2W`. Money is only stolen during `(N-1)D` ≈ `W - 4 s` of that `≈ 2W` window, so a target's duty cycle is **< 50%**, and the next round cannot start until the last W2 is gone (`isTargeting()`).
  - When `--max-batches 100` binds (`W > 202 s`, which is normal early-BN: e.g. hack 100 vs a 50-req/15-sec server gives `hackTime = 5*(2.5*50*15+500)/150 = 79 s`, `W = 317 s`), hacks land over only 200 s of a `W + 200 s` cycle: **~25-40% duty**.
  - RAM-time: batch k's hack script holds RAM for `q + W + kD` (≈ 1.5 W averaged over k) instead of `W/4`; grow for ≈ 1.5 W instead of 0.8 W; weakens ≈ 1.5 W instead of W. For a typical 50%-steal batch (H:250 G:462 W1:10 W2:37 threads) that is ≈ 1970 W GB·s vs ≈ 830 W GB·s for just-in-time launching: **≈ 2.4x the RAM per batch**.
- Concrete effect: whenever network RAM is the bottleneck (almost always once hacking is running), income per GB is roughly 40-50% of what a JIT scheduler gets on the same targets; whenever *targets* are the bottleneck (few servers within hack level), the best target yields at most half its potential. The daemon compensates by raising `maxTargets` (`:912-917`), i.e. by pouring RAM into progressively worse `$/GB·s` servers.
- Suggested change: keep the plan but launch late. Keep `scheduledTasks` in memory and `exec` each task only when `Date.now() >= schedItem.start - loopInterval` (the remote scripts already tolerate any start delay since they compute `sleepDuration` themselves); allow a new round to be planned as soon as the *last batch has been launched* rather than when the last W2 has resolved (track "planned until" per target instead of `isTargeting()`), so batch rounds overlap seamlessly. Both TODOs at `:107` and `:905-907` describe exactly this.

## HC-2 (high, confirmed): host-manager's budget is consumed by home RAM/core purchases

- Script: `daemon.js:490-502` (`getHostManagerBudget`), `:425-433` (host-manager launch, `shouldRun: ... getHostManagerBudget() > 0`), `:415-418` (ram-manager launched every 30 s with `--budget 0.5`), `Tasks/ram-manager.js:24-30`.
- Game: `src/NetscriptFunctions/Singularity.ts:612` and `:649`, `src/utils/MoneySourceTracker.ts:17, 26`

```ts
homeComputer.cpuCores += 1;
Player.loseMoney(cost, "servers");     // Singularity.ts:612 (upgradeHomeCores)
...
homeComputer.maxRam *= 2;
Player.loseMoney(cost, "servers");     // Singularity.ts:649 (upgradeHomeRam)
```
  `MoneySourceTracker` has a single `servers = 0;` bucket (`:26`), which `ns.getMoneySources().sinceInstall.servers` returns; `ns.cloud.purchaseServer` also books into it (`ServerPurchases.ts:162`).

- What the script assumes (its own comment, `:427`): "Restrict spending on *new servers* (i.e. temporary RAM for the current augmentation only) to be a % of total earned hack income".
- What actually happens: `budget = max(0, 0.25 * hacking - serverSpend, 0.001 * total - serverSpend)` where `serverSpend` includes every home RAM doubling and every core. Home RAM costs `ram * 32000 * 1.58^log2(ram)` (`PlayerObjectServerMethods.ts:30-40`): 256→512 GB = 318 M, 1→2 TB = 3.2 b, 4→8 TB = 31.7 b (cumulative to 8 TB ≈ 46 b). A purchased server costs `ram * 55000 * softcap^(log2(ram)-6)` (`ServerPurchases.ts:34-41`, softcap 1 in BN1): 8 TB = 450 M. Per GB, home RAM is 9x (64→128 GB) to 140x (4→8 TB) more expensive than a purchased server, yet ram-manager takes 50% of unreserved cash every 30 s and every dollar it spends is subtracted from host-manager's allowance.
- Concrete effect: after home reaches 4 TB (≈ 14.7 b spent), host-manager is not even launched until hack income since install exceeds ≈ 59 b, although 25 purchased 4 TB servers would cost 5.6 b in total. Early/mid-BN, the cheapest RAM in the game is bought last. (Home RAM does persist across augmentation installs - `ServerHelpers.ts:224-259 prestigeHomeComputer` touches programs/messages/scripts but not `maxRam`/`cpuCores` - so some home preference is defensible, but not a hard veto on purchased servers.)
- Suggested change: track purchased-server spend separately (sum of `ns.cloud.getServerCost`/upgrade costs actually paid, or `sinceInstall.servers` minus the home upgrade costs the daemon itself triggered), or simply drop the `- serverSpend` term for home purchases; and/or give host-manager first call on money until purchased servers reach some fraction of home RAM, since purchased RAM compounds into hack income immediately.

## HC-3 (medium, confirmed): prep grow resolves at pre-weaken security but is sized for min security

- Script: `daemon.js:1246` (`adjustedGrowthRate()` uses `getMinSecurity()`), `:1260, 1298-1300` (`getGrowThreadsNeeded`), `:1066-1071` (formulas mock sets `hackDifficulty = getMinSecurity()`), `:1847-1850` (prep weaken starts `now`), `:1855-1860` (prep grow also starts `now`).
- Game: `src/Server/formulas/grow.ts:8-18` and `src/NetscriptFunctions.ts:289-292`, `src/Server/Server.ts:83`

```ts
const hackDifficulty = server.hackDifficulty ?? 100;                        // grow.ts:10 - read when the grow RESOLVES
let adjGrowthLog = Math.log1p(ServerConstants.ServerBaseGrowthIncr / hackDifficulty);
if (adjGrowthLog >= ServerConstants.ServerMaxGrowthLog) adjGrowthLog = ServerConstants.ServerMaxGrowthLog;
...
return helpers.netscriptDelay(ctx, growTime * 1000).then(function () {      // NetscriptFunctions.ts:289
    const growth = processSingleServerGrowth(server, threads, scripthost.cpuCores);   // :292
this.minDifficulty = Math.min(Math.max(1, Math.round(realDifficulty / 3)), 100);      // Server.ts:83
```

- What the script assumes: the grow will be applied at min security (it computes threads with `log(1 + 0.03/minSec)`).
- What actually happens: both prep tasks start at once with durations fixed at the *current* (high) security; the grow (0.8x that weaken time) lands *before* the weaken, so the game evaluates `log1p(0.03 / currentSecurity)`. A freshly rooted server sits at `baseDifficulty = 3 x minDifficulty`; for `min >= 9` (above the 0.0035 cap) the per-thread growth is ≈ 1/3 of what was planned. A server that needs `ln(10) = 2.3` nats of growth gets ≈ 0.77 nats (2.2x instead of 10x). The daemon only re-preps once every prep script has finished (`isPrepping()`, `:827`), i.e. one full weaken-time later, and then sizes the second round correctly.
- Concrete effect: every initial prep of a server with `minDifficulty >= 9` (most mid/late servers) costs one extra weaken-time (minutes) and wastes ~2/3 of the round-1 grow RAM, exactly when a newly unlocked, better target is waiting. The same applies to the `prepRegressions` path.
- Suggested change: schedule prep as a W-G-W mini-batch using the existing `additionalMsec` mechanism: grow start = `now + W_cur - G_cur + delayInterval` (lands just after the weaken), and a second weaken for the grow hardening starting `2 * delayInterval` after the first. Then `getGrowThreadsNeeded` (min-security based) becomes correct.

## HC-4 (medium, confirmed): share runs regardless of faction work and suppresses the idle-RAM XP farm

- Script: `daemon.js:958-983` (`shouldShare` checks utilisation, cooldown, flags and `totalMaxRam > 1024` only; the comment says "if we are currently working for a faction" but nothing checks it; `getCurrentWorkInfo` at `:192` is never called), `:950-956` (`farmHackXp` gets `freeRamToUse = 1 - (1 - 0.8)/(1 - util)`, which is ≈ 0 when utilisation ≈ 0.8).
- Game: `src/PersonObjects/formulas/reputation.ts:16-24, 26-38, 40-50` - `calculateCurrentShareBonus()` multiplies only `getHackingWorkRepGain`, `getFactionSecurityWorkRepGain`, `getFactionFieldWorkRepGain` (faction work). No other gameplay code references it (`grep` over `src/`: only `NetworkShare/Share.ts`, `Formulas.ts`, the faction UI and these three functions). `NetscriptFunctions.ts:394-403`: each `ns.share()` holds its RAM for `ShareBonusTime = 10000` ms.

```ts
export function getHackingWorkRepGain(p: IPerson, favor: number): number {
  return (((p.skills.hacking + p.skills.intelligence / 3 + ...) / CONSTANTS.MaxSkillLevel) * p.mults.faction_rep *
    calculateIntelligenceBonus(p.skills.intelligence, 1) * mult(favor) * calculateCurrentShareBonus());   // reputation.ts:17-24
```

- What the script assumes: spare RAM spent on `share` is never worse than idle.
- What actually happens: whenever the player is not doing faction work (crime, company work, studying, Bladeburner, idle - all frequent under `work-for-factions.js --fast-crimes-only`), the share threads do nothing, while (a) they raise utilisation to ≈ 80% for 10 s every ~5 s, so the idle-RAM hack-XP farm at `:950-956` is computed on `util ≈ 0.8` and gets ≈ 0 RAM, and (b) targets whose rounds end while share is active are re-sized (`optimizePerformanceMetrics` reads live free RAM) against the share-occupied network.
- Concrete effect: with share auto-enabled at 1 TB, idle RAM stops producing hack XP (the thing that unlocks better targets) for the whole time the player is not on faction work; share-vs-batch interference is a smaller, self-correcting effect.
- Suggested change: gate `shouldShare` on `getCurrentWorkInfo().type == "FACTION"` (ram-dodged once per 60 loops, or read a flag written by `work-for-factions.js`), and run the XP farm before/instead of share when not on faction work.

## HC-5 (medium, confirmed): the `ns.ls` cache is reset every loop, costing a temp-script round trip per used host per loop

- Script: `daemon.js:1176-1182` (`resetCaches()` sets `_files = null`), `:807` (called for every server every loop), `:1209-1214` (`hasFile` → `getNsDataThroughFile(ns, 'ns.ls(ns.args[0])', ...)`), `:1762` (checked in `arbitraryExecution` for every task on a non-home host); `helpers.js:237-280` + `:433-456` (each round trip = `ns.write` + `ns.exec` + poll loop of `ns.sleep(1,2,4,...,200)` + `ns.read`).
- Game: `src/Netscript/RamCostGenerator.ts:598` (`ls: RamCostConstants.Scan` = 0.2 GB - the reason it is ram-dodged) and `RamCostGenerator.ts:590` (`exec: 1.3`).
- What the script assumes (comment at `:1174`): the file list must be re-read because `kill-all-scripts.js`/`cleanup.js` can wipe files.
- What actually happens: those scripts run rarely; the cache is discarded 60x per minute. With ~30-60 rooted hosts receiving batch tasks, a loop that (re)schedules a target performs that many exec+poll round trips (each several ms of wall time because `ns.sleep` yields to the game loop) before doing any useful work.
- Concrete effect: the 1000 ms `maxLoopTime` (`:114`) is regularly exhausted by bookkeeping; `skipped` grows, `workCapped` is set (`:800-804`), and lower targets are not scheduled that loop.
- Suggested change: keep `_files` across loops; invalidate only when an `exec` on that host returns 0 (which is what a missing file produces), or on the 60-loop refresh. The `_files.add(...)` fix from HK-F1 already keeps it consistent after `scp`.

## HC-6 (medium, confirmed): full re-sort with live `ns.getServerUsedRam` per comparison on every task

- Script: `daemon.js:2282-2287` (`getAllServersByFreeRam` sorts the cached array on *every* call; comparator calls `ramAvailable()` twice), `:1329-1330` (`usedRam()` = `ns.getServerUsedRam`), `:1673` (called at the top of `arbitraryExecution`), `:1518` (one `arbitraryExecution` per task: 4 x up to 100 batches per target), `:2411` (same in `Tool.getMaxThreads`).
- Game: `src/Netscript/RamCostGenerator.ts` `GetServerUsedRam: 0.05` - every call goes through the netscript API wrapper (argument validation, dynamic-RAM check `NetscriptHelpers.tsx:436-441`), it is not a plain property read.
- What actually happens: with n ≈ 100 servers a sort is ≈ 700 comparisons ≈ 1400 API calls; x 400 tasks ≈ 560 k API calls per fully-scheduled target per loop, plus a second sort (`getAllServersByMaxRam`, dictionary-based, cheap). This is the dominant CPU cost of the loop and the reason large targets overrun `maxLoopTime`.
- Suggested change: snapshot `usedRam` per server once per loop (a dictionary, as already done for `maxRam`), decrement it locally after each successful `exec` (threads x cost), and re-sort only when the snapshot changes.

## HC-7 (low, confirmed): XP-farm target ranking is chance-weighted, the basic farm is not

- Script: `analyze-hack.js:136-137` (`expRate` weighted by `hackChance + (1 - hackChance)/4`, per `hackCost`), `daemon.js:1874-1882` (`getBestXPFarmTarget` uses that `expRate`), `:1893` (`advancedMode = false` unless `--xp-only`), `:1993-1999` (basic mode = weaken while above min security, else grow).
- Game: `src/NetscriptFunctions.ts:295-300` (grow) and `:371-376` (weaken): `expGain = calculateHackingExpGain(server, Player) * threads` unconditionally; `processSingleServerGrowth` (`ServerHelpers.ts:202-212`) does not fortify when money is already max, so grow at max money is free XP at 0.8x weaken time.
- Effect: for a server with `requiredHackingSkill` close to the player's level the chance factor is ≈ 0.55, so a server with up to ~1.8x worse weaken/grow XP rate can be ranked above it. Modest: it only affects the 10 s kickstart and the idle-RAM farm.
- Suggested change: have `analyze-hack.js` also emit an unweighted `growExpRate = hackExp / (1.75 * growTime)` and use it for the basic farm.

## HC-8 (low, confirmed): ranking cost model does not match how the daemon actually holds RAM

- Script: `analyze-hack.js:120-122, 134` (`hackCost = 1.7 * hackTime + ...`, `growCost = 1.75 * growTime + ...`); daemon holds a hack thread for ≈ 1.5 W (HC-1).
- Game: `src/Hacking.ts:82-94` (`growTime = 3.2 x hackTime`, `weakenTime = 4 x hackTime`).
- Effect: in the daemon, all four tasks hold RAM for ≈ 1.5 W, so the true per-batch cost is ≈ `1.5W * (1.7H + 1.75(G + W1 + W2))` and the hack/grow weighting the ranking uses (1.98 : 6.16 per hackTime) overstates grow-heavy servers' cost by ~2x relative to hack-heavy ones. Ranking is only relative, so the effect is a bias, not a wrong absolute number. Fix HC-1 first; then the ranking model becomes right.

## HC-9 (low, confirmed): home cores are a poor use of leftover ram-manager budget

- Script: `Tasks/ram-manager.js:27-30, 71-93`; `daemon.js:415-418` (50% of unreserved cash every 30 s).
- Game: `src/PersonObjects/Player/PlayerObjectServerMethods.ts:42-44` (`1e9 * 7.5^cores`), `src/Server/ServerHelpers.ts:287-290` (`coreBonus = 1 + (cores-1)/16`), `src/Server/ServerPurchases.ts:34-41`.
- Effect: the 2nd core (7.5 b) buys 6.25% fewer grow/weaken threads *on home only*; 7.5 b buys ≈ 136 TB of purchased-server RAM in BN1 (or 2/3 of the 2→4 TB home doubling). With cash 40 b the daemon's ram-manager run spends 10 b on RAM and then 7.5 b on a core in the same tick.
- Suggested change: buy cores only when home RAM is a large share of network RAM and the core is < ~5% of cash, or leave `--no-cores` on by default.

## HC-10 (low, confirmed): per-loop `getServerMaxRam` sweep

- Script: `daemon.js:726` → `:1114-1117` (`getServersDict(ns, 'getServerMaxRam')` = one temp script over all hosts, every loop).
- Game: max RAM only changes via `ns.cloud.purchaseServer/upgradeServer` (`ServerPurchases.ts:56-63`) or home upgrades (`Singularity.ts:648`), which the daemon itself triggers on 30-32 s cadences.
- Suggested change: move to the 60-loop refresh, or refresh when `buildServerList` finds a new host / after each host-manager or ram-manager run.

## HC-11 (low, confirmed): backdoor RAM guard mis-calibrated below SF4.3

- Script: `Tasks/backdoor-all-servers.js:5, 86-91` ("each parallel backdoor consumes 3.6 GB", reserve 22 GB).
- Game: `src/Netscript/RamCostGenerator.ts:87-97` (`SF4Cost`: x16 when SF4 ≤ 1, x4 at SF4 = 2) and `:170` (`installBackdoor: SF4Cost(SingularityFn1)` = 2 GB base).
- Effect: below SF4.3 `backdoor-one.js` costs 1.6 + 32 = 33.6 GB (8.6 GB at SF4.2); `ns.run` returns 0 (`:107-109`) and the script exits - harmless, but the guard cannot do its job and backdoors are serialised by RAM failure instead of by design.

---

## Formula-by-formula comparison (question 2)

| Script formula | Script line | Game | Verdict |
|---|---|---|---|
| `percentStolenPerHackThread` = `(100-minSec)/100 * (hack-(req-1))/hack * hacking_money * ScriptHackMoney / 240`, clamped [0,1] | `daemon.js:1284-1288` | `Hacking.ts:44-56` | exact (script returns 0 for `minSec > 100`, game for `>= 100`; irrelevant) |
| formulas path: `ns.formulas.hacking.hackPercent(mock, player)` with `hackDifficulty = minSec` | `:1272-1281` | `Formulas.ts:180-185` → same function | exact |
| growth per thread: `ln(min(1.0035, 1 + 0.03/minSec)) * growth/100 * ServerGrowthRate * hacking_grow` | `:1242-1250, 1259-1263` | `grow.ts:8-28` (`log1p(0.03/diff)` capped at `log1p(0.0035)`, x `serverGrowth/100 * ServerGrowthRate * hacking_grow * coreBonus * threads`) | exact for 1 core; ignores the additive `+$threads` (`grow.ts:46`) → slight over-estimate (safe). At the wrong security in prep (HC-3) |
| multi-core grow: `ns.formulas.hacking.growThreads(mock, player, max, cores)` | `:1064-1074` | `Formulas.ts:199-209` → `numCycleForGrowthCorrected` (`ServerHelpers.ts:90-`) | exact, includes additive term and cores |
| `ns.growthAnalyze` | not used | `NetscriptFunctions.ts:311-323` uses `numCycleForGrowth` (multiplicative only) | n/a - the daemon's closed form equals `numCycleForGrowth`; it correctly does not rely on `growthAnalyze` |
| hack hardening 0.002/thread; grow hardening 0.004/thread | `:96-97, 1312, 1316, 1614, 1823` | `Server/data/Constants.ts:9` (`ServerFortifyAmount 0.002`), `NetscriptHelpers.tsx:613` (hack: x `min(threads, ceil(1/pct))`), `ServerHelpers.ts:209-211` (grow: `2 * 0.002 * min(ceil(usedCycles), threads)`) | exact; script uses full thread count, game caps at threads actually needed → weaken slightly over-provisioned (safe) |
| weaken 0.05 x `ServerWeakenRate` per thread, x `coreBonus` | `:98, 1022, 1029-1046` | `ServerHelpers.ts:292-295`, `:287-290` | exact (also uses `formulas.weakenEffect` ratio when available) |
| hack/grow/weaken durations | `:1333-1335` (`ns.get*Time`) | `NetscriptFunctions.ts:1263-1277` → `Hacking.ts:60-94` | exact by construction; times read at current security - correct for prepped targets, and the remote scripts inherit the duration the game fixes at start (`NetscriptHelpers.tsx:544`) |
| hack chance | not used by daemon; `analyze-hack.js:110-113`: `(max(1,1.75h)-req)/max(1,1.75h) * (100-minSec)/100 * hacking_chance * (1 + int^0.8/600)` | `Hacking.ts:9-24`, `intelligence.ts:1-3` | exact (BN mult not applied by the game either) |
| hack exp `3 + 0.3 * baseDifficulty`, failure = 1/4 | `analyze-hack.js:114-115, 135-136` | `Hacking.ts:30-38`, `NetscriptHelpers.tsx:564-565` | exact (relative; `hacking_exp`/`HackExpGain` omitted, same for all servers) |
| share bonus `1 + ln(threads)/25`, effective threads x int bonus x coreBonus, 10 s duration, 4 GB/thread | `daemon.js:46-48, 973-979` | `Share.ts:22-25, 43-49, 8`; `RamCostGenerator.ts:566` (`share: 2.4` + 1.6 base) | exact |
| home RAM max `2^30`, cores max 8, core cost `1e9 * 7.5^cores` | `ram-manager.js:3-4, 78` | `Server/data/Constants.ts:6`, `Singularity.ts:601`, `PlayerObjectServerMethods.ts:42-44` | exact |
| darkweb prices (500k, 1.5m, 5m, 30m, 250m, 500k, 500k, 1m, 25m, 5b) | `program-manager.js:6-22` | `DarkWeb/DarkWebItems.ts:5-21` | exact (prices only drive the Formulas gate) |
| purchased server cost via `ns.cloud.getServerCost`; upgrade = difference | `host-manager.js:61, 227-240` | `ServerPurchases.ts:23-54` | exact after HK-F2 |
| `maxTargets` initial `2 + round(totalRam / 500 TB)` | `daemon.js:475` | heuristic | n/a |

No re-implemented formula is numerically wrong. The errors are in *when* formulas are evaluated (HC-3) and in which cost model the ranking uses (HC-8).

## Timing (question 1)

- The game does not quantise hack/grow/weaken to the 200 ms engine cycle: `Constants.ts:19 MilliPerCycle: 200` drives the engine's periodic updates, but each operation resolves on its own `setTimeout` (`NetscriptHelpers.tsx:419-433`) whose length is fixed the moment the call is made (`:544`). The daemon's 500 ms task spacing (`cycle-timing-delay/4`) therefore only has to absorb JS timer jitter and game-loop stalls; that is comfortable, and the remote scripts absorb exec latency by recomputing `sleepDuration` from `Date.now()` (`hack-target.js:16-26`). Sound.
- Within a batch the order H (t) → W1 (t+500) → G (t+1000) → W2 (t+1500) is correct: hack lands at min security/max money, W1 removes hack hardening before G lands, W2 removes grow hardening 500 ms before the next batch's hack. `weaken` cannot undershoot min (`Server.ts:91-97`), so W over-provisioning is safe.
- The unsound part is macro-timing (HC-1), not micro-timing.

## Efficiency (question 3)

Per loop (1 s cadence, 1 s budget): 4 fixed temp-script round trips (`scanAllServers`, `getServerMaxRam`-all [HC-10], owned-programs, `getPlayer`), plus one `ns.ls` round trip per host used [HC-5], plus a `getAllServersByFreeRam` sort per task [HC-6]. `getNetworkStats()` (one `ns.getServerUsedRam` per rooted server) is recomputed for every `isWorkCapped()` evaluation and in `optimizePerformanceMetrics`; `getPerformanceSnapshot`'s simulation is O(maxBatches x 4 x hosts) per iteration and is called twice per tuning iteration (up to 1000) - in practice a few ms, fine. `isSubjectOfRunningScript` walks `allHostNames x ns.ps` with a per-loop cache - fine. `analyze-hack.js` runs every 60 loops and calls `ns.getServer` for every host - fine.

## Progression (question 4)

- TOR/programs: `tor-manager` buys TOR (200k, `Constants.ts:44`) as soon as affordable; `program-manager` buys crackers in price order 500k → 1.5m → 5m → 30m → 250m, which is also port order 1→5 (`DarkWebItems.ts:6-10`), refuses non-crackers while a cracker is missing, defers Formulas.exe (5 b) to 10x its price, and `daemon.reservedMoney` (`:229-231`) starts saving for SQLInject at 200 m. Sensible. Note `purchaseTor`/`purchaseProgram` cost 32 GB each below SF4.3 (`RamCostGenerator.ts:87-97, 162-163`), so in BN1.1 neither script can run until home ≥ 64 GB; the daemon's terminal reminder (`:743-746`) covers this.
- Backdoor: correct progression lever - CyberSec, NiteSec, The Black Hand, BitRunners and Fulcrum all require `haveBackdooredServer` (`FactionInfo.tsx:379, 402, 419, 465, 489`), `installBackdoor` takes only `hackTime/4` (`Singularity.ts:525`), captures the current server at call time (`:520`) so hopping back home immediately is safe, and forces an immediate invitation check (`:551-552`). Backdoored servers are also directly connectable (`Terminal/commands/connect.ts:43`). Sorting by required level is the right order. Known: HK-F6 (`>` vs `>=`).
- Servers: HC-2 is the real problem; otherwise the guards (min 2^5, not below worst/best purchased, ≥ 25% of home, ≥ 2% of network) are reasonable, and upgrades-in-place at the 25-server cap are handled (HK-F2 fix verified against `ServerPurchases.ts:44-54`).
- Home RAM: ram-manager's "50% of unreserved cash every 30 s" is aggressive but home RAM survives installs (`ServerHelpers.ts:224-259`), so it is defensible; cores are not (HC-9).

## What is well done (question 5)

- Every closed-form replica of a game formula is exact (table above), including the growth cap, hardening amounts, weaken potency and the intelligence bonus; `formulas.hacking.growThreads` is used for the one case where the closed form is not exact (multi-core hosts, additive term).
- Cores-aware scheduling (`weakenThreadsByCores`/`growThreadsByCores`, host ordering by `cpuCores` for grow/weak/share) matches `getCoreBonus` and `startSharing` exactly and is correctly *not* applied to the `+$1/thread` grow-from-zero and XP paths.
- Bundling the pre-start wait into `additionalMsec` makes batch timing immune to exec latency and to the engine tick; the stock-manipulation argument plumbing (`args[4]` hack/grow, loop flag `[6]`/`[5]`) is consistent between `getFlagsArgs`, the remote scripts and `terminateScriptsManipulatingStock`.
- Ram-dodging keeps the daemon's static footprint small and every dodge is retried with back-off; the `_files.add` fix (HK-F1) is correct.
- The ranking (`analyze-hack.js`) correctly folds hack chance, failure XP, and weaken-recovery cost into `$/GB·s`, and pro-rates locked servers to the current level.
- Backdoor and program order both match the game's requirements exactly; the 4S/SQLInject/sleeve reserves in `reservedMoney` use the right constants (`StockMarket/data/Constants.ts:10`, `BitNodeMultipliers.ts:85`).

---

# Section 2: Progression and singularity

Scope: `autopilot.js`, `faction-manager.js`, `work-for-factions.js`, `ascend.js`, `crime.js`, `Tasks/program-manager.js`, `Tasks/tor-manager.js` on branch `game-optimisation-3.0`, compared with `/home/jubnl/dev/bitburner/bitburner-src/src` (v3.0.1). Read-only.

Findings already in `docs/audit/2026-09-15-in-game-audit.md` (SG-F1..F7 and the "Checked and OK" list: favor/donation formulas, aug price multiplier, NF pricing, Daedalus/Covenant/Illuminati invite tables, company rep 400k/0.75, crime karma model, casino kick-out) are **not** repeated here; they were re-read and hold.

Summary

| Sev | Finding | Status |
|---|---|---|
| high | Silhouette invite is ground via Software track to CTO (3.2M company rep) although the game also accepts CFO (Business track, 800k rep, same charisma, far less hacking) | confirmed, numbers corrected |
| medium | `--install-for-augs` (default: The Red Pill) only looks at *affordable* augs, never at *already-queued* ones, so a labyrinth-awarded TRP does not trigger an install | confirmed |
| medium | `work-for-factions.js` (as launched by autopilot) joins mutually-exclusive city factions in invite-arrival order; with the casino skipped the first invite is usually Volhaven, which bans the other five cities for the whole reset | mechanics confirmed, trigger frequency suspected |
| medium | Combat-stat grinding picks Homicide at >=50 % (and Heist at >=75 %) although Mug yields more combat exp/s in every reachable state | confirmed |
| low | `earnFactionInvite` grinds hack/combat for Daedalus / The Covenant / Illuminati before checking money and never checks the installed-aug requirement | logic confirmed, frequency suspected |
| low | NeuroFlux is always sourced from a donation-unlocked faction, paying for rep that another joined faction already has for free (known TODO #145) | confirmed |
| low | autopilot's 2 s loop launches 7-14 temp scripts per iteration; `getStocksValue` (4 scripts) is recomputed up to 3x per iteration | confirmed |
| low | `measureRepGainRate` assumes exactly one 200 ms game tick between two temp-script samples; `detectBestFactionWork` picks the max of these noisy samples | suspected |

---

## 1. Silhouette: CTO (3.2M rep) is ground although CFO (800k rep) qualifies — **high, confirmed (numbers corrected by the coordinator)**

> **Coordinator correction (verified against `src/Company/data/CompanyPositionsMetadata.ts:256-283`):** the reviewer quoted the *Operations Manager* (business3) row for the CFO. The real CFO (business4) row is `reqdCharisma: 501, reqdHacking: 76, reqdReputation: 800e3, repMultiplier: 1.6`, and CEO (business5) is `751 / 101 / 3.2e6`. So CFO needs **4x** less company rep than CTO (800k vs 3.2M), the **same** charisma (501 + 224/249 offset), and far less hacking (76 vs 751 + offset). Business positions earn rep at 90 % charisma weight, so for a hack-heavy player the rate is lower; the net saving on the Silhouette grind is roughly **2-3x**, not the 4-6x stated below. The conclusion (apply to the Business track once rep >= 800k x backdoor factor, and stop treating 3.2M as the requirement) stands.

**Script.** `work-for-factions.js:45-46` (`{ name: "Silhouette", companyName: "TBD", repRequiredForFaction: 1.0e7 }` with the comment "3.2e6 should be enough rep to get the CTO position"), `:580-601` (company chosen by `(3.2e6*(backdoored?0.75:1) - rep) / (100+favor)`), `:1186-1207` (only the `IT` and `Software` job tables at `:48-63` are ever applied for).

**Game.**
- `src/Faction/FactionInfo.tsx:639`: `inviteReqs: [executiveEmployee(), haveMoney(15e6), haveKarma(-22)]`
- `src/Faction/FactionJoinCondition.ts:102-103`:
  ```ts
  export const executiveEmployee = (): PlayerCondition => ({
    ...someCondition([JobName.software7, JobName.business4, JobName.business5].map((jobTitle) => haveJobTitle(jobTitle))),
  ```
- `src/Company/data/CompanyPositionsMetadata.ts:244-254` (business4 = Chief Financial Officer): `reqdCharisma: 226, reqdHacking: 51, reqdReputation: 200e3, repMultiplier: 1.5`; vs `:107-110` (software7 = CTO): `reqdCharisma: 501, reqdHacking: 751, reqdReputation: 3.2e6`.
- `src/Company/data/CompaniesMetadata.ts:23-99`: all ten megacorps list `...businessJobs`.
- `src/NetscriptFunctions/Singularity.ts:719-737`: `applyToCompany(companyName, field)` starts at `JobTracks[field][0]` and (`PlayerObjectGeneralMethods.ts:325-329`) climbs every position the player qualifies for, so `applyToCompany(c, "Business")` (`src/Work/Enums.ts:73`) lands directly on CFO once rep >= 200k (150k if the company server is backdoored, `src/Company/utils.ts:15-19`) and charisma >= 226+offset (450 / 475).

**What the script assumes.** Only the Software track leads to an executive title; 3.2M company rep is required.

**What the game does.** Company rep is per company, not per track. CFO needs 16x less rep than CTO, and the charisma requirement (450/475) is *lower* than what the script already studies Leadership for on the Software track (CTO needs 725/750).

**Effect.** Business positions weight charisma 85 % / hacking 15 % (`CompanyPositionsMetadata.ts:246-248`), and rep gain is `repMultiplier * sum(weight*skill)/MaxSkillLevel/100` (`src/Company/CompanyPosition.ts:156-172`), so for a hack-heavy player the Business track earns ~2.7-4x less rep per second than Software — but it needs 16x less rep. Net: the Silhouette invite arrives roughly 4-6x sooner. At a typical 10 rep/s Software rate this is ~9 h of focused company work vs ~89 h (the script re-enters this grind in every main-loop pass at strategy >= 5 until it completes).

**Suggested change.** In `earnFactionInvite("Silhouette")`: work the normal IT/Software track (best rep/s) until company rep >= `200e3 * (backdoored ? 0.75 : 1)`, then `applyToCompany(company, "Business")`; set `repRequiredForFaction` for Silhouette to that value and use it (not 3.2e6) in the company-selection formula at `:591-593`. Also study Leadership to 226+offset only (not 501+offset).

---

## 2. `--install-for-augs` never fires for an aug that is already queued (labyrinth TRP) — **medium, confirmed**

**Script.** `autopilot.js:911-912`:
```js
let shouldReset = options['install-for-augs'].some(a => facman.affordable_augs.includes(a)) ||
    pendingAugCount >= augsNeeded || pendingAugInclNfCount >= augsNeededInclNf;
```
`facman.affordable_augs` is the *to-buy* list (`faction-manager.js:243`); queued augs are only in `awaiting_install_augs` (`faction-manager.js:238`), which line 911 does not consult (the countdown-reset code at `:962` does, inconsistently).

**Game.**
- `src/DarkNet/effects/cacheFiles.ts:173-180`:
  ```ts
  const getLabReward = (): string => {
    let reward = getLabAugReward();
    ...
    Player.queueAugmentation(reward);
  ```
  The labyrinth reward is *queued*, not installed.
- `src/DarkNet/effects/labyrinth.ts:419-427`: in BN15 the 4th lab yields The Red Pill; in any BN with `DarknetLabyrinthRewardsTheRedPill` the 6th lab does.
- `src/Augmentation/AugmentationHelpers.ts:32-37`: every queued non-SoA aug multiplies all further aug prices by `getBaseAugmentationPriceMultiplier()` (1.9 x SF11 factor).
- `src/Server/ServerHelpers.ts:384`: WD's required hacking = base x `WorldDaemonDifficulty` (x2 in BN15), so the post-install hack climb is long and should start as early as possible.

**Effect.** This branch runs `darknet.js` (daemon.js periodic list) whose labyrinth walker can obtain TRP. When it does, autopilot keeps waiting for the generic threshold (8 + SF11 augs, minus 0.5/h) instead of installing immediately; meanwhile every other aug costs 1.9x because TRP sits in the queue. TRP cannot be grafted around this (`Augmentations.ts:1951 isSpecial: true`; `GraftingHelpers.ts:13-16` skips special augs), so the queue is the only path.

**Suggested change.** `options['install-for-augs'].some(a => facman.affordable_augs.includes(a) || facman.awaiting_install_augs.includes(a))`. (The BN15 early-exit in `checkOnDaedalusStatus` is fine; this is the missing half.)

---

## 3. City factions are joined in invite-arrival order; Volhaven can lock out five factions for a reset — **medium**

**Script.**
- `work-for-factions.js:271-276`: with `--get-invited-to-every-faction` (always passed by `autopilot.js:717`), `invitesToAccept = invites.filter(f => !skipFactions.includes(f))` and every one is joined immediately.
- `:235-239`: the "precluding" cities Aevum/Sector-12/Volhaven are skipped **only when all their augs are already owned**; otherwise they are joined like any invite. The comment ("we will always filter the most-precluding city factions") does not match the code.
- `faction-manager.js:511-514, 530-534` deliberately refuses to auto-join any city faction (`manualJoin`) — the two scripts disagree, and it is work-for-factions that runs under autopilot.
- `daemon.js:457, 518-520`: at the start of every reset (`hack < 500 && < 10 min since aug`) daemon travels to **Volhaven** whenever money >= $200k and studies there; nothing moves the player back.

**Game.**
- `src/Faction/FactionInfo.tsx:552-553`: Volhaven `enemies: [Chongqing, Sector12, NewTokyo, Aevum, Ishima]`, `inviteReqs: [locatedInCity(Volhaven), haveMoney(50e6)]`; Sector-12/Aevum ban the other four (`:498, :540`), the Chongqing/NT/Ishima trio ban S12/Aevum/Volhaven (`:508, :520, :530`).
- `src/Faction/FactionHelpers.tsx:44-51`: `joinFaction` sets `isBanned = true` on every enemy and drops their invites.
- `src/Faction/Faction.ts:77-85`: bans (and membership) are cleared only by `prestigeAugmentation`, i.e. the lock-out lasts the whole reset.
- `src/engine.tsx:154, 177-182`: invites are checked every 10 cycles (2 s) for all factions at once.
- `src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:102` money is reset on install; `src/Prestige.ts:86-89` re-adds `startingMoney` (CashRoot: $1e6, `Augmentations.ts`), so with CashRoot installed the $200k travel condition holds at second 0 of every reset.

**Trigger.** In the default flow the casino (in Aevum) usually issues an Aevum invite first, and work-for-factions joins in `Player.factionInvitations` order, so Aevum wins by luck. Whenever the casino is skipped (`--disable-casino`, the audit's SG-F1 bug before it was fixed, `ranCasino` set by the 5b/min or 1t checks) the player sits in Volhaven after the kick-start study, hack income crosses $50m there, the Volhaven invite arrives, and the next work-for-factions main loop joins it.

**Effect for that reset** (from `Augmentations.ts` faction lists): Volhaven-only aug is DermaForce (def x1.4); banned are Aevum's PCMatrix (faction_rep/company_rep/charisma x1.0777, Aevum-only), Chongqing's Neuregen (hacking_exp x1.4, Chongqing-only), NutriGen (NT-only), INFRARet (Ishima-only), CashRoot (S12-only), and the `preferredEarlyFactionOrder` entries Aevum and Chongqing (`work-for-factions.js:71, 81`) become "precluded" for the rest of the reset. Even the non-Volhaven case is a strategy leak: whether the run ends up in the S12+Aevum pair (12 augs, PCMatrix/CashRoot) or the Chongqing+NT+Ishima trio (16 augs, Neuregen/NutriGen/INFRARet/DataJack) is decided by where casino/daemon last parked the player, not by the priority list.

**Suggested change.** In `mainLoop` never auto-accept the six city invites unless (a) a city faction is already joined (then the game has already banned the rest), (b) the faction is in `--first`, or (c) it is the next entry of `factionWorkOrder` (so `earnFactionInvite` remains the deliberate path). Same rule for `ascend.js:153-157` (joins every pending invite, including cities, right before the install — harmless today only because bans reset on install).

---

## 4. Stat-grind crime choice: Homicide/Heist chosen where Mug gives more exp/s — **medium, confirmed**

**Script.** `work-for-factions.js:642-667`: `bestCrimesByDifficulty = ["Heist","Assassination","Homicide","Mug"]` with `chanceThresholds = [0.75, 0.9, 0.5, 0]`; when karma/kills are satisfied and only `reqStats` remain, the first crime whose success chance meets its threshold is taken (in `--fast-crimes-only` mode: Homicide at >=50 %, else Mug).

**Game.** `src/Crime/Crimes.ts` (constructor args are `time, money, difficulty, karma`, `Crime.ts:70-78`): Mug `:44-64` 4e3 ms, difficulty 0.2, exp 3/3/3/3; Homicide `:139-161` 3e3 ms, difficulty 1, exp 2/2/2/2; Kidnap `:187-210` 120e3 ms, exp 80 each; Assassination `:211-234` 300e3 ms, exp 300 each; Heist `:235-260` 600e3 ms, exp 450 each; GTA `:162-186` 80e3 ms, 20/20/20/80. `src/Work/CrimeWork.ts:64-84`: on failure `gains = scaleWorkStats(gains, 0.25)` and `karma /= 4`.

**Numbers** (combat exp per stat per second = base x (0.25 + 0.75 p), all multipliers cancel):

| crime | base exp/s | at threshold | at p = 1 |
|---|---|---|---|
| Mug | 0.750 | — | 0.750 |
| Homicide | 0.667 | p=0.5: **0.417** | 0.667 |
| Heist | 0.750 | p=0.75: 0.609 | 0.750 |
| Assassination | 1.000 | p=0.9: 0.925 | 1.000 |
| Kidnap | 0.667 | — | 0.667 |

Homicide beats Mug only if `p_homicide > 0.04 + 1.125 * p_mug`, impossible since Mug (difficulty 0.2) always has the higher chance. Heist at its 75 % threshold is also below Mug. Only Assassination >= ~0.85 beats Mug.

**Effect.** The pure-stat grind used for Tetrads (75), The Syndicate (200), Dark Army / Speakers (300), The Covenant (850) and the `--crime-focus` rush runs up to 1.8x slower (0.417 vs 0.75) when Homicide is at 50-60 % and still ~12 % slower at 100 %. (The karma/kills path is untouched: the audit-verified "Homicide always" rule is correct there because karma, not exp, is the objective.)

**Suggested change.** When `needStats && !needKarmaOrKills`, pick `argmax_c exp_c/time_c * (0.25 + 0.75 * chance_c)` over the allowed crimes (Mug, or Assassination once its chance is >= ~0.85; Kidnap/Heist never beat Mug for combat exp). Keep the crime for its full duration when switching to slow crimes.

---

## 5. Invite grinding for Daedalus / Covenant / Illuminati ignores the aug-count and money requirements — **low**

**Script.** `work-for-factions.js:447-562`: crime (`:466-507`) and study (`:509-556`) run *before* the money check at `:561`, and there is no check of installed augs at all. Study is gated only by `hackHeuristic >= requirement / training-stat-per-multi-threshold` (`:527-535`); the rush-gang args set that threshold to 200 (`autopilot.js:725`), so Covenant's 850 hack triggers a university grind once `sqrt(hacking_mult * HackingLevelMultiplier * hacking_exp * ClassGymExpGain) >= 4.25`.

**Game.** `src/Faction/FactionInfo.tsx:132` (Illuminati `haveAugmentations(30), haveMoney(150e9)`), `:142` (Daedalus `DaedalusAugsRequirement`), `:167` (Covenant `haveAugmentations(20), haveMoney(75e9)`); `src/Faction/FactionJoinCondition.ts:116-131` counts installed augs (`p.augmentations.length`).

**Effect.** Late in a BN with strong multipliers the player is parked at ZB studying Algorithms toward 850/1500 hack (or committing crimes toward 850 combat) for a faction that cannot invite them for lack of 20/30 installed augs or $75b/$150b cash — time that strategy 9 would otherwise spend on NF rep. Bounded by the 10-minute `breakToMainLoop`, but repeated every pass.

**Suggested change.** In `earnFactionInvite`, test `requiredMoneyByFaction` (against money + stock value) and an `installedAugs >= n` table first, and return early.

---

## 6. NeuroFlux always bought from a donation faction, even when free rep exists elsewhere — **low, confirmed (known TODO)**

**Script.** `faction-manager.js:474-481` (NF `getFromJoined` sorts donation-unlocked factions first, regardless of rep), `:838-870` (each NF level's rep is bought with `getReqDonationForRep`), TODO #145 at `:481` and `:858`.

**Game.** `src/Faction/formulas/donation.ts:12-14` `donationForRep = rep * 1e6 / faction_rep / FactionWorkRepGain`; NF rep requirement grows x1.14 per level (`Augmentations.ts`, `CONSTANTS.NeuroFluxGovernorLevelMult`, `Constants.ts:36`).

**Effect.** After a long Daedalus/TRP grind the player commonly has 0.5-2.5M rep with Daedalus (no donations) while a 150-favor faction has ~0 rep; NF levels 20-40 need up to ~94k rep each, which the script buys for ~$94b / faction_rep_mult instead of taking them free from Daedalus first. Small relative to late-BN income, hence low.

**Suggested change.** Buy NF from the joined faction with the most rep until `nextNfRep > rep`, then switch to the donation faction (the TODO's plan).

---

## 7. autopilot main loop: redundant temp-script launches — **low, confirmed**

**Script.** Per 2 s iteration (`autopilot.js:251-263`): `getPlayer` (1), `getOwnedAugmentations` (1, `:279`), `getStocksValue` (4 temp scripts: `helpers.js:786-802`), `inBladeburner` (1/loop with SF7, `:416`; then `getActionCountRemaining` 1/loop), `getMoneySources` + a second `getStocksValue` until the casino ran (`:796, :803` = 5), and when an install is pending `getCurrentWork` + `has4SDataTixApi` + `has4SData` + a third `getStocksValue` (`:1019-1027` = 7). That is 7 (steady) to 14 (pre-casino / pre-install) temp scripts every 2 s, each an `ns.run` + file write + poll (`helpers.js:433-448`).

**Game.** `src/Constants.ts:19 MilliPerCycle: 200`; the values polled change only on install/graft (`AugmentationHelpers.ts:41-70`), casino completion, or stock ticks — none benefit from 2 s polling.

**Suggested change.** Compute `stocksValue` once per loop and pass it to `maybeDoCasino`/`shouldDelayInstall`; move `updateCachedData` and the casino money-source check under the existing 10 s `interval-check-scripts` cadence; check `inBladeburner` on that cadence too.

---

## 8. Rep-rate measurement assumes one game tick between samples — **low, suspected**

**Script.** `work-for-factions.js:1056-1065`: samples rep twice via temp scripts and returns `(delta) * 5` ("Assume this rep gain was for a 200 tick"); `detectBestFactionWork` (`:1081-1101`) picks the max over the three work types every minute (`:989-993`).

**Game.** `src/Constants.ts:19` 200 ms cycles; `src/Work/FactionWork.tsx:49-53` adds `getReputationRate() * cycles` each process call, and `APICopy()` (`:63-70`) exposes `cyclesWorked`.

**Effect.** Each temp-script round trip takes up to ~200 ms of polling (`helpers.js:446-447`), so two samples can straddle one or two ticks; a 2x error is enough to prefer the wrong work type when hacking/field/security rates differ by less than 2x, and the wrong choice persists for a minute. ETA displays are also off.

**Suggested change.** Read `cyclesWorked` from `getCurrentWork()` before and after and divide `delta_rep` by `delta_cycles` (x5 for per-second), or sample over >= 3 ticks.

---

## Other observations (no game-source dependency; not counted as findings)

- `faction-manager.js:449-450`: `sort((a, b) => a.mostExpensiveAugCost - b.mostExpensiveAugCost)` subtracts two *methods* (NaN), so `getFromAny` is just the first faction in list order; `:993` `.length` on a number likewise. Display-only.
- `autopilot.js:938-939`: the quick-install branch permanently overwrites `options['install-countdown']` with 30 s for the rest of the process; if that quick install is then held back by `shouldDelayInstall` (4S wait, grafting), the eventual normal install in the same reset also gets only a 30 s countdown.
- `work-for-factions.js:106` comment "one new invite every 25 seconds" is stale (invites are all issued every 2 s, `engine.tsx:154,177-182`); the 30 s wait is harmless.

## What is well done (verified against 3.0.1)

- **Purchase ordering and thresholds.** Most-expensive-first with prerequisite bubbling (`faction-manager.js:566-587`) is the cost-minimising order under `price_i * 1.9^i` (`AugmentationHelpers.ts:29-37`). I checked the NF insertion algebra: the affordability loop prices each NF as if bought last (`:839`) while actually inserting it ahead of cheaper augs (`:863`); since those augs are cheaper than the first NF level, the estimate is an *over*-estimate, so the plan never overspends. The install cadence (8 + SF11, minus 0.5/h, momentum countdown, 4-aug quick install in the first 20 min) is a reasonable trade-off given that eight equal augs cost `(1.9^8-1)/0.9 = 188` base units vs `13.4` for four.
- **Endgame.** WD requirement is read from the server (so `WorldDaemonDifficulty` at `ServerHelpers.ts:384` is honoured), root is verified before `destroyW0r1dD43m0n` (`Singularity.ts:1170-1175` requires both), the Daedalus rush (reserve $100b, liquidate stocks, `--xp-only` at 75 % of 2500, combat path alternative) matches `FactionInfo.tsx:138-149`, and the "install as soon as TRP is affordable" default is right. The Daedalus donation soft-reset (`work-for-factions.js:856-864` -> `autopilot.js:917-925`) is sound: `softReset` -> `installAugmentations(true)` -> `Faction.prestigeAugmentation` converts rep to favor (`Singularity.ts:185-195`, `Faction.ts:77-79`), and the 0.9 x 2.5M guard avoids resetting when TRP rep is nearly earned.
- **Company track model.** Promotion-by-tier plus "apply for the field and let the game climb" exactly mirrors `applyForJob` (`PlayerObjectGeneralMethods.ts:325-329`); the backdoor 0.75 is applied to both job and faction requirements as `Company/utils.ts:15-19` does; the 224/249 offsets and the IT/Software tables match `CompanyPositionsMetadata.ts`.
- **Pre-install spending in `ascend.js`.** Everything bought before the reset persists: sleeve augs are cleared only in `prestigeSourceFile` (`PlayerObjectGeneralMethods.ts:145-148`), gang members keep equipment/augs (only ascension points are recomputed, `Prestige.ts:133-147`), home RAM/cores and 4S persist, stocks are liquidated first (money is zeroed at `:102`). Stanek acceptance before the first purchase matches the CotMG condition.
- **Joining every invite** for passive rep is correct (`FactionHelpers.tsx:132-157`), and `faction-manager.js` correctly exempts city factions — the fix for finding 3 is to make work-for-factions follow the same rule.
- **Crime for karma/kills**: Homicide-always is right (failure still yields karma/4, `CrimeWork.ts:80-84`); the Mug warm-up for the first two crimes and the `homicideForKarma` override are consistent with the game.
- **Program/TOR managers**: prices, ordering (crackers first, DarkscapeNavigator before Formulas) and `hasTorRouter()` usage are correct for 3.0.1 (audit-verified; nothing new).

---

# Section 3: Gangs, sleeves, bladeburner

Scope: do the three scripts advance the game well, and are their calculations correct against what the game actually does.
Scripts: `/home/jubnl/dev/bitburner/bitburner-scripts` (branch `game-optimisation-3.0`).
Game source of truth: `/home/jubnl/dev/bitburner/bitburner-src/src` (v3.0.1).
Findings already listed in `docs/audit/2026-09-15-in-game-audit.md` (FT-F1..F9 and the "Checked and OK" lists) are not repeated; the formula-level equivalence of the gang gain calculations, the bladeburner leveling model, the sleeve API name/shape checks etc. were re-read and hold, and are taken as given below.

Severity: high = materially wrong decision or big waste; medium = clear inefficiency or wrong calculation with modest effect; low = minor.

## Summary

| Sev | ID | Script | Finding |
|---|---|---|---|
| high | SL-1 | sleeve.js | "Synchronise first, then Homicide for gang karma" parks every sleeve on Synchronize for ~21-27 h in any non-BN2 run where SF2 is owned and no gang exists; and sleeve homicide at fresh stats cannot deliver karma anyway (karma only on success, ~0.5 % success) |
| high | SL-2 | sleeve.js | Gym/university training is unreachable under defaults (`train-max-shock 10` can never be met inside `training-cap-seconds` 2 h), so sleeves never gain stats and every stat-scaled sleeve job (faction rep, homicide, bladeburner contracts) is dead |
| high | BB-1 | bladeburner.js | BlackOp go/no-go uses `max(lo, hi)`, which equals `real x pop/popEst` whenever the population is under-estimated - the one situation the script's own uncertainty detector cannot see - so a 70-80 % BlackOp can be launched as "100 %" |
| medium | GG-1 | gangs.js | `importantStats` does not match the task weights: agility has zero weight in Terrorism / Human Trafficking while hack+cha carry 40-60 %; equipment value, the 50x off-stat penalty, ascension triggers and training focus are all steered by the wrong stats |
| medium | GG-2 | gangs.js | In bonus time (after offline) territory ticks every 800 ms; the pre-tick warfare swap + per-tick housekeeping cannot keep up and the gang spends most of the 25x-accelerated catch-up on Territory Warfare (zero respect/money for those cycles) |
| medium | SL-3 | sleeve.js | Sleeve 6 permanently on bladeburner Field Analysis (0.1 rank / 30 s, ~0.06 % estimate improvement at stat 1) instead of Infiltrate Synthoids (worth several rank/min via extra Assassination/Stealth-Retirement count) |
| medium | BB-2 | bladeburner.js | Tracking is in `populationActions` but its estimate effect is an absolute 100-1000 people on a ~1e9 population, so the "population uncertain" branch can loop on Tracking without ever resolving the uncertainty |
| low | GG-3 | gangs.js | Territory-tick tracking polls 1-2 temp scripts every 200 ms and pads/misfires, although `ns.gang.nextUpdate()` (0 GB) resolves once per gang update and the territory tick is exactly every 10th update |
| low | GG-4 | gangs.js | Post-ascension retraining is a fixed 200 s wall-clock gate; the game resets skill to ~= the ascension multiplier, so the gate is unrelated to how long the member actually needs |
| low | BB-3 | bladeburner.js | Between chaos 50 and `--max-chaos` (100) the script tolerates a `sqrt(1 + chaos - 50)` difficulty multiplier (x1.4 at 51, x7 at 100) rather than spending Diplomacy time when no city is below 50 |
| low | BB-4 | bladeburner.js | Skill points are spent one level per 4 temp scripts; ~20 temp scripts per 2 s loop re-fetch static data (max levels, blackop ranks) instead of pacing on `nextUpdate()` |
| low | SL-4 | sleeve.js | `getResetInfo()` / `getNumSleeves()` re-fetched through temp scripts every second; per-second loop launches ~8-12 temp scripts |

---

## gangs.js

### GG-1: `importantStats` does not match the task weights (medium, confirmed)

- Script: `gangs.js:147` (`importantStats = isHackGang ? ["hack"] : ["str", "def", "dex", "agi"]`), consumed at `:513` (equipment perceived cost x50 when no key matches), `:444` and `:478` (ascension trigger / near-ascension), `:270` (training task: 10 % Charisma, 81 % Combat, 9 % Hacking for a combat gang).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/data/tasks.ts:295-311` (Human Trafficking) and `:317-332` (Terrorism)
  ```ts
  name: "Human Trafficking", params: { baseRespect: 0.004, baseWanted: 1.25, baseMoney: 360,
    hackWeight: 30, strWeight: 5, defWeight: 5, dexWeight: 30, chaWeight: 30, difficulty: 36, ...
  name: "Terrorism", params: { baseRespect: 0.01, baseWanted: 6,
    hackWeight: 20, strWeight: 20, defWeight: 20, dexWeight: 20, chaWeight: 20, difficulty: 36, ...
  ```
  (no `agiWeight` on either). Hacking gang equivalents `:119-131` Money Laundering `hackWeight: 75, chaWeight: 25`, `:132-144` Cyberterrorism `hackWeight: 80, chaWeight: 20`.
  `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/formulas/formulas.ts:17-24` - `statWeight` is the plain weighted sum of the six stats; respect and money are `(... * statWeight ...)^territoryPenalty`.
  `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/GangMember.ts:343-350` - an upgrade multiplies exactly the stats it lists; `:141-150` it also multiplies exp gain by `(mult-1)/4 + 1`.
- What the script assumes: for a combat gang all four combat stats are "important" and hack/cha are not; for a hacking gang only hack is.
- What the game does: the two best combat tasks (the ones the optimiser converges on) put 0 weight on agility and 40 % (Terrorism) / 60 % (Human Trafficking) on hack+cha; the two best hacking tasks put 20-25 % on cha.
- Effect (combat gang, Human Trafficking, equal stats S): Bionic Legs ($10 B, agi x1.6) adds 0 % to the task statWeight but is bought as a full-value augmentation; Neuralstimulator ($10 B, hack x1.15) adds +4.5 % but is perceived at $500 B; Synthetic Heart ($25 B, str/agi x1.5) adds +2.5 % and is bought before it. Rootkits ($5-75 M, hack x1.05-1.15, +1.5-4.5 % on both top tasks) are perceived at $250 M-$3.75 B and never bought. Ascension is triggered on the agi ratio like any other; training never targets cha except the 10 % lottery. Territory-warfare power (`Gang.ts:361-369`, `GangMember.ts:87-89`: sum of all six stats / 95) is the only place agility is worth as much as the others.
- Suggested change: score each equipment as `sum_s weight_s(task) * (mult_s - 1)` using the task the member is (or will be) assigned, and rank by score/cost instead of the binary important/off-stat flag; drive the ascension trigger and the training stat choice from the same weights.

### GG-2: bonus-time thrash (medium; mechanism confirmed, magnitude estimated)

- Script: `gangs.js:225-235` (swap everyone to Territory Warfare when `thisLoopStart + 200 + padding >= territoryNextTick`, then run `onTerritoryTick` as soon as power changes), `:244` (`territoryNextTick = lastLoopTime + 20000 / 25` in bonus time), `:241-273` (the ~15 temp scripts and two `waitForGameUpdate`s run per tick).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/Gang.ts:99-110`
  ```ts
  process(numCycles = 1): void {
    this.storedCycles += numCycles;
    if (this.storedCycles < GangConstants.minCyclesToProcess) return;
    const cycles = Math.min(this.storedCycles, GangConstants.maxCyclesToProcess);   // 25
    ...
      this.processTerritoryAndPowerGains(cycles);
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/data/Constants.ts:12` `CyclesPerTerritoryAndPowerUpdate: 100`; `/home/jubnl/dev/bitburner/bitburner-src/src/engine.tsx:326` `if (Player.gang) Player.gang.process(numCyclesOffline);` (all offline cycles are stored at once; 8 h offline = 144 000 cycles = 1152 s of 25-cycles-per-200 ms bonus time). `Gang.ts:132-137`: respect/money for an update are computed from `member.getTask()` at that update, so members on Territory Warfare earn nothing for those cycles.
- What the script assumes: it can get everyone onto Territory Warfare just before each territory tick and back onto crime right after, with `updateInterval` 200 ms granularity.
- What the game does in bonus time: a territory tick every 4 engine ticks (800 ms). After the first detected tick the script sets `territoryNextTick` 800 ms ahead, but `onTerritoryTick` itself takes several seconds (recruit, ascend, equipment, warfare toggle, set tasks, `nextUpdate`, optimise, `nextUpdate`), during the first ~9 temp scripts of which the members are still on Territory Warfare. The next loop immediately re-triggers the swap (the deadline is already past), and so on.
- Effect: for the whole bonus window the gang alternates "warfare for the first half of a ~5 s cycle, crime for the second half", i.e. roughly half of a 25x-accelerated catch-up (8 h offline -> ~19 min of bonus time == ~8 h of gang production) earns nothing. Log spam of "Assigned N/12 tasks" every few seconds. Power gain is correspondingly high, which is only useful below 100 % territory.
- Suggested change: while `ns.gang.getBonusTime() >= 5000`, do not attempt the pre-tick swap at all (pick one task set - crime, or warfare if territory still matters - and leave it), and run the once-per-tick housekeeping on a wall-clock timer (e.g. every 20 s) instead of per detected tick.

### GG-3: tick tracking by polling instead of `nextUpdate()` counting (low, confirmed)

- Script: `gangs.js:211-237` (every 200 ms: `getGangInformation()` via temp script, plus `getAllGangInformation()` while `!territoryTickDetected`; padding/misfire logic `:26-27, :245-258, :579`).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/Gang.ts:115-120`
  ```ts
  // Handle "nextUpdate" resolver after this update
  if (GangPromise.resolve) { GangPromise.resolve(cycles * CONSTANTS.MilliPerCycle); ...
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Netscript/RamCostGenerator.ts:297` `nextUpdate: RamCostConstants.CycleTiming` (0 GB). Territory is processed when `storedTerritoryAndPowerCycles` reaches 100 (`Gang.ts:180-182`), i.e. on exactly every 10th normal update.
- Effect: two temp-script launches per 200 ms (each `ns.run` + wait + read) purely to notice a change, an estimated deadline with padding that grows to 2 s on misfires, and a 5 s "lost track" fallback - each misfire leaves the gang on Territory Warfare for extra updates (each update on warfare forfeits that update's respect/money for the whole gang, see GG-2).
- Suggested change: once a territory tick has been observed (power change), count `await ns.gang.nextUpdate()` resolutions: set Territory Warfare after the 9th, run `onTerritoryTick` after the 10th. No polling, no padding, exactly one update on warfare per 20 s (the unavoidable minimum: `calculatePower` reads the task at the tick, `Gang.ts:365`).

### GG-4: post-ascension retraining gate is a fixed 200 s (low, confirmed)

- Script: `gangs.js:66` (`min-training-ticks 10`), `:356` (`Date.now() - lastMemberReset[member] < 10 * territoryTickTime` forces `Train ...`), `:63-65, :465-467` (thresholds 1.60 for member 0 down to 1.05 for member 11).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/GangMember.ts:70-72`
  ```ts
  calculateSkill(exp: number, mult = 1): number {
    return Math.max(Math.floor(mult * (32 * Math.log(exp + 534.5) - 200)), 1);
  ```
  `:321-328` ascend sets all `*_exp = 0` then `updateSkillLevels()` -> skill = floor(mult * 1.0) ~= the ascension multiplier. `formulas.ts:75-81`: points gained = `max(exp - 1000, 0)`, mult = `max(sqrt(points/2000), 1)`. Exp per cycle from Train Combat (`GangMember.ts:168-176`, `tasks.ts:358-366`): `25/1500 * 100^0.9 * expMult * ascMult` ~= 1.05 * ascMult per stat.
- What the script assumes: 10 territory ticks of training is "enough" after any ascension.
- What the game does: the exp needed to get back to the pre-ascension skill depends on the previous exp and the new multiplier (e.g. member with mult 7.07 -> 7.42 at 100 k points: ~10 200 exp at ~39 exp/s = ~260 s; a first-time 1.60 ascension of member 0 needs ~2 000 exp at 8 exp/s = ~250 s; a 1.05 ascension of member 11 at low points needs ~2 900 exp at 5.5 exp/s = ~520 s). With the low thresholds the last members re-qualify for ascension within a few minutes of returning to crime (their exp is already past `1000 + 0.1025 * points`), so they cycle through ascension every ~5 min and spend most of their life below their pre-ascension skill.
- Suggested change: record the skill at ascension time and keep the member on training until it has recovered a configurable fraction (e.g. 90 %) of it, rather than a fixed tick count; and treat the 1.05 spacing floor as too low for the same reason (the game's `sqrt(points)` growth rewards frequent ascension, but not with a 200 s blind gate).

### gangs.js - checked and OK (beyond the audit's list)

- Ascending costs `member.earnedRespect` of gang respect only (`Gang.ts:390-404`); faction reputation was already banked per update (`Gang.ts:152-155`), so the recruit guard is the only respect concern - correct.
- Warfare engagement: the player is involved in its own clash (random opponent among gangs with territory > 0) plus any NPC clash that picks it (`Gang.ts:219-235`); win chance `power/(power+other)` (`AllGangs.ts:73-77`); territory swing `min(loser.territory, powerBonus * 0.0001 * (rand + 0.5))` with `powerBonus = max(1, 1 + ln(win/lose)/ln 50)` (`:174-178`); losing also costs `power /= 1.008` (`:286`). An average-win-chance >= 60 % gate therefore has positive expectation. Death roll only on 35 % of clashes, `0.01 (0.005 on win) / def^0.6` per warfare member (`:281-303`): 0.06 % at def 100 - the def guard at `:286` is adequate.
- `warfareFinished` at 100 % territory: `gangs = Names.filter(territory > 0 || g === gangName)` (`:219`) has length 1, so no clashes occur and stopping the swap is right.
- Wanted management: with the multiplicative decay `(old + gain*cycles) * (1 - 0.001*justice)` applied once per update (`Gang.ts:157-167`), the "recover / sustain / allow" bands around a 1 % penalty are workable; in practice the top tasks' wanted/respect ratio (e.g. Terrorism at ~1000 stats: ~0.044 wanted vs ~78 respect per cycle) keeps the penalty far below 1 % without vigilante work.
- Equipment: 0.2 %/tick default (`:18`), divided by 100 until "established" (`:498-505`), means no equipment until >= $1 B cash / $1 M/s gang income. Given non-augmentation equipment multiplies both skill and exp gain (`GangMember.ts:79-84, 141-150`) and the full set is ~x3.2 str/def per member for ~$755 M before the respect/power discount (`upgrades.ts:34-160`, `Gang.ts:407-416`), this is conservative but defensible while the money is better spent elsewhere; not counted as a finding.

---

## sleeve.js

### SL-1: "sync first, then Homicide for karma" is the slowest possible karma plan and cannot work at fresh stats (high, confirmed)

- Script: `sleeve.js:289-291`
  ```js
  const wantKarmaCrime = !playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000;
  if (sleeve.sync < 100 && (options['sync-first'] || wantKarmaCrime))
      return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], ...];
  ```
  and `:373-374` (`return await crimeTask(ns, 'Homicide', ...)` with the comment "Ignore chance - even a failed homicide generates more Karma than every other crime").
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Work/SleeveSynchroWork.ts:13-18`
  ```ts
  process(sleeve: Sleeve, cycles: number) {
    sleeve.sync = Math.min(100, sleeve.sync + calculateIntelligenceBonus(Player.skills.intelligence, 0.5) * 0.0002 * cycles);
  ```
  (0.0002/cycle = 0.001/s; 1 -> 100 takes ~99 000 s = 27.5 h; in BN10 sleeves start at `sync = max(25, sync)`, `PlayerObjectGeneralMethods.ts:150-154`, still ~21 h). Sleeve sync starts at `max(memory, 1)` on every BitNode (`Sleeve.ts:253`).
  `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts:44-48`
  ```ts
  const success = Math.random() < crime.successRate(sleeve);
  if (success) {
    Player.karma -= crime.karma * sleeve.syncBonus();
    Player.numPeopleKilled += crime.kills;
  } else gains.money = 0;
  ```
  - karma only on success, scaled by sync. `/home/jubnl/dev/bitburner/bitburner-src/src/Crime/Crime.ts:120-135` success = `(2*str + 2*def + 0.5*dex + 0.5*agi + 0.025*int) / 975 / 1 * mults` for Homicide (`Crimes.ts:139-160`), i.e. ~0.5 % for a fresh sleeve (all stats 1, `Sleeve.ts:227-240` prestige zeroes exp). `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Player/PlayerObjectGangMethods.ts:12-28`: outside BN2 a gang needs SF2 and karma <= -54 000.
- What the script assumes: karma from sleeve crime is worth waiting for full sync, and Homicide gives karma even on failure.
- What the game does: sleeve karma rate = `3 * successChance * sync/100` per 3 s attempt. Eight fully-synced fresh sleeves add ~0.04 karma/s to the player's own ~1 karma/s (crime.js homicide). Even for the idealised case of 100 % success the plan ranks: no sync at all ~14 h to -54 k (8 sleeves + player), ~3.5 h sync then crime ~10.7 h, sync-to-100-first (what the script does) ~29 h.
- Effect: in every BitNode other than 2 where SF2 is owned and no gang has been formed yet (i.e. the first many hours of most runs, or the whole run when the player never reaches -54 k karma), all sleeves sit on Synchronize for ~21-27 h doing nothing else - no shock recovery, no faction work, no bladeburner infiltration, no training. Origin: upstream `sync-first` legacy behaviour, narrowed by the branch to exactly the common case.
- Suggested change: never block on sync. Treat karma-Homicide as a filler task that requires `successChance * sync/100` above a small threshold (or above the player's own rate / numSleeves); otherwise fall through to the productive tasks. Fix the comment at `:374`.

### SL-2: training can never happen under the default gates, so sleeves never gain stats (high, confirmed)

- Script: `sleeve.js:22` (`training-cap-seconds` 7 200 s since node reset), `:29` (`train-max-shock` 10), `:208-213` (`canTrain` requires `timeInBitnode < cap`), `:310-312` (`sleeve.shock <= train-max-shock`), `:4-5, :293-304` (shock recovery only above 97 %, then a 5 %/min lottery).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Sleeve.ts:68` (`shock = 100`), `:251` (`this.shock = 100` on SF prestige), `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:150-154` (BN10 only: `shock = Math.min(25, shock)`). Fastest possible shock decay:
  `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Work/SleeveRecoveryWork.ts:12-16` `sleeve.shock - 0.0002 * intBonus * cycles` plus `Sleeve.ts:269-272` `this.shock - 0.0001 * intBonus * cyclesUsed` while working = 0.0003/cycle = 0.0015/s.
  So 100 -> 10 needs >= 60 000 s (16.7 h) of full-time recovery; 25 -> 10 (BN10) needs >= 10 000 s (2.8 h); both exceed the 7 200 s cap, and the script only recovers full-time above 97 % anyway (passive + 5 % lottery ~= 0.00055/s -> 7.6 h for 25 -> 10).
  Alternative exp sources at stat ~1 / shock >= 90 are ~0: faction security 1.5 exp/s x shockBonus (`Work/Formulas.ts:49-55, :92-97`, `SleeveFactionWork.ts:31-33`); failed crime 0.25 x 2 exp x shockBonus (`SleeveCrimeWork.ts:29-31, :49`); exp copied from other sleeves is x sync x shock (`Work.ts:24`). Gym numbers: Powerhouse `costMult 20, expMult 10` (`LocationsMetadata.ts:322-327`), gym class `money: -120, strExp: 1` per second (`ClassWork.tsx:53-72`, `Work/Formulas.ts:100-120`): $2 400/s for 10 exp/s x shockBonus.
- What the script assumes (branch): training is only worth it below 10 % shock, and (upstream) only in the first 2 h of a node.
- What the game does: the two gates are mutually exclusive for the entire run; sleeves keep stats ~1. Consequences at stat 1: faction rep `0.9*(1+1+1+1+...)/975/4.5` ~= 0.001 per cycle (`PersonObjects/formulas/reputation.ts:26-38`) -> ~4-15 rep/h per sleeve (x shockBonus) against 10^4-10^6 rep requirements, so `--max-faction-sleeves` and follow-player are effectively no-ops; Homicide success ~0.5 % (SL-1); the per-sleeve bladeburner contract gate `>= 0.99` (`:45, :399`) is never met, so sleeves 1-3 always fall back to Infiltrate. Origin: branch (`train-max-shock`); upstream trained at 97-100 % shock (0-3 % efficiency), which is what the branch was trying to avoid.
- Suggested change: gate training on shock < 100 (exp is exactly 0 at 100, `Sleeve.ts:173-175`), or better on cost per exp (`$2400 / (10 * shockBonus)` per exp) against current cash, and drop or greatly extend `training-cap-seconds`. At shock 90 a sleeve reaches str 105 in ~3.8 h for ~$33 M, which is cheap once the BN is under way; at shock 50 in ~45 min.

### SL-3: sleeve 6 on Field Analysis (and sleeve 5 always on Diplomacy) instead of Infiltrate (medium, confirmed)

- Script: `sleeve.js:378-386` (`/*5*/["Diplomacy"], /*6*/["Field Analysis"]`), `:407-408` (Diplomacy escalation by chaos already exists: sleeve i switches at chaos > (10-i)*10).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Bladeburner.ts:1124-1143` Field Analysis: `eff = 0.04*hack^0.3 + 0.04*int^0.9 + 0.02*cha^0.3` (%), rank via `calculateActionRankGain` = `0.1 * BladeburnerRank` (`Bladeburner/Formulas.ts:12-13`), 30 s (`GeneralActions.ts:13-15`). At sleeve stats ~1 (SL-2): +0.1 rank and +0.06 % estimate per 30 s.
  `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Bladeburner.ts:1253-1261`
  ```ts
  const infilSleeves = Player.sleeves.filter((s) => isSleeveInfiltrateWork(s.currentWork)).length;
  const amt = Math.pow(infilSleeves, -0.5) / 2;
  for (const contract ...) this.contracts[contract].count += amt;
  for (const operation ...) this.operations[operation].count += amt;
  ```
  per infiltrating sleeve per 60 s (`SleeveInfiltrateWork.ts:7`), i.e. total `sqrt(n)/2` per minute to every contract and operation. Natural count growth is `growthFunction()/480` per second (`Bladeburner.ts:1388-1393`): Assassination avg 0.13/min, Stealth Retirement 0.13/min, Raid 0.26/min (`Operations.ts:146, 187, 225`).
- What the script assumes: a variety of sleeve tasks is "probably useful".
- What the game does: going from 5 to 6 infiltrating sleeves adds ~0.10 count/min to each action type; at 44 rank per Assassination (`Operations.ts:202`) and 22 per Stealth Retirement that is >= 4-7 rank/min even if only those two are consumed, versus 0.2 rank/min from Field Analysis. The player's own Field Analysis (script-driven, with real hacking/int) is the tool for population uncertainty; a stat-1 sleeve's 0.06 % per 30 s is noise against 0.4-0.8 % per Investigation/Undercover success (`Bladeburner.ts:805-822`). Sleeve Diplomacy at cha 1 is `1^0.045 + 1/1000` ~= 1.0 % per 60 s in the player's current city (`Bladeburner.ts:737-745, 1187-1189`) - useful only when chaos is a problem, which the `:407` escalation already handles.
- Suggested change: default sleeves 5 and 6 to Infiltrate Synthoids; keep the chaos-based Diplomacy escalation (it already reaches sleeves 7..0 as chaos rises).

### SL-4: per-second loop re-fetches constants (low, confirmed)

- Script: `sleeve.js:185` (`getNumSleeves()`), `:197` (`getResetInfo()`), `:190` (`getCurrentWork()`), `:238` (`getSleeve(i)` for all), `:222-233` (4 bladeburner temp scripts) every 1 000 ms.
- Game source: `lastNodeReset` / `bitNodeOptions` never change within a node; `Player.sleeves.length` changes only on a Covenant purchase (`SleeveCovenantPurchases.tsx`, BN10 only). `getSleeve` costs `SleeveBase` 4 GB (`RamCostGenerator.ts:408`) - one temp script for all sleeves, fine.
- Effect: ~8-12 temp-script launches per second for a decision that changes on the order of minutes. Not wrong, just wasteful; at low home RAM each launch that fails is retried with back-off (`helpers.js:466-510`).
- Suggested change: fetch `getResetInfo` once (and on `lastNodeReset` change), `getNumSleeves` every ~60 s, and raise `interval` to 5-10 s except when a sleeve has a pending task change.

### sleeve.js - checked and OK

- `costByNextLoop` at `:195` uses $12 000/s per training sleeve; the real Powerhouse cost is $2 400/s (`ClassWork.tsx:56` x `LocationsMetadata.ts:324`). Over-reservation only (and the code comment already says so).
- Aug purchases: sleeves pay `aug.baseCost` with no price escalation (`NetscriptFunctions/Sleeve.ts:225-241`, `Sleeve.ts:392-400`), require shock 0 (`Sleeve.ts:356-361`), and every install zeroes all sleeve exp (`Sleeve.ts:215-225`) - buying cheapest-first in batches of 20 at shock 0 is the right shape.
- Shock/sync effects are correctly understood in the comments: class/crime/faction/company/bladeburner exp x shockBonus (`SleeveClassWork.ts:31-33`, `SleeveCrimeWork.ts:29-31`, `SleeveFactionWork.ts:31-37`, `SleeveCompanyWork.ts:31-38`, `SleeveBladeburnerWork.ts:55`), faction rep x shockBonus (`SleeveFactionWork.ts:35-37`), karma and player-copied exp x sync (`SleeveCrimeWork.ts:46`, `Work.ts:20-24`). Bladeburner rank from sleeve contracts is *not* shock-scaled (`Bladeburner.ts:950-952` `changeRank(person, gain)`), which is why low-shock is irrelevant for the infiltrate path.
- On an augmentation install (not a source-file reset) sleeves keep exp, shock and sync and are merely put back on recovery/sync (`PlayerObjectGeneralMethods.ts:120`), so within a node the sleeves do improve across installs - which makes SL-2's 2 h cap even less appropriate.

---

## bladeburner.js

### BB-1: BlackOp go/no-go uses `max(lo, hi)`, which is `real x pop/popEst` when the population is under-estimated (high; mechanism confirmed, frequency estimated)

- Script: `bladeburner.js:247-252`
  ```js
  const blackOpsChance = nextBlackOp === null || rank < blackOpsRanks[nextBlackOp] ? [0, 0] :
      (([lo, hi]) => [Math.max(lo, hi), Math.max(lo, hi)])((await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Black Operations", [nextBlackOp]))[nextBlackOp]);
  ```
  consumed via `getChance`/`getTargetLevel` at `:263, :311-315, :413` with `--blackop-success-threshold 0.99`.
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Actions/BlackOperation.ts:55-57` `getPopulationSuccessFactor(): number { return 1; }` (est == real, so `diff = 0`), then `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Actions/Action.ts:153-167`
  ```ts
  const est = this.getSuccessChance(bladeburner, person, { est: true });
  const real = this.getSuccessChance(bladeburner, person);
  const diff = Math.abs(real - est);
  let low = real - diff; let high = real + diff;
  let r = city.pop / city.popEst;
  if (r < 1) { low *= r; } else { high *= clampNumber(r); }
  return [clamp(low), clamp(high)];
  ```
  So the pair is `[real*r, real]` when popEst > pop and `[real, real*r]` when popEst < pop. `pop` moves without `popEst` on random events every 240-600 s (`Bladeburner.ts:657-669` "+8-24 % new synthoids", `:613-624` new community +10-20 %, `:564-587` migration 3-15 %, plus Bounty/Retirement/Sting/Raid effects that do update the estimate) - `r` drifts by tens of percent. `getActionEstimatedSuccessChance` returns exactly this range (`NetscriptFunctions/Bladeburner.ts:138-143`).
- What the script assumes (comment at `:247-250`): "one end of the pair is the true chance; we use the max (exact when the population is over-estimated, optimistic otherwise)".
- What the game does: `max` is exact only for r <= 1. For r > 1 it is `real * r`, unbounded except by the clamp to 1. Worse, the script's own population-uncertainty detector (`:297`, any regular action with `max > threshold > min`) is silent precisely in this case: when all regular ops are already at 100 % (late game, exactly when BlackOps are attempted) they report `[1, 1]` for r > 1 (both ends clamp) and `[r, 1]` only for r < 1 - so under-estimation is never corrected.
- Effect: with r = 1.3 a 77 %-real Daedalus shows as `[0.77, 1.0]` -> `max` = 1.0 -> attempted at 77 %. A failed BlackOp costs `rankLoss` (10 000 for Daedalus, 20 000 for Vindictus) and `hpLoss * difficultyMult` damage with hospitalisation (`BlackOperations.ts:705-711`, `Bladeburner.ts:1053-1069`), and forfeits a team member (`TeamCasualties.ts:34-38`, min 1 for BlackOps). Origin: branch (the upstream code used `[0]`).
- Suggested change: use `min(lo, hi)` as the go/no-go value (exact for r >= 1, merely conservative for r < 1), and when `hi > threshold > lo` for the BlackOp, run Field Analysis (or Investigation/Undercover) in the current city until the pair collapses - both move `popEst` toward `pop` in either direction (`City.ts:46-58`), so `lo == hi` guarantees the estimate is exact.

### BB-2: Tracking cannot resolve population uncertainty (medium, confirmed)

- Script: `bladeburner.js:185` (`populationActions = ["Undercover Operation", "Investigation", "Tracking"]`), `:297-315` (when `populationUncertain`, candidates are only these three; the first with count and `maxChance` above threshold is run), `:327-329` (Field Analysis only if none qualifies).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Bladeburner.ts:874-879`
  ```ts
  case BladeburnerContractName.Tracking:
    city.improvePopulationEstimateByCount(getRandomIntInclusive(100, 1e3) * this.getSkillMult(BladeburnerMultName.SuccessChanceEstimate));
  ```
  `City.ts:35-43` moves `popEst` by that absolute count; populations are `[1e9, 1.5e9]` at creation (`City.ts:19-23`) with an initial estimate error of up to 50 %. Investigation / Undercover move the estimate by 0.4 % / 0.8 % per success (`:805-822`); Field Analysis by `eff` % per 30 s (`:1126-1143`).
- What the script assumes: Tracking is a population-estimate action.
- What the game does: 100-1000 people per success against an error of 10^8 - it would take >10^5 successes. Tracking is also the easiest action (baseDifficulty 125, `Contracts.ts:16`), so it is almost always above threshold and becomes the branch's steady state whenever Undercover/Investigation are not.
- Effect: while the highest-rank ops sit at e.g. `[0.8, 0.96]` around a 0.9 threshold, the script farms 0.3-rank Tracking (12.5 s base) instead of ~0.4-2 % per 30 s of Field Analysis that would unblock them in minutes.
- Suggested change: drop Tracking from `populationActions`; in the uncertain branch compare estimate-improvement per second (Undercover 0.8 %/actionTime, Investigation 0.4 %/actionTime, Field Analysis `eff`/30 s using the player's real hacking/int/cha) and pick the best, breaking ties toward the one that also gives rank.

### BB-3: chaos between 50 and `--max-chaos` is tolerated at a `sqrt(1 + chaos - 50)` difficulty multiplier (low, confirmed)

- Script: `bladeburner.js:282-288` (Stealth Retirement only if `minChance > 0.99`; Diplomacy only above `max-chaos` 100), `:231-236` (city choice prefers chaos <= 50, but falls back to the highest-population city regardless when no city qualifies).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Actions/Action.ts:94-103`
  ```ts
  if (city.chaos > BladeburnerConstants.ChaosThreshold) {   // 50
    const diff = 1 + (city.chaos - BladeburnerConstants.ChaosThreshold);
    return Math.pow(diff, 0.5);
  ```
  applied as `difficulty *= ...` (`:181`), so chance /= 1.41 at chaos 51, /5.1 at 75, /7.1 at 100. Passive decay is 0.0001/s (`Bladeburner.ts:1399`); Sting adds +0.1 flat per completion (`:830`), Bounty/Retirement +0.02/+0.04 per success (`:882, :886`), Raid +1-5 % (`:846`), riots +1 and +5-20 % (`:680-686`), Incite +10 + chaos/log10(chaos) to every city (`:1231-1235`). Diplomacy removes `cha^0.045 + cha/1000` % per 60 s (`:737-745`): ~1.8 %/min at cha 500, ~2.9 %/min at cha 1500.
- What the script assumes: chaos only needs active treatment above 100, or when a >= 99 % Stealth Retirement is on hand.
- What the game does: the penalty is a cliff at 50, not a gentle slope to 100. With sleeves infiltrating (~1 extra Sting per minute at 4 sleeves) the worked city gains ~6 chaos/h from Stings alone, so over a long run every city can drift past 50; at that point the script keeps running ops at 1/2-1/7 of their chance (i.e. at drastically lower levels, `getTargetLevel` drops `log(penalty)/log(fac)` levels - ~28 levels of Assassination at chaos 75, /39 reward) instead of spending ~25 min of Diplomacy.
- Suggested change: when no city is <= `chaos-recovery-threshold`, compare the rank/s lost to `1/sqrt(1 + chaos - 50)` over the expected stay against Diplomacy's `cha^0.045 + cha/1000` %/min, and run Diplomacy in the chosen city until it drops below 50; lower the Stealth Retirement gate (0.99) to the normal `--success-threshold` when chaos is above 50.

### BB-4: skill-point spending and per-loop fetches (low, confirmed)

- Script: `bladeburner.js:435-461` (per level: `getSkillPoints`, `getSkillLevel` x12, `getSkillUpgradeCost` x12, `upgradeSkill` - 4 temp scripts, `ns.sleep(10)`), `:150-258` (~20 temp scripts per loop, including `getActionMaxLevel` for all 9 actions, `getBlackOpRank`/names per loop, `getCurrentLevel` x2 dicts), `:94` (2 s loop).
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Bladeburner.ts:241-259` - `getSkillUpgradeCost(name, count)` and `upgradeSkill(name, count)` take a count (closed-form cost `Skill.ts:76-81`); `maxLevel` only changes on a success (`Bladeburner.ts:945-949`); `nextUpdate` is 0 GB and resolves on the 1 s bladeburner tick (`Bladeburner.ts:1424-1428`, `RamCostGenerator.ts:375`).
- Effect: after a hash exchange or offline catch-up with hundreds of SP, hundreds of loop iterations x 4 temp scripts (each `BladeburnerApiBase` 4 GB + 1.6 GB base); the main loop runs ~10 temp scripts per second continuously even while an action with a known end time is running.
- Suggested change: buy in bulk (`count = floor(availableSP / marginalCost)`-ish, or at least all levels of the chosen skill up to the next perceived-cost crossover); cache max levels / blackop ranks and refresh on success; sleep on `min(update-interval, nextTaskComplete)` is already right - add `await ns.bladeburner.nextUpdate()` before re-reading state.

### bladeburner.js - checked and OK

- Action ordering "highest rep first" (`:119-120, :183-184`) also matches rank per second at level 1: Raid 55/80 s, Assassination 44/150 s, Stealth Retirement 22/100 s, Sting 5.5/65 s, Undercover 4.4/50 s, Investigation 2.2/40 s, Bounty 0.9/25 s, Retirement 0.6/20 s, Tracking 0.3/12.5 s (`Operations.ts`/`Contracts.ts` `rankGain`, `baseDifficulty`, `Action.ts:105-121` time = difficulty/10 / statFac). Raid is deliberately reserved because each success removes 1 % of the city's population and a community (`Bladeburner.ts:832-847`), which feeds `(pop/1e9)^0.7` (`Action.ts:88-92`).
- `--success-threshold 0.9`: expected rank per attempt is `p*gain - (1-p)*loss` with `gain, loss` both x `rewardFac^(L-1)` (`Bladeburner/Formulas.ts:16-27, :30-39`) while time grows x `difficultyFac^(L-1)`; for Assassination `rewardFac/difficultyFac^2 = 1.0146`, so pushing a level or two below 100 % is roughly neutral (+0.5-2 %) before HP/stamina costs. 0.9 is a sensible default.
- Stamina: penalty is `min(1, stamina / (0.5 * maxStamina))` (`Bladeburner.ts:167-169`) - the 0.5/0.6 hysteresis keeps the script entirely out of the penalised region at no cost.
- Skill priorities: the greedy "lowest perceived cost" spreads levels ~proportionally to `1/(adj * costInc)`; Cloak (5.5 % stealth, costInc 1.1) and Overclock (-1 % time, max 90) still receive the most levels despite the adjustments, which is right for the stealth-heavy op list (Assassination, Stealth Retirement, Sting, Undercover, Investigation, Tracking and most BlackOps are `isStealth`).
- `startAction` cancels the player's current work unless The Blade's Simulacrum is owned (`Bladeburner.ts:178-180`) and the reverse (`:1356-1368`) - `canDoBladeburnerWork` handles both directions correctly.

---

## Efficiency summary (question 4)

- gangs.js: 5 temp-script launches/s baseline (10/s while re-detecting the tick) purely for change detection, ~15 per territory tick, 2 x `nextUpdate` waits per tick. `nextUpdate()` counting (GG-3) would remove the polling entirely. Per-member computations in `optimizeGangCrime` (100 shuffles x 12 members x ~20 tasks) are trivial CPU.
- sleeve.js: ~8-12 temp scripts/s (SL-4). The per-sleeve state is otherwise cached sensibly (augs 60 s, crime stats forever, faction candidates 5 min).
- bladeburner.js: ~20 temp scripts per 2 s loop (BB-4); the skill loop is the worst offender after an SP windfall. Loop cadence vs game tick: bladeburner ticks once per second (`Bladeburner.ts:1376-1380`), gang every 2 s (`Gang.ts:101`), sleeves every 1 s (`Sleeve.ts:265-268`); the scripts' 2 s / 1 s / 200 ms intervals are fine in themselves - the cost is the temp-script fan-out per iteration, not the interval.

## Progression traps (question 5)

1. SL-1: all sleeves synchronise for a day in the common "SF2 owned, no gang yet" state.
2. SL-2: sleeves never gain stats in any node, so every stat-scaled sleeve feature added on this branch (faction rep sleeves, follow-player, darknet charisma study, sleeve contracts) is inert.
3. BB-1: a BlackOp can be launched at 70-80 % real chance while reporting 100 %; late-game BlackOps punish that with 10-20 k rank and hospitalisation.
4. GG-2: the gang's offline catch-up (the single largest income event after a long absence) is spent mostly on Territory Warfare.
5. BB-3 (slow): chaos creep past 50 in all cities silently collapses op levels.

## What is well done (question 6)

- gangs.js: gain formulas are an exact transcription (already audited); the ascend/recruit guard, the equipment-near-ascension guard, the `nextUpdate()` fast path, the engage/disengage rule and the low-defense warfare guard are all consistent with `Gang.ts`; the wanted bands work because the top tasks' wanted/respect ratio is tiny.
- sleeve.js: faction one-sleeve-per-faction bookkeeping (`factionBySleeve`), batching aug purchases at shock 0 at base cost, shock-gating the extra faction sleeves, the per-sleeve v3 `getActionEstimatedSuccessChance(type, name, sleeve)` use, and the sqrt-aware "infiltrate is the default" for bladeburner.
- bladeburner.js: the level-tuning model (`difficultyFac`, `min(1, competence/difficulty)`), the stamina hysteresis, the chaos-aware city choice, the Incite guard, the Raid/population reasoning, BlackOp ordering by required rank, and the 0.9 threshold rationale are all correct against the v3.0.1 source.

---

# Section 4: Darknet crawler

Scope: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet.js`, `darknet/{agent,lib,solvers,crack,cache,realloc,phish,migrate,promote,stasis,lab}.js`, the `daemon.js` launch and the `stockmaster.js` promote feed, compared with `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/**` and `src/NetscriptFunctions/Darknet.ts`. Findings already listed in `docs/audit/2026-09-15-in-game-audit.md` (DN-F1..F9) are not repeated; several findings below build on the post-fix code (commits `bdeae49`, `3011bb0`, `bb21fd9`, `70c78b5`, `2e40e1f`).

Read-only review; nothing was modified.

## Summary

| Sev | ID | Finding | Status |
|---|---|---|---|
| high | R1 | After every state wipe the controller assumes the *first* labyrinth is current; once `TheBrokenWings` is installed nothing in the planner can ever discover the real lab (air-gap migrations are only planned for rows below the assumed lab depth 7) | confirmed |
| high | R2 | `balanced` mode can never flip to `labyrinth` for the third labyrinth onward: the frontier is capped at depth 7 by the row-8 air gap, and air-gap migrations are only planned in labyrinth mode | confirmed |
| high | R3 | The air-gap migration target can be (and in practice often is) a stasis-pinned host; a linked server is immutable, so the migration charge fills, silently resets and starts over forever | confirmed |
| high | R4 | `crack.js` calls `heartbleed` after every failed attempt even for the 13 feedback-free models; the heartbleed charisma gate then aborts cracks that `authenticate` alone would finish, dictionary cracks cost 2.5× the necessary time, and the agent relaunches a doomed crack every 4 s | confirmed |
| high | R5 | `lab.js` pays two full lab authentication delays per step (`labreport` + `authenticate`) although the `authenticate` response already carries the new coordinates and the 3×3 wall window | confirmed |
| medium | R6 | A crack claim expires after 2 min while oracle cracks run 4–30 min; adjacent agents then start duplicate cracks whose interleaved heartbleed logs make each other fail with `timeouts` | confirmed |
| medium | R7 | Walk hosts have every filler evicted but the walker is capped at `--lab-threads 6`, leaving most of the host idle although the lab auth delay keeps shrinking with threads | confirmed |
| medium | R8 | The three walkers are deterministic duplicates (same start cell on the first three labs, same tie-break), so `--lab-walkers 3` triples RAM for no exploration gain | confirmed |
| medium | R9 | Filler economics are inverted: phishing's cache stream saturates at ~4–10 threads network-wide and its money is negligible, promote out-yields phish per GB in charisma XP and adds up to 4× volatility on held stocks but is capped at 4 threads on ≥64 GB hosts, and `share` zeroes phish entirely | confirmed (formulas) / suspected (stock profit magnitude) |
| medium | R10 | Island migration as implemented can never succeed: `induceServerMigration` needs a direct connection to the target, an island has none, and self-migration is refused | confirmed |
| medium | R11 | Charisma goal and walker gate are off by one: the game's underleveled auth penalty (≥2.5×) applies at `charisma <= required`, so walkers launched at exactly `lab.cha` crawl at 2.5× | confirmed |
| low | R12 | `--crack-threads`/`--lab-threads` and the 64 GB promote floor are tuned without regard to the game's RAM tiers and thread curve | confirmed |
| low | R13 | `pushFiles` re-scp's identical `passwords.txt`/`cmd.txt` to every host every loop | confirmed |
| low | R14 | `2G_cellular` could use the timing side channel instead of heartbleed (2.5× faster) | confirmed |

---

## 1. Economics: yield per worker type

All rates below are from the game formulas cited; `C` = player charisma, `d` = server difficulty, player multipliers and BitNode `DarknetMoneyMultiplier` taken as 1.

| Worker | GB/thread | Delay per call | Yield per call per thread | Source |
|---|---|---|---|---|
| phish | 3.65 | `max(10000·400/(400+C), 200)` ms | money chance `0.05·(200+C)/200` (not thread-scaled), money `500·(0.1+0.05·depth)·t·(400+C)/400·[0.9,1.2]`; cache chance `0.005·t·(400+C)/400` under a **global 3-minute cooldown**; XP `50·t` on success, `12.5·t` otherwise | `effects/phishing.ts:12-73` |
| promote | 3.65 | `max(8000·600/(600+C), 200)` ms | volatility charge `t·(500+C)/500`; XP `10·t·(200+C)/200`; charges decay ×0.4 every stock cycle (75 ticks × 6 s = 450 s) | `NetscriptFunctions/Darknet.ts:590-601`, `effects.ts:197-201`, `StockMarket/StockMarket.ts:231,264`, `StockMarket/data/Constants.ts:4-6` |
| realloc | 2.65 | `max(8000·500/(500+C), 200)` ms | frees `0.02·2·0.92^(d+1)·t·(1+C/100)` GB; XP `10·t·1.1^(d+1)`; **guaranteed cache** when the block hits 0 (+15 % STORM_SEED) | `Darknet.ts:536`, `effects/ramblock.ts:21-82` |
| migrate | 5.65 | 6000 ms | charge `(C+500)/(200d+1000)·0.01·t`; XP `5·t·d` | `Darknet.ts:444`, `effects.ts:245-262` |
| crack | 2.95 | `850·(5·chaReq+(d+1)·100)/(C+150)·[underleveled]·/(1+0.2(t-1))` ms per attempt, ×1.5 for each heartbleed | XP `(3+1.1^d)·t` per failed attempt, ×10 on first success; cache chance `0.1·1.05^d` on first success | `effects.ts:60-121`, `effects.ts:33-46`, `Darknet.ts:240-242` |
| stasis | 13.65 (one-shot) | `30000·1000/(C+1000)` ms | immunity to move/restart/delete/disconnect + `backdoorInstalled` | `effects.ts:218-243`, `NetworkMovement.ts:227-228` |
| share | 4.0 | 10 s | rep bonus `1 + ln(totalShareThreads)/25` (logarithmic in the whole network) | `NetworkShare/Share.ts:43-49` |
| lab walk | 3.95 | 2 × lab auth delay per step (see R5) | XP `(3+1.1^10)·t` per move, `×10·32` once on the win; the reward augmentation | `labyrinth.ts:306-323`, `Darknet.ts:666-667` |

Worked numbers at `C = 300`, depth/difficulty 5–6:

- phish: 5.7 s/call, `p = 0.125`, money ≈ 40 $/call/thread ≈ **7 $/s/thread ≈ 1.9 $/s/GB** (irrelevant next to hacking); XP ≈ 3.0 xp/s/thread; cache chance 0.00875/call/thread.
- The cache stream is the only thing phishing is really for, and it is cooldown-bound: rate per thread = `0.005·(400+C)²/(400·4000)` /s = `3.1e-9·(400+C)²` → one cache per 180 s needs **~7 threads at C=100, ~4 at C=300, 1 at C≥1000**. Every phish thread beyond ~10 network-wide adds only pennies and XP.
- promote: 5.3 s/call, XP 4.7 xp/s/thread (**≈1.6× phish**, and the ratio grows with charisma: 20 vs 8.3 xp/s at C=1000). Steady-state volatility charge per thread per symbol ≈ `1.67 × 135 ≈ 225` → ~9 threads/symbol reach a 2.6× volatility multiplier, ~22 threads/symbol ≈ 3.05×, asymptote 4×. Volatility multiplies the per-tick price move (`StockMarket.ts:264`), so with a correct stockmaster forecast the profit on a held position scales roughly linearly with it.
- realloc: 5 s/call; 50 threads at d=6 free ≈ 4 GB/call, so a 32 GB block clears in ~40 s and pays a guaranteed cache worth `1.2^d·1e7·(200+C)/200` ≈ 62 M at d=5 when the money option is rolled (`cacheFiles.ts:163-175`, 1 of 4–5 options). Realloc is clearly the best first spend, as the spec's order says.
- crack: cache 10–27 % on first success (`0.1·1.05^d`), plus frontier progress. Right after realloc.

Conclusion on the spending order `realloc, migrate, promote, share, phish` (`agent.js:119-170`): the order is right, the **sizing is not** — see R9. The per-GB ranking is realloc > crack > migrate (when a gap must be crossed) > promote up to ~20 threads/symbol (when stockmaster holds positions) > phish up to ~10 threads network-wide > everything else, and "everything else" is nearly worthless whether it goes to phish or share.

---

## 2. Findings

### R1 (high, confirmed): after any state wipe the planner assumes `th3_l4byr1nth` and can never learn otherwise
- Script: `darknet.js:626-643` (`recomputeCompleted` falls back to `state.passwords`), `:647-657` (`currentLab` → `LABS[Math.min(done.length, …)]`; `details.isOnline` is always true for every lab, as the code's own comment says), `:699-701` (`for (const row of AIR_GAP_ROWS) { if (row >= lab.depth) continue; …}`), `:88-95` (prestige → `emptyState`).
- Game: `labyrinth.ts:434-473`
  ```ts
  const getCurrentLabName = () => {
    if (!hasAugment(AugmentationName.TheBrokenWings)) return SpecialServers.NormalLab;
    if (!hasAugment(AugmentationName.TheBoots)) return SpecialServers.CruelLab;
  ```
  `NetworkGenerator.ts:235-248` (all eight labs are created at once, `depth: -1`, `isStationary: true`; the only place that sets a depth is `addServerToNetwork`, `:213`, never called for a lab), `NetworkGenerator.ts:225-231` (the current lab is wired only to servers at `depth === getNetDepth()-1`), `darknetNetworkUtils.ts:414-432` + `:501` (no server ever sits on rows 8/16/24/32), `NetworkGenerator.ts:192-200` and `darknetNetworkUtils.ts:447-461,478-483` (connections only ever join rows `x±1`, so rows 7 and 9 are never connected), `Prestige.ts:76` + `SaveObject.ts:561-562` (the darknet is regenerated for the new lab on every reset).
- What the script assumes: `state.labs.completed` survives, or an agent will eventually probe a server adjacent to the real lab.
- What the game does: every augmentation install wipes the darknet and this state; the second lab (`cru3l`, depth 12) is wired to depth-11 servers, which lie beyond the row-8 air gap; nothing but a migration of an agent-carrying host crosses a gap.
- Effect: from the first reset after `TheBrokenWings` onward, `currentLab` = lab 1 (depth 7, cha 300) → `chooseMode` flips to labyrinth immediately, `planLabyrinth` skips every air gap (`8 >= 7`), no host adjacent to `th3_l4byr1nth` ever exists, no walker is launched, the charisma goal is 300 instead of 600, and `observedLab` never fires because nothing ever reaches depth 11. Permanent stall in every later reset (only a random game-driven island move of an agent host past the gap, `NetworkMovement.ts:64-70`, can break it).
- Suggested change: infer the current lab from what the network shows without needing to reach it. Cheapest: `difficulty` is uniform in `[0, getNetDepth())` (`NetworkMovement.ts:194`) and is reported for every probed neighbour, so `maxObservedDifficulty + 1` is a lower bound on the net depth → current lab = first `LABS` entry with `depth > maxObservedDifficulty`. Exact: read owned augmentations once at start (`getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)')`) and mirror `getCurrentLabName` (including the BN15 branch). Also make `planLabyrinth` consider every air gap below the *inferred* lab.

### R2 (high, confirmed): `balanced` never enters labyrinth mode for labs at depth ≥ 19
- Script: `darknet.js:719-737` (`chooseMode`: `frontierDepth(state) >= lab.depth - LAB_DEPTH_SLACK` with slack 6, else needs a `migrationCharge`), `:562-598` (`planLoot` only migrates islands), `:699-709` (air-gap migrations exist only in `planLabyrinth`), `:458-466` (`frontierDepth` = max known depth).
- Game: same topology citations as R1 — `darknetNetworkUtils.ts:501` `isOnAirGap = !!x && !(x % 8)`, `:420` positions exclude gap rows, `NetworkGenerator.ts:192-200` adjacent-row connections only.
- What the script assumes: the frontier can creep to within 6 rows of the lab by cracking alone.
- What the game does: without a migration nothing is reachable beyond row 7, so `frontierDepth ≤ 7`. `m3rc1l3ss` (19), `ub3r` (23), … need `frontier ≥ 13/17/…`.
- Effect: with R1 fixed, from the third lab on the controller sits in loot mode forever (walkers and gap crossings never planned) unless the user pins `--mode labyrinth`.
- Suggested change: trigger labyrinth mode (or at least air-gap migration planning) when the frontier is blocked by a gap, i.e. `frontierDepth === row - 1` for some gap row `< lab.depth`, regardless of slack; or plan gap migrations in both modes.

### R3 (high, confirmed): the migration target may be a stasis-pinned host, which cannot move
- Script: `darknet.js:688-697` (labyrinth-mode stasis: lab-adjacent hosts, else `deepest` reachable hosts), `:699-709` (migration candidates: every live host with `difficulty + 4 > row`, sorted by difficulty, **no exclusion of `plan.stasisTargets` or currently linked hosts**), `:766-769` (`buildCmd` gives each charger to the first target listing it).
- Game: `effects.ts:257-260`
  ```ts
    if (newCharge >= 1) {
      moveDarknetServer(server, 2, 4);
      DarknetState.migrationInductionServers.set(server.hostname, 0);
  ```
  `NetworkMovement.ts:227-228, 240-243` (`isImmutable = openServer || isConnectedTo || hasStasisLink`; `moveDarknetServer` returns `false` for an immutable server and the charge is reset to 0 anyway), `darknetNetworkUtils.ts:470` (linked servers are not even "movable").
- What the script assumes: any live host with enough difficulty is a valid target.
- What the game does: a linked host never moves; every full charge (≈ 4 min at 10 threads, C=300, d=6) is discarded.
- Effect: before the first crossing, the stasis candidates are the *deepest* reachable hosts (depth 7) and the migration candidates are the highest-*difficulty* hosts that self-reported neighbours — the same handful of hosts. When they coincide, `migrate.js` (56.5 GB) charges forever, `chooseMode` keeps seeing a "charging" migration, and the gap is never crossed. The test at `test/darknet-controller.test.js:400-414` happens to pick disjoint hosts, so it does not catch this.
- Suggested change: exclude `plan.stasisTargets`, `ns.dnet.getStasisLinkedServers()` and `entry.stasis === true` hosts from migration candidates (and, symmetrically, do not pin the chosen migration target until it has landed beyond the gap — after landing it is the deepest host and gets pinned by the existing rule, which is exactly right).

### R4 (high, confirmed): `crack.js` heartbleeds after every failed attempt, even when no solver needs feedback
- Script: `darknet/crack.js:22-40` (`attemptFn`: after any failed `authenticate`, `heartbleed(target, {peek:true, logsToCapture:1})`; `451 → throw "charisma"`), `darknet/solvers.js:53-60, 387-437` (`dict()` and the 12 direct-decode solvers never read `feedback`), `darknet/agent.js:63-68, 88-93` (the agent reserves RAM for, and launches, a crack on every online uncracked neighbour with no charisma check; `cmd.claimed` excludes the agent's own claim, so it relaunches every loop).
- Game: `NetscriptFunctions/Darknet.ts:93-177` — `authenticate` has **no** charisma gate (only `requireDirectConnection`); `:248-258`
  ```ts
        if (Player.skills.charisma < server.requiredCharismaSkill) {
          ...
            code: ResponseCodeEnum.NotEnoughCharisma,
  ```
  (heartbleed only); `:240-242` heartbleed delay = `1.5 × calculateAuthenticationTime`; `effects.ts:77-78` `underleveledFactor = cha <= chaRequired && depth > 1 ? 1.5 + (chaReq+50)/(cha+50) : 1`; `DarknetServerOptions.ts:67-72` `requiredCharismaSkill ≈ (d/labDepth)^1.5 · labCha · 0.85 ± d..2d` (≈ 200 at d=6 on the first lab, ≈ 500 at d=12 on the second).
- What the script assumes: feedback is needed for every failure, and a 451 from heartbleed means the host is uncrackable.
- What the game does: 13 of 24 models (`ZeroLogon, DeskMemo_3.1, FreshInstall_1.0, Laika4, TopPass, EuroZone Free, CloudBlare(tm), Pr0verFl0, 110100100, OrdoXenos, PrimeTime 2, OctantVoxel, MathML`) are solved by `authenticate` alone; the charisma requirement only blocks heartbleed.
- Effect: (a) a `TopPass` crack (up to 93 attempts) spends 2.5× the necessary time (auth + 1.5 auth per miss); (b) any neighbour with `requiredCharismaSkill > charisma` is unconditionally uncrackable even when its model is feedback-free — and those are exactly the frontier hosts; (c) each such host is retried every 4 s with one full underleveled authenticate (≈ 9 s at 6 threads for d=6, chaReq 200, C=100) plus 11.8 GB reserved (`agent.js:83`) that starves fillers, forever.
- Suggested change: in `crack.js`, only call `heartbleed` when the model is in the oracle set (`NIL, 2G_cellular, AccountsManager_4.2, BellaCuore, BigMo%od, Factori-Os, DeepGreen, RateMyPix.Auth, PHP 5.4, KingOfTheHill, OpenWebAccessPoint`); have the controller put `charisma` into `cmd.txt` so the agent skips (and does not reserve RAM for) oracle-model hosts with `requiredCharismaSkill > charisma`, and prefers hosts with `requiredCharismaSkill < charisma` (the ≥2.5× underleveled penalty) when ordering cracks. Deprioritising feedback-free hosts above the charisma bar is unnecessary — they should be cracked first.

### R5 (high, confirmed): every labyrinth step costs two lab authentication delays
- Script: `darknet/lab.js:160-161` (`labreport()` at the top of every iteration), `:200` (`authenticate(labHost, move.dir)`), `:212-232` (only `message` is inspected; `outcome.data` is ignored).
- Game: `NetscriptFunctions/Darknet.ts:641-669`
  ```ts
      const authenticationTime = calculateAuthenticationTime(lab, Player, ctx.workerScript.scriptRef.threads);
      await helpers.netscriptDelay(ctx, authenticationTime);
      return getLabyrinthLocationReport(pid);
  ```
  and `:163-169` (for labyrinth servers `authenticate` returns `message: authResult.response.message, data: authResult.response.data`); `labyrinth.ts:325-331` (a move returns `"You have moved to X,Y."` with `data = getSurroundingsVisualized(maze, x, y, 1, true, false)`), `:288-295` (a blocked move returns `"…still at X,Y."` with the same window), `:217-227` (`labreport`'s `north/east/south/west` are literally `surroundings[0][1]`, `[1][2]`, `[2][1]`, `[1][0] === " "` of that identical range-1 window).
- What the script assumes: `labreport` is the only source of position and open walls.
- What the game does: the `authenticate` reply already contains both, at the same delay `labreport` would cost.
- Effect: walk time is doubled. At C = 2500 on `ub3r_l4byr1nth` (600 cells, up to ~1200 DFS moves) each call is ≈ 5.5 s at 6 threads (`850·(12500+1100)/2650·2.5·0.5`), so the walk is ≈ 3.6 h instead of ≈ 1.8 h; on top of the radar cost already noted as DN-F9.
- Suggested change: call `labreport` once at start (and after a 351/503), then parse `outcome.message` (`/(?:moved to|still at) (-?\d+),(-?\d+)/`) and `outcome.data` (rows 0..2, `" "` = open, same indices as `getLocationStatus`) for every subsequent step; keep `shouldRestart` on the parsed coordinates.

### R6 (medium, confirmed): crack claims expire mid-crack and the duplicates break each other
- Script: `darknet.js:42` (`CLAIM_LIFETIME = 120000`), `:392-397` (claim stamped once, at launch), `:758-765` (`buildCmd` drops claims older than 2 min), `darknet/agent.js:93` (claim sent once with the exec), `darknet/crack.js:24-39` (a log line that is not ours → `continue`; after 5 → `throw new Error("timeouts")`).
- Game: `models/packetSniffing.ts:333-369` (every PID's attempt is prepended to the same per-server log), `Darknet.ts:277-288` (heartbleed returns only the message strings — the log's `pid` is not exposed, so a foreign line is indistinguishable except by `passwordAttempted`).
- Timings from `effects.ts:60-90` + `Darknet.ts:240-242`: at C=300, d=6, chaReq 200, 6 threads one miss costs ≈ 1.6 s auth + 2.4 s heartbleed = 4 s; `TopPass` worst case 93 misses ≈ 6 min, `NIL` ≈ 4 min, `2G_cellular` (≈ L·cs/2 = 250 attempts) ≈ 16 min, `Factori-Os` up to 108 primes ≈ 7 min.
- Effect: any uncracked host with two cracked neighbours gets a second `crack.js` after 2 min; the two PIDs' failures interleave in the log, each `peek` sees the other's line, and after five wasted re-authentications one worker dies with `timeouts` (the model's scoreboard records a failure), while the survivor has burned 2× RAM and time.
- Suggested change: have `crack.js` re-send the `worker/crack` claim every ~60 s (one port line), or key `CLAIM_LIFETIME` off the model's budget × expected attempt time; alternatively let the controller treat `entry.crackClaimBy`'s agent as alive while `isRunning` says so (the agent already knows via `ns.isRunning`).

### R7 (medium, confirmed): walk hosts idle the RAM the controller freed for them
- Script: `darknet.js:29` (`["lab-threads", 6]`), `:776-793` (`buildCmd`: walk host → `phish: 0, promote: 0, share: false`), `:952-961` (`threadsForHost = min(plan.walkThreads, floor((maxRam − 4.5 − 0.5)/3.95))`), `darknet/agent.js:132-137` (walker gets `min(cmd.walkThreads, free/3.95)`).
- Game: `effects.ts:74` `threadsFactor = 1 / (1 + 0.2·(threads − 1))` applied to `authenticate`, `labreport`, `labradar` (`Darknet.ts:124-126, 666, 696`); `DarknetServerOptions.ts:200-205` `maxRam = 16·2^floor(d/6)·{0.5,1,1,1.15,1.4}` → hosts next to lab 2+ are ≥ 32–128 GB.
- Effect: a 128 GB lab-adjacent host runs the walker at 6 threads (23.7 GB, factor 0.5) and leaves ~100 GB unused, when 30 threads would give factor 0.147 — a further 3.4× on the walk. Because R5 and R7 stack, the fix pair is worth ≈ 7× on the single longest task in the crawler.
- Suggested change: default `--lab-threads` to "all that fits" on a walk host (the controller already evicts the fillers); keep the flag as a cap only.

### R8 (medium, confirmed): the three walkers walk the same path
- Script: `darknet/lab.js:88-96` (`nextMove` sorts by distance to `target ?? FAR_CORNER`; ties resolved by insertion order `north, east, south, west`, `:41`), `:149-158` (no per-walker randomisation).
- Game: `labyrinth.ts:334-338, 377-382`
  ```ts
    const offsetX = offsetStartAndEnd ? Math.floor(Math.random() * 3) * 2 : 0;
  ```
  `labData[...].offsetStartAndEnd` is `false` for `th3`, `cru3l`, `m3rc1l3ss` (`labyrinth.ts:37-64`), so every PID starts at `[1,1]`; one shared maze (`getLabMaze`, `:364-375`).
- Effect: on the first three labs all walkers execute the identical DFS; on the later ones they start within one of 9 cells and converge within a few moves. `--lab-walkers 3` costs 3 hosts' RAM and 3 stasis-worthy slots for redundancy only. Pooling those threads into one walker (R7) would be strictly better; with several walkers, different tie-break orders (e.g. rotate `DIRS` by `pid % 4`, or one walker preferring `south` before `east`) would make them explore different branches and cut expected time to the exit.
- Suggested change: seed the direction preference per walker (pid or host hash) and/or default `--lab-walkers` to 1 with all RAM (R7).

### R9 (medium; formulas confirmed, stock magnitude suspected): filler sizing is inverted
- Script: `darknet.js:48-49` (`PROMOTE_THREADS = 4`, `MIN_PROMOTE_RAM = 64`), `:780-782` (`phish: shareActive ? 0 : 1`, promote only above the floor), `darknet/agent.js:125-127` (promote clamped to 4), `:152-170` (phish/share take *all* spare RAM), `:159-160` (share instead of phish whenever the daemon shares).
- Game: `effects/phishing.ts:18-22,70-73` (cache chance thread-scaled but gated by a 3-minute global cooldown), `:19` (money chance not thread-scaled), `:36-46` (money `500·depthFactor·t…` — pennies), `Darknet.ts:596-601` (promote XP `10·t·(200+C)/200`, charge `t·(500+C)/500`), `effects.ts:197-201` (`1 + (1−e^{−0.001c}) + 2(1−e^{−0.00015c})`, max 4), `StockMarket.ts:231` (`scaleDarknetVolatilityIncreases(0.4)` per 75-tick cycle) and `:264` (`volatility = stock.mv · mult`), `Share.ts:43-49` (`1 + ln(threads)/25`), `cacheFiles.ts:108-131` (a phishing `.d.cache` is the only cache that can contain coding contracts, `:122-125`).
- Numbers (section 1): the phishing cache stream saturates at ~4–10 threads network-wide; promote gives 1.6–3× the charisma XP of phish per GB and ~9/22 threads per symbol already give 2.6×/3.05× volatility on held positions; the darknet's share contribution to a home network that already shares is `ln(1 + n/N)/25` (200 threads on top of 2000 ≈ 0.4 % rep).
- Effect: hundreds of GB run phish for XP and pennies, promote is starved below its saturation point on every host below 64 GB (i.e. every host of difficulty < 12, `DarknetServerOptions.ts:200-205`), and while `/Temp/share-active.txt` is `true` no phishing cache (and no darknet contract) is generated at all.
- Suggested change: (1) cap phish at ~12–16 threads total (one or two deep hosts — the money factor `0.1+0.05·depth` favours deep ones) and keep them even while sharing; (2) drop the 64 GB floor and give promote up to ~20–25 threads per held symbol network-wide, in `|prob−0.5|` order as now; (3) only then share/phish the remainder. Mark the stock-profit part as a hypothesis to measure: it depends on stockmaster holding positions with a correct forecast.

### R10 (medium, confirmed): island migration cannot work as implemented
- Script: `darknet.js:580-592` (island = self-reported empty neighbour list; chargers = `prevNeighbours` ∪ hosts still listing it), `darknet/agent.js:121-124` (charger must have the target in its *current* probe — which it never does for an island), `darknet/migrate.js:14-21` (`code !== 200 → break`, reports `calls: 0`).
- Game: `Darknet.ts:417-420` (`requireDirectConnection: true`), `:428-439`
  ```ts
        if (targetHost === hostOfCurrentServer) {
          const message = `Cannot induce migration on a script's own server. ...`;
  ```
  `darknetNetworkUtils.ts:485` (`getIslands = servers with !serversOnNetwork.length`), `NetworkMovement.ts:64-70` (the game itself moves a random island on 30 % of mutations).
- Effect: no charger can ever pass the direct-connection check, and the island's own agent is refused. In practice the agent-side `neighbours.includes(cmd.migrateTarget)` guard means `migrate.js` is rarely even launched; when a stale probe still lists the island it is launched, gets 351 after 100 ms, exits and re-reports every 4 s until the plan changes. The design-doc mechanism is dead code; the game's own island mover is what actually rescues islands (and the agent survives that move — `moveDarknetServer` never kills scripts, only `restartServer`/`deleteDarknetServer` do, `NetworkMovement.ts:175, 305`).
- Suggested change: remove island migration; simply wait (the island's agent keeps running and re-probes after the game moves it).

### R11 (medium, confirmed): the charisma goal and the walker gate are off by one
- Script: `darknet.js:497-510` (`required > charisma` → goal = `required`), `:727` (`if (charisma < lab.cha) return "loot"`), `:930` (`if (charisma < lab.cha) return []`), `work-for-factions.js:396-399` / `sleeve.js:441-442` (study until `charisma >= goal`).
- Game: `effects.ts:77-78`
  ```ts
    const applyUnderleveledFactor = person.skills.charisma <= chaRequired && darknetServerData.depth > 1;
    const underleveledFactor = applyUnderleveledFactor ? 1.5 + (chaRequired + 50) / (person.skills.charisma + 50) : 1;
  ```
  `NetworkGenerator.ts:257` (`requiredCharismaSkill = getLabyrinthChaRequirement(hostname)` = the lab's own gate), `labyrinth.ts:243` (the maze gate is `<`).
- Effect: at `charisma == lab.cha` the maze is enterable, but every `labreport`/`authenticate` on it costs 2.5× (e.g. 12.3 s instead of 4.9 s per call on lab 1 at 1 thread). The goal file stops the sleeve/faction study one point short of removing that penalty. Same for crack targets: `chaReq == charisma` passes heartbleed but pays ≥2.5× per attempt.
- Suggested change: `consider(required + 1)` in `planCharismaGoal`, and gate walkers on `charisma > lab.cha` (or launch at equality but keep the goal at `cha+1`).

### R12 (low, confirmed): thread and RAM constants vs the game's curves
- `effects.ts:74`: crack/walk throughput per GB is `(0.2 + 0.8/t)` of a single thread — 6 threads = 2× faster for 6× RAM. Since the alternative use of that RAM is near-worthless phish (R9), `--crack-threads` could go higher on big hosts, not lower; the 4-thread reserve in `agent.js:83` under-reserves relative to the 6 it will actually launch.
- `DarknetServerOptions.ts:200-205`: hosts of difficulty < 6 are 16–22 GB (agent 4.5 + ≤ 3 fillers), 6–11 are 32–45 GB, 12–17 are 64–90 GB. `MIN_PROMOTE_RAM = 64` therefore means "no promotion before difficulty-12 hosts exist" (R9). `getRamBlock` (`ramblock.ts:97-110`) can block *all* RAM on > 64 GB hosts; `agent.js:114` handles that by realloc from the neighbour — good.

### R13 (low, confirmed): `pushFiles` re-pushes unchanged files every loop
- Script: `darknet.js:830-864` — per commandable host per 10 s: `connectToSession` (useful: it is the liveness probe) then `write` + `scp` of two files even when neither changed. No RAM cost, but it is O(hosts) scp per loop and log noise. Cache the last pushed `cmd` JSON per host and skip the `scp` when both `passwords.txt` and the host's `cmd` are unchanged.

### R14 (low, confirmed): `2G_cellular` has a free side channel
- Script: `darknet/solvers.js:462-482` reads the mismatch index from heartbleed `message`.
- Game: `Darknet.ts:125-126` `networkDelay = calculateAuthenticationTime(server, Player, threads, sharedChars)` with `effects.ts:86-88` `sharedCharsExtraTime = sharedChars · 50 · threadsFactor` — the prefix length is encoded in the `authenticate` delay itself (25 ms per matched char at 6 threads, deterministic base time). Timing `Date.now()` around `authenticate` yields the same index without the 1.5× heartbleed, i.e. ≈ 2.5× faster on this model. (Also worth knowing: the heartbleed *noise* on any server leaks neighbours' passwords — `packetSniffing.ts:402-407, 442-452` `Connecting to <host>:<password>` — so a large `logsToCapture` peek on an already-cracked host is a cheap password harvest; noise only accrues on password attempts, `:371-396`, so it pays most right after a crack.)

---

## 3. Question-by-question notes

**Q1 economics** — see section 1 and R9/R12. Stasis links are worth it whenever a slot is free: the cost is 13.65 GB for `30 s·1000/(C+1000)` and nothing afterwards; the payoff is immunity for the crossing host / lab-adjacent walk hosts (each host is otherwise moved every ≈ 5 min, restarted every ≈ 28 min, deleted every ≈ 19 min at net depth 12: `mutateDarknet` every `60/depth` s outside BN15 (`darknetNetworkUtils.ts:407-412`, `Constants.ts:19`), 30 %×3 moves, 20 % restarts, 10 %×2.5 deletions over `4.8·depth` servers). The loot-mode "biggest host as phishing base" anchor is harmless but low-value given R9; pinning the deepest hosts (which loot mode does second) is the useful part.

**Q2 crack strategy** — solver attempt counts are near-optimal for the feedback each model gives (`NIL` and `RateMyPix`/`DeepGreen` exact-count are information-theoretically tight per position; `BigMo%od` could drop to 7–8 moduli since passwords are ≤ 10 digits, `PHP 5.4` could infer the last digit from the multiset — one attempt each, not worth a change). `Pr0verFl0` already uses the overflow (`authentication.ts:101-118`), and `connectToSession` accepts the doubled string too (`Darknet.ts:204` → `checkPassword`). Ordering is the weak point: R4 (heartbleed on feedback-free models, charisma gate, retry loop), R6 (claims), and no depth/difficulty priority at `agent.js:88-93` (fine while RAM allows cracking every neighbour at once). `2G_cellular` side channel: R14.

**Q3 labyrinth** — the DFS is correct against `mazeMaker` (perfect maze per quadrant + 4 gaps, `labyrinth.ts:120-186`) and `findExit`/`shouldRestart` match the game (audit "Checked and OK"). The efficiency problems are R5 (2 delays per step), R7 (threads), R8 (duplicate walkers), DN-F9 (radar), R11 (2.5× penalty at the gate). Charisma planning is realistic in the sense that `LABS` matches `labData`, but R1 makes the goal wrong after the first lab.

**Q4 network dynamics** — `SERVER_TTL`/`WALKER_TTL` (5 min) sit sensibly between the per-host move (~5 min) and restart (~28 min) rates; `pushFiles` refreshes `lastSeen` via `connectToSession` (works from home for any cracked host, `offlineServerHandling.ts:235-321` — no direct connection needed) and probes stamp uncracked neighbours every ≤ 60 s. Restarted hosts (`restartServer` kills scripts but keeps `hasAdminRights`, `NetworkMovement.ts:301-312`) are re-spread by neighbours' `isRunning` checks — good. Islands: R10. Air gaps: R1–R3. Stationary/darkweb filtering is correct except the known DN-F6.

**Q5 efficiency** — RAM: R7, R9, the crack reserve (R12). Calls: the agent's per-loop `getServerDetails` per neighbour is fine (no delay, 0.1 GB static). Port: after DN-F1 the steady load is ≤ 1 line/agent/min plus worker reports; `MAX_PORT_CAPACITY` is 50 (`Settings.ts:41`) and the controller drains only every 10 s, so bursts (a mutation re-wiring several hosts) still overflow into the agents' retry queues — harmless but the drain could run at the agent cadence (4 s). Pushes: R13.

**Q6 progression traps** — R1, R2, R3 are the real stalls (all silent). R4's retry loop and R10's relaunches are wasteful but not blocking. The charisma-goal handshake with `work-for-factions.js`/`sleeve.js` is wired correctly (only studies when idle), and darknet workers raise charisma on their own, so there is no "waiting for charisma nothing raises" deadlock; R11 just stops the study one point early.

## 4. What is well done

- The RAM-collision discipline (quoted `"share"` keys, renamed locals) and the per-worker static budgets are exact against `RamCostGenerator.ts:237-261`; every worker fits its stated footprint.
- Session/exec/scp preconditions are respected everywhere, including the subtle ones: `connectToSession` is never pointed at a lab, the walker delivers the agent with its own win session, and `agent.js:114` realloc-from-neighbour handles hosts whose RAM is fully blocked.
- Solver library: every model's feedback semantics (duplicate-aware Mastermind counting, `BigMo%od`'s `10^15+r` CRT trick under `MAX_SAFE_INTEGER`, the `Pr0verFl0` overflow, `PHP 5.4`'s RMS inversion, `OpenWebAccessPoint`'s substring intersection) is ported faithfully and the budgets are now password-aware.
- The two-way stasis command with a content marker, the crack-claim envelope, the filler `fillerPlan` yielding rule, and the `hostArg` wrapping for `--`-prefixed hostnames are all correct responses to real game behaviour.
- `daemon.js:437` gates the launch exactly like `hasDarknetAccess`, and the `/Temp/share-active.txt` / `/Temp/stock-probabilities.txt` / `/Temp/darknet-charisma-goal.txt` handshakes line up on both sides.
- The Node test harness (`test/darknet-mock.js`) is a faithful port of the generators and oracles, which is why the remaining problems are all *planning* errors against network topology and timing rather than solver bugs.

---

# Section 5: Stocks, hacknet, stanek, go

Scope: `stockmaster.js`, `hacknet-upgrade-manager.js`, `spend-hacknet-hashes.js`, `stanek.js`, `optimize-stanek.js`, `go.js` (strategy only). There is no `corporation.js` in the repo and no BitNode-specific money script under `Tasks/`, so nothing to review there. Findings already in `docs/audit/2026-09-15-in-game-audit.md` (FT-F10/F11/F12/F13..F23) are not repeated.

Paths: scripts `/home/jubnl/dev/bitburner/bitburner-scripts/`, game `/home/jubnl/dev/bitburner/bitburner-src/src/`.

## Summary

| Sev | ID | Script | Finding | Status |
|---|---|---|---|---|
| medium | SM-1 | stockmaster.js | The `--fracB` (0.4) liquidity gate leaves the cash freed by cycle reversals idle for a whole 75-tick cycle in a large share of cycles post-4S; worst in BN8 where autopilot passes `--fracH 0.001` | confirmed |
| medium | ST-1 | stanek.js / autopilot.js | Fragments are charged once per reset at start-of-run home RAM; the effect is `ln(highestCharge+1)`, so every later home-RAM upgrade is wasted on Stanek unless one more charge is run | confirmed |
| medium | GO-1 | go.js | Default 13x13 board: favor per win-streak is board-size independent, so favor farming (the script's first priority, Daedalus) is ~5-8x slower than on a 5x5/7x7 board | suspected |
| low | SM-2 | stockmaster.js | 6-7 temp-script round trips every second although prices only change every 6 s; `ns.stock.nextUpdate()` is a 0 GB call | confirmed |
| low | SM-3 | stockmaster.js | The pre-4S `--diversification` cap (34 %) is still applied with exact 4S forecasts | confirmed |
| low | SM-4 | stockmaster.js | Pre-4S volatility = max over 151 ticks, but darknet promotions decay x0.4 every cycle, so promoted (held) stocks get an inflated ER | confirmed |
| low | HN-1 | hacknet-upgrade-manager.js | New-node payoff uses the worst existing node's production as if the new node produced it for free; total payoff can reach ~2x the configured limit | confirmed |
| low | HN-2 | hacknet-upgrade-manager.js / daemon.js | daemon launches it with `--interval 0`; while the best upgrade is unaffordable it busy-loops with `ns.sleep(0)` calling ~5 API functions per node per frame | confirmed |
| low | HN-3 | hacknet-upgrade-manager.js | Hash value is fixed at $250k while autopilot actually spends hashes on `Increase Maximum Money` (+2 % of the best server per 50 hashes), so hacknet is under-invested where hashes matter most | suspected |
| low | HN-4 | spend-hacknet-hashes.js | Contract-vs-money comparison assumes a generated contract pays money; only 1 in 4 rewards is money | confirmed |
| low | ST-2 | optimize-stanek.js | Layout score ignores fragment `power` and treats booster adjacency additively instead of x1.1 multiplicatively | confirmed |
| low | GO-2 | go.js | Slum Snakes (crime_success) is played last, yet cheat success chance is linear in `crime_success` | suspected |
| low | GO-3 | go.js | Five temp-script round trips per move to dodge 60 GB of Go API RAM | confirmed |

---

## 1. stockmaster.js

### Verified correct (formula comparison)

| Script | Game | Result |
|---|---|---|
| `forecast` (349): fraction of ticks where newer price > older | `StockMarket.ts:284-296`: up with probability `chc`, `price*(1+av)` up, `price/(1+av)` down | correct estimator of `chc` |
| `expectedReturn` (271-276) `= vol * (prob-0.5)` | `StockMarket.ts:260-265` `av = v*mv/100`, `v ~ U(0,1)` shared by all stocks; `NetscriptFunctions/StockMarket.ts:228-236` `getVolatility = mv*darknetMult/100` | E[log return] = `(2p-1)*E[av] = (p-0.5)*vol`. Exact in expectation |
| pre-4S `vol` = max single-tick move (366) | same; `E[max of 151 U(0,1)] = 0.993` | unbiased to <1 % |
| `timeToCoverTheSpread` (287) `ln(ask/bid)/ln(1+ER)` | `Stock.ts:225-231` ask = `price*(1+s)`, bid = `price*(1-s)`; `StockMarketHelpers.ts:28-31, 53-58` buy at ask / sell at bid, short buys at bid and closes at ask | correct for both sides |
| `positionValueShort` (283) `shares*(2*avgShortPx - ask)` | `StockMarketHelpers.ts:56-59` `origCost + (avgShortPx-ask)*shares` | identical (minus commission) |
| `ownedShares()==maxShares` (207), `maxShares - ownedShares()` (216) | `BuyingAndSelling.tsx:84, 261` `shares + playerShares + playerShortShares > maxShares` | correct |
| commission 100k (7), added on buy, subtracted on sell | `data/Constants.ts:11`, `StockMarketHelpers.ts:28, 53` | correct |
| `marketCycleLength = 75`, 45 % flip, `prob -> 1-prob` (19, 23) | `data/Constants.ts:6`, `StockMarket.ts:224-227` `roll < 0.45 -> b = !b` | correct |
| `expectedTickTime 6000`, `catchUpTickTime 4000` (28-29) | `data/Constants.ts:4-5` `msPerStockUpdate 6e3, msPerStockUpdateMin 4e3` | correct |
| shorts need SF8.2 outside BN8 (132) via `getActiveSourceFiles(ns,true)` (helpers.js:621 gives BN8 effective level 3) | `NetscriptFunctions/StockMarket.ts:151` `bitNodeN !== 8 && activeSourceFileLvl(8) <= 1` | correct |
| `disable4SData` latch (562-566) | `NetscriptFunctions/StockMarket.ts:250, 276` | correct (FT-F10 fix) |
| 4S inversion detection (372) `detectInversion(prob, lastTickProb)` | `Stock.ts:174-196` `otlkMag` drifts by `otlkMag*av` (or 1 when <=1) per tick, so a jump of >= 0.10 in one tick only happens on the cycle flip | reliable cycle re-sync |

Price impact of the script's own trades is limited to the forecast (`StockMarketHelpers.ts:70-109`: -0.006 otlkMag per `shareTxForMovement` shares, floored at 5 by `Stock.ts:246-250`); the price itself never moves on a transaction, so ignoring it is fine.

### SM-1 (medium, confirmed) - `fracB` gate strands reversal cash for whole cycles post-4S

- Script: `stockmaster.js:43-44` (`fracB 0.4`, `fracH 0.2`), `:195-197` (`if (playerStats.money / corpus > fracB)` then invest down to `fracH`), `:180` (sell when `bearish && sharesLong>0` etc.), `:190` (`continue` after sales). `autopilot.js:547-549` passes `--fracH 0.1` (BN8: `0.001`) but leaves `fracB` at 0.4.
- Game: `StockMarket.ts:219-232`

  ```ts
  const roll = Math.random();
  if (roll < 0.45) { stock.b = !stock.b; stock.flipForecastForecast(); }
  ```
  once every `TicksPerCycle` (`:257-258`, `data/Constants.ts:6` = 75). Between cycles the forecast only crosses 0.5 when `otlkMag` random-walks to 0 (`Stock.ts:191-195`), which is rare for any stock the script buys (it needs `|p-0.5| > 0.01` and a blackout window shorter than the cycle).
- What the script assumes: cash should only be redeployed once it is at least 40 % of corpus, to avoid "death by a thousand commissions".
- What happens: post-4S, sells are batched at the cycle tick. The script sells every flipped position (correct), then can only rebuy if `cash/corpus > 0.4`. With `fracH = 0.1` that needs more than 33 % of holdings (by value) to have flipped; with autopilot's BN8 `fracH = 0.001` it needs more than 40 %. Each stock flips independently with p = 0.45, so with ~33 held positions `P(Bin(33,0.45) <= 11) ~ 12 %` (fracH 0.1) and `P(<= 13) ~ 32 %` (BN8). With fewer positions (10-15, typical mid-run because of `--diversification`) the miss rate is 25-35 %. In those cycles 30-40 % of corpus sits in cash for the remaining ~75 ticks (7.5 min), precisely when the freshly reversed stocks have the largest known `|p-0.5|`. Commission is 100k (`data/Constants.ts:11`), irrelevant once corpus is in the billions, so the guard buys nothing.
- Effect: roughly 5-10 % of stock income lost on average, more in BN8 where stocks are the whole economy.
- Suggested change: once `!pre4s`, replace the gate with `playerStats.money - reserve > fracH * corpus + 2*commission` (i.e. `fracB = fracH` post-4S), or rely on the existing `estEndOfCycleValue <= 2*commission` check at `:223` which already prevents unprofitable micro-buys. Keep `fracB` for pre-4S.

### SM-2 (low, confirmed) - 1 s polling with 6-7 temp scripts per loop

- Script: `stockmaster.js:31` `sleepInterval = 1000`; per loop `getPlayerInfo` (156), `checkAccess('has4SDataTixApi')` (159, pre-4S), `tryGet4SApi` which repeats `has4SDataTixApi` and `has4SData` (567, 570, pre-4S, before the budget check at 573), then `refresh` runs `getAskPrice`, `getBidPrice`, `getVolatility`, `getForecast`, `getPosition` as five separate `getStockInfoDict` temp scripts (301-305).
- Game: `StockMarket.ts:235-251` only updates prices every `msPerStockUpdate` (6 s) and resolves `StockMarketPromise` after each update (`:318-322`); `ns.stock.nextUpdate()` (`NetscriptFunctions/StockMarket.ts:340`) costs `RamCostConstants.CycleTiming = 0` (`RamCostGenerator.ts:79, 131`).
- Effect: ~360-420 temp-script launches per minute (each is `ns.run` + file write + poll + read) for 10 real ticks; forecasts, volatility and positions cannot change between ticks except through the script's own trades. Pure overhead on the game's main thread.
- Suggested change: `await ns.stock.nextUpdate()` in the main script (0 GB), then one temp script that returns `{sym: [ask, bid, vol, forecast, position]}` for all symbols (one launch instead of five). Move `tryGet4SApi`'s access checks behind its budget test.

### SM-3 (low, confirmed) - diversification cap applied with exact forecasts

- Script: `stockmaster.js:47` (comment: "Before we have 4S data"), `:213` `budget = min(cash, maxHoldings*(diversification+spread) - position*(1.01+spread))` runs in both modes.
- Game: with 4S the forecast is the exact `otlkMag` (`NetscriptFunctions/StockMarket.ts:238-247`); the only real position limit is `maxShares` (`BuyingAndSelling.tsx:84`).
- Effect: while corpus is small relative to `maxShares * price`, the best-ER stock gets at most 34 % of `maxHoldings` and the rest is pushed into lower-ER stocks. Small in absolute terms; disappears once positions hit `maxShares`.
- Suggested change: apply the cap only when `pre4s`.

### SM-4 (low, confirmed) - pre-4S volatility ignores promotion decay

- Script: `stockmaster.js:20, 366` volatility = max |move| over the last 151 ticks.
- Game: `StockMarket.ts:264` `volatility = mv * getDarknetVolatilityMult(symbol)`; `:231` `scaleDarknetVolatilityIncreases(0.4)` at every cycle; `DarkNet/effects/effects.ts:197-201` multiplier `1 + (1-e^{-0.001c}) + 2(1-e^{-0.00015c})`.
- Effect: the darknet feed (`darknet.js:481-496`) promotes the three held stocks with the strongest `|prob-0.5|`; their volatility peaks just before a cycle and drops 60 % right after, but the 151-tick max keeps the peak for two cycles. ER for those (held) stocks is overstated by up to ~20 %, so the sell threshold fires late. Post-4S is unaffected (`getVolatility` is live).
- Suggested change: pre-4S, take the max over the last `nearTermForecastWindowLength` ticks, or weight recent ticks.

### Darknet promote feed (no finding)

`darknet.js:481-496` reads `/Temp/stock-probabilities.txt` (written by `stockmaster.js:426-427` on every tick), keeps held symbols, sorts by `|prob-0.5|` and hands up to three to `promote.js`, which calls `ns.dnet.promoteStock` (`NetscriptFunctions/Darknet.ts:582-610`: `charges += threads*(500+cha)/500` per call of `max(8000*600/(600+cha), 200)` ms). Since ER = `vol * (p-0.5)`, raising volatility only on strong-forecast held stocks is the right use of the effect. Verified consistent.

---

## 2. hacknet-upgrade-manager.js and spend-hacknet-hashes.js

### Verified correct

| Script | Game | Result |
|---|---|---|
| `relativeGain.level = (l+1)/l - 1` (88) | `formulas/HacknetNodes.ts:7`, `HacknetServers.ts:103` linear in level | correct |
| `relativeGain.ram` nodes `1.035^ram - 1`, servers `0.07` (89) | `HacknetNodes.ts:8` `1.035^(ram-1)`; `HacknetServers.ts:104` `1.07^log2(ram)` | doubling: `1.035^r`, `1.07` - correct |
| `relativeGain.cores` nodes `(c+6)/(c+5)-1`, servers `(c+5)/(c+4)-1` (90) | `HacknetNodes.ts:9` `(cores+5)/6`; `HacknetServers.ts:105` `1+(cores-1)/5` | correct |
| formulas path passes `ramUsed = 0` and `mults.hacknet_node_money` (76-78, 122-123) | `HacknetServers.ts:106` `ramRatio = 1 - ramUsed/maxRam`; `HacknetServer.ts:125-126` uses `Player.mults.hacknet_node_money`; BN mult inside the formula (`:108`) | correct, and correctly avoids the ramUsed-depressed `production` |
| `hashDollarValue = 2.5e5` (150) | `HashUpgradesMetadata.tsx:10-23` 4 hashes -> $1e6 (flat `cost: 4`) | correct for Sell-for-Money |
| `maxNumNodes()` guard (143) | `NetscriptFunctions/Hacknet.ts:57-62` 20 servers / Infinity nodes | correct |
| bulk `spendHashes(sellForMoney, "", qty)` (spend:150-152) | `NetscriptFunctions/Hacknet.ts:200-215`, `HashUpgrade.ts:72-75` `cost*count` | correct |
| `hashesEarnedNextTick` overflow spending (spend:129, 136) | `HacknetServer.ts:86` `hashes = hashRate*seconds` | correct |
| hard-failure latch (spend:97-101, 156-165) | `HacknetHelpers.tsx:475-565` permanent `success:false` cases | correct (FT-F11 fix) |

### HN-1 (low, confirmed) - optimistic new-node payoff

- Script: `hacknet-upgrade-manager.js:142-143` `newNodePayoff = worstNodeProduction / newNodeCost` (comment at 138-141 acknowledges it).
- Game: a new server produces `0.001 * 1 * 1 * 1 * mult` (`HacknetServers.ts:103-108`, level 1 / 1 GB / 1 core); reaching the worst node's stats costs the sum of `calculateLevelUpgradeCost` (`:111-130`, `10*50e3*1.1^L`), `calculateRamUpgradeCost` (`:132-157`) and `calculateCoreUpgradeCost` (`:159-180`). For server n the purchase itself is `50e3 * 3.2^(n-1)` (`:204-210`): ~1.8e9 for #10, ~2e14 for #20, versus ~1.4e11 to bring a server to level 100 / 8 TB / 16 cores.
- Effect: for early nodes the "price" of the assumed production is dominated by upgrades, not the node; each upgrade is later tested individually against the payoff limit, so the true payoff of (node + upgrades) is bounded by about `2 * maxPayoffTime`, not by `maxPayoffTime`. Never "never pays off", but the 1 h kick-start (`daemon.js:377`) effectively behaves as a ~2 h limit for new nodes.
- Suggested change: price the new node as `newNodeCost + sum of upgrade costs needed to reach the worst node's (level, ram, cores)` using the formulas API when available.

### HN-2 (low, confirmed) - `--interval 0` busy loop

- Script: `daemon.js:377` launches `-c --max-payoff-time 1h --interval 0`; `hacknet-upgrade-manager.js:40-57` loops `await ns.sleep(interval)`; `upgradeHacknet` returns `0` (not `false`) when the best upgrade is unaffordable (`:168-172`), so the loop continues; each iteration calls `getNodeStats` + 4 cost functions per node (`:120-128`) and `ns.getPlayer()` twice (`:68, 167`).
- Game: `Netscript/NetscriptHelpers.tsx:419-422` `ns.sleep` is a `window.setTimeout`, so `sleep(0)` yields for one timer tick (~4 ms clamp); `NetscriptFunctions/Hacknet.ts:73-90` `getNodeStats` builds a fresh object per call.
- Effect: while the player cannot afford the next 1 h-payoff purchase (common early), ~100+ API calls every few ms until it can. CPU drag on the main thread, no functional harm.
- Suggested change: `--interval 1000` for the kick-start, or `Math.max(interval, 200)` in the script.

### HN-3 (low, suspected) - hash valuation ignores what hashes are actually spent on

- Script: `hacknet-upgrade-manager.js:150` values every hash at $250k. `autopilot.js:563-609` runs `spend-hacknet-hashes.js --liquidate --spend-on-server <best> --spend-on Increase_Maximum_Money [--spend-on Reduce_Minimum_Security]` after 15 min.
- Game: `HashUpgradesMetadata.tsx:50-62` `IncreaseMaximumMoney` costs `50*(level+1)` and multiplies the target's `moneyMax` by 1.02 (`HacknetHelpers.tsx:516-527`, soft-capped above 1e13); `ReduceMinimumSecurity` `x0.98` (`:497-512`).
- Effect: when hack income on the boosted server exceeds ~$625m/s, +2 % max money is worth more per hash than $250k; hacknet is then under-bought against the 4 h / 8 h payoff limits (`daemon.js:411-412`). Suspected because the true value depends on daemon's utilisation of the extra max money.
- Suggested change: pass `--hash-value` from autopilot when a server boost is active (e.g. `0.02 * bestServerIncomePerSec * horizon / 50`).

### HN-4 (low, confirmed) - contract reward is money only 25 % of the time

- Script: `spend-hacknet-hashes.js:14` comment "A contract pays >= $25m * difficulty", `:72-73` generates contracts while `25*(level+1) <= 40 * 4` hashes.
- Game: `CodingContract/ContractGenerator.ts:178-189` `getRandomReward` picks uniformly from FactionReputation, FactionReputationAll, CompanyReputation and (if `CodingContractMoney > 0`) Money; `PlayerObjectGeneralMethods.ts:560` money = `75e6 * difficulty * CodingContractMoney * scaling`. Level resets on install (`PlayerObjectGeneralMethods.ts:131` `hashManager.prestige()`).
- Effect: at most 6 contracts per install (levels 0-5) for 25..150 hashes each; expected money is a quarter of the stated figure, the other rewards are reputation. Still a bargain versus 4 hashes = $1m, so no behaviour change needed; the comparison is just mis-stated and the rep rewards are the real value.
- Suggested change: fix the comment, and skip generation when `contractor.js` is not running (contracts nobody solves are worth nothing).

---

## 3. stanek.js and optimize-stanek.js

### Verified correct

| Script | Game | Result |
|---|---|---|
| charge each fragment sequentially with all free home RAM, `threads = (free - reserved)/2.0` (stanek.js:177-192) | `RamCostGenerator.ts:65, 425` `chargeFragment` 0.4 GB + 1.6 base = 2.0 GB; `NetscriptFunctions/Stanek.ts:47-53` charge = `threads * getCoreBonus(cores)`; `CotMG/formulas/effect.ts:3-12` effect bonus `= ln(highestCharge+1)/60 * ((numCharge+1)/5)^0.07 * power * boost` | maximising threads per single call is exactly what the formula rewards |
| `--max-charges 120` diminishing returns comment (14) | exponent 0.07: 60 -> 120 charges is +4.9 % on the bonus term | reasonable stopping point |
| continue for CotMG rep (93-95, 141-143) | `StaneksGift.ts:41-42` rep `+= faction_rep * threads^0.95 * (favor+100)/1000` per charge | correct |
| booster fragments not charged (164) | `NetscriptFunctions/Stanek.ts:39-44` throws for boosters | correct |
| no charge decay assumed | `StaneksGift.ts:50-62` `process()` never reduces `numCharge`; `:229-231` cleared only on install | correct |

### ST-1 (medium, confirmed) - peak charge frozen at start-of-run home RAM

- Script: `autopilot.js:684-691` launches `stanek.js` once per reset (`stanekLaunched = true; // ... we never have to again this reset`); `stanek.js:100-116` exits when every fragment reaches `--max-charges`. Home RAM is then upgraded all run long by `Tasks/ram-manager.js` (`daemon.js:415-418`, 50 % budget every 30 s).
- Game: `CotMG/formulas/effect.ts:3-12`

  ```ts
  return 1 + (Math.log(highestCharge + 1) / 60) * Math.pow((numCharge + 1) / 5, 0.07) * power * boost * ...
  ```
  and `StaneksGift.ts:33-39`

  ```ts
  if (threads > af.highestCharge) { af.numCharge = (af.highestCharge * af.numCharge) / threads + 1; af.highestCharge = threads; }
  ```
- What the script assumes: charging is a one-off at the start of the augmentation cycle.
- What the game does: the bonus scales with `ln(highestCharge)`, the *largest single charge ever made*, and the count term is almost flat. A single later charge with more threads raises `highestCharge` immediately and rescales `numCharge` proportionally (the `^0.07` term loses a few percent at most).
- Effect: run starts at 128 GB home (48 threads -> `ln(49)/60 = 0.065`); after ram-manager reaches 4 TB (~2000 threads -> `ln(2001)/60 = 0.127`) the whole Stanek bonus could be ~1.95x larger for the rest of the run (with 120 charges the count term drops from 1.25 to ~1.22 after rescaling, a 2 % loss). Every fragment (hacking, rep, hacknet) is affected for hours.
- Suggested change: autopilot should re-run `stanek.js --max-charges 1`-style top-up (one full-RAM charge per fragment, N seconds of home RAM) whenever `getServerMaxRam('home')` has at least doubled since the last charge, or stanek.js itself can loop on a long interval and charge again when `free threads > 2 * highestCharge`.

### ST-2 (low, confirmed) - layout score ignores fragment power and booster math

- Script: `optimize-stanek.js:322-325` `score = stats.length * (1 + 0.1 * adjacencies)`.
- Game: `StaneksGift.ts:73-80` boost is the *product* of distinct adjacent boosters' `power` (each 1.1, `Fragment.ts` ids 100-107); the effect is proportional to the fragment's own `power` (`Fragment.ts`: Hacking 1, HackingSpeed 1.3, HackingMoney 2, HackingGrow 0.5, HacknetMoney 1, HacknetCost 2, Rep 0.5, Charisma 3, WorkMoney 10, Bladeburner 0.4).
- Effect: a booster next to Rep (power 0.5) scores the same as one next to HackingMoney (power 2); layouts with one more low-power piece can beat layouts that boost the pieces that matter. The tool is offline and `stanek.js.create.js` uses hand-made layouts, so impact is small (audit FT-F22/F23 already cover the size limit and the bogus fragment type).
- Suggested change: score `sum over stats of power * 1.1^adjacentBoosters`.

---

## 4. go.js (strategy only)

### Verified correct

| Script | Game | Result |
|---|---|---|
| cheat chance formula and thresholds (go.js:20-21, 1370-1375): first cheat 0.55, later 0.9 | `netscriptGoImplementation.ts:561-567` `min(1, 0.6*(0.7-0.02c)^c*crime_success + (SF14.3 ? 0.25 : 0))`; `:518-527` ejection only when `priorCheatCount` and 10 % on failure | correct; expected game loss per later cheat at 0.9 is 1 % |
| cheat API gating (113) | `checkCheatApiAccess` per script comment; SF14.2 or BN14 | correct |
| favor cap and one-opponent focus (90-94, 395-419) | `scoring.ts:67-79` rep only for joined factions, `winStreak % 2 === 0`, `< getMaxRep()`; `effect.ts:30-44` | correct (FT-F14/F19 already noted) |
| per-opponent bonus table (90-92) | `effect.ts:68-101` | correct |

### GO-1 (medium, suspected) - 13x13 default makes favor farming several times slower than necessary

- Script: `go.js:23, 42, 124-128` board size 13 by default; `:94` default preference starts with Daedalus (favor), then `????????????`, Illuminati.
- Game: `scoring.ts:67-79`

  ```ts
  if (factionName && statusToUpdate.winStreak % 2 === 0 && Player.factions.includes(factionName) && statusToUpdate.rep < getMaxRep()) {
    const repToAdd = getMaxRep() / 200;
  ```
  no board-size term: every second consecutive win is worth `getMaxRep()/200` regardless of size. Node power (`:86-89`) is `blackScore * getDifficultyMultiplier(komi, size) * winstreakMult`, where `effect.ts:132-135` gives `(komi+0.5)*0.25` for all sizes and 8 for 5x5 vs Illuminati. The opponent takes 200 ms per move (`goAI.ts:877-882`), so game length is proportional to board area (~100+ moves on 13x13 vs ~10-15 on 5x5).
- What the script assumes: bigger board = better.
- What the game does: the favor cap (the script's own first goal) is reached after 200 even-streak wins whatever the board; on 5x5 that is roughly 6-8x fewer minutes. Node power per *game* is lower on small boards (fewer points) but per *hour* it is comparable or better (5x5 vs Illuminati: ~20 pts x 8 = 160 per ~10 s game versus ~100 pts x 2 = 200 per ~60 s game), and the effect formula `ln(n+1)*(n+1)^0.3` (`effect.ts:16-22`) has strongly diminishing returns anyway.
- Marked suspected because the pattern engine's win rate on 5x5/7x7 (which drives the streak multiplier and the even-streak favor) is unverified; the script's own comment on line 23 already suspects this.
- Suggested change: default to 7x7 (or 5x5 vs Illuminati) while any preferred faction is below the favor cap, then switch to 13x13 for node power; make `--size` per-opponent.

### GO-2 (low, suspected) - Slum Snakes ordering vs cheat success

- Script: `go.js:94` Slum Snakes is sixth of seven in the default order.
- Game: `netscriptGoImplementation.ts:565-566` `0.6 * cheatCountScalar * Player.mults.crime_success`; `effect.ts:75-77` Slum Snakes node power multiplies `crime_success`.
- Effect: a Slum Snakes bonus of +20-30 % lifts the first-cheat chance from 0.60 to 0.72-0.78 and makes the 0.9 threshold reachable for a second cheat sooner; playing it after Daedalus (before Illuminati) would compound into every later game. Small and depends on crime augments already owned.

### GO-3 (low, confirmed) - five temp scripts per move

- Script: `go.js:166-195` ram-dodges `getBoardState`, `getControlledEmptyNodes`, `getValidMoves`, `getLiberties`, `getChains` every turn (`:209-213`).
- Game: `RamCostGenerator.ts:301-316` costs 4 / 16 / 8 / 16 / 16 GB (60 GB total); `daemon.js:375` only launches go.js at 64 GB free anyway.
- Effect: five `ns.run` + file round trips per move (each tens of ms) roughly doubles the script's think time on top of the AI's 200 ms; matters most if GO-1 is adopted (short games). Cheap fix once home RAM is large: call the functions directly when `getServerMaxRam('home') - used >= 80`.

---

## 5. Progression traps checked (none new beyond the above)

- stockmaster liquidation: only when buying 4S (`:575-576`) or on `--liquidate`; the "Disable 4S" loop is fixed (FT-F10). Liquidation for 4S costs one spread on every position but is a one-off. OK.
- Hacknet: nothing is bought when `HacknetNodeMoney == 0` (`daemon.js:366-369`; `hacknet-upgrade-manager.js:145-148`). OK.
- Hash spends: server boosts are gated by hack-income multipliers and the 1e13 soft cap (`autopilot.js:563-609`); permanent refusals are latched (FT-F11). OK.
- Stanek: `stanek.js` reserves all home RAM until done (`daemon` is started RAM-starved through `--on-startup-script`), then hands over. At 8 fragments x 120 charges x 1 s this is ~16 min of no hacking per reset - acceptable, and much of it would be recovered by the ST-1 top-up approach (few charges, later).
- Go: ejection resets the win streak (`scoring.ts:106-113, 118-128`) and forfeits node power; the 0.9 threshold keeps this at ~1 % per later cheat. OK.

## 6. What is well done

- stockmaster's pre-4S estimator is statistically sound: unbiased `chc` estimate, binomial standard-error haircut, near-term window for early inversion detection, and the blackout/hold-time rules line up with the game's exact 75-tick cycle and 45 % independent flips. Post-4S the cycle re-sync via one-tick forecast jumps is essentially exact.
- Commission and spread accounting matches `StockMarketHelpers.ts` for both long and short sides, including the `2*avgShortPx - ask` short valuation.
- hacknet-upgrade-manager's marginal-gain-per-dollar greedy with the exact node vs server formulas (this branch's fix) and the `ramUsed = 0` correction is the right model; the formulas-API detection is robust.
- spend-hacknet-hashes spends only the overflow, prefers cheap contracts, latches permanent refusals, and buys capacity only when needed.
- stanek.js charges one fragment at a time with every free thread, which is exactly what `ln(highestCharge)` rewards, and keeps charging for CotMG rep when an augmentation is within reach.
- go.js's cheat policy is calibrated to the actual ejection rule (first cheat risk-free), and opponent focus is driven by the real favor cap.
