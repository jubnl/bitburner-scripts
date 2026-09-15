# Darknet crawler design

Date: 2026-09-15. Target: Bitburner v3.0.1 (web build is 3.0.2, no darknet changes). Repo: `bitburner-scripts`, branch `game-optimisation-3.0`.

## 1. Goal and scope

Fully automate the Darknet: discover and crack servers, spread agents, free blocked RAM, open caches, phish, promote stocks, cross air gaps, and solve the labyrinths for their augmentations (including The Red Pill). Mode is switchable at runtime between loot, labyrinth and balanced. Launched by `daemon.js`, opt-out with `--no-darknet`.

Non-goals: running daemon.js hack/grow/weaken batches on darknet RAM (1 core, servers vanish, no remote exec from home); manual terminal backdoors (only source of instability); automatic webstorms (opt-in flag only).

Decisions already made with the user: approach B (controller on home + thin agents), spare darknet RAM goes to `share` when daemon says sharing is worthwhile and to phishing otherwise.

## 2. Game facts the design relies on

Verified in the game source (paths under `bitburner-src/src`).

Access: `hasDarknetAccess = canAccessBitNodeFeature(15) || hasProgram(DarkscapeNavigator.exe)` (`DarkNet/utils/darknetAuthUtils.ts`). Full access (labs exist, extra models, hostname reuse) needs BN15 or SF15.

Sessions and reach: sessions are per PID, granted by a successful `authenticate` or by `connectToSession(host, password)` (any distance, sync, 0.05 GB, needs admin rights on the target). `exec` onto a darknet server needs a session and (direct connection or `backdoorInstalled`); `scp` needs only a session. Home is directly connected only to `darkweb`. Stasis links set `backdoorInstalled` without instability. Darknet servers are never `ns.scan` results and never hack targets.

Dynamics: mutation tick every `30000/depth` ms in BN15, `60000/depth` elsewhere. Per tick: island move 30%, add shallow servers 30%, delete 1-3 servers 10%, add 1-3 servers 10%, restart a backdoored server 10%, delete a backdoored server 5%, restart a random server 20%, move 3 servers 30%, add connections 50%, disconnect one server 50%. Immune: the server open in the UI, the terminal-connected one, stasis-linked ones, stationary ones (darkweb, labs). Restart keeps password, admin, files and caches, but kills scripts and sessions and clears backdoors. Offline deletes the server; a later server with the same name has a new password. Air gaps at depths 8, 16, 24, 32 are only crossed by migration. Net depth equals the current lab's depth: 7, 12, 19, 23, 29, 31, 36, 36. Reload keeps servers and passwords but reshuffles all connections and clears sessions, offline list, stock promotions, migration charge, maze and cooldowns. Any prestige regenerates everything.

Auth time (`DarkNet/effects/effects.ts` `calculateAuthenticationTime`): `850 * (5*chaReq + (difficulty+1)*100)/(charisma+150) * backdoorDebuff * underleveled * boots(0.8) * sf15.3(0.8) / (1 + 0.2*(threads-1)) * intBonus`, plus 50 ms per matching leading character for the TimingAttack model. Heartbleed is 1.5x that and refuses below the server's charisma requirement (code 451). Timeout chance (408) is `(backdooredServers-2)*0.03` clamped to 0.5; stasis-linked servers do not count.

Feedback: for normal servers `authenticate` only returns success or 401. The model feedback is read with `heartbleed(host, {peek:true, logsToCapture:1})`, whose first log line is always our own last attempt as JSON `{code, message, data, passwordAttempted}` (the game discards ambient noise for scripted players). Labs return `message` and `data` inline.

RAM: `memoryReallocation(host)` needs direct connection and admin, takes `max(8000*500/(500+cha), 200)` ms, frees `0.02 * 2*0.92^(difficulty+1) * threads * (1+cha/100)` GB per call (rounded to 0.01, so threads*cha must be large enough). Full clear drops a `.cache`, 30% a clue file, 15% `STORM_SEED.exe` (30 min global cooldown).

