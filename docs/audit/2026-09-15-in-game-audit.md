# In-game correctness audit of the automation scripts (2026-09-15)

Branch audited: `game-optimisation-3.0` (HEAD at the time: `ea64c1a`), scripts in this repository as they run inside
Bitburner v3.0.1. Every finding below was confirmed against the game's TypeScript source in
`/home/jubnl/dev/bitburner/bitburner-src/src` (file and line cited in each entry); unconfirmed suspicions were
dropped and are listed per section under "Unconfirmed (dropped)".

Method: four independent reviewers, one per subsystem, each required to cite the decisive game source lines;
the coordinator then re-read every cited script line and game source line before accepting a finding.

Already fixed before this audit (not listed again): darknet hostnames starting with `--` crashing workers
(commit `4c4d85e`); phish.js starving cache/stasis workers and stasis planning picking hosts that cannot hold a
link (commit `ea64c1a`).

Totals: 5 high, 15 medium, 31 low (51 findings). None fixed yet.

Origin column: `branch` = introduced (or made worse) by this branch's patches; `upstream` = present in alainbryden's
original scripts.

## Summary

| Sev | ID | Origin | Finding |
|---|---|---|---|
| high | DN-F1 | branch | `ns.dnet.probe()` shuffles its result, so the agent's "report only on change" self-report fires every loop and floods the report port |
| high | FT-F1 | upstream threshold; branch raised the divisor 5→25 | `ns.gang.getBonusTime() > 0` is true ~90% of the time in normal play, so gangs.js permanently thinks a territory tick is imminent and parks the whole gang on Territory Warfare |
| high | FT-F10 | upstream | stockmaster.js liquidates its entire portfolio on every loop when the BitNode option "Disable 4S Data" is set |
| high | SG-F1 | upstream | `autopilot.js` assigns to an undeclared `_`, which throws in a module — the casino never runs and, worse, daemon.js is killed every loop |
| high | SG-F2 | upstream | `crime.js` crashes on its first loop — `work-for-factions.js` module globals are `undefined` when imported |
| medium | DN-F2 | branch | `crack.js`'s heartbleed feedback match can never succeed on Pr0verFl0 (BufferOverflow) servers, turning any wrong clue attempt into a permanent retry loop |
| medium | DN-F3 | branch | `BUDGETS.DeepGreen = 30` is smaller than the fixed 61-probe cost `solveByExactCount` pays on alphanumeric Mastermind servers, so those servers can never be cracked |
| medium | DN-F4 | branch | air-gap migration targets are picked by current `depth`, but the game re-places a migrated server relative to its `difficulty` |
| medium | DN-F5 | branch | the walker copies its own host's `cmd.txt` onto the solved labyrinth, so the agent it starts there puts a stasis link on the labyrinth — permanently burning one of the 1–4 global stasis slots |
| medium | FT-F11 | upstream | spend-hacknet-hashes.js treats permanently-impossible `spendHashes` failures as transient and retries forever, buying hacknet capacity with real money to chase them |
| medium | FT-F13 | upstream | go.js `getAggroAttack` / `getDefAttack` compare the whole liberties array to a number — the "south" attack direction is dead code |
| medium | FT-F14 | branch | go.js opponent rotation can never advance — `rep` only accrues for factions you have already joined, and `????????????` is not a faction |
| medium | FT-F5 | upstream | a transient "another sleeve already works for this faction" throw is mis-read as "work type unsupported" and permanently blacklists the faction |
| medium | FT-F6 | branch | the new `--darknet-charisma` task raises the *sleeve's* charisma, but the patch also stopped syncing sleeves, so the player gains ~1% of it |
| medium | HK-F1 | upstream | `arbitraryExecution` never records the scripts it just copied (Set treated as a dictionary), so it re-`scp`s on every task scheduled to that host |
| medium | HK-F2 | upstream | `host-manager.js` sizes RAM *upgrades* with the full purchase price, so it needs ~2× the money the game actually charges (and no-ops at the boundary) |
| medium | HK-F3 | branch | hard-coded BitNode multiplier fallback in `helpers.js` has 7 wrong values (all 6 non-trivial `DarknetMoneyMultiplier` entries, plus BN14 `DefenseLevelMultiplier`) |
| medium | HK-F4 | upstream | `work-for-factions.js` launch guard is a no-op (misplaced parenthesis), so it launches at any home RAM and interrupts the startup study |
| medium | SG-F3 | upstream | `work-for-factions.js` IT-track hacking requirements are 100 too low for tiers 2 and 3 |
| medium | SG-F4 | upstream | `autopilot.js` operator-precedence bug makes the "low SF4 level" fallback unreachable — start-up loops forever |
| low | DN-F6 | branch | island migration targets are not filtered by `isStationary`/`darkweb`, and `induceServerMigration` *throws* on a stationary target |
| low | DN-F7 | branch | `launchWalkers`' per-host thread estimate ignores `blockedRam`, so a RAM-blocked lab-adjacent host can hold a `--lab-walkers` slot while never being able to start a walker |
| low | DN-F8 | branch | `lab.js` treats a `DirectConnectionRequired` / `ServiceUnavailable` authenticate failure as a completed move |
| low | DN-F9 | branch | `labradar` cannot see past one cell, so `lab.js` pays a full authentication delay every 5 steps for a target it can essentially never obtain |
| low | FT-F12 | upstream | `if (ns.hacknet.purchaseNode())` mis-reads the return value — a failed purchase is logged as SUCCESS |
| low | FT-F15 | upstream, made likely by branch | go.js chooses its play style once and never re-reads the opponent when a new game starts |
| low | FT-F16 | upstream | go.js `getSurroundEnemiesFull` scores the wrong cell for the down-left diagonal |
| low | FT-F17 | upstream | go.js `getSnakeEyes` never scans the last row or column of the board |
| low | FT-F18 | upstream | go.js `--runOnce` exits without playing when the previous game is already over |
| low | FT-F19 | upstream | go.js SF14-level detection silently degrades to 0, disabling cheats and mis-computing the favor cap |
| low | FT-F2 | upstream | `"Unassigned"` is in the candidate task list, and the wanted-downgrade loop prefers it over training |
| low | FT-F20 | upstream | go.js `startNewGame` logs (and requests) a board size the game ignores for `????????????` |
| low | FT-F21 | upstream | stanek.js calls `ns.stanek.activeFragments()` before verifying the gift is installed |
| low | FT-F22 | upstream | optimize-stanek.js only searches grids up to 6×5, so it cannot plan the grids SF13.2+ / BN13 actually give you |
| low | FT-F23 | upstream | optimize-stanek.js declares a `FragmentType.HackingChance` that does not exist in the game |
| low | FT-F3 | upstream | operator-precedence bug makes the auto "money vs respect" focus never evaluate `respect < 9000` |
| low | FT-F4 | upstream | members are put on Territory Warfare while `territoryClashChance` is still 0, so the low-defense death guard is bypassed on the first engaged tick |
| low | FT-F7 | upstream | the `--crime` option is ignored because of operator precedence |
| low | FT-F8 | upstream | bladeburner.js's skill priority key `"Evasive Systems"` never matches the game's skill name `"Evasive System"` |
| low | FT-F9 | upstream | the "don't interrupt a manually-started final BlackOp" special case stores an object where a name is expected, so it never fires |
| low | HK-F10 | branch | `git-pull.js` — the new `'test/'` omit-folder entry has no effect on the normal (GitHub API) download path |
| low | HK-F11 | upstream | `--looping-mode` XP farming never gets a host assignment (dictionary keyed by name, read by index; `in` used on an array of values) |
| low | HK-F12 | upstream | `startup_withRetries` re-runs `startup()` up to 6 times after a *clean* return |
| low | HK-F5 | upstream | `kill-all-scripts.js` compares `ns.ps()` (an array) to a number, so it never waits for scripts to die before deleting their files |
| low | HK-F6 | upstream | `Tasks/backdoor-all-servers.js` uses `>` where the game uses `>=`, skipping servers whose requirement exactly equals your hacking level |
| low | HK-F7 | upstream | `Remote/grow-target.js`'s misfire warning can never fire on a real target |
| low | HK-F8 | upstream | `Remote/manualhack-target.js` reads a different argument layout than `daemon.js` passes |
| low | HK-F9 | upstream | `Tasks/ram-manager.js` never handles the `restrictHomePCUpgrade` BitNode option and error-toasts forever |
| low | SG-F5 | upstream | `casino.js` can never read a dealer "10" card |
| low | SG-F6 | upstream | `casino.js` travel-confirmation click is guarded by an always-true condition |
| low | SG-F7 | upstream | `run-command.js -s` (silent mode) destroys the command it was given |

IDs: DN = darknet crawler, HK = hacking daemon/helpers, SG = singularity/progression, FT = gangs/sleeves/bladeburner/go/stanek/stocks/hacknet.

---

## DN: Darknet crawler (darknet.js, darknet/*)

Source report: `darknet-report.md` (verified line by line by the coordinator).

Scope: `darknet.js`, `darknet/{agent,lib,solvers,crack,cache,realloc,phish,migrate,promote,stasis,lab}.js`,
plus how `daemon.js` launches `darknet.js` (`daemon.js:44`, `:437`, `:964-965`) — no finding there, see
"Checked and OK".

Findings: 1 high, 4 medium, 4 low.

---

### DN-F1: `ns.dnet.probe()` shuffles its result, so the agent's "report only on change" self-report fires every loop and floods the report port
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/agent.js:45`, `:56-59`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Darknet.ts:330-333`
  ```ts
        helpers.log(ctx, () => `Returned ${out.length} connections for ${server.hostname}`);
        // The order of results is shuffled. This is to avoid clues to the network structure
        // like there are in the standard network's scan results order.
        return shuffle(out);
  ```
  (`import { shuffle } from "lodash";` — `Darknet.ts:50`)
- What the script assumes / does: `agent.js:56` builds `myKey = JSON.stringify([...,, neighbours])` from the raw
  `ns.dnet.probe()` array and only dispatches a `server` report about itself when that key differs from the last one,
  with a forced report every `SELF_REPORT_INTERVAL` (60 s). The intent (comment at `agent.js:53-55`) is one self-report
  per minute on a quiet host.
- What the game actually does: `probe()` returns a freshly shuffled array on every call. For a host with n≥2 darknet
  neighbours the serialised order differs with probability 1 − 1/n! (50 % at n=2, ≥83 % at n=3, ≥96 % at n=4), so
  `myKey` almost always changes and the agent dispatches a full `server` report **every `--interval` (4 s) loop**.
- Concrete failure scenario: a mid-game net has `getNetDepth()*NET_WIDTH*SERVER_DENSITY` movable servers
  (`NetworkMovement.ts:217-222`) — e.g. 12·8·0.6 ≈ 57, later ~170. Each agent emits ~2.5 self-reports per 10 s
  controller loop, i.e. 140–430 messages per drain window, against `Settings.MaxPortCapacity = 50`
  (`src/Settings/Settings.ts:41`, enforced at `src/NetscriptPort.ts:65`). The port is permanently saturated.
  `crack.js` writes its result with a bare `ns.tryWritePort` and **drops the line on failure**
  (`darknet/crack.js:13`), so a solved password can be lost: `crack.js:45` only persisted it into the *local*
  `darknet/passwords.txt`, which `pushFiles` (`darknet.js:819, 844`) overwrites with the controller's view on the
  next loop. The host is then re-cracked from scratch. Walker progress (`lab.js:143-147`) and `freed`/`phish`
  reports are equally starved (agent-side queue is capped at `MAX_QUEUED = 200` and drops the oldest).
- Severity: **high** (silently loses completed crack work and starves every other report type)
- Suggested fix: key on a canonical order — `[...neighbours].sort()` — inside the `myKey` computation (leave the
  dispatched `neighbours` payload as-is, or sort it too; nothing downstream depends on probe order).

---

### DN-F2: `crack.js`'s heartbleed feedback match can never succeed on Pr0verFl0 (BufferOverflow) servers, turning any wrong clue attempt into a permanent retry loop
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/crack.js:22-40` (specifically `:35-36`, `:24`, `:39`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/models/packetSniffing.ts:99-119`
  ```ts
    if (server.modelId === ModelIds.BufferOverflow) {
      ...
      const [passwordInBuffer, overflow] = (passwordResponse.data ?? "").split(",");
      message = { code: ..., passwordAttempted: passwordInBuffer, passwordExpected: overflow, message: ... };
    }
  ```
  and `src/DarkNet/effects/authentication.ts:101-118` (`receivedBuffer = overwrittenBuffer.slice(0, server.password.length)`,
  `data = `${receivedBuffer},${expectedValueBuffer}``).
- What the script assumes / does: after a failed `authenticate`, `crack.js` peeks one heartbleed log and requires
  `fb.passwordAttempted === password` before accepting it as its own feedback; otherwise it treats it as a race with
  another PID and retries the whole attempt, up to 5 times, then `throw new Error("timeouts")`.
- What the game actually does: for `ModelIds.BufferOverflow` the logger **rewrites** `passwordAttempted` to
  `receivedBuffer` — the first `password.length` characters of the overwritten buffer — not the attempted string.
  It only coincides with the attempt when `attempt.length === password.length`. `getBufferOverflowConfig`
  (`ServerGenerator.ts:289-297`) makes passwords 4–7 alphanumeric characters, so any attempt of a different length
  produces a mismatch on every retry.
