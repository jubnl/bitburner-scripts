# Functional Fixes Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This index orders five area plans; execute the tasks inside those files.

**Goal:** Fix every confirmed finding of the 2026-09-15 functional review (58 findings, 12 high) so the automation scripts advance the game the way Bitburner v3.0.1 actually works.

**Architecture:** Five independent area plans, one per subsystem, each with TDD tasks and one commit per finding. Pure decision logic is extracted into importable modules (`progression-rules.js`, `lib/gang-logic.js`, `lib/sleeve-logic.js`, `lib/bladeburner-logic.js`, exports from `stockmaster.js` / `hacknet-upgrade-manager.js` / `daemon.js`) so it can be unit-tested with `node:test`; the darknet plan extends the existing fake-`ns` harness; everything that depends on game runtime is verified with the headless harness or a documented in-game check.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22 `node:test`, `tools/harness` (collide.mjs RAM check, drv.mjs headless game).

**Spec:** `docs/audit/2026-09-15-functional-review.md` (sections 1-5). Findings marked "suspected" are not planned (GO-1, GO-2, HN-3, progression finding 8, the stock-profit magnitude of R9).

## Global Constraints

- Never edit `/home/jubnl/dev/bitburner/bitburner-src`.
- One finding per commit, message names the finding ID (e.g. `daemon: launch batch tasks just in time (HC-1)`). No Co-Authored-By or session trailers, no push, never touch `.idea/`.
- After every script edit: `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>`; any `+[...]` that is not a documented 0 GB constant (`nextUpdate=RamCostConstants.CycleTiming`, `hacking={`) is a new RAM charge: rename the identifier. `darknet/agent.js` stays 4.50 GB, darknet workers at `WORKER_RAM`.
- Full suite: bare `node --test` (126 passing at `7d13c98`). Each area plan states its own expected totals assuming it runs alone from 126; when plans are interleaved the totals add up, so compare against the previous run instead of the quoted number.
- Default option changes need the user's approval first (table below).

## Area plans

| # | Plan file | Tasks | Findings |
|---|---|---|---|
| A | `2026-09-15-functional-hacking.md` | 10 | HC-1 .. HC-11 |
| B | `2026-09-15-functional-gang-sleeve-blade.md` | 12 | SL-1..4, GG-1..4, BB-1..4 |
| C | `2026-09-15-functional-darknet.md` | 16 (0..15) | R15, R1..R14, smoke |
| D | `2026-09-15-functional-progression.md` | 8 | Silhouette, install-for-augs, city factions, stat-grind crime, invite grinding, NF sourcing, autopilot temp scripts, 3 observations |
| E | `2026-09-15-functional-money-side.md` | 10 | SM-1..4, HN-1, HN-2, HN-4, ST-1, ST-2, GO-3 |

## Execution order (by impact; each row is independently committable)

- [ ] 1. **C Task 0 (R15)** — the live stall: `Invalid host` from `connectToSession` after a reload. Smallest task, unblocks the user's current game.
- [ ] 2. **A Task 1 (HC-1)** — just-in-time batch launching and round chaining. Largest single gain.
- [ ] 3. **B Tasks 1-2 (SL-2, SL-1)** — sleeve training gate and no sync stall.
- [ ] 4. **C Tasks 1-3 (R1, R2, R3)** — labyrinth identification, gap-blocked frontier, no migration on pinned hosts.
- [ ] 5. **B Task 3 (BB-1)** — BlackOp go/no-go on the low end of the range.
- [ ] 6. **A Task 2 (HC-2)** — separate purchased-server spend from home upgrades.
- [ ] 7. **C Tasks 4-6 (R4, R12, R5)** — heartbleed only for oracle models, crack reserve, one lab delay per step.
- [ ] 8. **E Task 2 (ST-1)** — Stanek top-up after home RAM doubles.
- [ ] 9. **B Task 4 (GG-1)** — task-weighted gang equipment/ascension/training.
- [ ] 10. **D Task 1 (Silhouette)** — CFO path (800k rep).
- [ ] 11. **E Task 1 (SM-1)** — post-4S buy gate.
- [ ] 12. Remaining mediums by area: A 3-6 (HC-3..HC-6), B 5-10 (GG-3, GG-2, SL-3, BB-2, GG-4, BB-3), C 7-11 (R11, R6, R7, R8, R9), D 2-6, E 3-4 (SM-2, HN-1).
- [ ] 13. Lows: A 7-10, B 11-12, C 12-14, D 7-8, E 5-10.
- [ ] 14. **C Task 15** — darknet headless smoke (after every darknet change, and once at the end).

## Cross-plan file overlaps (apply in this order, re-locate lines by the quoted old text)