Loot: `openCache(exactName)` must run on that server; karma loss `difficulty+1`; reward uniform over money (`1.2^difficulty * 1e7 * (200+cha)/200 * crime_money * dnet_money * BN mult`, absent in BN8), next missing program then WSE/TIX/4S, free stock shares, clue files, and for `.d.cache` from phishing also up to 3 coding contracts. Phishing: `max(10000*400/(400+cha), 200)` ms per call, cache chance `0.005*crime_success*threads*(400+cha)/400` on a 3-minute global cooldown, money chance `0.05*crime_success*(200+cha)/200` paying `500*crime_money*dnet_money*(0.1+0.05*depth)*threads*(400+cha)/400*BN`.

Stasis: limit `1 + BrokenWings + Hammer + Staff` (1 to 4), `setStasisLink` targets own server only, 12 GB, `30000*1000/(cha+1000)` ms. Migration: `induceServerMigration(neighbour)` 4 GB, 6 s, charge `((cha+500)/(difficulty*200+1000))*0.01*threads`, moves the server on reaching 1 with depth range [-2, +4] anchored on its difficulty; charge stacks across scripts. Stock promotion: `promoteStock(sym)` 2 GB, `max(8000*600/(600+cha),200)` ms, adds `threads*(500+cha)/500` charge; volatility mult `1 + (1-e^(-0.001c)) + 2(1-e^(-0.0002c))` (max 4x), scaled by 0.4 every 75-tick market cycle.

Labyrinth (`DarkNet/effects/labyrinth.ts`): labs `th3_l4byr1nth` (depth 7, cha 300, 20x14), `cru3l_l4byr1nth` (12, 600, 30x20), `m3rc1l3ss_l4byr1nth` (19, 1500, 40x26), `ub3r_l4byr1nth` (23, 2500, 60x40), `et3rn4l_l4byr1nth` (29, 3000), `end13ss_l4byr1nth` (31, 3500), `f1n4l_l4byr1nth` (36, 4000), `b0nus_l4byr1nth` (36, 4000). Labs from the third onward are script-only. The current lab is connected to every server at depth `netDepth-1`. A walk is one `authenticate(lab, "north"|"east"|"south"|"west")` per step; `labreport()` (0 GB, adjacency required) returns `{coords:[x,y], north, east, south, west}`; `labradar()` returns a 7x7 ASCII view with `@` and `X`. Start is (1,1) plus a random offset of 0/2/4 per axis on the four largest labs, per PID; the exit is the far corner minus a similar offset. Success grants admin, a session, and a `the_great_work` cache (3 on the bonus lab); opening it queues the reward augmentation. Reward order: Broken Wings, Boots, Hammer, Staff, then Law, Sword, The Red Pill (BN15: The Red Pill at the fifth lab; BN8: never), then NeuroFlux forever. The next lab becomes current only after the reward is installed. Never call `connectToSession` on a lab (game bug corrupts the walker position).

## 3. Files

| File | Runs on | Role | RAM target |
|---|---|---|---|
| `darknet.js` | home | controller: state, planning, pushes files, launches walkers | under 8 GB |
| `darknet/agent.js` | every cracked server | local loop: probe, spread, spawn workers, report | under 5 GB (probe, getServerDetails, connectToSession, scp, exec, ls, fileExists, isRunning, files, ports) |
| `darknet/cache.js` | agent's server | opens every `.cache` on the server, reports rewards | 3.8 GB |
| `darknet/crack.js` | agent's server | authenticate + heartbleed loop for one neighbour using `solvers.js` | about 2.6 GB/thread |
| `darknet/realloc.js` | agent's server | memoryReallocation on self or a neighbour | 2.6 GB/thread |
| `darknet/phish.js` | agent's server | phishingAttack loop | 3.6 GB/thread |
| `darknet/migrate.js` | agent's server | induceServerMigration on a named neighbour | 5.6 GB/thread |
| `darknet/promote.js` | agent's server | promoteStock loop for named symbols | 3.6 GB/thread |
| `darknet/stasis.js` | agent's server | setStasisLink once | 13.6 GB |
| `darknet/lab.js` | server adjacent to the lab | labyrinth walker | about 2 GB/thread |
| `darknet/solvers.js` | library | one pure solver per model | n/a |
| `test/darknet-solvers.test.js` | Node | `node --test` unit tests with a port of the game's feedback | n/a |