- Concrete failure scenario: a Pr0verFl0 host sits next to a host carrying a `.data.txt` clue
  (`addClue` writes `Remember this password: X` with ~10 % probability per crack, `effects/effects.ts:144-155`).
  `crack.js:18-20` feeds every such clue into `solve`'s clue loop first. The clue "hunter2" (7 chars) against a
  5-char password yields a log entry with `passwordAttempted: "hunte"` → mismatch → `continue` → 5 full
  authenticate+heartbleed round trips (each ~2.5× the server's auth delay) → `Error("timeouts")` → `crack.js`
  aborts **before the Pr0verFl0 solver ever runs**. The agent sees `passwords[h] === undefined` next loop
  (`agent.js:33`, `:43-44`) and relaunches `crack.js`, which repeats forever: the host is never cracked and a
  crack worker is permanently occupied.
- Severity: **medium** (permanent no-progress loop on an entire model class whenever a clue file exists)
- Suggested fix: accept the log when `details.modelId === "Pr0verFl0"` and `fb.passwordAttempted` is a prefix of
  the attempt (or simply skip the identity check for that model and rely on `fb.code`/`fb.passwordExpected`).

---

### DN-F3: `BUDGETS.DeepGreen = 30` is smaller than the fixed 61-probe cost `solveByExactCount` pays on alphanumeric Mastermind servers, so those servers can never be cracked
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/solvers.js:673` (budget), `:547-551` (dispatch),
  `:332-345` (the `cs.length - 1` multiset scan), `:194-196` (`charset`), `:689-695` (budget enforcement)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/controllers/ServerGenerator.ts:195-203`
  ```ts
  export const getMastermindHintConfig = (difficulty: number): ServerConfig => {
    const alphanumeric = difficulty > 16 && Math.random() < 0.3;
    const passwordLength = Math.min((alphanumeric ? -1 : 2) + difficulty / 5, 10);
    return { modelId: ModelIds.MastermindHint, password: getPassword(passwordLength, alphanumeric), ... };
  ```
  plus `ServerGenerator.ts:581-595` (`getPasswordType` returns `"alphanumeric"`, `numbers + letters` = 62 symbols).
- What the script assumes / does: for `cs.length ** L > 200000` the DeepGreen solver delegates to
  `solveByExactCount`, whose first phase is an unconditional loop over `cs.length - 1` symbols, each one costing one
  `tryPw`. `solve` throws `BudgetExceeded` once `count >= budget` (30).
- What the game actually does: whenever `alphanumeric` is true, `charset()` is 62 symbols, so phase 1 alone needs
  61 attempts. Because `alphanumeric` requires `difficulty > 16`, `L = min(-1 + difficulty/5, 10) ≥ 3`, and
  `62**3 = 238328 > 200000`, so the enumeration branch is never taken — every alphanumeric DeepGreen server takes
  the `solveByExactCount` path and aborts at attempt 30, long before any positional probe.
- Concrete failure scenario: any `DeepGreen` server with difficulty ≥ 17 that rolled the 30 % alphanumeric branch:
  `crack.js` reports `reason: "budget"`, the agent retries it on every loop forever, and the host is never cracked.
  The numeric branch is also under-budgeted at the top end: a 9-digit all-distinct password needs
  9 (multiset) + 8+7+…+0 = 36 (positional) + 1 (final) = 46 attempts. `RateMyPix.Auth` has the same shape
  (`solvers.js:573-576`, budget 120) and overruns in the worst case (61 + 91 + 1 = 153) once `getSpiceLevelConfig`
  goes alphanumeric at `difficulty > 8` (`ServerGenerator.ts:338-346`).
- Severity: **medium** (a whole model class is permanently uncrackable, and the retries burn auth delays)
- Suggested fix: raise `BUDGETS.DeepGreen` to at least `cs.length + L*(L-1)/2 + 2` (≈ 120 for the alphanumeric case),
  or compute the budget from `details.passwordFormat`/`passwordLength` instead of a flat constant.

---

### DN-F4: air-gap migration targets are picked by current `depth`, but the game re-places a migrated server relative to its `difficulty`
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet.js:684-692` (`if ((Number(entry.depth) || 0) !== row - 1) continue;`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/effects/effects.ts:257-260`
  ```ts
    if (newCharge >= 1) {
      moveDarknetServer(server, 2, 4);
  ```
  and `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/controllers/NetworkMovement.ts:230-250`
  ```ts
  export const moveDarknetServer = (server, maxDepthDecrease = 3, maxDepthIncrease = 3,
                                    startingDepth = server.difficulty): boolean => {
    ...
    const positionOptions = getAllOpenPositions(startingDepth - maxDepthDecrease, startingDepth + maxDepthIncrease);
  ```
- What the script assumes / does: `planLabyrinth` selects every online host whose **current depth** is exactly
  `row - 1` (one row below an air gap) and charges migrations on it, on the assumption that a completed migration
  moves it across the gap. `chooseMode` (`darknet.js:714-719`) even flips the whole controller into `labyrinth`
  mode on the strength of such a charge.
- What the game actually does: the completed migration relocates the server into
  `[server.difficulty - 2, server.difficulty + 4]` (clamped to `getNetDepth() - 1` and excluding air-gap rows,
  `darknetNetworkUtils.ts:16-34`). The server's current depth is irrelevant to where it lands.
- Concrete failure scenario: second labyrinth (`cru3l_l4byr1nth`, depth 12, so `getNetDepth() = 12`), air gap at
  row 8. A server sitting at depth 7 with `difficulty = 4` (reachable: its previous move allowed depth up to
  `difficulty + 3`) gets `plan.migrationTargets[name]`, `MIGRATE_THREADS = 10` of migrate.js work and repeated
  6-second `induceServerMigration` calls. On completion `getAllOpenPositions(2, 8)` yields only rows 2–7
  (row 8 is an air gap), so the server moves back *above* the gap and the gap is never crossed. The controller
  re-selects it next loop and stays stuck in this cycle, keeping `mode = labyrinth` indefinitely.
- Severity: **medium** (degraded/never-progressing air-gap crossing, wasted migrate threads and charisma time)
- Suggested fix: select air-gap migration candidates by `entry.difficulty` (need `difficulty + 4 > row`, i.e.
  `difficulty >= row - 3`) rather than by `entry.depth`; `difficulty` is already stored in `state.servers`
  from `getServerDetails`.

---

### DN-F5: the walker copies its own host's `cmd.txt` onto the solved labyrinth, so the agent it starts there puts a stasis link on the labyrinth — permanently burning one of the 1–4 global stasis slots
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/lab.js:240-252` (`deliverAgent` copies `FILES.cmd`
  then execs `darknet/agent.js` on the lab), `darknet/agent.js:145-150` (acts on `cmd.stasis`),
  `darknet.js:519-527` (`assignStasis` filters lab hosts out of the linked list),
  `darknet.js:673-682` (walk hosts and stasis targets are the same set of lab-adjacent hosts)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/effects/effects.ts:211-243`
  ```ts
  export const getStasisLinkLimit = (): number => { return 1 + brokenWingLimitIncrease + hammerLimitIncrease + staffLimitIncrease; };
  ...
  export const setStasisLink = (ctx, server, shouldLink) => {
    const stasisLinkCount = getStasisLinkServers().length;
    if (shouldLink && stasisLinkCount >= stasisLinkLimit) { ... StasisLinkLimitReached ... }
    server.hasStasisLink = shouldLink;
  ```
  with `getStasisLinkServers = () => getAllDarknetServers().filter((s) => s.hasStasisLink)`
  (`utils/darknetNetworkUtils.ts:101`) — **all** darknet servers, labyrinths included (labs are created as real
  `DarknetServer`s with `maxRam: 128`, `blockedRam: 0`, `NetworkGenerator.ts:235-261`), and
  `ns.dnet.setStasisLink` targeting the script's own host passes `checkDarknetServer` unconditionally
  (`Darknet.ts:339-348`, early-out at `offlineServerHandling.ts:98-101`).
- What the script assumes / does: `deliverAgent` ships `[...AGENT_FILES, FILES.passwords, FILES.cmd]` to the lab and
  starts `darknet/agent.js` there so `cache.js` can open the `the_great_work` cache. The cmd file it ships is the
  **walk host's** command file, and in `planLabyrinth` the walk hosts are exactly the lab-adjacent hosts that
  `assignStasis` also pins, so that file normally carries `stasis: true`. The lab has no
  `darknet/stasis-done.txt`, so `agent.js:146` sees `cmd.stasis && stasisMark !== "1"` and execs `stasis.js`
  (128 GB free ≫ 18.15 GB needed).
- What the game actually does: `setStasisLink` happily links the labyrinth and counts it in the global
  `getStasisLinkServers()` total. The controller never sees it: `assignStasis` strips lab hosts from
  `getStasisLinkedServers()` before computing `kept`/`stasisRelease`, so the lab link is neither counted against
  the budget nor ever released.
- Concrete failure scenario: with `getStasisLinkLimit() === 2` (The Broken Wings installed), the first labyrinth
  win leaves `th3_l4byr1nth` holding a link. From then on the controller plans 2 links, but only 1 slot is free;
  the second host's `stasis.js` returns `StasisLinkLimitReached (453)` while `agent.js:147` has already written
  `stasisMark = "1"`, so it never retries. The player permanently loses half the stasis capacity for the reset,
  and the lab is marked backdoored (`setStasisLink` also sets `backdoorInstalled = true`).
- Severity: **medium** (permanent loss of a scarce, non-recoverable resource for the rest of the reset)
- Suggested fix: have `deliverAgent` write a neutral command file to the lab (stasis false, walk null, all threads 0,
  cache work only) instead of copying the walk host's `cmd.txt`; and/or stop filtering lab hosts out of `linked`
  in `assignStasis` so a stray lab link is at least counted and released.

---

### DN-F6: island migration targets are not filtered by `isStationary`/`darkweb`, and `induceServerMigration` *throws* on a stationary target
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet.js:575-586` (island loop skips only `!entry.online`
  and `isLabHost(name)`; compare `:564-566`, which does filter `name !== "darkweb"` and `entry.isStationary !== true`
  for stasis targets), `darknet/migrate.js:17` (no try/catch)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Darknet.ts:417-420` and
  `/home/jubnl/dev/bitburner/bitburner-src/src/DarkNet/effects/offlineServerHandling.ts:78-81`
  ```ts
    if (options.preventUseOnStationaryServers && targetServer.isStationary) {
      const result = `${host} is not a valid target: it is a stationary server.`;
      throw errorMessage(ctx, result);
    }
  ```
- What the script assumes / does: any online non-lab host that reported itself with an empty neighbour list is
  treated as an island and handed to `migrate.js` as `migrateTarget`. `migrate.js` calls
  `await ns.dnet.induceServerMigration(target)` and only handles `result.code !== 200`.
- What the game actually does: for a stationary server the API **throws** rather than returning
  `{success:false}`. `darkweb` is the one non-lab stationary darknet server
  (`NetworkGenerator.ts:79-83`, `darkweb.isStationary = true`).
- Concrete failure scenario: `ns.dnet.probe()` on `darkweb` returns only its *darknet* neighbours
  (`Darknet.ts:320-324` skips `home`), so if mutation momentarily deletes every depth-0 server
  (`deleteRandomDarknetServers`, `NetworkMovement.ts:154-163` — nothing prevents that between
  `addLowLevelServersIfNeeded` passes) the darkweb agent reports `neighbours: []`. `planLoot` then sets
  `migrationTargets["darkweb"]`, `buildCmd` hands it to a depth-0 charger, and that host's `migrate.js` dies with
  an uncaught `is not a valid target: it is a stationary server`. The agent restarts it on the next loop, so the
  error repeats until the plan changes.
- Severity: **low** (narrow trigger window, but a crashing worker in a retry loop)
- Suggested fix: apply the same `name !== "darkweb" && entry.isStationary !== true` filter to the island loop that
  `planLoot` already applies to stasis candidates.

---

### DN-F7: `launchWalkers`' per-host thread estimate ignores `blockedRam`, so a RAM-blocked lab-adjacent host can hold a `--lab-walkers` slot while never being able to start a walker
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet.js:940-944` and `:955-964`
  (`threadsForHost` uses `maxRam - WORKER_RAM.agent - 0.5` only), vs
  `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/lib.js:192-195` (`canHoldStasis`, which *does* subtract `blockedRam`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Netscript/NetscriptWorker.ts:243`
  ```ts
        server.updateRamUsed(roundToTwo(server instanceof DarknetServer ? server.blockedRam : 0));
  ```
  plus `src/DarkNet/effects/ramblock.ts:87-92` (`applyRamBlocks`) and `:97-110` (`getRamBlock` can block
  16/32/`maxRam-8` on a ≤64 GB server, or up to `maxRam` above that).
- What the script assumes / does: the controller picks lab-adjacent hosts sorted by `maxRam` descending, accepts any
  with `threadsForHost(host) >= 1`, and puts them in `plan.walkHosts` — which is capped at `--lab-walkers`.
- What the game actually does: a darknet server's blocked RAM is charged to `ramUsed`, so usable RAM is
  `maxRam - blockedRam`. `agent.js:64-66` re-clamps with real free RAM and simply launches nothing when
  `walkThreads < 1`.
- Concrete failure scenario: a lab-adjacent host with `maxRam 16, blockedRam 8` has 8 GB usable, 3.5 GB free beside
  the 4.5 GB agent — not enough for one 3.95 GB `lab.js` thread. `threadsForHost` computes
  `floor((16 − 4.5 − 0.5)/3.95) = 2`, so the controller selects it, writes `walk`/`walkThreads` into its command
  file, and counts it against `--lab-walkers`. No `walker-launch` message ever arrives, so it is re-selected (it
  sorts first by `maxRam`) on every loop. With three such hosts and the default `--lab-walkers 3`, no walker is
  ever started. (Self-heals only once the host's own `realloc.js` clears its block.)
- Severity: **low**
- Suggested fix: subtract `state.servers[host].blockedRam` in `threadsForHost`, exactly as `canHoldStasis` does.

---

### DN-F8: `lab.js` treats a `DirectConnectionRequired` / `ServiceUnavailable` authenticate failure as a completed move
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/lab.js:200-229` (only `408`, `success`,
  `451`/charisma text and "cannot go that way" are special-cased; everything else falls through to
  `expected = stepTo(coords, move.dir); steps++;`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Darknet.ts:112-121` and `:135-143`
  ```ts
        const serverCheck = checkDarknetServer(ctx, targetHost, { requireDirectConnection: true });
        if (!serverCheck.success) {
          return helpers.netscriptDelay(ctx, 100).then(() => ({ success: false, code: serverCheck.code, ... }));
        }
  ```
  `serverCheck.code` is `351` (`DirectConnectionRequired`) or `503` (`ServiceUnavailable`)
  (`offlineServerHandling.ts:52-58`, `:92-97`) and **no move is made** in that case.
- What the script assumes / does: any non-408, non-success, non-charisma, non-"cannot go that way" outcome is taken
  to mean "moved one cell": the pushed/popped stack entry is kept and `expected` is advanced.
- What the game actually does: with code 351/503 the walker did not move; the message is
  `"Direct Connection Required"` / `"Service Unavailable"`, which matches neither `CHARISMA_PATTERN` nor
  `BLOCKED_PATTERN`.
- Concrete failure scenario: mid-walk, a mutation moves the walker's host away from the lab
  (`moveRandomDarknetServers`, `NetworkMovement.ts:143-152`). The current `authenticate` returns 351. The stack now
  holds a direction for a move that never happened; `previous` keeps `shouldRestart` from firing, so the corrupted
  stack survives and a later backtrack sends the walker in the wrong direction (each wrong move costing a full
  auth delay) until the DFS blunders into "exhausted" or the walker is retired.
- Severity: **low**
- Suggested fix: add an explicit branch for `outcome.code === 351 || outcome.code === 503` that undoes the
  push/pop exactly like the 408 branch and sleeps `RETRY_DELAY`.

---

### DN-F9: `labradar` cannot see past one cell, so `lab.js` pays a full authentication delay every 5 steps for a target it can essentially never obtain
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/darknet/lab.js:44` (`RADAR_EVERY = 5`), `:185-190`,
  `:58-68` (`stepTo` is ±2 per move; `distanceAfter` falls back to `FAR_CORNER` when `target` is null)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Darknet.ts:695-703`
  ```ts
      const authenticationTime = calculateAuthenticationTime(lab, Player, ctx.workerScript.scriptRef.threads);
      await helpers.netscriptDelay(ctx, authenticationTime);
      const [x, y] = getPositionInLab(pid);
      return { success: true, message: getSurroundingsVisualized(getLabMaze(), x, y, 3, true, true) };
  ```
  and `src/DarkNet/effects/labyrinth.ts:188-215`: the window is `y-range..y+range` by `x-range..x+range` in **maze
  character cells**, while a move changes the position by 2 (`labyrinth.ts:261`,
  `newLocation = [initialX + dx*2, initialY + dy*2]`).
- What the script assumes / does: sweeps radar every 5 steps until `target` is set, expecting to find the exit `X`
  and switch the DFS tie-break from "far corner" to the real exit.
- What the game actually does: `range = 3` covers ±3 characters, i.e. the current cell, the four cells at ±2, and
  the walls between. The exit is a cell, so it is only ever inside the window when it is already one move away —
  at which point the DFS is about to step there anyway. Each sweep costs one full
  `calculateAuthenticationTime(lab, …)` delay, the same as a move (`Darknet.ts:696`).
- Concrete failure scenario: on `ub3r_l4byr1nth` (60×40 maze, `labyrinth.ts:65-73`), a walk of several hundred
  moves spends ~20 % of its wall-clock time on radar sweeps that return nothing usable; the `--lab-threads` speed-up
  is partly cancelled out.
- Severity: **low** (wasted in-game time only)
- Suggested fix: drop the periodic sweep (or raise `RADAR_EVERY` far higher) — the `FAR_CORNER` heuristic is
  already what `DarknetState.labEndpoint` approximates (`labyrinth.ts:369-372`: bottom-right minus a 0–4 offset).

---

### DN: Unconfirmed (dropped)

- **`realloc.js` infinite no-op loop.** `getRamBlockRemoved` (`ramblock.ts:71-82`) rounds to two decimals, so
  `0.02 · 2·0.92^(difficulty+1) · threads · (1 + cha/100) < 0.005` yields 0 and `blockedRam` never decreases while
  `memoryReallocation` keeps returning code 200 — `realloc.js:13-19` would loop until `--kill`. Reaching it needs
  difficulty ≳ 33 (hence `getNetDepth() ≥ 34`, i.e. the 7th/8th labyrinth) *and* charisma ≲ 100 *and* 1–2 realloc
  threads simultaneously. That combination is only possible in the window right after installing a labyrinth reward
  augmentation resets charisma; I could not establish it as a state the automation reliably reaches, so it is not
  reported as a finding.
- **`KingOfTheHill` peak-solving near the bottom of a digit class.** The analytic `delta = width·sqrt(ln(10000/bestAlt))`
  step assumes the best sample landed inside the game's `|x−P|/P < 0.03` single-hill branch
  (`authentication.ts:226-228`). For the smallest password of a given digit count the nearest scan sample can be
  ~0.5·10^(L−2) away, i.e. outside that band, so `bestAlt` includes decoy hills. The solver still fires six probes
  around the estimate, and I could not show it fails deterministically.
- **`MathML` evaluator divergence.** `evalArithmetic` (recursive descent) vs the game's regex-driven
  `parseSimpleArithmeticExpression` (`ServerGenerator.ts:459-512`). I constructed no expression reachable from
  `generateSimpleArithmeticExpression` where they disagree, and `checkPassword` accepts a 0.5 % tolerance
  (`authentication.ts:152-164`), so no finding.
- **`OpenWebAccessPoint` budget.** `BUDGETS.OpenWebAccessPoint = 10` vs 1 + up to 7 capture probes + the final
  candidates; overruns only when the length-`L` substring intersection still has ≥3 survivors after 7 captures.
  Plausible for very short passwords but not demonstrable from the source alone.

### DN: Checked and OK

- **RAM budgets.** Every `WORKER_RAM` entry in `darknet/lib.js:57-75` was recomputed from the charged identifiers
  reported by `matches.mjs` plus `src/Netscript/RamCostGenerator.ts` (base 1.6; `dnet` block at lines 237-261):
  crack 2.95, realloc 2.65, phish 3.65, migrate 5.65, promote 3.65, cache 3.85, stasis 13.65, lab 3.95,
  share 4.0 (`Remote/share.js` = 1.6 + `share` 2.4), agent 4.50, and `darknet.js` itself 6.15 — all exact.
  No accidental NS-name collisions beyond the harmless zero-cost `peek` (solvers.js) and `clear` (lab.js);
  the quoted-key convention for `"share"` is doing its job.
- **API preconditions vs call sites.** `authenticate`/`heartbleed` (direct connection) are only called from
  `crack.js`/`lab.js` on probe neighbours; `memoryReallocation` (direct connection + admin) is called on self
  (early-out at `offlineServerHandling.ts:98-101`) or on a host whose session was just established;
  `openCache`/`phishingAttack`/`promoteStock`/`unleashStormSeed` (`expectRunningOnDarknetServer`) all run on the
  host itself; `setStasisLink` always targets its own host. `ns.exec`/`ns.scp` on darknet targets
  (`NetscriptFunctions.ts:641-651`, `:769-774`: admin + per-PID session + direct connection / backdoor bypass)
  are satisfied everywhere, including `lab.js:deliverAgent` (the win calls `addSessionToServer(labServer, pid)`,
  `labyrinth.ts:315`).
- **Response codes.** 200/351/401/408/451/453/454/503 as tested in the scripts all match
  `src/DarkNet/Enums.ts:57-69`. `crack.js`'s 408-retry is correct — the timeout returns before any password check
  (`Darknet.ts:147-154`). `lab.js`'s comment about the labyrinth 451→401 rewrite is correct
  (`Darknet.ts:163-170` overrides the code but forwards `authResult.response.message`), and all four charisma-gate
  messages (`labyrinth.ts:244-249`) match `CHARISMA_PATTERN`.
- **Solver-vs-model feedback semantics** (checked in depth against `authentication.ts` / `packetSniffing.ts` /
  `ServerGenerator.ts`): `NIL` (Yesn_t CSV is keyed off the *attempted* string's length — matches, and budget 64 ≥ 62+1),
  `2G_cellular` (prefix index strictly increases only on a correct character), `AccountsManager_4.2`
  ("Higher" ⇒ guess too low), `BellaCuore` (single value below difficulty 8, `min,max` + ALTUS NIMIS/PARUM BREVIS above),
  `BigMo%od` (10^15+r keeps `(n−1)%32+1 = r` and stays below `Number.MAX_SAFE_INTEGER`; the 9 moduli are pairwise
  coprime with product 6.4e11 > any 10-digit password), `Factori-Os` (every factor really is in
  `smallPrimes ∪ largePrimes` — the random seed `≤ 5·(scale+1) ≤ 80` has no prime factor above 97),
  `PHP 5.4` (`a = (S + 81 − L·dev²)/18` is exactly the game's `squaredError`, and the `< 5` bail-out matches
  `authentication.ts:128-130`), `CloudBlare(tm)` (`filler` = `"/[]╬╸.-()*~:;><#\\"` contains no digits, so
  stripping non-digits recovers the password), `OrdoXenos`, `110100100`, `OctantVoxel` (`BASE_N_DIGITS` matches
  `numbers + lettersUppercase`), `Pr0verFl0` (`"0".repeat(2n)` makes received == expected buffer on the first try),
  `DeskMemo_3.1`.
- **Copied data.** `COMMON_PASSWORDS` (93), `EU_COUNTRIES` (27), `SMALL_PRIMES` (25), `LARGE_PRIMES` (83) are
  byte-identical to `dictionaryData.ts` / `ServerGenerator.ts`; `dict()` budgets match their list lengths.
  `LABS` (`lib.js:77-86`) matches `labData` (`labyrinth.ts:37-110`) in hostname, depth and charisma, in the same
  unlock order as `getCurrentLabName()`; `isLabHost`'s `_l4byr1nth` suffix matches all eight
  (`Server/data/SpecialServers.ts:13-20`). `AIR_GAP_ROWS = [8,16,24,32]` matches
  `isOnAirGap = !!x && !(x % AIR_GAP_DEPTH)` with `AIR_GAP_DEPTH = 8`. `STORM_COOLDOWN = 30 min` matches
  `ramblock.ts:59`; `"STORM_SEED.exe"` matches `src/Programs/Enums.ts:16`.
- **Labyrinth walking rules.** `stepTo` (±2) matches `newLocation = [x+dx*2, y+dy*2]`; `labreport`'s
  `north/east/south/west` come from a range-1 window with out-of-bounds reading as open
  (`labyrinth.ts:209`, `:217-227`) — which is exactly why `lab.js`'s "cannot go that way" branch is needed at the
  maze border; `findExit`'s coordinate arithmetic inverts `getSurroundingsVisualized`'s double-swapped
  `[endpointY, endpointX]` correctly; positions are per-PID (`labyrinth.ts:334-338`) so multiple walkers explore
  independently, and once one wins `labServer.hasAdminRights` makes every other walker's next `authenticate`
  return success with the password (`labyrinth.ts:268-276`) — handled.
- **`connectToSession` is never pointed at a labyrinth** (`pushFiles`/`stopEverything`/`agent.js` all skip
  `isLabHost`). This matters: `Darknet.ts:204` passes `threads` where `checkPassword` expects `pid`
  (`authentication.ts:19-27`), so a session attempt on a lab would move some other PID's walker.
- **Stasis/mutation immunity.** `isImmutable = openServer || isConnectedTo || hasStasisLink`
  (`NetworkMovement.ts:227-228`) confirms the controller's "a linked server is immune to mutation" comment;
  `setStasisLink` also flips `backdoorInstalled`, and `getBackdooredDarknetServers` excludes linked servers
  (`darknetNetworkUtils.ts:89-90`), so pinning does not inflate `getTimeoutChance`.
- **Server-gone detection.** A deleted darknet server is registered in `DarknetState.offlineServers`
  (`NetworkMovement.ts:180-185`), so `helpers.getServer` returns null instead of throwing
  (`NetscriptHelpers.tsx:504-516`) and `checkDarknetServer` yields 503 — which is what `pushFiles` keys its
  `entry.online = false` on. Reused hostnames come back with `hasAdminRights = false`, producing the 401 the
  script maps to `stale`.
- **`ns.exec`/`ns.isRunning` argument pairing.** Every exec/isRunning pair uses identical argument lists, and all
  hostnames passed positionally go through `hostArg()`/`hostFromArg()`, which is required because darknet hostnames
  can start with `-`/`--` (`generateDarknetServerName`).
- **`openCache`.** `ns.ls(host, ".cache")` returns the stored `CacheFilePath` values verbatim
  (`NetscriptFunctions.ts:846-852`), and `resolveCacheFilePath` is idempotent on them, so the
  `filter(cache => cache !== fileName)` in `Darknet.ts:309` does remove the opened cache — no re-open loop.
- **Password length caps.** No solver can produce an attempt longer than `MAX_PASSWORD_LENGTH * 2 = 100`
  (`Darknet.ts:102-111`), so `authenticate` never throws on length.
- **`daemon.js` launch.** `daemon.js:437` schedules `darknet.js` as a periodic tool with
  `shouldRun: () => !options['no-darknet'] && (ownedPrograms.includes("DarkscapeNavigator.exe") ||
  resetInfo.currentNode == 15 || 15 in dictSourceFiles)`. That matches the game's gate exactly —
  `hasDarknetAccess = () => canAccessBitNodeFeature(15) || Player.hasProgram(CompletedProgramName.darkscape)`
  (`src/DarkNet/utils/darknetAuthUtils.ts:6-8`), with `canAccessBitNodeFeature(15) = bitNodeN === 15 ||
  activeSourceFileLvl(15) > 0` (`src/BitNode/BitNodeUtils.ts`) and
  `CompletedProgramName.darkscape = "DarkscapeNavigator.exe"` (`src/Programs/Enums.ts:15`). So `ns.dnet` calls
  can never throw `expectDarknetAccess` when the daemon starts it. `tryRunTool` (`daemon.js:643-647`) guards
  against duplicate launches by filename, which is what an infinite-loop controller needs; `ignoreReservedRam`
  is set for periodic tools (`daemon.js:439`) so the 6.15 GB fits past home's reserve. `darknet.js` is launched
  with no args, so it uses `PORT_DEFAULT = 15`; no other script in the repo touches a netscript port, so there
  is no collision. The `/Temp/share-active.txt` handshake (`daemon.js:964-965` writer,
  `darknet.js:538` reader) and the `/Temp/darknet-charisma-goal.txt` goal (`darknet.js:123` writer,
  `work-for-factions.js:395` and `sleeve.js:427` readers) line up.
- **`getServerDetails` on labyrinths.** All eight labs are always present in `AllServers`
  (`NetworkGenerator.ts:235-261`), only the current one is wired into the graph, and their `depth` stays `-1` —
  `currentLab`'s `Number(details.depth) > 0 ? … : lab.depth` fallback is correct, and the call cannot throw.

## HK: Hacking daemon and helpers (daemon.js, helpers.js, host-manager.js, Tasks/*, Remote/*, misc)

Source report: `daemon-report.md` (verified line by line by the coordinator).

Repo: `/home/jubnl/dev/bitburner/bitburner-scripts` (branch `game-optimisation-3.0`)
Game source: `/home/jubnl/dev/bitburner/bitburner-src` (v3.0.1)

Files audited in full: `daemon.js`, `helpers.js`, `analyze-hack.js`, `host-manager.js`,
`Tasks/ram-manager.js`, `Tasks/backdoor-all-servers.js`, `Tasks/crack-host.js`, `Tasks/contractor.js`,
`Remote/{hack,grow,weak,manualhack}-target.js`, `Remote/share.js`, `kill-all-scripts.js`, `scan.js`,
`farm-intelligence.js`, `sync-scripts.js`, `git-pull.js`, `cleanup.js`, `reserve.js`.

---

### HK-F1: `arbitraryExecution` never records the scripts it just copied (Set treated as a dictionary), so it re-`scp`s on every task scheduled to that host

- Script: `daemon.js:1761-1773` (specifically `1771`), with `daemon.js:1209-1214` (`Server.hasFile`)
- Game source: `src/NetscriptFunctions.ts:840-857` (`ls` returns `string[]` of filenames), `src/NetscriptWorker.ts:266-311` + `314-353` (every `ns.exec` of the temp script costs RAM and returns 0 when it cannot be started)

```js
// daemon.js:1771
missing_scripts.forEach(s => targetServer._files[s] = true); // Make note that these files now exist on the target server
```

- What the script assumes: that writing `_files[name] = true` registers the file as present, so the
  next `tool.existsOnHost(targetServer)` in the same loop returns `true`.
- What actually happens: `Server.hasFile` builds `this._files` as a **`Set`** (`this._files ??= new Set(await ...ns.ls(...))`)
  and queries it with `.has(fileName)`. Assigning an own property on a `Set` object does **not** add a member,
  so `.has()` keeps returning `false`. The `??=` also prevents the Set from ever being re-fetched within the loop
  (`resetCaches()` only nulls it once per main-loop iteration).
- Concrete failure scenario: `host-manager.js` buys a new `daemon-N` server. It is empty, so it sorts first in
  `getAllServersByFreeRam()` and receives a large share of the batch tasks. The first task triggers one
  `ns.ls` + one `ns.scp` temp script. **Every subsequent task scheduled onto that host in the same loop
  triggers another `ns.scp` temp script** (plus a second `doesFileExist(helpers.js)` check that also re-copies).
  With `--max-batches 100` (this branch's new default) a single target is 400 tasks, so one loop can fire
  hundreds of redundant temp scripts, each of which is an `ns.write` + `ns.exec` + poll + `ns.read` round trip.
  The targeting loop blows past its own `maxLoopTime` (1000 ms) budget and other targets get skipped.
- Severity: **medium**
- Suggested fix: use `targetServer._files.add(s.startsWith('/') ? s.substring(1) : s)` (matching the
  leading-slash normalisation `hasFile` applies) instead of property assignment.

---

### HK-F2: `host-manager.js` sizes RAM *upgrades* with the full purchase price, so it needs ~2× the money the game actually charges (and no-ops at the boundary)

- Script: `host-manager.js:169-175` (exponent chosen from `costByRamExponent`, i.e. full purchase price),
  `host-manager.js:209-215` (guards allow `maxRamPossibleToBuy == worstServerRam`),
  `host-manager.js:220-234` (upgrade path)
- Game source: `src/Server/ServerPurchases.ts:44-54`

```ts
if (server.maxRam >= ram)
  throw new Error(`The new ram of '${hostname}' (${ram}) must be bigger than its current ram (${server.maxRam}).`);
return getCloudServerCost(ram) - getCloudServerCost(server.maxRam);
```

- What the script does: computes `maxRamPossibleToBuy` as the largest `2^n` whose **full** `cloud.getServerCost(2^n)`
  fits in `spendableMoney`, then — when already at `cloud.getServerLimit()` servers — calls
  `ns.cloud.upgradeServer(worstServerName, maxRamPossibleToBuy)`.
- What the game actually does: an upgrade costs `cost(newRam) − cost(oldRam)`, which for the common
  softcap-1 case is *half* the full price of the new size. It also **throws** (and `upgradeServer` returns
  `false`, `Cloud.ts:104-114`) when `ram <= server.maxRam`.
- Concrete failure scenario: 25 servers at 2^16 GB, budget exactly equal to `cost(2^16)`. `exponentLevel`
  resolves to 16, so `maxRamPossibleToBuy == worstServerRam`; both "don't buy worse" guards pass (they use `<`,
  not `<=`), `ns.cloud.upgradeServer(worst, 2^16)` throws inside the game and returns `false`, and the script
  logs "Could not upgrade a server with 64 TB RAM…" every 32 s forever — even though the budget is exactly
  what the game would charge to upgrade that server to **2^17**. In general every upgrade step is delayed
  until the player has twice the money the game requires.
- Severity: **medium**
- Suggested fix: on the upgrade path, re-derive the affordable exponent against
  `ns.cloud.getServerUpgradeCost(worstServerName, 2^n)` (or equivalently `cost(2^n) − cost(worstServerRam)`),
  and skip/return early when the best affordable size is `<= worstServerRam`.

---

### HK-F3: hard-coded BitNode multiplier fallback in `helpers.js` has 7 wrong values (all 6 non-trivial `DarknetMoneyMultiplier` entries, plus BN14 `DefenseLevelMultiplier`)

- Script: `helpers.js:702` (`DarknetMoneyMultiplier`), `helpers.js:703` (`DefenseLevelMultiplier`)
- Game source: `src/BitNode/BitNode.tsx:628` (BN3 `0.4`), `:658` (BN4 `0.4`), `:689` (BN5 `0.7`),
  `:839` (BN9 `0.05`), `:884` (BN10 `0.4`), `:1039` (BN13 `0.1`); `src/BitNode/BitNode.tsx:1063`
  (BN14 `DefenseLevelMultiplier: 0.5`); defaults in `src/BitNode/BitNodeMultipliers.ts`.

```ts
// BitNode.tsx:1039 (case 13)
DarknetMoneyMultiplier: 0.1,
// BitNode.tsx:1063 (case 14)
DefenseLevelMultiplier: 0.5,
```

- What the script assumes: `DarknetMoneyMultiplier` is `1` in every BN except BN8, and BN14's
  `DefenseLevelMultiplier` is `1`.
- What the game actually does: BN3=0.4, BN4=0.4, BN5=0.7, BN8=0, BN9=0.05, BN10=0.4, BN12=`1/1.02^lvl`,
  BN13=0.1; BN14 `DefenseLevelMultiplier` = 0.5.
- Concrete failure scenario: `getHardCodedBitNodeMultipliers` is the fallback used by
  `tryGetBitNodeMultipliers_Custom` whenever SF-5 is not owned or RAM is too tight (`helpers.js:647-666`) —
  i.e. exactly early-BN conditions. In BN9 a consumer of `bitNodeMults.DarknetMoneyMultiplier` (the new
  `darknet.js` work on this branch) would value darknet money 20× too high (1 instead of 0.05); in BN13, 10× too high.
- Severity: **medium** (silent, wrong economic decisions in 6 BitNodes; low if nothing reads the multiplier)
- Suggested fix: set `DarknetMoneyMultiplier` to `[1,1,0.4,0.4,0.7,1,1,0,0.05,0.4,1,1,0.1,1,1]` and
  `DefenseLevelMultiplier` BN14 to `0.5`. (Everything else in the table, including the whole new BN15 column
  and the `DaedalusAugsRequirement` BN12 value of 31 — `floor(30 + 1.02^lvl)` — was verified correct.)

---

### HK-F4: `work-for-factions.js` launch guard is a no-op (misplaced parenthesis), so it launches at any home RAM and interrupts the startup study

- Script: `daemon.js:381-384`

```js
shouldRun: () => 4 in dictSourceFiles && reqRam(256 / (2 ** dictSourceFiles[4]) && !studying)
```

- Game source: `src/NetscriptWorker.ts:294-303` (`ns.exec` returns 0 when `ramUsage > ramAvailable`),
  `src/NetscriptFunctions/Singularity.ts` university/faction work replaces the current action.
- What the script intends: only launch when home has `256 / 2^SF4` GB free **and** we are not studying.
- What actually happens: `&&` binds tighter than the function call boundary — the argument is
  `(256 / 2**lvl) && !studying`, which evaluates to the boolean `!studying`. `reqRam(true)` is
  `homeRam >= 1` and `reqRam(false)` is `homeRam >= 0`; **both are always true**. Both guards are dead.
- Concrete failure scenario: (a) in early BN1.1 (8-32 GB home) `work-for-factions.js` is attempted every
  60 loops, `ns.exec` returns 0 and `tryRunTool` logs a warning forever; (b) `runStartupScripts` is called
  from `kickstartHackXp` (`daemon.js:467`) *while* `studying` is true, so work-for-factions can take focus
  and cancel the university course the daemon is about to sleep 10 s waiting on — the study XP is lost.
- Severity: **medium**
- Suggested fix: `reqRam(256 / (2 ** dictSourceFiles[4])) && !studying`.

---

### HK-F5: `kill-all-scripts.js` compares `ns.ps()` (an array) to a number, so it never waits for scripts to die before deleting their files

- Script: `kill-all-scripts.js:17` and `kill-all-scripts.js:30-35`
- Game source: `src/NetscriptFunctions.ts:865-880`

```ts
ps: (ctx) => (_host?) => {
    const [server] = helpers.getServer(ctx, _host);
    const processes: ProcessInfo[] = [];
    ...
    return processes;
```

- What the script assumes: `ns.ps(server)` returns a count (`=== 0`, `> 0`).
- What the game actually does: it returns `ProcessInfo[]`. `[] === 0` is `false` and `[{…}] > 0` coerces the
  array to the string `"[object Object]"` → `NaN > 0` → `false`.
- Concrete failure scenario: the "idle until they're dead" loop at line 30 exits immediately on every server,
  so `ns.rm(file, server)` runs while `killall` is still tearing scripts down — exactly the race the comment
  at line 29 says it is there to avoid. (The `continue` at line 17 is also dead, which is harmless.)
- Severity: **low**
- Suggested fix: use `ns.ps(server).length` in both places.

---

### HK-F6: `Tasks/backdoor-all-servers.js` uses `>` where the game uses `>=`, skipping servers whose requirement exactly equals your hacking level

- Script: `Tasks/backdoor-all-servers.js:64` (also the log lines 50-51)

```js
toBackdoor = toBackdoor.filter(s => myHackingLevel > dictRequiredHackingLevels[s]);
```

- Game source: `src/Hacking/netscriptCanHack.ts:38-44` (called by `installBackdoor`, `src/NetscriptFunctions/Singularity.ts:527-533`)

```ts
if (s.requiredHackingSkill > Player.skills.hacking) {
    return { res: false, msg: `... your hacking skill is not high enough` };
}
```

- What the script assumes: you need *strictly more* hacking skill than the requirement.
- What the game actually does: it refuses only when `requiredHackingSkill > hacking`, i.e. equal is allowed.
- Concrete failure scenario: at hacking level exactly 54, `CSEC` (requirement 54) is excluded from
  `toBackdoor` and the faction invite is delayed until the next hacking level. `daemon.js`'s own
  `Server.canHack()` uses `<=` correctly, so the two disagree.
- Severity: **low**
- Suggested fix: change to `>=`.

---

### HK-F7: `Remote/grow-target.js`'s misfire warning can never fire on a real target

- Script: `Remote/grow-target.js:34-37`

```js
const growPct = await ns.grow(target, hgwOptions);
if (growPct == 0 && !silentMisfires) ns.toast(`Misfire: Grow achieved no growth. ...`, 'warning');
```

- Game source: `src/NetscriptFunctions.ts:308` and `src/Server/ServerHelpers.ts:202-221`

```ts
return Promise.resolve(server.moneyMax === 0 ? 0 : growth);
// processSingleServerGrowth returns 1 (not 0) when there was no growth
```

- What the script assumes: `ns.grow()` returns `0` when the grow accomplished nothing (e.g. it fired while
  the server was already at max money — the classic batch misfire).
- What the game actually does: it returns the growth **ratio** (`moneyAfter / moneyBefore`, clamped to `1`
  when there was no growth) and only returns literal `0` when `server.moneyMax === 0`, which
  `daemon.js`'s `shouldHack()` already excludes as a target.
- Concrete failure scenario: a batch's grow lands after the next batch's grow has already restored max
  money — a real misfire — and the toast never appears, so the scheduling problem stays invisible.
  (The equivalent checks in `hack-target.js` and `weak-target.js` are correct: `ns.hack` returns 0 money
  on a miss and `ns.weaken` returns the security reduction, `NetscriptFunctions.ts:362-385`.)
- Severity: **low** (diagnostics only)
- Suggested fix: warn on `growPct <= 1` instead of `== 0`.

---

### HK-F8: `Remote/manualhack-target.js` reads a different argument layout than `daemon.js` passes

- Script: `Remote/manualhack-target.js:4-9`; producer: `daemon.js:1514-1519` and `daemon.js:2058` via `getFlagsArgs` (`daemon.js:1542-1552`)
- Game source: `src/Netscript/NetscriptHelpers.tsx:144-153` (`number()` throws on `NaN`, so `ns.sleep(NaN)` would throw)

- What the script assumes: the legacy 8-slot layout `[target, start, end, duration, description, stock, silent, loop]`.
- What `daemon.js` actually passes: `[target, start, duration, description, stock, silent, loop]` —
  `description` is at index 3 and there is no separate "expected end" slot.
- Concrete failure scenario: with `-i` (intelligence farming), `expectedDuration = ns.args[3]` is the
  *string* `"Batch 0-hack"`, so `cycleTime` is `NaN`; `disableToastWarnings = ns.args[6]` is the loop flag
  and `loop = ns.args[7]` is `undefined`. Practical effect: the "hack stole 0 money" toast can never be
  suppressed via `--silent-misfires`, and the whole looping branch is unreachable (which is the only thing
  keeping `ns.sleep(NaN)` from throwing).
- Severity: **low**
- Suggested fix: re-index to `[4]=stock, [5]=silent, [6]=loop` and read the duration from `args[2]`,
  matching `hack-target.js`.

---

### HK-F9: `Tasks/ram-manager.js` never handles the `restrictHomePCUpgrade` BitNode option and error-toasts forever

- Script: `Tasks/ram-manager.js:3-4` (`max_ram`, `max_cores`), `:40-43`, `:50-54`, `:72-77`, `:85-89`
- Game source: `src/NetscriptFunctions/Singularity.ts:626-637` and `:595-603`

```ts
if ((Player.bitNodeOptions.restrictHomePCUpgrade && homeComputer.maxRam >= 128) ||
    homeComputer.maxRam >= ServerConstants.HomeComputerMaxRam) { ...; return false; }
...
if (Player.bitNodeOptions.restrictHomePCUpgrade || homeComputer.cpuCores >= 8) { ...; return false; }
```

- What the script assumes: the only reasons `upgradeHomeRam()` / `upgradeHomeCores()` can return `false`
  are "at max RAM" (`2^30`, checked) / "at max cores" (`8`, checked) or "not enough money" (checked).
- What the game actually does: with the `restrictHomePCUpgrade` BitNode option enabled, home RAM caps at
  **128 GB** and cores are **never** upgradable (the check does not even look at `cpuCores`).
  `getUpgradeHomeRamCost()` still returns a finite affordable number, so the script's guards all pass.
- Concrete failure scenario: a BN started with "Restrict home PC upgrade" — at 128 GB home RAM,
  `daemon.js` runs `/Tasks/ram-manager.js` every 30 s and each run fires
  `ERROR: Failed to upgrade home RAM from 128 GB to 256 GB thinking we could afford it` as a terminal
  message **and a toast** (`log(..., true, 'error')`), forever. Same for cores at 1 core.
- Severity: **low** (only with an opt-in BitNode option, but it is an unbounded error-toast loop)
- Suggested fix: read `ns.getResetInfo().bitNodeOptions.restrictHomePCUpgrade` once and cap
  `max_ram` at 128 / skip cores entirely when it is set; also downgrade the "failed to upgrade" log
  from an error toast to a warning.

---

### HK-F10: `git-pull.js` — the new `'test/'` omit-folder entry has no effect on the normal (GitHub API) download path

- Script: `git-pull.js:10` (this branch's change), `git-pull.js:81-97` (`repositoryListing`, GitHub path),
  `git-pull.js:103-104` (fallback path, the only place `omit-folder` is used)
- Repo state: `/home/jubnl/dev/bitburner/bitburner-scripts/test/` contains 8 Node-only `*.test.js` files.

- What the change intends (per its own comment): `'test/' holds Node-only test files that the game never runs`,
  so they should not be downloaded.
- What actually happens: `repositoryListing()` filters the GitHub listing **only** by extension
  (`git-pull.js:91-92`); `options['omit-folder']` is consulted exclusively in the `catch` fallback at line 104.
  So on the normal path every `test/*.test.js` file is still downloaded into the game.
  The fallback that *does* use `omit-folder` is itself broken: line 103 references an undefined
  identifier `f` (`options.extension.some(ext => f.endsWith(ext))` — should be `name`), which throws a
  `ReferenceError` out of `main`.
- Severity: **low**
- Suggested fix: apply the `omit-folder` filter inside `repositoryListing()` (line 91-92) as well, and
  fix `f` → `name` on line 103.

---

### HK-F11: `--looping-mode` XP farming never gets a host assignment (dictionary keyed by name, read by index; `in` used on an array of values)

- Script: `daemon.js:1911-1913` and `daemon.js:1940`

```js
jobHostMappings[target.name] = jobHosts.filter(h => !(h.name in Object.values(jobHostMappings)))[0];
...
let selectedHost = loopingMode ? jobHostMappings[i] : jobHosts[i];
```

- Game source: n/a — this is an internal indexing bug; the observable game consequence is that
  `arbitraryExecution(..., preferredServerName = allocatedServer?.name)` receives `undefined`
  (`daemon.js:2060`, `:2081`, `:2098`), so "targets locked to a host" does not happen.
- What actually happens: the map is written with `target.name` keys but read with the numeric loop index
  `i`, so `selectedHost` is always `undefined` in looping mode. Additionally
  `h.name in Object.values(jobHostMappings)` uses `in` against an *array of Server objects*, which tests
  array **indices**, so the filter never excludes anything and every target would map to `jobHosts[0]` anyway.
- Concrete failure scenario: `daemon.js --xp-only --looping-mode` — every XP target is scheduled with
  "any server", so the stable target↔host pairing the looping design depends on never happens and
  perpetual loops compete for the same hosts.
- Severity: **low** (non-default mode)
- Suggested fix: key and read the map consistently by `target.name`, and use
  `!Object.values(jobHostMappings).some(x => x?.name === h.name)`.

---

### HK-F12: `startup_withRetries` re-runs `startup()` up to 6 times after a *clean* return

- Script: `daemon.js:2474-2489`

```js
while (startupAttempts++ <= 5) {
    try { await startup(ns); }
    catch (err) { ... }
}
```

- Game source: n/a for the loop itself; the reachable clean returns are `startup()`'s
  `if (!runOptions) return;` (daemon.js:267, i.e. `getConfiguration` returned `null` after
  `ns.flags` threw — `src/NetscriptFunctions/Flags.ts`) and `doTargetingLoop` returning under `--run-once`.
- What the script assumes: `startup()` only returns by throwing.
- What actually happens: on a clean return the `while` loop immediately calls `startup()` again.
- Concrete failure scenario: `run daemon.js --bogus-flag` prints the full help text **six times**;
  `run daemon.js -o` (run-once) executes the whole startup + one targeting loop six times, including
  the 10 s study kickstart and re-launching every helper.
- Severity: **low**
- Suggested fix: `return` after a successful `await startup(ns)`.

---

### HK: Unconfirmed (dropped)

- **`--share-max-threads` does not cap total share threads.** The cap applies per scheduling pass
  (`daemon.js:976`), and `ns.share()` only lasts `ShareBonusTime = 10000 ms`
  (`src/NetworkShare/Share.ts:8`, `src/NetscriptFunctions.ts:394-403`), so the steady state is roughly
  `2 × cap` rather than `cap`. Since the option is documented as "scheduled at once", the behaviour
  matches the wording; dropped as a deliberate configuration choice.
- **Coding-contract name collisions across servers.** `Tasks/contractor.js:24-29` keys its type/data
  dictionaries by contract *filename* only, while the game guarantees uniqueness only **per server**
  (`src/CodingContract/ContractGenerator.ts:217-231`). A collision would feed one contract the other's
  data. With 6 alphanumeric characters the probability is negligible, so not reported as a finding.
- **`joesguns` missing from `serverStockSymbols`** (`daemon.js:2130-2134`) while the game defines a
  `JGN` stock for Joe's Guns (`src/StockMarket/Enums.ts:48`). Could not confirm from the source that the
  daemon's list is meant to be exhaustive rather than a curated subset, so dropped.
- **Sorting hacknet servers *first* for grow/weaken/share when `-n` is used** (`daemon.js:1685-1688`,
  hacknet servers can reach 128 cores per `src/Hacknet/data/Constants.ts:50`), which contradicts the
  long-standing "hacknet last, they lose hash production" rule kept in the `else` branch. The new comment
  states this trade-off explicitly, so it reads as a deliberate choice.
- **Background-tab timer throttling vs the new 500 ms task spacing** (`--cycle-timing-delay 2000`).
  `netscriptDelay` uses `window.setTimeout` (`src/Netscript/NetscriptHelpers.tsx:419-432`), so HWGW
  ordering depends on browser timer behaviour when the tab is hidden. I could not establish from the
  game source that ordering actually breaks, so not reported.
- **`helpers.js:833-836` dereferences `match[1]` before the `if (!match)` check**, so an unrecognised
  key in a `*.config.txt` reports "Cannot read properties of null" instead of the intended
  "Unrecognized key …". Still caught and reported as a config error, and not a game-behaviour issue.
- **`scan.js:17-18` dereferences the result of `getConfiguration` without a null check**, so
  `run scan.js --bogus` throws after printing help. Same class as above.

---

### HK: Checked and OK

Formulas / constants verified line-by-line against the game:

- `growthThreadHardening = 0.004` (= `2 × ServerFortifyAmount`), `hackThreadHardening = 0.002`,
  `weakenThreadPotency = 0.05`, `unadjustedGrowthRate = 1.03`, `maxGrowthRate = 1.0035`
  — all match `src/Server/data/Constants.ts:7-10` and `src/Server/formulas/grow.ts:15-18`.
- `Server.adjustedGrowthRate()/serverGrowthPercentage()/cyclesNeededForGrowthCoefficient()`
  (`daemon.js:1242-1263`) is algebraically identical to `calculateServerGrowthLog`
  (`src/Server/formulas/grow.ts:8-29`) for a 1-core host.
- `percentageStolenPerHackThread()` fallback (`daemon.js:1283-1288`) matches
  `calculatePercentMoneyHacked` (`src/Hacking.ts:44-57`), balance factor 240 included.
- `coreBonus(cores) = 1 + (cores-1)/16` matches `getCoreBonus` (`src/Server/ServerHelpers.ts:287-290`);
  `getWeakenEffect` (`:292-295`) is linear in threads and multiplied by `ServerWeakenRate`, so
  `weakenThreadsByCores` scaling is correct. grow/weaken/share all read the *host's* `cpuCores`
  (`src/NetscriptFunctions.ts:292`, `:367`, `:398`), and `hack` does **not** — matching the daemon's
  decision to core-scale only grow/weak/share.
- `ns.formulas.hacking.weakenEffect(threads, cores)` and
  `growThreads(server, player, targetMoney, cores)` signatures match
  `src/NetscriptFunctions/Formulas.ts:199-209, 238-245`; the mocked server object supplies every key
  `helpers.server()` requires (`src/Netscript/NetscriptHelpers.tsx:666-683`), and
  `numCycleForGrowthCorrected` reads exactly the fields the daemon overwrites.
- Time multipliers: grow = 3.2× hack, weaken = 4× hack (`src/Hacking.ts:83-94`) — matches the
  `duration * 3.0` / `duration * 0.25` looping offsets in `hack-target.js:29` / `grow-target.js:30`.
- Batch timing model: `hack/grow/weaken` fix their duration at the moment `ns.hack/grow/weaken` is
  called (`src/Netscript/NetscriptHelpers.tsx:537-561`, `src/NetscriptFunctions.ts:266-310, 342-386`)
  and wait via real `setTimeout`. The daemon exec's all batch scripts immediately and folds the wait into
  `additionalMsec`, so reducing `--cycle-timing-delay` to 2000 is sound, and the removed
  `firstEnding`/`lastStart` guard is genuinely unnecessary. (Note: the new comment at `daemon.js:1494-1500`
  claims the guard was pure dead code — it was not: `lastStart` froze at batch 0's `lastFire` and
  `lastStart >= firstEnding` did fire for fast targets, truncating them to a single batch. Removing it is
  still correct; only the justification is inaccurate.)
- No game-side limit on the number of running scripts (`src/NetscriptWorker.ts:266-353`), so
  `--max-batches 100` has no hard game ceiling; `ns.exec` returning `0` on insufficient RAM is handled
  everywhere (`daemon.js:1776-1779`, `:691-700`).
- RAM costs: `Remote/hack-target.js` 1.7 GB, `grow`/`weak` 1.75 GB, `share.js` 4.0 GB
  (`RamCostConstants.Hack 0.1 / Grow 0.15 / Weaken 0.15 / share 2.4` + 1.6 base) — matches
  `analyze-hack.js:26-28`. Ran the static-RAM identifier checker over all 20 files: no accidental
  NS-name identifiers, and the daemon's `ns.formulas.*` / `ns.format.time` references are 0 GB.
- `ns.hasTorRouter()` exists and costs 0.05 GB (`src/NetscriptFunctions.ts:195`,
  `RamCostGenerator.ts:582`), and `ns.scan` really does skip `DarknetServer` since 3.0
  (`src/NetscriptFunctions.ts:187`) — the branch's replacement of the `allHostNames.includes("darkweb")`
  test is correct.
- `darkwebPrograms` (`daemon.js:2457`) matches the 11 items in `src/DarkWeb/DarkWebItems.ts` exactly
  (names, count) and matches `Tasks/program-manager.js`'s list, so the
  `ownedPrograms.length != darkwebPrograms.length` relaunch condition does terminate.
  `DarkscapeNavigator.exe` = `CompletedProgramName.darkscape` at 50e6 (`src/DarkNet/Constants.ts:8`).
- Purchased-server limits: `cloud.getServerLimit/getRamLimit/getServerCost/purchaseServer/upgradeServer/
  getServerNames` all exist with the signatures `host-manager.js` uses (`src/NetscriptFunctions/Cloud.ts`);
  `CloudServerLimit = 25`, `CloudServerMaxRam = 2^20` (`src/Server/data/Constants.ts:12-13`);
  `maxPurchasedServers == 0` (BN9) is handled.
- `ram-manager.js` `max_ram = 2^30` matches `HomeComputerMaxRam`; `max_cores = 8` matches
  `upgradeHomeCores`'s `cpuCores >= 8`; `getUpgradeHomeCoresCost = 1e9 * 7.5^cores`
  (`src/PersonObjects/Player/PlayerObjectServerMethods.ts:42-44`); the RAM-cost comment
  (SingularityFn2 for both upgrades) matches `RamCostGenerator.ts:176-179`.
- `analyze-hack.js` no-formulas fallback replicas verified against the game:
  `calculateHackingTime` rescaling (`src/Hacking.ts:60-80`), `calculateHackingChance`
  incl. `clampNumber(1.75*hacking, 1)` and `1 + int^0.8/600`
  (`src/Hacking.ts:9-24`, `src/PersonObjects/formulas/intelligence.ts:1-3`),
  `calculateHackingExpGain` `3 + baseDifficulty*0.3` (`src/Hacking.ts:30-38`), and the new
  `hackExp * (chance + (1-chance)/4)` expectation matches
  `expGainedOnFailure = expGainedOnSuccess / 4` (`src/Netscript/NetscriptHelpers.tsx:564-565`).
  `ns.formulas.hacking.hackExp/hackChance` exist (`Formulas.ts:168, 174`); `ns.getServer` takes a single
  argument so `serverNames.map(ns.getServer)` is safe.
- `helpers.js` v3 detection: `ns.ui.getGameInfo().versionNumber >= 44` vs `CONSTANTS.VersionNumber = 51`
  (`src/Constants.ts:10`); `ns.format.time` exists (`src/NetscriptFunctions/Format.ts:32`) and
  `ns.ui.{openTail,renderTail,moveTail,resizeTail,closeTail,windowSize,getGameInfo}` all exist
  (`src/NetscriptFunctions/UserInterface.ts`).
- `daemon.js` `killProcessIds` → `ns.args.forEach(ns.kill)` passes `(pid, index, array)`, which is safe:
  `scriptIdentifier` short-circuits on a numeric first argument and ignores the rest
  (`src/Netscript/NetscriptHelpers.tsx:478-493`).
- 4S API reserve `bitNodeMults.FourSigmaMarketDataApiCost * 25e9` matches
  `MarketDataTixApi4SCost: 25e9` (`src/StockMarket/data/Constants.ts:10`); the `$100k` commission in
  `getStocksValue` matches `StockMarketCommission`.
- `ns.ls` includes `server.programs` (`src/NetscriptFunctions.ts:847-854`), so
  `doesFileExist(ns, "Formulas.exe")` really does detect Formulas.exe.
- `sync-scripts.js` `ns.scp(files, destination, source)` argument order is correct in both directions
  (`src/NetscriptFunctions.ts:766-777`), and its recursive `scan` helper does return a flat list.
- The whole hard-coded BN multiplier table was diffed programmatically against
  `src/BitNode/BitNode.tsx` for BN1-BN15; only the 7 values in F3 differ (the new BN15 column is
  entirely correct).

## SG: Singularity and progression (autopilot.js, work-for-factions.js, crime.js, casino.js, run-command.js)

Source report: `singularity-report.md` (verified line by line by the coordinator).

Scope: `autopilot.js`, `faction-manager.js`, `work-for-factions.js`, `Tasks/program-manager.js`, `Tasks/tor-manager.js`,
`casino.js`, `crime.js`, `ascend.js`, `stats.js`, `Tasks/run-with-delay.js`, `Tasks/write-file.js`, `run-command.js`,
`dev-console.js`, `dump-ns-namespace.js`, `grep.js` (all under `/home/jubnl/dev/bitburner/bitburner-scripts`).
Game source: `/home/jubnl/dev/bitburner/bitburner-src` (v3.0.1).

Findings: 2 high, 2 medium, 3 low.

---

### SG-F1: `autopilot.js` assigns to an undeclared `_`, which throws in a module — the casino never runs and, worse, daemon.js is killed every loop
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js:829-837` (and the catch that hides it: `autopilot.js:141-154`, loop order: `autopilot.js:256-263`)
  ```js
  await killScript(ns, 'work-for-factions.js');
  await killScript(ns, 'daemon.js');
  if (4 in unlockedSFs)
      _ = await getNsDataThroughFile(ns, `ns.singularity.stopAction()`);   // <-- line 835
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptJSEvaluator.ts:16-18` and `:30-33`
  ```ts
  function makeScriptBlob(code: string): Blob { return new Blob([code], { type: "text/javascript" }); }
  ...
  doImport(url: ScriptURL): Promise<ScriptModule> { return import(/*webpackIgnore:true*/ url) as Promise<ScriptModule>; }
  ```
  Every player script is loaded as an **ES module** (blob + dynamic `import()`), and ES modules are always strict mode,
  where assignment to an undeclared identifier is a `ReferenceError`. The game defines no global `_`:
  the only globals it installs are `globalThis.React` / `globalThis.ReactDOM` (`src/index.tsx:15-16`) and
  `globalThis.Bitburner` / `globalThis.openDevMenu` (`src/engine.tsx:397,412`); `webpack.config.js` has no
  `ProvidePlugin`/`externals` that would leak lodash's `_` onto `window`.
  (Verified empirically: an ES module doing `_ = 5` throws `ReferenceError: _ is not defined`.)
- What the script assumes / does: that `_ = <expr>` is a harmless throw-away assignment (it was introduced upstream in
  commit `2462af8`, replacing a plain `await`). `maybeDoCasino()` first kills `work-for-factions.js` and `daemon.js`,
  then executes line 835.
- What the game actually does: line 835 raises `ReferenceError`, which propagates out of `maybeDoCasino` into the
  `try/catch` in `main_start` (`autopilot.js:148-152`) where it is logged as a suppressed warning. Because
  `maybeDoCasino` is called *before* `maybeInstallAugmentations` in `mainLoop` (`autopilot.js:261-262`), the install /
  reset logic never runs either.
- Concrete failure scenario: normal BN with SF4, player has ≥ $300k (or is already in Aevum), casino earnings < $10b
  (they reset on every install — `src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:128` `this.moneySourceA.reset()`),
  income < 5b/min. Every 2 s mainLoop pass: `checkOnRunningScripts` (re)launches `daemon.js`, then `maybeDoCasino` kills
  `daemon.js` + `work-for-factions.js` and throws. Result: daemon is killed within the same pass it is launched, the $10b
  casino run never happens, and augmentations are never installed — the BN stalls completely.
- Severity: **high** (kills the hacking daemon in a loop, no casino money, no automatic ascension)
- Suggested fix: drop the `_ = ` (just `await getNsDataThroughFile(...)`), or declare a local variable.
- Status: fixed — commit `f881e4d` (removed the `_ = ` prefix; the value was never used).

### SG-F2: `crime.js` crashes on its first loop — `work-for-factions.js` module globals are `undefined` when imported
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/crime.js:2,15` imports and calls
  `crimeForKillsKarmaStats()`; that function calls `isValidInterruption` at `work-for-factions.js:671-672`, which reads
  module globals declared (but never assigned outside `main`) at `work-for-factions.js:110-111`:
  ```js
  let dictSourceFiles, dictFactionFavors, playerGang, mainLoopStart, scope, ...
  ...
  async function isValidInterruption(ns, currentWork = null) { ...
      else if (7 in dictSourceFiles && !hasSimulacrum && !options['no-bladeburner-check']) {   // line 882
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptWorker.ts:55-66`
  ```ts
  const loadedModule = await compile(script, scripts);
  ...
  const mainFunc = loadedModule.main;
  await mainFunc(ns);
  ```
  The runtime only calls `main` of the *started* script. An imported module (`work-for-factions.js`) only has its
  top-level evaluated, so `dictSourceFiles`/`options`/`shouldFocus` stay `undefined`.
- What the script assumes / does: `crimeForKillsKarmaStats` is exported for reuse and guards `options` in two places
  (`work-for-factions.js:644,663`), but `isValidInterruption` (line 882) and the tail-window line 675 do not guard.
- What the game actually does: `7 in undefined` throws `TypeError: Cannot use 'in' operator to search for '7' in undefined`
  on the first iteration (`lastCrime` is undefined, so the branch containing the `isValidInterruption` call is always taken).
  `crime.js` has no try/catch, so the script dies immediately.
- Concrete failure scenario: `run crime.js` or `run crime.js --fast-crimes-only` → script terminates with a TypeError
  before committing a single crime. (Only `run crime.js <CrimeName>` works, since that path uses `legacyAutoCrime`.)
- Severity: **high** (the script's default mode is completely non-functional)
- Suggested fix: guard the imported-use case in `isValidInterruption` (e.g. `if (!dictSourceFiles || !options) return false;`)
  and at `work-for-factions.js:675` (`options?.['no-tail-windows']`).

### SG-F3: `work-for-factions.js` IT-track hacking requirements are 100 too low for tiers 2 and 3
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js:49-55`
  ```js
  name: "IT",
  reqRep: [0e0, 7e3, 35e3, 175e3],
  reqHck: [225, 250, 275, 375], // [1, 26, 51, 151] + 224
  ```
  used by `getTier()` at `work-for-factions.js:1199-1202` and for the next-promotion requirements at `:1220-1222`.
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Company/data/CompanyPositionsMetadata.ts:137-161`
  ```ts
  [JobName.IT2]: { ... reqdCharisma: 51, reqdHacking: 151, reqdReputation: 35e3, ... },
  [JobName.IT3]: { ... reqdCharisma: 76, reqdHacking: 251, reqdReputation: 175e3, ... },
  ```
  with `requiredSkills(jobStatReqOffset)` adding the company offset (`src/Company/CompanyPosition.ts:144-154`;
  offsets 224/249 in `src/Company/data/CompaniesMetadata.ts`). So the real values are `[1, 26, 151, 251] + 224`
  = `[225, 250, 375, 475]`, not `[225, 250, 275, 375]`. (The Software table in the script *is* correct.)
- What the script assumes / does: with hacking ≥ 275 (or ≥ 375) and enough rep/charisma it believes it qualifies for
  "IT Manager" (or "Systems Administrator"), applies for the promotion, and unconditionally records
  `currentJobTier = bestJobTier` (`:1212`).
- What the game actually does: `Player.applyForJob` climbs the track only while `isQualified`
  (`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:325-329`) and returns `success:false` when the player already
  holds the best qualifying job (`:331-340`), so `ns.singularity.applyToCompany` returns `null`
  (`src/NetscriptFunctions/Singularity.ts:726-736`).
- Concrete failure scenario: hacking 375, charisma 300, ECorp/other megacorp rep ≥ 175k → script thinks it is tier 3,
  logs `Application to "X" for a 'IT' Job or Promotion failed.` every 5 s loop, stays at IT Manager (rep multiplier 1.3
  instead of 1.4), and computes the next promotion's `requiredHack` from the wrong (understated) row, so it studies
  Charisma at ZB (`:1231-1259`) for a promotion that is actually blocked by hacking level — wasted hours of study.
- Severity: medium (degraded automation: wrong job tier, wasted study time, error-log spam)
- Suggested fix: change the IT row to `reqHck: [225, 250, 375, 475] // [1, 26, 151, 251] + 224` (charisma/rep rows are correct).

### SG-F4: `autopilot.js` operator-precedence bug makes the "low SF4 level" fallback unreachable — start-up loops forever
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js:167-181`
  ```js
  } catch (err) {
      if (unlockedSFs[4] || 0 == 3) throw err; // No idea why this failed, treat as temporary and allow auto-retry.
      log(ns, `WARNING: You only have SF4 level ${unlockedSFs[4]}. Without level 3, ...`, true);
  }
  ```
  `==` binds tighter than `||`, so this is `unlockedSFs[4] || false` — i.e. it rethrows for *every* SF4 level
  (the block is only reachable when `4 in unlockedSFs`). The intended expression is `(unlockedSFs[4] || 0) == 3`.
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Netscript/RamCostGenerator.ts:82-94` and `:201`
  ```ts
  function SF4Cost(cost) { return () => { if (Player.bitNodeN === 4) return cost;
      const sf4 = Player.activeSourceFileLvl(4); if (sf4 <= 1) return cost * 16; if (sf4 === 2) return cost * 4; return cost; }; }
  ...
  getOwnedAugmentations: SF4Cost(RamCostConstants.SingularityFn3),   // SingularityFn3 = 5 GB
  ```
  With SF4.1 `ns.singularity.getOwnedAugmentations()` costs 80 GB (plus the ~1.6 GB temp-script base), so the call at
  `autopilot.js:174` genuinely fails on low-RAM home servers — exactly the case the catch block was written for.
- What the script assumes / does: with SF4 < 3 it means to log a warning and carry on with reduced functionality.
- What the game actually does: the error is rethrown out of `startUp()`, caught by `main_start` (`:148-152`),
  `startUpRan` stays false and `mainLoop` is never reached; autopilot just logs a suppressed warning every 2 s.
- Concrete failure scenario: player with SF4.1 (or SF4.2) starting a new BN with < ~82 GB home RAM → autopilot does
  nothing at all (no daemon management, no installs) until home RAM grows, which nothing is driving.
- Severity: medium (stuck loop for low-SF4 players — exactly the audience the fallback targets)
- Suggested fix: `if ((unlockedSFs[4] || 0) == 3) throw err;`

### SG-F5: `casino.js` can never read a dealer "10" card
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/casino.js:596-601`
  ```js
  const dealerCount = await findRequiredElement("//p[contains(text(), 'Dealer')]/..");
  const text = dealerCount.innerText.substring(8, 9);
  let cardValue = parseInt(text);
  return isNaN(cardValue) ? (text == 'A' ? 11 : 10) : cardValue;
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Casino/CardDeck/Card.ts:17-31`
  ```ts
  formatValue(): string { switch (this.value) { case 1: return "A"; case 11: return "J"; case 12: return "Q"; case 13: return "K"; default: return `${this.value}`; } }
  ```
  rendered by `src/Casino/CardDeck/ReactCard.tsx:56-60` inside the dealer panel (`src/Casino/Blackjack.tsx:325-340`).
  A value-10 card renders as the two-character string `"10"`.
- What the script assumes / does: a single character at a fixed offset always identifies the dealer's up-card.
- What the game actually does: for the 10 card the single character is `"1"` (or `"0"`), so `parseInt` yields 1 (or 0)
  instead of 10. Face cards (`J`/`Q`/`K`) still resolve to 10 via the `isNaN` fallback, and `A` → 11.
- Concrete failure scenario: dealer shows a 10 while the player holds hard 13-16 → `shouldHitAdvanced`
  (`casino.js:591`) sees `dealer <= 6` and stays instead of hitting, losing hands it should win. Impact is limited
  because losses are save-scummed (`casino.js:363-367`), so it only costs extra reload cycles.
- Severity: low
- Suggested fix: parse the full card text (e.g. match `/(10|[2-9]|[AJQK])/` on the dealer panel's first card span)
  instead of a one-character substring.

### SG-F6: `casino.js` travel-confirmation click is guarded by an always-true condition
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/casino.js:165-171`
  ```js
  await click(await findRequiredElement("//span[contains(@class,'travel') and ./text()='A']"));
  if (!ns.getPlayer().city != "Aevum")            // `!string` is false; `false != "Aevum"` is always true
      await click(await findRequiredElement("//button[p/text()='Travel']"));
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Locations/ui/TravelAgencyRoot.tsx:40-50`
  ```tsx
  if (Settings.SuppressTravelConfirmation) { travel(city); return; }
  setOpen(true);   // otherwise show the confirmation dialog containing the "Travel" button
  ```
  (`Settings.SuppressTravelConfirmation` default is `false`, `src/Settings/Settings.ts:63`, but many players enable it.)
- What the script assumes / does: the intent was clearly "if we are not yet in Aevum, a confirmation dialog must be open".
- What the game actually does: with `SuppressTravelConfirmation` enabled the click already travelled and no `Travel`
  button exists, so `findRequiredElement` throws after its retries.
- Concrete failure scenario: player without SF4 (or whose `travelToCity` failed) and with travel confirmations
  suppressed → one failed navigation attempt + error log; the outer retry loop (`casino.js:227-237`) recovers on the
  next pass because the player is now in Aevum. Wastes an attempt out of the 5 allowed.
- Severity: low
- Suggested fix: `if (ns.getPlayer().city != "Aevum")` (and prefer `tryfindElement` for the confirmation button).

### SG-F7: `run-command.js -s` (silent mode) destroys the command it was given
- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/run-command.js:13-20,38`
  ```js
  if (args.includes('-s')) { silent = true; args = args.slice(args.indexOf('-s'), 1); }
  ```
  `Array.prototype.slice(start, end)` — with `-s` first this evaluates to `slice(0, 1)` → `['-s']`, i.e. the actual
  command is thrown away and `-s` becomes the command.
- Game source: the resulting text is written verbatim into a temp script by `helpers.js runCommand` and then compiled by
  the game (`/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptWorker.ts:55-60` → `compile()` →
  `src/NetscriptJSEvaluator.ts:48-58`), which fails to parse `ns.tprint(JSON.stringify(await (async () => -s)() ...))`.
  (The decisive part of this finding is JS `slice` semantics rather than a game rule — flagged for transparency.)
- Concrete failure scenario: `run run-command.js -s ns.getPlayer().money` → the temp script is syntactically invalid and
  the command never runs.
- Severity: low (documented flag is unusable; the default, non-silent path is unaffected)
- Suggested fix: `args = args.filter(a => a !== '-s');`

---

### SG: Unconfirmed (dropped)
- **`faction-manager.js` NF-level inference vs queued SoA augs** (`faction-manager.js:781`): the inference divides by
  `augCountMult ** numAugsAwaitingInstall`, but the game's price multiplier counts only *non-SoA* queued augs
  (`src/Augmentation/AugmentationHelpers.ts:32-37`). Since "Shadows of Anarchy" is in the default `--ignore-faction`
  list and SoA augs are never purchased by these scripts, I could not construct a reachable failure.
- **`crimeForKillsKarmaStats` one-iteration lag when switching crimes** (`work-for-factions.js:671-683`): the re-commit
  test compares the in-game crime against `lastCrime` rather than the newly chosen `crime`, so a switch takes effect one
  5 s loop later. Real but self-correcting; no game-source rule is violated.
- **`casino.js checkForKickedOut` shadowed `closeModal`** (`casino.js:110-121`): the outer `let closeModal` is never
  assigned (the inner `let` shadows it), so the `while` test is always true; the inner `break` still terminates the loop,
  so I could not find a state where it misbehaves.
- **`ascend.js` local `const hasTixApiAccess`** (`ascend.js:56`): the identifier matches an NS function name, so the
  static analyser may add its 0.05 GB. Too small to matter and I did not confirm the analyser resolves it
  (`findFunc` in `src/Script/RamCalculations.ts:225-248` matches any leaf key by name, so it probably does).

### SG: Checked and OK (verified against v3.0.1 source)
- **RAM identifiers** (`matches.mjs` on all 15 files): no accidental expensive charges. The `skills`/`hacking`/`work`/
  `reputation` hits are `ns.formulas.*` *namespaces* (objects), and `src/Script/RamCalculations.ts:225-235` only charges
  leaf entries whose value is a number/function, so `player.skills.hacking` etc. are free. `heart.break`, `read`, `write`,
  `flags`, `print`, `toast`, `sleep` are all 0 GB; the `run`/`ls`/`getPlayer` charges are deliberate.
- **`Tasks/program-manager.js`**: every name and price matches `src/DarkWeb/DarkWebItems.ts` + `src/Programs/Enums.ts`
  (incl. `DarkscapeNavigator.exe` = `DarknetConstants.DarkscapeNavigatorPrice` = 50e6, `Formulas.exe` = 5e9);
  `purchaseProgram` returns `false` (never throws) without TOR / money / on a bad name
  (`src/NetscriptFunctions/Singularity.ts:420-460`), and returns `true` if already owned, which the script handles.
- **`Tasks/tor-manager.js`**: `ns.hasTorRouter()` exists and costs 0.05 GB (`src/NetscriptFunctions.ts:195`,
  `RamCostGenerator.ts:582`); `purchaseTor` returns true if already owned / false if unaffordable
  (`Singularity.ts:401-418`). The 3.0 comment about `ns.scan` no longer exposing `darkweb` motivates the change correctly.
- **Daedalus logic (branch change)**: invite reqs are `haveAugmentations(DaedalusAugsRequirement) && haveMoney(100e9) &&
  (hacking ≥ 2500 || all combat ≥ 1500)` (`src/Faction/FactionInfo.tsx:138-149`) — `daedalusCombatPathMet` matches.
  BN15 really does strip The Red Pill from Daedalus (`src/Faction/FactionHelpers.tsx:204-207`), so autopilot's new
  BN15 early-exit is correct. TRP rep cost 2.5e6 (`src/Augmentation/Augmentations.ts:1946-1947`) matches
  `daedalusSpecialCheck`.
- **Augmentation pricing**: `augCountMult = 1.9 * [1,0.96,0.94,0.93][SF11]` matches
  `getBaseAugmentationPriceMultiplier` (`AugmentationHelpers.ts:29-30`, `CONSTANTS.MultipleAugMultiplier = 1.9`);
  NF base 750e3 / rep 500 / ×1.14 per level matches `Augmentations.ts:1159-1161` + `CONSTANTS.NeuroFluxGovernorLevelMult`;
  the per-purchase multiplier applies to queued augs (`getGenericAugmentationPriceMultiplier`), which the script models.
  `activeSourceFileLvl(11)` does *not* add a level for being inside BN11, matching the script's use of *owned* SF levels.
- **Donations**: `getCostOfReputation = 1e6 * rep / mults.faction_rep / FactionWorkRepGain` matches
  `donationForRep` (`src/Faction/formulas/donation.ts:12-14`, `CONSTANTS.DonateMoneyToRepDivisor = 1e6`);
  `repToFavour(f) = 25500*1.02^(f-1) - 25000` is algebraically identical to `favorToRep` (`formulas/favor.ts:15-18`);
  the no-donation list (Bladeburners, Church of the Machine God, Shadows of Anarchy) exactly matches the factions with
  `offersWork() === false` (`FactionInfo.tsx:711-713, 772-774, 806-808`), plus the gang faction which the game also blocks.
- **Joining every invite (branch change)**: passive rep for all joined non-special, non-gang factions is real
  (`FactionHelpers.tsx:132-157`), and only city factions declare `enemies` (`FactionInfo.tsx:498-553`), so the
  `--join-all-invites` default plus the city-faction exclusion is safe.
- **Faction invite requirement tables** in `work-for-factions.js:422-431` match `FactionInfo.tsx` for money, hacking,
  combat, karma and kills (Slum Snakes -9/30/1e6, Tetrads -18/75, Silhouette -22/15e6/CTO, Speakers -45/300/30 kills,
  Dark Army -45/300/5 kills, Syndicate -90/200/200/10e6, Covenant 20 augs/75e9/850/850, Illuminati 30/150e9/1500/1200),
  and the travel destinations satisfy the `locatedInCity` clauses. Netburners' hacknet totals (100 levels / 8 RAM /
  4 cores) match `FactionInfo.tsx:675`. Gang karma requirement is -54000 (`src/Gang/data/Constants.ts:27`).
- **Company faction rep**: 400e3 with a ×0.75 backdoor discount (`CONSTANTS.CorpFactionRepRequirement`,
  `CompanyRequiredReputationMultiplier`, `src/Company/utils.ts:15-19`) — the script's `400_000 - 100_000` is equivalent;
  the `jobStatReqOffset` fix on this branch (ECorp/MegaCorp/NWO = 249, others = 224) is correct; the Software job table,
  IT/Software rep requirements, `serverByCompany["Fulcrum Technologies"] = "fulcrumtech"` and the Silhouette
  "CTO" path (`executiveEmployee()` = software7/business4/business5) all check out.
- **Crime model (branch change)**: failed crimes grant karma/4 and no kills (`src/Work/CrimeWork.ts:64-82`);
  Homicide = 3 karma / 3 s / 1 kill and Mug = 0.25 karma / 4 s (`src/Crime/Crimes.ts:44-63, 139-160`) — the
  "Homicide always beats Mug for karma" rewrite is sound. All 12 crime names match `src/Crime/Enums.ts`.
- **Work API shapes**: `getCurrentWork()` field names used by the scripts (`type`, `crimeType`, `classType`, `location`,
  `factionName`, `factionWorkType`, `companyName`) match the `APICopy()` implementations, and `WorkType.GRAFTING` is the
  literal `"GRAFTING"` (`src/Work/Work.ts:48-55`). `workForFaction` returns `false` (not throws) for unsupported work
  types, gang factions and non-members, as `detectBestFactionWork` relies on.
- **Casino**: kick-out is `Player.getCasinoWinnings() > 10e9` on `moneySourceA.casino` (`src/Casino/Game.ts:4-19`,
  `PlayerObjectGeneralMethods.ts:600`), which resets on install (`:128`) — autopilot's per-install casino run is valid;
  max bet 100e6 and the result strings "You won!"/"You Won! Blackjack!"/"You lost!"/"Push! (Tie)"
  (`src/Casino/Blackjack.tsx:15-25`) match the xpaths; the `{isTrusted:true}` fake event satisfies
  `startOnClick`/`trusted` (`Blackjack.tsx:239-243`, `src/Casino/utils.ts`); `BetInput` rounds and caps the wager.
- **autopilot misc**: `destroyW0r1dD43m0n(nextBn, cbScript, {sourceFileOverrides:new Map()})` is a valid signature and
  passing that object is equivalent to passing nothing (`Singularity.ts:1153-1193`, `NetscriptHelpers.tsx:871-913`,
  `BitNodeUtils.ts:30-42`); BN15 is a valid next BN (`src/BitNode/Constants.ts:1`); the bladeburner win check
  (`'Black Operations'`, `'Operation Daedalus'`, `=== 0`) matches `Bladeburner.ts:176-188` + `Bladeburner/Enums.ts`;
  the `--max-money-boost-cap` $10t soft cap matches `src/Server/Server.ts:126-134`; SF4-level RAM reserve (16×/4×)
  matches `SF4Cost`; duplicate `--reserved-ram` args are last-wins in the `arg` parser, and a boolean arg lands in `_`
  without breaking parsing (`src/NetscriptFunctions/Flags.ts:29`); `ns.write` accepts numbers
  (`NetscriptHelpers.tsx:137-141`); `facman.unpurchased_count` really is emitted by `faction-manager.js:250`
  (only the JSDoc in autopilot is stale).
- **`stats.js`**: `ns.getServer` takes a single parameter, so `ns.args.map(ns.getServer)` is safe; `getTotalScriptIncome()`
  returns a 2-element array (index 0 used); gang/bladeburner/hacknet APIs and field names match.
- **`ascend.js`**: `upgradeHomeCores` terminates (returns false at 8 cores / insufficient money,
  `Singularity.ts:595-613`); `softReset`/`installAugmentations` callback-script resolution is valid; Stanek's gift
  eligibility (no non-NF augs owned *or queued*) matches `src/CotMG/Helper.tsx:59-74`, and the aug name
  `"Stanek's Gift - Genesis"` matches `src/Augmentation/Enums.ts:126`.
- `Tasks/run-with-delay.js`, `Tasks/write-file.js`, `dev-console.js`, `dump-ns-namespace.js`, `grep.js`: no
  game-behaviour mismatches found (`ns.write(...ns.args)` mode defaulting and `ns.run(script, {temporary:true}, ...)`
  are both valid in 3.0.1).

## FT: Gangs, sleeves, bladeburner, go, stanek, stocks, hacknet

Source report: `features-report.md` (verified line by line by the coordinator).

Game source of truth: `/home/jubnl/dev/bitburner/bitburner-src/src` (Bitburner v3.0.1).
Scripts: `/home/jubnl/dev/bitburner/bitburner-scripts` (branch `game-optimisation-3.0`).

---

### FT-F1: `ns.gang.getBonusTime() > 0` is true ~90% of the time in normal play, so gangs.js permanently thinks a territory tick is imminent and parks the whole gang on Territory Warfare

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/gangs.js:238-240`, `gangs.js:660-664`, and its consumers `gangs.js:11-12, 221-231, 305-306, 329`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Gang.ts:340-343`
  ```ts
  getBonusTime: (ctx) => () => {
    const gang = getGang(ctx);
    return gang.storedCycles * CONSTANTS.MilliPerCycle;
  },
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/Gang.ts:99-110`
  ```ts
  process(numCycles = 1): void {
    this.storedCycles += numCycles;
    if (this.storedCycles < GangConstants.minCyclesToProcess) return;   // minCyclesToProcess = 10
    const cycles = Math.min(this.storedCycles, GangConstants.maxCyclesToProcess);
    ... this.storedCycles -= cycles;
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/engine.tsx:106` — `if (Player.gang) Player.gang.process(numCycles);` with `numCycles` = 1 per 200 ms tick (`engine.tsx:428-434`).
  The game's own UI only calls it bonus time above 5 s: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/ui/BonusTime.tsx:15-17`
  ```tsx
  const CyclerPerSecond = 1000 / CONSTANTS.MilliPerCycle;
  if ((props.gang.storedCycles / CyclerPerSecond) * 1000 <= 5000) return <></>;
  ```
- What the script assumes / does: it treats any non-zero `getBonusTime()` as "we are in bonus time", and therefore divides the 20 s territory period by 25 (`territoryNextTick = lastLoopTime + territoryTickTime / 25`) and uses 25 cycles/update in `getGangCyclesPerUpdate()`.
- What the game actually does: in normal (non-bonus) play `storedCycles` cycles through 1,2,…,9,0 — it is non-zero on 9 of every 10 engine ticks, so `getBonusTime()` returns 200–1800 ms almost always. Real bonus time is > 5000 ms. The gang genuinely processes 10 cycles per update normally, 25 only while catching up.
- Concrete failure scenario: normal foreground play, gang below 100% territory. `onTerritoryTick` sets `territoryNextTick = now + 800 ms`. Two loop iterations later (`gangs.js:221`) the script sets **every** member to `"Territory Warfare"`. The tick-detection fallback at `gangs.js:226` (`thisLoopStart > territoryNextTick + 5000`) then fires ~5.8 s later, re-runs `onTerritoryTick`, logs `WARNING: Power stats weren't updated, assuming we've lost track of territory tick` (toasted, `gangs.js:247-248`), and restarts the same 5.8 s cycle. Net effect: members do crime for ~0.4 s out of every ~5.8 s and Territory Warfare the rest — money/respect/wanted-reduction income collapses, and low-defense members are repeatedly exposed to clash deaths. Secondary effect: `computeWantedGains` divides the vigilante decay term by 25 instead of 10, so the script under-estimates wanted recovery by 2.5x and the self-check at `gangs.js:383` emits spurious `WARNING: Calculated new rates would be ...` messages whenever anyone is on Vigilante Justice / Ethical Hacking.
- Severity: **high**
- Suggested fix: compare against a real bonus-time threshold, e.g. `ns.gang.getBonusTime() > 5000` (matching `BonusTime.tsx`), or at minimum `> GangConstants.maxCyclesToProcess * 200`. Use the same test in `getGangCyclesPerUpdate()`.

---

### FT-F2: `"Unassigned"` is in the candidate task list, and the wanted-downgrade loop prefers it over training

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/gangs.js:188-189` (`allTaskNames = ns.gang.getTaskNames()`), `gangs.js:325-337` (all of `allTaskNames` become candidates, sorted by gain), `gangs.js:359-363` (downgrade loop picks `memberTaskRates[mostWanted].filter(c => c.wanted < ...)[0]`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Gang.ts:189-194`
  ```ts
  getTaskNames: (ctx) => () => {
    const gang = getGang(ctx);
    const tasks = gang.getAllTaskNames();
    tasks.unshift("Unassigned");
    return tasks;
  },
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/GangMember.ts:155-157` — `calculateExpGain()` returns `null` for `Unassigned`, so an unassigned member gains **no experience at all** (and `Gang.ts:418-427` `getAllTaskNames()` deliberately excludes it).
- What the script assumes / does: it treats every name returned by `getTaskNames()` as a workable task. `Unassigned` survives the `gangs.js:330` filter (its `wanted` is 0, so `task.wanted <= 0` passes). Because `Array.prototype.sort` is stable and `Unassigned` is the **first** element of `allTaskNames`, it sorts ahead of every other zero-gain task (including `Train Combat`/`Train Hacking`) after the descending gain sort.
- What the game actually does: `Unassigned` is a real, assignable state that produces no respect, no money, no wanted **and no experience**; `setMemberTask(name, "Unassigned")` succeeds (`assignToTask` returns true because the key exists in `GangMemberTasks`), so the script sees success.
- Concrete failure scenario: gang is over its wanted tolerance; the downgrade loop at `gangs.js:359` picks the highest-wanted member and looks for the first lower-wanted task. When no positive-gain task has lower wanted, the first match is `Unassigned` (gain 0, wanted 0) rather than a Train task. The member is parked doing literally nothing — not even training — until the next territory tick (up to 20 s, or every loop while the tolerance is positive).
- Severity: **low**
- Suggested fix: drop `"Unassigned"` from `allTaskNames` right after fetching it (`allTaskNames = allTaskNames.filter(t => t != "Unassigned")`).

---

### FT-F3: operator-precedence bug makes the auto "money vs respect" focus never evaluate `respect < 9000`

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/gangs.js:321-323`
  ```js
  factionRep > requiredRep ? "money" : (playerData.money > 1E11 || myGangInfo.respect) < 9000 ? "respect" : "both money and respect";
  ```
- Game source: n/a for the formula itself; the consequence is measured against `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/formulas/formulas.ts:15-73`, where respect and money gains are independent optimisation targets.
- What the script assumes / does: the comment and the surrounding code intend `playerData.money > 1E11 || myGangInfo.respect < 9000`. As written, `||` binds tighter than the comparison, so the expression is `(money > 1e11 || respect) < 9000`.
- What actually happens: if `money > 1e11` the left side is the boolean `true`, and `true < 9000` → `true` → the script picks `"respect"`. If `money <= 1e11` the left side is the raw respect number, so it *accidentally* evaluates `respect < 9000` correctly. So the only broken branch is "rich player": with ≥ \$100b and any amount of respect, the script optimises purely for respect and never selects `"both money and respect"`.
- Concrete failure scenario: player with \$500b and 10M gang respect but `factionRep < requiredRep` → `optStat = "respect"` forever; gang money income is never balanced in.
- Severity: **low** (degraded optimisation target, pre-existing upstream)
- Suggested fix: parenthesise as `(playerData.money > 1E11 || myGangInfo.respect < 9000)`.

---

### FT-F4: members are put on Territory Warfare while `territoryClashChance` is still 0, so the low-defense death guard is bypassed on the first engaged tick

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/gangs.js:221-223` and `gangs.js:282-283`
  ```js
  if (forceTask == "Territory Warfare" && myGangInfo.territoryClashChance > 0 && (member.def < 100 || member.def < Math.min(10000, maxMemberDefense * 0.1)))
      task = assignedTasks[member.name]; // Hack: Spare low-defense members ...
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Gang/Gang.ts:209-216` then `:232-233` and `:291-302`
  ```ts
  if (this.territoryWarfareEngaged) { this.territoryClashChance = 1; }
  ...
  if (thisGang === gangName || otherGang === gangName) { if (!(Math.random() < this.territoryClashChance)) continue; }
  ...
  if (member.task !== "Territory Warfare") continue;      // only warfare members can die
  ```
- What the script assumes / does: it uses the *last observed* `territoryClashChance` to decide whether warfare is dangerous, and skips the guard entirely while it is 0.
- What the game actually does: `territoryClashChance` is only recomputed inside `processTerritoryAndPowerGains`, and it is set to 1 **in the same call** that immediately afterwards resolves clashes. So right after `setTerritoryWarfare(true)`, `getGangInformation().territoryClashChance` still reads 0 while the very next territory update will clash at 100% chance.
- Concrete failure scenario: the script decides to engage in `enableOrDisableWarfare` (`gangs.js:596-602`), then on the next loop assigns *all* members — including a freshly recruited `def = 1` member — to Territory Warfare because `territoryClashChance == 0`. The next game territory update sets clash chance to 1 and rolls deaths; the low-defense member has death chance `0.01 / def^0.6`, and dying costs 5% of total gang respect plus all its earned respect (`Gang.ts:371-388`).
- Severity: **low**
- Suggested fix: treat "we have asked to engage" as dangerous — check `myGangInfo.territoryWarfareEngaged || myGangInfo.territoryClashChance > 0` instead of clash chance alone.

---

### FT-F5: a transient "another sleeve already works for this faction" throw is mis-read as "work type unsupported" and permanently blacklists the faction

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/sleeve.js:416-424` (candidate selection) and `sleeve.js:490-518` (failure handling; `sleeve.js:505-509` sets `factionWorkUnsupported[faction] = true`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Sleeve.ts:152-164`
  ```ts
  // Cannot work at the same faction that another sleeve is working at
  for (let i = 0; i < Player.sleeves.length; ++i) {
    ...
    if (isSleeveFactionWork(other.currentWork) && other.currentWork.factionName === factionName) {
      throw helpers.errorMessage(ctx, `Sleeve ${sleeveNumber} cannot work for faction ${factionName} because Sleeve ${i} is already working for them.`);
    }
  }
  ```
- What the script assumes / does: any failure of `setToFactionWork` is attributed to the *work type* (`security`/`field`/`hacking`) not being offered by that faction; it advances `workByFaction[faction]` and, after 3 failures, sets `factionWorkUnsupported[faction] = true`, which removes the faction from `refreshFactionWorkCandidates` (`sleeve.js:137`) and from `pickSleeveTask` (`sleeve.js:419`) for the remaining life of the script.
- What the game actually does: it throws for three distinct reasons — not a member, gang faction, **and "another sleeve is already working for them"**. The last one is transient and has nothing to do with work type.
- Concrete failure scenario: `factionWorkCandidates` is rebuilt every 5 minutes and sorted by current rep (`sleeve.js:144-148`), so its order changes as rep accrues. Suppose sleeve 4 works for faction A and sleeve 5 for faction B; after a refresh the order flips, so sleeve 4 is designated B while sleeve 5 still *is* working for B → throw → recorded as unsupported work type. Sleeve 5 is then designated A while sleeve 4 is still on A → throw as well. Three consecutive loops of this (~3 s, and each attempt burns 5 `getNsDataThroughFile` retries because the temp script writes an `ERROR: ` result) and **both** factions are blacklisted permanently, so no sleeve ever works for them again this run.
- Severity: **medium**
- Suggested fix: only blacklist when the thrown message does not mention another sleeve/faction membership — or, simpler, keep the current sleeve's designated faction stable across loops (remember `factionBySleeve[i]`) so reordering the candidate list cannot create cross-assignments.

---

### FT-F6: the new `--darknet-charisma` task raises the *sleeve's* charisma, but the patch also stopped syncing sleeves, so the player gains ~1% of it

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/sleeve.js:284-289` (sync is now skipped unless `--sync-first` or we want karma crime) and `sleeve.js:425-442` (studies Leadership until `charismaGoal > playerInfo.skills.charisma`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Work/Work.ts:17-25`
  ```ts
  export const applySleeveGains = (sleeve: Sleeve, shockedStats: WorkStats, mult = 1): void => {
    applyWorkStatsExp(sleeve, shockedStats, mult);           // sleeve's own exp: NOT scaled by sync
    const sync = sleeve.syncBonus();
    applyWorkStatsExp(Player, shockedStats, mult * sync);    // player's exp: scaled by sync
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/PersonObjects/Sleeve/Sleeve.ts:78` (`sync = 1`) and `:177-179` (`syncBonus() { return this.sync / 100; }`)
- What the script assumes / does: it puts an idle sleeve into `Algorithms`/`Leadership` at ZB Institute and loops until the **player's** charisma reaches the goal left by darknet.js.
- What the game actually does: only `sync/100` of the sleeve's class experience is copied to the player. A never-synchronised sleeve starts at `sync = 1`, i.e. the player gets 1% of the charisma exp while paying ZB Institute's (most expensive) tuition in full.
- Concrete failure scenario: player is already in a gang (so `wantKarmaCrime` is false, `sleeve.js:287`) and `--sync-first` is not set, so no sleeve ever synchronises. darknet.js writes a charisma goal; an idle sleeve is sent to ZB Institute and studies Leadership essentially forever, paying tuition each tick, while the player's charisma creeps up at 1% of the rate the script's exit condition assumes.
- Severity: **medium**
- Suggested fix: require `sleeve.sync` to be meaningful (e.g. `>= 50`) before taking the darknet-charisma job, or synchronise the chosen sleeve first — otherwise the player-facing goal can't be reached by that sleeve.

---

### FT-F7: the `--crime` option is ignored because of operator precedence

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/sleeve.js:447`
  ```js
  var crime = options.crime || (await calculateCrimeChance(ns, sleeve, "Homicide")) >= options['homicide-chance-threshold'] ? 'Homicide' : 'Mug';
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Crime/Enums.ts:1-14` lists 12 crimes, and `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Sleeve.ts:91-98` accepts any of them via `getEnumHelper("CrimeType").nsGetMember`, so `--crime Heist` would be a legal request.
- What the script assumes / does: the flag is documented as "sleeves will perform only this crime regardless of stats" (`sleeve.js:6`).
- What actually happens: `||` binds tighter than `?:`, so the expression is `(options.crime || chance >= threshold) ? 'Homicide' : 'Mug'`. Any truthy `--crime` value yields `'Homicide'`; the user's crime name is discarded. (Line 478 then also uses `options.crime` only to suppress a log line.)
- Concrete failure scenario: `run sleeve.js --crime Heist` → sleeves commit Homicide.
- Severity: **low**
- Suggested fix: `var crime = options.crime || ((await calculateCrimeChance(...)) >= threshold ? 'Homicide' : 'Mug');`

---

### FT-F8: bladeburner.js's skill priority key `"Evasive Systems"` never matches the game's skill name `"Evasive System"`

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/bladeburner.js:14` (`"Evasive Systems": 1.2`) consumed at `bladeburner.js:445` (`costAdjustments[skillName] || 1`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/Enums.ts:70`
  ```ts
  EvasiveSystem = "Evasive System",
  ```
  and `/home/jubnl/dev/bitburner/bitburner-src/src/Bladeburner/data/Skills.ts:67` (`name: BladeburnerSkillName.EvasiveSystem`). `getSkillNames()` returns `Object.values(BladeburnerSkillName)` (`NetscriptFunctions/Bladeburner.ts:104-107`), i.e. the singular form.
- What the script assumes / does: it intends to de-prioritise Evasive System by a 1.2x perceived-cost multiplier (the branch explicitly re-wrote this line and its comment).
- What the game actually does: the key is never found, so `costAdjustments["Evasive System"]` is `undefined` and the multiplier silently falls back to 1.
- Concrete failure scenario: every skill-point spend pass treats Evasive System as unadjusted, so it is bought ~20% more eagerly than the author intended, at the expense of Blade's Intuition / Digital Observer / Short-Circuit.
- Severity: **low** (silently ignored tuning, no crash)
- Suggested fix: rename the key to `"Evasive System"`. Consider validating `costAdjustments` keys against `skillNames` at startup and logging a warning for unknown names.

---

### FT-F9: the "don't interrupt a manually-started final BlackOp" special case stores an object where a name is expected, so it never fires

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/bladeburner.js:367-371`
  ```js
  const currentAction = await getBBInfo(ns, `getCurrentAction()`);
  if (currentAction?.name == remainingBlackOpsNames[remainingBlackOpsNames.length - 1]) lastAssignedTask = currentAction;
  if (lastAssignedTask && lastAssignedTask != currentAction?.name && getCount(lastAssignedTask) > 0) { ... }
  ```
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Bladeburner.ts:120-124`
  ```ts
  getCurrentAction: (ctx) => () => {
    const bladeburner = getBladeburner(ctx);
    if (!bladeburner.action) return null;
    return { ...bladeburner.action };          // { type, name }
  },
  ```
- What the script assumes / does: `lastAssignedTask` is a **string action name** everywhere else (`bladeburner.js:380`, `:400`, and `getCount(lastAssignedTask)`). Line 369 assigns the whole `{type, name}` object instead.
- What the game actually does: `getCount(object)` falls through every `includes()` test and returns 0, so the guard at line 371 is skipped; execution reaches line 387 where `Date.now() < currentTaskEndTime` is false for a task the script did not start, and `bestActionName == currentAction.name` is false when the BlackOp's estimated chance is under `--blackop-success-threshold`. The script then calls `startAction` with its own choice, cancelling the player's final BlackOp.
- Concrete failure scenario: player manually starts Operation Daedalus from the Bladeburner UI while bladeburner.js is running; on the next loop the script cancels it and starts a contract.
- Severity: **low** (requires manual UI interaction; the branch fixed the adjacent `remainingBlackOpsNames[remainingBlackOpsNames - 1]` index bug but left the object/name mismatch)
- Suggested fix: `lastAssignedTask = currentAction.name;`

---

### FT: Unconfirmed (dropped)

- **`ns.gang.setMemberTask` short-circuit in the bulk reduce** (`gangs.js:288`): `(success, m) => success && ns.gang.setMemberTask(...)` would skip all remaining members after a failure. Dropped: `NetscriptFunctions/Gang.ts:195-222` shows `setMemberTask` returns `member.assignToTask(...)`, which per `Gang/GangMember.ts:91-98` returns `false` only for a name absent from `GangMemberTasks` — unreachable because the branch is guarded by `getAllTaskNames().includes(taskName)`. It never returns false, so the short-circuit cannot trigger. (It *can* silently set a member to `Unassigned` and still return `true` for a task valid for the other gang type, but the script only ever picks names from its own gang's `getTaskNames()`.)
- **Sleeve aug purchase short-circuit** (`sleeve.js:107`): same `s && ns.sleeve.purchaseSleeveAug(...)` pattern; a mid-batch failure would skip the rest while `availableAugs[i].splice(0, batchCount)` already dropped them. Dropped as a confirmed *game* fault: `PersonObjects/Sleeve/Sleeve.ts:366-400` only fails on affordability/shock/ownership, and the script budgets the whole batch beforehand; the 60 s cache refresh at `sleeve.js:122-126` also restores the list. Real but speculative.
- **`maxRankNeeded` becomes `undefined` once all BlackOps are complete** (`bladeburner.js:129` → NaN at `:188`). Confirmed to produce NaN, but the resulting behaviour (never reserving population actions) is the desired end-state, so no wrong outcome. Not reported.
- **Travel failure loop** (`sleeve.js:322-325, 338-341, 429-432`): if `ns.sleeve.travel` fails for lack of money the subsequent `setToGymWorkout`/`setToUniversityCourse` returns false (`PersonObjects/Sleeve/Sleeve.ts:288-309, 445-470` reject a sleeve in the wrong city) and the script retries + toasts an error every second. Confirmed mechanically, but `canTrain` already gates on money and the loop self-heals; too marginal to call a finding.
- **`setActionAutolevel`/`setActionLevel` race** (`bladeburner.js:361-362`): `runCommand` returns the pid without awaiting completion, so the level change may land after the following `startAction`. Could not confirm a wrong outcome from the game source (level is re-read at completion time), so dropped.

### FT: Checked and OK

**gangs.js**
- `computeRepGains` / `calculateMoneyGains` / `computeWantedGains` additive terms match `Gang/formulas/formulas.ts:15-73` exactly (11x/5x factors, `-4·`/`-3.2·`/`-3.5·difficulty`, `territoryMult = max(0.005, (territory·100)^fac/100)`, `territoryPenalty = (0.2·territory + 0.8)·GangSoftcap`, `min(100, 7·baseWanted / (3·statWeight·territoryMult)^0.8)`).
- The multiplicative wanted decay `wanted = (old + gain·cycles)·(1 − 0.001·justice)` and the definition of `justice` (`baseWanted < 0`) match `Gang/Gang.ts:125-169`; `wantedLevelGainRate` reported by the API is the post-decay per-cycle delta, so modelling the decay was the right call — only the cycle count (F1) is wrong.
- `minCyclesToProcess = 10` / `maxCyclesToProcess = 25` match `Gang/data/Constants.ts:28-31` (2000/200 and 5000/200).
- Recruit thresholds: `respectForNextRecruit()` and `MaximumGangMembers = 12` match `Gang/Gang.ts:315-323` and `Constants.ts:11`; the new ascend/recruit guard's assumption that ascending deducts `res.respect` matches `Gang/Gang.ts:390-404`.
- Equipment is cleared on ascend (`Gang/GangMember.ts:309`), augmentations are not — the new `isNearAscension` guard is correct.
- `getAscensionResult` / `ascendMember` return `undefined` when `!canAscend()` (`NetscriptFunctions/Gang.ts:284-300`); the script's `!ascResult` / `undefined !==` checks handle it, and `jsonReplacer` in helpers.js serialises `Infinity` correctly for `respectForNextRecruit()`.
- `canRecruitMember()` is exposed as a **boolean** (`NetscriptFunctions/Gang.ts:166-169`) even though `Gang.canRecruitMember()` returns the `RecruitmentResult` enum — the script's boolean use is correct.
- Warfare win chance `power/(power+otherPower)` matches `Gang/AllGangs.ts:73-77`.
- Gang creation gating (`bitNode == 2 || heart.break() <= -54000`) is consistent with `GangConstants.GangKarmaRequirement = -54000` and `Gang/helpers.ts:6-26` (faction membership is also required, which the "try all gangs" loop handles).
- `ns.gang.nextUpdate()` is 0 GB (`Netscript/RamCostGenerator.ts:130-131`) and resolves at the end of `Gang.process()` (`Gang/Gang.ts:115-120`) — the new fast-path is sound.
- Task names: `Ethical Hacking` is hacking-only and `Vigilante Justice` / `Territory Warfare` / all `Train *` are both-type (`Gang/data/tasks.ts:147-149, 336-393`), so `strWantedReduction` and the random training task are always valid for the gang type.
- RAM: `node matches.mjs gangs.js` charges only 0-GB identifiers (`flags`, `sleep`, `disableLog`, `heart.break`, `getBonusTime`, `read`, `nextUpdate`).

**sleeve.js**
- Max sleeves is 8 (`PersonObjects/Sleeve/SleeveCovenantPurchases.tsx:13, 62-63`: `min(3, SF10 + BN10) + 5`), so the 8-entry `bbTasks` array cannot overflow.
- `setToFactionWork` work types `security`/`field`/`hacking` match `Work/Enums.ts:1-5`; `setToGymWorkout` short stat codes `str`/`def`/`dex`/`agi` match `GymType` (`Work/Enums.ts:16-22`); `UniversityClassType.algorithms`/`leadership` and `CrimeType` `Homicide`/`Mug` all match.
- `setToBladeburnerAction` accepts exactly the names used: `Infiltrate Synthoids`, `Support main sleeve`, `Take on contracts`, plus the General names `Field Analysis`, `Recruitment`, `Diplomacy` (`Bladeburner/Enums.ts:8-21`, `PersonObjects/Sleeve/Sleeve.ts:488-539`).
- The v3.0 3-argument `getActionEstimatedSuccessChance(type, name, sleeveNumber)` exists and supports General + Contract only (`NetscriptFunctions/Bladeburner.ts:138-156`); the script's per-sleeve keying and the new `.filter(([i]) => i < numSleeves)` correctly avoid the `checkSleeveNumber` throw.
- `inBladeburner()` needs no API access (`NetscriptFunctions/Bladeburner.ts:74`), so calling it without SF7 does not throw.
- `getSleevePurchasableAugs` does **not** filter by shock (`NetscriptFunctions/Sleeve.ts:225-241`, `Sleeve.ts:90-171`), which is what makes the new `augsPending` training guard work; purchasing itself does require shock 0 (`Sleeve.ts:356-361`) and costs `aug.baseCost` exactly (`Sleeve.ts:392-400`) — matching the `{name, cost}` shape the script budgets with.
- Installing a sleeve aug zeroes all sleeve exp (`Sleeve.ts:215-225`), confirming the `--train-with-pending-augs` rationale; class exp is scaled by `shockBonus()` while the cost is not (`Work/SleeveClassWork.ts:32`), confirming `--train-max-shock`.
- `getCurrentWork()` type strings `FACTION` / `COMPANY` match `Work/Work.ts:48-55` and the `APICopy` shapes in `Work/FactionWork.tsx:71-79` / `Work/CompanyWork.tsx:65-72`.
- Sync only affects sleeve-crime karma and the exp copied to player/other sleeves (`Work/SleeveCrimeWork.ts:46`, `Work/Work.ts:17-25`) — the patched "sync only for karma crime" reasoning is correct as far as it goes (see F6 for the interaction it missed).

**bladeburner.js**
- All nine `difficultyFacByAction` constants match the game data exactly (`Bladeburner/data/Contracts.ts:17, 51, 84`; `data/Operations.ts:17, 51, 87, 122, 162, 200`).
- `difficulty(L) = baseDifficulty · difficultyFac^(L−1)` (`Actions/LevelableAction.ts:58-64`) and `chance = min(1, competence/difficulty)` (`Actions/Action.ts:169-196`) — the `getTargetLevel` scaling model is correct, and clamping with `Math.min(chance, 1)` is the conservative direction.
- Autolevel really does snap level back to `maxLevel` on every completion (`Bladeburner/Bladeburner.ts:1005-1007`), so disabling it before `setActionLevel` is required; `setActionLevel` rejects levels outside `1..maxLevel` (`NetscriptFunctions/Bladeburner.ts:218-227`) and `getTargetLevel` stays inside that range.
- The `--success-threshold 0.9` rationale holds: failing an action loses rank and HP but **not** faction rep — `changeRank` only adds reputation when `change > 0` (`Bladeburner/Bladeburner.ts:1267-1282`), and skill points come from `maxRank`, which never decreases.
- BlackOps ignore population (`Actions/BlackOperation.ts` overrides `getPopulationSuccessFactor`), but `getSuccessRange` still skews one end by `pop/popEst` (`Actions/Action.ts:144-167`) — taking `max(lo, hi)` with a stricter `--blackop-success-threshold` is the correct reading.
- `Incite Violence` adds `(60·3·growthFunction())/480` count and `10 + chaos/log10(chaos)` chaos to every city (`Bladeburner/Bladeburner.ts:1221-1237`), and `ChaosThreshold = 50` with a `sqrt(1 + chaos − 50)` difficulty multiplier (`data/Constants.ts:31`, `Actions/Action.ts:94-103`) — the new `--max-chaos-for-incite` comment and default are accurate.
- Training takes 30 s (`data/GeneralActions.ts:6-12`), matching `timesTrained += update-interval/30000`; Field Analysis / Diplomacy / Recruitment / Incite Violence cost no stamina, so the low-stamina fallbacks are valid.
- `getActionCountRemaining("Black Operations", n)` returns 1 for every not-yet-completed BlackOp (`NetscriptFunctions/Bladeburner.ts:176-188`), matching the `=== 1` filter; `Raid` requires `comms >= 1` (`data/Operations.ts:146-149`) and returns chance 0 otherwise (`Actions/Operation.ts:63-68`), which the city selection respects.
- `getSkillUpgradeCost` returns `Infinity` at max level (`NetscriptFunctions/Bladeburner.ts:241-251`), which serialises to `null` through the temp file — the `?? Number.POSITIVE_INFINITY` workaround at `bladeburner.js:445` is still needed and correct. `Overclock` maxLvl is 90 (`data/Skills.ts:51`).
- `startAction` calls `Player.finishWork(true)` unless the player owns The Blade's Simulacrum (`Bladeburner/Bladeburner.ts:178-180`), which is exactly what `canDoBladeburnerWork` guards against.
- RAM: `node matches.mjs bladeburner.js` charges only `flags`/`sleep`/`alert` (0 GB) plus a legitimate `ns.run` at `bladeburner.js:522`.

---
---


(Findings below were produced by parallel sub-audits; every decisive game-source citation marked **[verified]** was re-read and confirmed by the lead auditor.)

### FT-F10: stockmaster.js liquidates its entire portfolio on every loop when the BitNode option "Disable 4S Data" is set

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/stockmaster.js:163-164` and `stockmaster.js:556-582` (decisive: `563-573`)
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/StockMarket.ts:249-253` (identically at `:275-279`)
  ```ts
  purchase4SMarketData: (ctx) => () => {
    if (Player.bitNodeOptions.disable4SData) {
      helpers.log(ctx, () => "4S Market Data is disabled in advanced BitNode options.");
      return false;
    }
  ```
  `disable4SData` is a real player-selectable advanced BitNode option (`/home/jubnl/dev/bitburner/bitburner-src/src/BitNode/ui/BitNodeAdvancedOptions.tsx:407-410`, `BitNode/ui/PortalModal.tsx:87`, default `false` at `BitNode/BitNodeUtils.ts:38`).
- What the script assumes / does: `tryGet4SApi` assumes that once `budget >= totalCost` the purchase will eventually succeed. It calls `liquidate(ns)` **first** (`stockmaster.js:565-566`), then attempts the purchase, logs `ERROR attempting to purchase ...` on failure and returns false. Nothing records that the purchase is impossible, and `pre4s` (`stockmaster.js:163`) stays true forever, so `tryGet4SApi` is re-entered every main-loop iteration.
- What the game actually does: with `disable4SData` both purchase functions return `false` unconditionally and never set `has4SData` / `has4SDataTixApi`.
- Concrete failure scenario: BN entered with "Disable 4S Data". Once the corpus exceeds ~`totalCost / (buy-4s-budget − fracH)` (≈ \$43b at defaults in BN1), every iteration liquidates all long and short positions (2 commissions + full bid/ask spread per stock, up to 33 stocks), fails the purchase, and the next iteration re-buys everything. At `sleepInterval = 1000 ms` that is a full round-trip every 1-2 s, bleeding ~\$6.6m of commission plus ~1% of corpus in spread per cycle, forever.
- Severity: **high**
- Suggested fix: after a purchase attempt fails while `playerStats.money >= totalCost`, latch a `can4S = false` flag so `tryGet4SApi` returns immediately thereafter; and never call `liquidate(ns)` again once an attempt has already failed with sufficient funds.

### FT-F11: spend-hacknet-hashes.js treats permanently-impossible `spendHashes` failures as transient and retries forever, buying hacknet capacity with real money to chase them

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/spend-hacknet-hashes.js:146-151` (the `WARN` + `break`, commented "we may fail if another script spends them first"), falling through to `:190-251` and `:256`
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Hacknet.ts:212-216`
  ```ts
  const result = purchaseHashUpgrade(upgName, upgTarget, count);
  if (!result.success) { helpers.log(ctx, () => result.message); }
  return result.success;
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Hacknet/HacknetHelpers.tsx:539-545`
  ```ts
  case HashUpgradeEnum.ExchangeForBladeburnerRank: {
    const bladeburner = Player.bladeburner;
    if (bladeburner === null) { return { success: false, message: "You have not joined Bladeburner." }; }
  ```
  plus the same pattern for `SellForCorporationFunds` (no corporation, `:474-480`), `Company Favor` (`:594-597`, target must be a real `CompanyName`), and server-targeted upgrades (`:490-495`, target must be a *foreign* server per `ServerOwnershipType.Foreign`, `Server/ServerHelpers.ts:31-36, 297-315`). On failure the hashes are refunded (`HacknetHelpers.tsx:562-567`).
- What the script assumes / does: it only validates that `--spend-on-server` / `--spend-on-company` were *supplied* (`spend-hacknet-hashes.js:57-60`); it never checks that a corporation / Bladeburner division exists or that the target is a valid foreign server / company. A `false` return is logged at `print` level only (no terminal, no toast) and retried next tick.
- What the game actually does: these failures are deterministic and permanent for the current game state; hashes are refunded and accumulate to capacity.
- Concrete failure scenario: `bladeburner.js:502` tells users to `run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_Rank --spend-on Exchange_for_Bladeburner_SP --liquidate`. If the player has not joined Bladeburner, every purchase fails forever; hashes pile up to capacity, `remaining < hashesEarnedNextTick` becomes permanently true, and the capacity-upgrade branch (`:193-222`) spends the player's **money** on `purchaseNode()` / `upgradeCache()` every tick until max capacity (20 servers × cache 15), with nothing shown on the terminal.
- Severity: **medium**
- Suggested fix: count consecutive failures per spend action; after N failures with sufficient hashes, drop that action from `toBuy` and emit a terminal/toast error carrying the game's reason. Validate `--spend-on-server` is not player-owned before starting.

### FT-F12: `if (ns.hacknet.purchaseNode())` mis-reads the return value — a failed purchase is logged as SUCCESS

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/spend-hacknet-hashes.js:209-214`
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Hacknet.ts:63-65` (`purchaseNode: () => () => purchaseHacknet()`) and `/home/jubnl/dev/bitburner/bitburner-src/src/Hacknet/HacknetHelpers.tsx:38, 56-58, 63`
  ```ts
  export function purchaseHacknet(): number {
    ...
    if (!Player.canAfford(cost) || numOwned >= HacknetServerConstants.MaxServers) { return -1; }
    ...
    return numOwned;
  ```
- What the script assumes / does: treats the result as a boolean success flag.
- What the game actually does: returns the **index** of the new node, or `-1` on failure. `-1` is truthy, so a failed purchase takes the SUCCESS branch; the WARNING branch at `:212-214` is unreachable.
- Concrete failure scenario: another script drains money between the cost/budget check (`:200-208`) and the call. No node is bought, yet the log claims `SUCCESS: ... spent $X to purchase a new hacknet node N`, so money accounting and "why isn't capacity growing?" diagnosis are both wrong.
- Severity: **low**
- Suggested fix: `if (ns.hacknet.purchaseNode() !== -1)` — the form already used correctly at `/home/jubnl/dev/bitburner/bitburner-scripts/hacknet-upgrade-manager.js:173`.

### FT-F13: go.js `getAggroAttack` / `getDefAttack` compare the whole liberties array to a number — the "south" attack direction is dead code

- Script **[verified]**: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:1188` and `go.js:1236`
  ```js
  (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] >= libsMin && validLibMoves <= libsMax)
  ```
  (the three sibling clauses immediately above each correctly write `validLibMoves[...][...] <= libsMax`)
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/effects/netscriptGoImplementation.ts:242-252` — `getLiberties()` returns a `number[][]`.
- What the script assumes / does: the final clause is meant to be `validLibMoves[x][y + 1] <= libsMax`.
- What the game actually does: `validLibMoves` is the raw 2-D array; `array <= number` stringifies it (`"-1,-1,2,…"`), `Number(...)` → `NaN`, so the comparison is **always false**.
- Concrete failure scenario: an enemy chain adjacent only below the candidate point is never recognised as an attack target. `getAggroAttack` / `getDefAttack` run in every play style (e.g. `go.js:236`), so roughly a quarter of capture/pressure opportunities are silently skipped for the whole session and play falls through to weaker generators.
- Severity: **medium**
- Suggested fix: `validLibMoves[x][y + 1] <= libsMax` on both lines.

### FT-F14: go.js opponent rotation can never advance — `rep` only accrues for factions you have already joined, and `????????????` is not a faction

- Script **[verified]**: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:88-95` and `go.js:399-417`, especially `:401`
  ```js
  const uncapped = opponentPreference.filter(o => (stats[o]?.rep ?? 0) < maxFavorRep);
  ```
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/boardAnalysis/scoring.ts:67-79`
  ```ts
  const factionName = getEnumHelper("FactionName").getMember(boardState.ai);
  if ( factionName && statusToUpdate.winStreak % 2 === 0 &&
       Player.factions.includes(factionName) && statusToUpdate.rep < getMaxRep() ) { ... statusToUpdate.rep += repToAdd; }
  ```
  `/home/jubnl/dev/bitburner/bitburner-src/src/Go/Enums.ts:9` defines `w0r1d_d43m0n = "????????????"`, and `FactionName` (`src/Faction/Enums.ts`) has no such member, so `getMember` returns `undefined`.
- What the script assumes / does: "focus on one opponent at a time (in this order) until its win-streak favor bonus is capped", gating purely on `stats[o].rep >= maxFavorRep`.
- What the game actually does: `rep` rises only when the opponent is a real faction **and** the player is already a member of it.
- Concrete failure scenario: default preference is `["Daedalus", "????????????", ...]`. A player not yet in Daedalus plays Daedalus forever — rep stays 0, `uncapped` always contains it, and the other five opponents (and their distinct stat bonuses) are never played. Even after Daedalus caps, `????????????` can never accrue rep, so the script is pinned there permanently; the `uncapped.length > 0 ? ... : shuffle` fallback at `:402` is unreachable whenever `????????????` is in the list. The status log ("favor rep 0/400,000") is also misleading.
- Severity: **medium**
- Suggested fix: treat an opponent as "capped" when it is not a joinable faction or the player is not a member (check `ns.getPlayer().factions`), or rotate on `winStreak`/`nodePower` instead of `rep`.

### FT-F15: go.js chooses its play style once and never re-reads the opponent when a new game starts

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:207` (`const playStyle = getStyle(ns);`, outside the `while (true)` at `:208`), with opponent switching at `:366` → `:386-393` → `startNewGame` `:399-417`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/effects/netscriptGoImplementation.ts:368` (`Go.currentGame = getNewBoardState(boardSize, opponent, true);`) and `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Go.ts:78-80` (`getOpponent` reads `Go.currentGame.ai`).
- What the script assumes / does: evaluates `getStyle()` once and reuses it for every subsequent game.
- What the game actually does: `resetBoardState` installs a new board with a new `ai`, so the opponent changes each game.
- Concrete failure scenario: the script starts against Daedalus (style 3); that game ends and `startNewGame` picks Illuminati, but every later game is still played with Daedalus's move ordering. This is newly likely on this branch, because `startNewGame` deliberately switches opponents.
- Severity: **low**
- Suggested fix: move `getStyle(ns)` inside the game loop (or re-evaluate it in `checkNewGame` after `startNewGame`).

### FT-F16: go.js `getSurroundEnemiesFull` scores the wrong cell for the down-left diagonal

- Script **[verified]**: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:1128`
  ```js
  if (y < size - 1 && x > 0 && board[x - 1][y + 1] === "O") surround += getChainValue(x - 1, y - 1, "O")
  ```
  (the three sibling lines `:1126`, `:1127`, `:1129` all pass the coordinates they tested)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/boardAnalysis/boardAnalysis.ts:575-589` — `board[x][y]` addresses one specific point, so `(x-1, y-1)` and `(x-1, y+1)` are different points.
- What the game actually does: the measured chain may be empty, ours, or offline, so `getChainValue` returns 0 or a size unrelated to the detected stone.
- Concrete failure scenario: `getRandomExpand` (`go.js:849`) and `attackGrowDragon` (`go.js:1281`) rank moves with `getSurroundEnemiesFull`; the down-left diagonal contributes a wrong term, mis-ranking expansion/dragon moves. Never produces an illegal move.
- Severity: **low**
- Suggested fix: `getChainValue(x - 1, y + 1, "O")`.

### FT-F17: go.js `getSnakeEyes` never scans the last row or column of the board

- Script **[verified]**: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:568-569` (`for (let x = 0; x < size - 1; x++)` / `for (let y = 0; y < size - 1; y++)`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/effects/netscriptGoImplementation.ts:60-66` — valid coordinates are `0 … boardSize-1` inclusive.
- What the script assumes / does: scans `0 … size-2` for two-liberty enemy chains to kill with the `playTwoMoves` cheat. Every other board scan in the file (e.g. `getAllValidMoves`, `go.js:1388-1389`) correctly uses `0 … size-1`.
- Concrete failure scenario: an enemy chain lying entirely in the final row/column with exactly 2 liberties is never selected for the SnakeEyes cheat — edge chains are common, so the highest-value cheat is regularly skipped. No crash.
- Severity: **low**
- Suggested fix: use `x < size` / `y < size` in both loops.

### FT-F18: go.js `--runOnce` exits without playing when the previous game is already over

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:205-206` then `:386-392`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/boardAnalysis/goAI.ts:31-35, 136-147` — `resetAI(true)` sets `playerPromise.nextTurn = Promise.resolve(gameOver)`, and `endGoGame` calls it (`Go/boardAnalysis/scoring.ts:94`).
- What the script assumes / does: uses the opening `await ns.go.opponentNextTurn(false)` purely as a turn-sync and feeds the result straight into `checkNewGame`, which calls `ns.exit()` on `gameOver` when `runOnce` is set.
- What the game actually does: if the saved game already ended, `opponentNextTurn` resolves immediately with `{type: "gameOver"}` before any game has been played this run.
- Concrete failure scenario: a scheduler launches `go.js --runOnce` after the previous game ended by mutual pass; the script exits at `go.js:388` without playing, every single time — a permanent no-op.
- Severity: **low**
- Suggested fix: only honour `runOnce` after at least one move has actually been made this run; start a fresh game on the initial `gameOver`.

### FT-F19: go.js SF14-level detection silently degrades to 0, disabling cheats and mis-computing the favor cap

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:108-117`; the lookup failure is swallowed in `/home/jubnl/dev/bitburner/bitburner-scripts/helpers.js:604-608` (`try { … } catch { } dictSourceFiles ??= {};`)
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Netscript/RamCostGenerator.ts:82-94, 202` — `getOwnedSourceFiles` costs `SF4Cost(5 GB)`, i.e. **80 GB** without SF4; and `/home/jubnl/dev/bitburner/bitburner-src/src/Go/effects/netscriptGoImplementation.ts:487-496` — `checkCheatApiAccess` depends only on `activeSourceFileLvl(14)` and `bitNodeN`, never on SF4.
- What the script assumes / does: infers SF14 level solely from `ns.singularity.getOwnedSourceFiles()`.
- What the game actually does: grants the cheat API on SF14 ≥ 2 (or SF14.1 while in BN14) regardless of SF4 — but the lookup the script uses is unaffordable without SF4 and its failure is swallowed, so `sf14Level` becomes 0.
- Concrete failure scenario: a player in BN14 owning SF14.1/14.2 but no SF4 (or with < ~82 GB free home RAM) gets `cheats = false` and `maxFavorRep = 100_000`, so cheats are never used and opponents are considered "capped" 2-4× too early. No warning is shown.
- Severity: **low**
- Suggested fix: warn when the source-file dictionary comes back empty, and probe cheat access directly (`try { ns.go.cheat.getCheatCount() } catch { cheats = false }`) — the same check the game performs.

### FT-F20: go.js `startNewGame` logs (and requests) a board size the game ignores for `????????????`

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/go.js:405-408`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/Go/effects/netscriptGoImplementation.ts:355-357` and `/home/jubnl/dev/bitburner/bitburner-src/src/Go/boardState/boardState.ts:26-30`
  ```ts
  if (ai === GoOpponent.w0r1d_d43m0n) { boardToCopy = ...bitverseBoardShape...; boardSize = 19; applyObstacles = false; }
  ```
- What the game actually does: for `????????????` the requested size is discarded and a fixed 19×19 bitverse board (with `#` offline nodes) is used.
- Concrete failure scenario: the status line reads "Starting a new 13x13 game vs ????????????" while a 19×19 board is in play. Gameplay survives (`getOpeningMove` has a `case 19` at `go.js:1567`), so this is a reporting/expectation defect only.
- Severity: **low**
- Suggested fix: special-case the opponent in the log message.

### FT-F21: stanek.js calls `ns.stanek.activeFragments()` before verifying the gift is installed

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/stanek.js:44` and `:200-201`; same issue at `/home/jubnl/dev/bitburner/bitburner-scripts/optimize-stanek.js:82`
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/NetscriptFunctions/Stanek.ts:17-21, 63-65`
  ```ts
  function checkStanekAPIAccess(ctx: NetscriptContext): void {
    if (!Player.hasAugmentation(AugmentationName.StaneksGift1, true)) {
      throw helpers.errorMessage(ctx, "Stanek's Gift is not installed");
    }
  }
  ...
  activeFragments: (ctx) => () => { checkStanekAPIAccess(ctx); ...
  ```
- What the script assumes / does: treats a missing gift as an empty grid and proceeds to run `stanek.js.create.js`.
- What the game actually does: every `ns.stanek.*` entry point throws when `Stanek's Gift - Genesis` is not installed; it does not return an empty array.
- Concrete failure scenario: launching `stanek.js` before accepting the gift aborts `main` with an unhandled `Stanek's Gift is not installed` error (the call is outside the `try` at `stanek.js:103`) instead of printing the intended actionable message.
- Severity: **low**
- Suggested fix: wrap the first `getActiveFragments` call in try/catch and emit the "accept Stanek's Gift first" message.

### FT-F22: optimize-stanek.js only searches grids up to 6×5, so it cannot plan the grids SF13.2+ / BN13 actually give you

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/optimize-stanek.js:87-90` (`for (let height = 3; height <= 5; height++) for (let width = height; width <= height + 1; width++)`)
- Game source **[verified]**: `/home/jubnl/dev/bitburner/bitburner-src/src/CotMG/StaneksGift.ts:22-31`
  ```ts
  baseSize(): number { return StanekConstants.BaseSize + currentNodeMults.StaneksGiftExtraSize + Player.activeSourceFileLvl(13); }
  width(): number  { return Math.max(2, Math.min(Math.floor(this.baseSize() / 2 + 1),   StanekConstants.MaxSize)); }
  height(): number { return Math.max(3, Math.min(Math.floor(this.baseSize() / 2 + 0.6), StanekConstants.MaxSize)); }
  ```
  with `BaseSize: 9` (`/home/jubnl/dev/bitburner/bitburner-src/src/CotMG/data/Constants.ts:1-5`) and `StaneksGiftExtraSize: 2` in BN13 (`src/BitNode/BitNode.tsx:723`).
- What the script assumes / does: enumerates only (w,h) = (3,3),(4,3),(4,4),(5,4),(5,5),(6,5).
- What the game actually does: baseSize 11 (SF13.2) → 6×6; baseSize 12 → 7×6; baseSize 13 → 7×7. Very small grids (baseSize ≤ 3, e.g. BN8) give width 2 < height 3, also outside the loop's `width >= height` assumption.
- Concrete failure scenario: a player with SF13.2 runs the optimizer, gets six layouts, none of which fits their actual 6×6 gift; pasting any of them wastes half the grid.
- Severity: **low**
- Suggested fix: drive the loop from `ns.stanek.giftWidth()` / `ns.stanek.giftHeight()` (0.4 GB each), or extend the range to height 7 and allow `width = height - 1`.

### FT-F23: optimize-stanek.js declares a `FragmentType.HackingChance` that does not exist in the game

- Script: `/home/jubnl/dev/bitburner/bitburner-scripts/optimize-stanek.js:1-19` (`HackingChance: 2,` at `:2`), surfaced via `autocomplete` at `:57-59`
- Game source: `/home/jubnl/dev/bitburner/bitburner-src/src/CotMG/FragmentType.ts:4-22` — the enum starts at `HackingSpeed: 3`; there is no type 2 and no `FragmentById` entry producing one (`CotMG/Fragment.ts:96-374`).
- Concrete failure scenario: tab-completion offers `HackingChance`; the (currently commented-out) arg-validation path at `optimize-stanek.js:63-72` would accept it and match zero fragments. Harmless today because `main` ignores `ns.args`.
- Severity: **low**
- Suggested fix: delete the entry.

---

### FT: Script-internal defects found in Part 2 (no game-source counterpart — listed for completeness, not counted as findings)

- `/home/jubnl/dev/bitburner/bitburner-scripts/stanek.js:175-195` — `tryChargeAllFragments` has no `return` despite its `@returns {Promise<bool>}` contract, so `lastLoopSuccessful` (`:109`) is always `undefined` and the fast path `await ns.sleep(lastLoopSuccessful ? 10 : 1000)` (`:101`) is never taken: the charging loop always pays a full second of dead time per pass.
- `/home/jubnl/dev/bitburner/bitburner-scripts/optimize-stanek.js:272-304` — `planStats` only recurses into `statFragsKeys.slice(1)` from *inside* the `for (const key of statFragsKeys[0])` loop, so if the current fragment has no unblocked placement every remaining fragment is silently dropped from the search.

### FT: Unconfirmed (dropped) — Part 2

- `go.js:1318, 1338` call a bare global `sprintf(...)` that is neither imported nor an `ns` global. It likely works only via `sprintf-js`'s UMD side effect on `window`; could not verify (`bitburner-src/node_modules` is not installed).
- `optimize-stanek.js:325` scores layouts as `piecesPlaced * (1 + 0.1 * numAdjacencies)` while the game applies `1.1^k` per fragment times each fragment's `power` (`CotMG/StaneksGift.ts:74-80`, `CotMG/formulas/effect.ts:3-11`). Treated as a heuristic objective, not a copied constant.
- `go.js:205` `opponentNextTurn` deadlocking when it is already the player's turn — traced `handleNextTurn` (`Go/boardAnalysis/goAI.ts:60-126`); the black promise is already resolved in that state, so no deadlock.
- `stockmaster.js:199` — `inversionAgreementThreshold <= 8 ? 20 : <= 10 ? 30` is unreachable dead code (the variable is only ever 6 or `Math.max(14, ...)`), but no game-source behaviour contradicts it.
- `hacknet-upgrade-manager.js` buys one ~\$1000 node in BN8 (`HacknetNodeMoney: 0`) because `worstNodeProduction` starts at `Number.MAX_VALUE` (`:119`); the next call correctly bails (`:145-148`). Bounded cost, not reported.
- `--max-spend 0` makes `if (maxSpend && moneySpent === false)` (`hacknet-upgrade-manager.js:46`) falsy so `-c` loops as a no-op. Config edge case.
- `stockmaster.js:478, 504` comments about a short-price API bug are stale — in 3.0.1 `buyShort`/`sellShort` return bid/ask price as the script expects (`NetscriptFunctions/StockMarket.ts:157, 169`), so the warning simply never fires.
- `getCacheUpgradeCost` returning `-1` (`NetscriptFunctions/Hacknet.ts:171-174`) would make `spend-hacknet-hashes.js:216` log a bogus warning, but the required state (hacknet servers enabled while the node is not a `HacknetServer`) could not be constructed.

### FT: Checked and OK — Part 2

**go.js**
- All seven `allOpponents` / `defaultOpponentPreference` strings match `GoOpponent` exactly (including the 12-character `"????????????"`); `"No AI"` correctly excluded.
- `--size` validation `[5,7,9,13]` exactly matches `resetBoardState` (`netscriptGoImplementation.ts:355`).
- Cheat-access condition `sf14 >= 2 || (sf14 >= 1 && currentNode == 14)` is equivalent to `checkCheatApiAccess` (`:487-496`); `maxFavorRep` ladder 100k/200k/300k/400k matches `getMaxRep()` (`Go/effects/effect.ts:30-44`).
- Cheat-success formula and the "first cheat is risk-free" comment match `netscriptGoImplementation.ts:521-531, 561-567`; `getCheatCount()` / `getCheatSuccessChance()` read the same `Go.currentGame.cheatCount`.
- Per-opponent bonus mapping in the new comment block matches `calculateMults` (`Go/effects/effect.ts:68-101`) one-for-one; the 5×5-vs-Illuminati difficulty note matches `getDifficultyMultiplier` (`:132-135`).
- `resetBoardState` throwing for `????????????` without The Red Pill (`:359-361`) is correctly caught by the try/catch at `go.js:404-412`, and the fallback list excludes it.
- Board character sets (`X`/`O`/`.`/`#`, plus `?` for controlled-empty) match `simpleBoardFromBoard` (`boardAnalysis.ts:575-589`) and `:257-277`; the `-1` sentinel from `getLiberties` is handled.
- `ns.disableLog("go.makeMove")` is a legal dotted log name (`NetscriptFunctions.ts:1619, 1627-1639`); `getStats()` returning a partial record is handled with `?? 0`; Go `rep` survives augmentation prestige (`NetscriptFunctions/Go.ts:34-47`).
- RAM: only `makeMove` (4 GB) is charged; no stray identifier collisions.

**stanek.js / optimize-stanek.js**
- Charge script cost 1.6 GB base + 0.4 GB `chargeFragment` = exactly the `/ 2.0` divisor at `stanek.js:180` (`RamCostGenerator.ts:56`).
- `fragment.id < 100` correctly separates chargeable fragments from Boosters (ids 100-107, `CotMG/Fragment.ts:258-374`), matching `chargeFragment`'s Booster rejection (`NetscriptFunctions/Stanek.ts:40-45`).
- `activeFragments()` shape (`{...ActiveFragment.copy(), ...Fragment.copy(), chargedEffect}`) provides `id`/`x`/`y`/`numCharge`/`highestCharge`; the duplicated `id` key is benign.
- The "fragment not accepting charge" workaround is still required in 3.0.1: `findFragment` matches by root coordinate only (`CotMG/StaneksGift.ts:101-103`), and shapes such as `L`/`J` are empty at their own (0,0).
- `awakeningRep = 1E6` / `serenityRep = 100E6` match `StaneksGift2.repCost` / `StaneksGift3.repCost` (`Augmentation/Augmentations.ts:1631, 1669`).
- `optimize-stanek.js` `FragmentId` map and `FragmentType` values 3-18 match the game data exactly; `coverage()`'s rotation is algebraically identical to `Fragment.fullAt(x, y, rotation)` (`CotMG/Fragment.ts:24-51`); `adjacents()` matches `Fragment.neighbors` / `ActiveFragment.neighbors`; the in-bounds test is equivalent to `canPlace`'s bound (`StaneksGift.ts:84-86`); duplicate-booster de-duplication matches `StaneksGift.ts:76`; booster `limit` 99 means repeated boosters are legal.

**stockmaster.js**
- Constants all match 3.0.1: `commission = 100000` = `StockMarketConstants.StockMarketCommission`; WSE \$200M, TIX \$5B, 4S data \$1B, 4S API \$25B; `marketCycleLength 75` = `TicksPerCycle`; `expectedTickTime 6000` / `catchUpTickTime 4000` = `msPerStockUpdate` / `msPerStockUpdateMin` (`StockMarket/data/Constants.ts:3-12`); 45%-per-cycle forecast flip (`StockMarket/StockMarket.ts:225-227`); 33 symbols (`StockMarket/Enums.ts:18-55`).
- Short-selling gate: the game requires `bitNodeN === 8 || activeSourceFileLvl(8) >= 2` (`NetscriptFunctions/StockMarket.ts:151-153, 163-165`); `stockmaster.js:132` checks `effectiveSourceFiles[8] < 2` where helpers inject level 3 for BN8 (`helpers.js:617-620`) — equivalent.
- `getPosition` is still the 4-tuple `[shares, avgPx, shortShares, avgShortPx]` (`StockMarket.ts:91`); `positionValueShort = shares * (2*avgShortPx - askPrice)` matches `getSellTransactionGain` for shorts (`StockMarketHelpers.ts:56-59`).
- Buy limits: `shares + playerShares + playerShortShares > maxShares` rejects (`BuyingAndSelling.tsx:84, 259`); `Math.min(maxShares - ownedShares, affordable)` lands exactly at the cap with no off-by-one; `affordableShares = floor((budget - commission)/price)` matches `calculateBuyMaxAmount`; short purchase cost correctly uses `bid_price`.
- `getForecast` / `getVolatility` throw without `has4SDataTixApi`; the script only calls them when `has4s` is true. `ns.scriptRunning` still exists (`NetscriptFunctions.ts:1192`).
- RAM: charges only `hasTixApiAccess` (0.05 GB) plus 0-cost identifiers — the ram-dodging is intact.

**spend-hacknet-hashes.js / hacknet-upgrade-manager.js**
- Hash upgrade **names** (`spend-hacknet-hashes.js:22-25`) are a byte-exact match for every member of `HashUpgradeEnum` (`Hacknet/Enums.ts:1-13`). This matters: `hashCost` / `spendHashes` use `getEnumHelper("HashUpgradeEnum").nsGetMember`, which **throws** on an unknown name (`NetscriptFunctions/Hacknet.ts:192, 203`). `Company Favor` is correctly the only `hasTargetCompany` upgrade (`HashUpgradesMetadata.tsx:115-121`), giving `+5 * count` favor (`HacknetHelpers.tsx:566`).
- Cost formulas: `Sell for Money` flat `cost: 4` / value `1e6`; `Generate Coding Contract` `costPerLevel: 25` → `25 * (level + 1)` for count 1 (`Hacknet/HashUpgrade.ts:72-82`). The `--max-contract-cost-ratio 40` arithmetic (160 hashes ≡ \$40m) is correct.
- Marginal-gain derivations verified line-by-line against `Hacknet/formulas/HacknetNodes.ts:4-11` and `HacknetServers.ts:4-17`: node RAM `1.035^ram − 1`, node cores `(c+6)/(c+5) − 1`, server RAM `0.07`, server cores `(c+5)/(c+4) − 1`, level linear for both. `hashDollarValue = 2.5e5` is exactly consistent with 4 hashes = \$1e6.
- Formulas API signatures match (`NetscriptFunctions/Formulas.ts:248-256, 299-309`), both 0 GB, throwing only without Formulas.exe — so the `try { fnProduction(1,1,1) }` probe is valid.
- All max-value guards return `Infinity` (`calculateLevelUpgradeCost`, `RamUpgradeCost`, `CoreUpgradeCost`, `CacheUpgradeCost`, `calculateServerCost` at ≥ 20 servers), so `payoff → 0` and neither script can stall on a maxed upgrade. `MaxLevel 200/300`, `MaxRam 64/8192`, `MaxCores 16/128`, `MaxCache 15`, `MaxServers 20` all handled.
- `getCacheUpgradeCost` / `hashCost` / `numHashes` / `hashCapacity` return `Infinity`/`0` (not throw) without hacknet servers; both scripts detect this via `hashCapacity() == 0`.
- `spendHashes(name, undefined, count)` correctly falls through to `_upgTarget = ""`; `count` is validated non-negative (`Hacknet.ts:205-208`).
- RAM: only the hacknet functions actually called (0.5 GB each, deduplicated), `getServerMoneyAvailable`, and `getPlayer` (0.5 GB). The new `ns.formulas.hacknet*` calls on this branch cost 0 GB, so the patch adds no RAM.