- `autopilot.js`: D Task 2 (PR-2), D Task 7 (PR-7), D Task 8 (install-countdown) and E Task 2 (ST-1) all edit it. Apply D first, then E; E's line numbers are HEAD numbers.
- `daemon.js`: only plan A edits it (E's HN-2 deliberately leaves `daemon.js:377` alone). D's PR-7 reads daemon's `--interval-check-scripts` cadence but does not edit daemon.js.
- `work-for-factions.js`: only plan D (Task 1 moves the job tables into `progression-rules.js`; Tasks 3-5 quote HEAD line numbers and say so).
- `helpers.js`: none of the plans edit it.
- `test/darknet-controller.test.js`: only plan C; C Task 0 adds one test and states that Tasks 1-11's quoted totals are one lower than what will be seen.
- New files: `progression-rules.js` + `test/progression-rules.test.js` (D), `lib/gang-logic.js`, `lib/sleeve-logic.js`, `lib/bladeburner-logic.js` + tests (B), `test/daemon-batch-queue.test.js` and others (A), `test/stockmaster-*.test.js` etc. (E). No two plans create the same file.

## Default changes for the user to approve (consolidated; details in each plan's own table)

| Plan | Option / constant | Old | New |
|---|---|---|---|
| A | `Tasks/ram-manager.js --core-max-cash-fraction` (new) | cores bought with any leftover budget | 0.05 |
| A | `Tasks/backdoor-all-servers.js --reserved-home-ram` | 22 (guard never worked below SF4.3) | 22, now "free RAM after spawning the measured script size" |
| B | `sleeve.js --training-cap-seconds` (upstream) | 7200 | 0 = no cap |
| B | `sleeve.js --train-max-shock` (branch) | 10 | removed, replaced by `--train-max-cost-per-exp` 2500 |
| B | `sleeve.js --karma-homicide-min-rate` (new) | - | 0.1 |
| B | `sleeve.js` sync behaviour | sync first when karma crime wanted | never unless `--sync-first` |
| B | `sleeve.js` bladeburner table sleeves 5, 6 (upstream) | Diplomacy / Field Analysis | Infiltrate Synthoids (chaos escalation kept) |
| B | `gangs.js --min-training-ticks` (upstream) | 10 | removed, replaced by `--retrain-recovery-fraction` 0.9 |
| B | `gangs.js --disable-next-update` (branch), `updateInterval` 200 ms (upstream) | polling loop | removed; loop paced by `ns.gang.nextUpdate()` |
| B | `gangs.js` bonus-time behaviour | pre-tick warfare swap | no swap while `getBonusTime() >= 5 s`; housekeeping every 20 s |
| B | `bladeburner.js` Stealth Retirement gate above chaos threshold | 0.99 | `--success-threshold` (0.9) |
| B | `bladeburner.js --chaos-diplomacy-horizon-minutes` (new) | - | 60 |
| B | `bladeburner.js` `populationActions` | Undercover, Investigation, Tracking | Undercover, Investigation, Field Analysis (ranked) |
| C | `darknet.js --lab-threads` | 6 | 0 = all that fits (positive = cap) |
| C | `darknet.js --lab-walkers` | 3 | 1 |
| C | `darknet.js` `PROMOTE_THREADS` 4 / `MIN_PROMOTE_RAM` 64 | per host, 64 GB floor | 24 per held symbol network-wide, no floor; `PHISH_THREADS_TOTAL` 14 |
| D | `work-for-factions.js` Silhouette `repRequiredForFaction` (upstream constant) | 1.0e7 | 800e3 (x0.75 backdoored) |
| E | `stanek.js --top-up`, `--top-up-min-gain`, `--top-up-timeout` (new) | - | false / 1.5 / 600 s |
| E | `spend-hacknet-hashes.js --require-contractor`, `--contractor-max-age` (new) | - | true / 300 s |

Everything else keeps alainbryden's defaults.

## Skipped (suspected, not planned)

GO-1 (small-board favor farming), GO-2 (Slum Snakes ordering), HN-3 (hash valuation vs server boosts), progression 8 (rep-rate tick sampling), R9 stock-profit magnitude (the sizing rule is planned, the profit claim is not relied on). Deferred follow-up noted in C Task 0: keying darknet state by IP (stable across moves/restarts, unique across hostname reuse) — does not fix R15.

## Self-review

- Spec coverage: every confirmed finding in sections 1-5 plus R15 maps to a task in exactly one area plan (see each plan's own self-review); the three "Other observations" of section 2 are D Task 8.
- Placeholder scan: each area plan was scanned for TBD / "similar to task" / "handle edge cases" / "implement later"; the only hits are quoted upstream `TODO` comments inside old code and the self-review sentences themselves.
- Name consistency across plans: no shared identifiers between plans except `getNsDataThroughFile`, `log` and `getConfiguration` from `helpers.js`, which no plan changes.