`Remote/share.js` is reused as-is for the share workload. All scripts pass the identifier-collision check (no local identifier may equal an NS function name).

## 4. State and communication

`darknet/state.txt` on home, JSON, written only by the controller (write `state.tmp.txt`, then `state.txt`, keep `state.bak.txt`; validate on read, falling back to `state.bak.txt` and then to `state.tmp.txt` -- the tmp copy is the newest of the three and the only one that survives a crash between the two writes, so it is read last but it *is* read).

```
{ version: 1, resetTime: number, mode: "loot"|"labyrinth"|"balanced",
  passwords: { [host]: { password, modelId, difficulty, solvedAt, stale?: true } },
  servers:   { [host]: { depth, difficulty, modelId, maxRam, blockedRam, chaReq, neighbours: [], online, lastSeen, agentPid?, stasis, migrationCharge? } },
  labs:      { current, walkers: [{ host, pid, startedAt }], rewardQueuedAt?, completed: [] },
  plan:      { stasisTargets: [], migrationTargets: { [host]: [chargingHosts] }, promoteSymbols: [], charismaGoal, shareActive },
  stats:     { cracks: { [modelId]: { won, failed, attempts } }, sessionFailures: { [host]: count },
               ramFreed, cachesOpened, moneyFromCaches, phishSuccesses, promoteCalls } }
```

`darknet/passwords.txt` (host to password, subset of state) and `darknet/cmd.txt` (per server: mode, claimed crack targets, worker allocation in threads per worker type, migration target, promote symbols, stasis flag, share flag, walk target and walker threads, storm flag, stop flag) are scp'd by the controller to every online known server each loop after `connectToSession`. There is one command *file name*, not one per host: the controller writes each host's own command object to `darknet/cmd.txt` on home and immediately scp's it to that host, so every server ends up with a `darknet/cmd.txt` holding its own orders.

`stats.cracks` counts crack.js outcomes per model only. A refused `connectToSession` (a password gone stale) is counted separately in `stats.sessionFailures[host]`, and the reason of the most recent failure of either kind is kept in `servers[host].lastReason`, so a host that never gets cracked can be diagnosed from `--status`.

Reports: agents `tryWritePort(PORT, JSON)` with a local retry queue. Port default 15 (`--port`). Message types: `hello`, `server` (details + neighbours), `crack` (host, model, success, password?, attempts, reason), `freed` (host, GB), `cache` (host, name, reward text), `clue` (host, file, parsed passwords/hints), `worker` (type, host, threads, result), `gone` (host), `walker` (lab, pid, steps, done?, password?). Every message carries `ts`, `from`, `pid`.

Prestige detection: `ns.getResetInfo().lastAugReset` differs from `state.resetTime` → wipe state (passwords included).

## 5. Solver library

`solvers.js` exports `solve(details, attempt, options)` dispatching on `details.modelId`, and `BUDGETS`, the attempt cap per model. `attempt(password)` resolves to `{success, feedback}` where `feedback` is the parsed heartbleed JSON (or the inline lab response). Budgets are flat hard caps -- one number per model, covering the worst password length and charset that model can produce, rather than a formula in the password length -- and a solver returns `null` when exhausted or when feedback contradicts the model. The table below is `BUDGETS` as implemented.

| Model id | Strategy | Budget |
|---|---|---|
| ZeroLogon | `""` | 1 |
| DeskMemo_3.1 | last whitespace token of `passwordHint` | 1 |
| FreshInstall_1.0 | `admin, password, 0000, 12345` | 4 |
| Laika4 | `fido, spot, rover, max` | 4 |
| TopPass | game's 93-entry common list, in order | 93 |
| EuroZone Free | 27 EU countries as in the game | 27 |
| CloudBlare(tm) | `data.replace(/[^0-9]/g, "")` | 1 |
| Pr0verFl0 | N from the hint, submit `"0".repeat(2N)` | 1 |
| NIL (Yesn_t) | probe `c.repeat(L)` per charset symbol, read per-position yes/yesn't | 64 |
| DeepGreen (Mastermind) | candidate set filtered by exact/misplaced counts, minimax pick | 30 |
| 2G_cellular (TimingAttack) | prefix oracle from "mismatch at (i)", build left to right | 500 |
| 110100100 | 8-bit binary groups to chars | 1 |
| OrdoXenos | XOR cipher with per-char 5-bit masks | 1 |
| BellaCuore (Roman) | decode; above difficulty 8 binary search on ALTUS NIMIS / PARUM BREVIS | 14 |
| AccountsManager_4.2 | binary search over `[0, 10^L)` on Higher/Lower | 60 |
| PrimeTime 2 | largest prime factor by trial division | 1 |
| Factori-Os | divisibility oracle over the 25 small and 84 large primes, exponent search, then product | 200 |
| BigMo%od | CRT with moduli 31,29,27,25,23,19,17,13,11 using n = 1e16+r | 12 |
| OctantVoxel | parse base (integer or fractional) with 0-9A-Z digits | 1 |
| MathML | undo unicode operators, strip `ns.exit(),`, take text before the first comma, evaluate with a hand-written parser (never `eval`) | 1 |
| KingOfTheHill | scan at one-width steps then analytic Gaussian solve | 120 |
| RateMyPix.Auth (Spice) | exact-count oracle, multiset then elimination | 120 |
| PHP 5.4 (Sorted) | permutations of the sorted multiset; RMS deviation guidance when L >= 5 | 30 |
| OpenWebAccessPoint | regex `host:password` up to difficulty 16; intersect captures above | 10 |
| (The Labyrinth) | handled by `lab.js`, not here | n/a |

Rules: retry the same password on 408; skip feedback-driven models when `charisma < chaReq` and report the requirement; try clue passwords first; report a won password before doing anything else.

## 6. Agent loop

Every 3 to 5 seconds: read local password and command files; `probe`; `getServerDetails` per neighbour; report changes; for unknown neighbours not claimed elsewhere spawn `crack.js` with `min(allotted threads (default 6), floor(freeRam / 2.6))` threads; for known neighbours without an agent `connectToSession` (admin rights survive a restart, so no re-authentication is needed; only an offline-then-new server needs a fresh crack), scp agent + workers + files, exec agent with `preventDuplicates`; allocate free RAM in the order given by the command file: realloc (self, then fully blocked neighbours), migrate, promote, share, phish; spawn `cache.js` whenever `ls` shows a `.cache` file (it opens each by the exact name from `ls`; the agent holds its RAM back from phish/share and asks a running `phish.js` to exit via `darknet/phish-resize.txt` when a cache, a stasis change or a pending crack no longer fits, and likewise when a whole extra phish thread would fit); read new `.data.txt` and `.lit` and report clues; run `stasis.js` if commanded; exit on stop flag. Agents never decide stasis, migration, storms or lab walks.

## 7. Controller

Every 10 s: drain the port, merge into state, persist, recompute the plan, push files. Bootstrap by exec'ing the agent on `darkweb`. On start, `connectToSession` to every known server from home and re-exec agents where possible.

Modes: loot ranks crack targets by `1.2^difficulty` and RAM, stasis to the largest server (phishing base) then the deepest ones (permanent backdoored footholds), migration only toward islands, all spare RAM to phishing; labyrinth ranks by depth then difficulty, aims migration at servers just above air-gap rows (7, 15, 23, 31), pins the chain adjacent to the current lab with stasis links, starts walkers when an adjacent linked server exists and charisma meets the gate; balanced picks labyrinth when charisma meets the current gate and the deepest known online server is within 6 rows of the lab depth (or a migration toward it is charging), otherwise loot, re-evaluated each loop. `--mode` flag, overridable via the script config file at runtime.

Charisma goal: the lowest charisma that unlocks the next blocked action (lab gate or cheapest blocked crack) is written to `/Temp/darknet-charisma-goal.txt`.

Scarce resources: stasis candidates must have `maxRam - blockedRam >= agent + stasis.js` (18.15 GB) or the link could never be applied; stasis assignment respects the limit and removes links no longer useful -- the command file's `stasis` flag is two-way, so a host the plan still wants gets `stasis: true` and a host holding a link the plan has dropped gets `stasis: false` and runs `stasis.js --unlink` (the link budget therefore counts only the links the plan intends to keep, since every other one is being released); migration targets get charging agents on all their neighbours; `--allow-webstorm` (default false) permits `unleashStormSeed` in loot mode when the frontier has been stale for an hour; never manual backdoors.

Labyrinth: when a lab is adjacent to a pinned server with enough free RAM, launch `--lab-walkers` (default 3) instances of `lab.js` with `--lab-threads` (default 6). On completion the walker execs the agent on the lab, the agent opens the cache, the controller records `rewardQueuedAt` and pauses lab spending until the reset time changes. The controller never kills a walker: a walker whose host stops neighbouring the lab sees `labreport` fail and exits on its own, and the controller frees its roster slot once the walker has been silent for the 5-minute walker TTL (walkers report progress at least once a minute).

`--status` prints the summary; `--kill` sends stop flags and kills agents via sessions.

## 8. Labyrinth walker

`lab.js` on an adjacent server. Loop: `labreport()`; pick a move by DFS with a visited set on the cell lattice, biased toward the far corner; every 5 steps `labradar()` and switch to a direct path when `X` is visible; `authenticate(lab, direction)`; parse "moved", "cannot go", "successfully navigated"; on 451 report and exit; on inconsistent coordinates (reload regenerated the maze) restart from `labreport`. On success store the returned lab password, scp and exec the agent onto the lab, report `walker done`.

## 9. Integration

- `daemon.js`: launch `darknet.js` when `DarkscapeNavigator.exe` exists on home or `currentNode == 15` or SF15 owned; `--no-darknet`; write `/Temp/share-active.txt` from its existing share decision.
- `work-for-factions.js` and `sleeve.js`: when idle and the charisma goal exceeds current charisma, take the Leadership course (flags default on).
- `autopilot.js`: no change; a queued lab reward already counts as an aug awaiting install.
- `stockmaster.js`: unchanged; controller reads `/Temp/stock-probabilities.txt` for promotion targets; `--no-promote`.

## 10. Failure handling

Restart, offline, reload, prestige, 408, 451, 453, 454, fully blocked servers, port overflow, state corruption, home RAM: as described in sections 4, 6 and 7. Additional: a crack whose feedback contradicts the model aborts and marks the server for re-probe; exec failures retry `connectToSession` once, then report and mark the server for a fresh crack if the password is refused; a walker whose host loses adjacency to the lab gets a failing `labreport` ("You feel disconnected..."), reports the reason and exits by itself after a few retries; the controller does not kill it, it simply drops the walker from the roster once it has been silent for the walker TTL (5 minutes) and hands the slot to another adjacent host.

## 11. Testing plan

1. `node --test test/darknet-solvers.test.js`: every model against a port of `authentication.ts` feedback, asserting the password is found within budget over many random seeds.
2. Collision check and in-game `mem` for every script.
3. Headless game (scratchpad harness) with a copy of `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz` (BN1, SF1-4, DarkscapeNavigator owned, 33 darknet servers already generated, charisma 6): run `darknet.js --mode loot` for 20 minutes; assert agents spread beyond depth 0, cracks per model, RAM freed, caches opened, no runtime errors; reload the page and assert sessions and agents recover.
4. Same save with SF15 level 1 and charisma exp raised via the save editor so charisma is at least 300: `--mode labyrinth`, assert a walker completes `th3_l4byr1nth` and an augmentation is queued.
5. Runtime mode switch and `--kill`.

## 12. Risks

Charisma is the pacing resource: with charisma 6 most feedback-driven models are unreachable, so early progress is direct-decode and dictionary servers only. Mutation at depth is fast (under a second per tick at depth 36); deep pushes rely on stasis links and quick re-launch. Port capacity defaults to 50 messages; agents batch reports. The game's `openCache` filename quirk is avoided by always using `ls` output.
