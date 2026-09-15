# Progression and Singularity Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `work-for-factions.js` / `autopilot.js` / `faction-manager.js` / `ascend.js` earn the Silhouette invite via CFO, install for a queued Red Pill, stop joining city factions by accident, grind combat stats with the best exp/s crime, skip un-earnable end-game invites, buy NeuroFlux with free rep first, and poll fewer temp scripts.

**Architecture:** All decision logic that changes is extracted into a new zero-RAM pure module `progression-rules.js` (no `ns` usage; imported by `work-for-factions.js`, `faction-manager.js`, `ascend.js`; importable in Node) and unit-tested in `test/progression-rules.test.js`, including tests that compare the job / crime tables against the game source. The in-game scripts keep their structure; each fix is a small edit at the cited lines that calls the pure function.

**Tech Stack:** Bitburner Netscript ES modules (run in-game), Node 22 `node:test` for unit tests, tools/harness for RAM checks and the headless game.

**Spec:** docs/audit/2026-09-15-functional-review.md, section 2 ("Progression and singularity"). Finding IDs used below: **PR-1 .. PR-7** = section 2 findings 1..7, **PR-obs** = the three "Other observations".

## Default changes for the user to approve

No `argsSchema` default of any script changes. One upstream table constant changes (listed for transparency):

| Where | Old | New | Why |
|---|---|---|---|
| `work-for-factions.js` `companySpecificConfigs` Silhouette `repRequiredForFaction` | `1.0e7` (hack: "work until the invite arrives") | `800e3` (`SILHOUETTE_EXECUTIVE_REP`, CFO rep; x0.75 when backdoored) | PR-1: CFO (business4) qualifies for `executiveEmployee()` at 800k company rep; the loop now exits at that rep and applies for the title explicitly |

## Global Constraints
- Never edit anything under /home/jubnl/dev/bitburner/bitburner-src.
- One finding per commit (or one file's worth of tightly related findings); commit message names the finding ID. No Co-Authored-By or session trailers. Never push. Never touch .idea/.
- After every script edit run `node --check <file>` and `node /home/jubnl/dev/bitburner/tools/harness/collide.mjs <file>` from `/home/jubnl/dev/bitburner/bitburner-scripts`; any `+[...]` output is a new RAM charge from an identifier whose name equals an NS function - rename it. For the new file `progression-rules.js` there is no HEAD version, so collide prints every hit in the file (plus a harmless `fatal: path ... exists on disk, but not in 'HEAD'` line on stderr); the expected output is `progression-rules.js: +[] -[]`.
- Run the full Node suite with a bare `node --test` from the scripts repo root (126 tests pass at HEAD; this plan adds tests in `test/progression-rules.test.js`). Do not use globs or pipes on that command.
- `work-for-factions.js`, `autopilot.js`, `faction-manager.js`, `ascend.js` do NOT import in Node (top-level `ns` usage / `main`-only globals); their verification is `node --check` + collide + the in-game check described in each task. Only `progression-rules.js` is unit-tested.
- Scope discipline: fix the finding, do not refactor around it. Task 1 creates `progression-rules.js`; Tasks 3-6 append to it. If a task is executed before Task 1, create the file with only the exports that task needs (same code as shown).
- Test save for in-game checks: `/home/jubnl/dev/bitburner/bitburnerSave_1789432179_BN1x3.json.gz` (BN1, SF1-4). Import it via Options > Import save on a throwaway profile; the headless harness (`/home/jubnl/dev/bitburner/tools/harness/README.md`) can drive the same save if a browser is not at hand.

---

### Task 1: PR-1 — Silhouette: earn CFO (800k company rep, Business track) instead of grinding to CTO (3.2M)

**Files:**
- Create: `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js`
- Create: `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js`
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js` lines 1-4 (imports), 40-63 (`companySpecificConfigs` + `jobs`), 580-601 (Silhouette block in `earnFactionInvite`), 1196 and 1279 (backdoor rep adjustment in `workForMegacorpFactionInvite`), 1323-1327 (loop exit), end of file (new `earnExecutiveJob`).

**Interfaces:**
- Produces (`progression-rules.js`): `export const jobs` (array of `{name, reqRep[], reqHck[], reqCha[], repMult[]}` for "IT", "Software", "Business"), `export const executiveJobTitles`, `export const silhouetteExecutiveJob = { track: "Business", tier: 4 }`, `export const SILHOUETTE_EXECUTIVE_REP` (800e3), `export const BACKDOOR_REP_MULT` (0.75), `export function pickSilhouetteCompany(companies, repByCompany, favorByCompany, backdooredByCompany, repRequired = SILHOUETTE_EXECUTIVE_REP)`, `export function jobTierRequirements(trackName, tier, statModifier = 0, backdoored = false)` → `{rep, hack, cha}`.
- Produces (`work-for-factions.js`): `async function earnExecutiveJob(ns, companyName, executiveJob, statModifier, backdoored)` → `Promise<boolean>`.
- Consumes: `tryApplyToCompany`, `getCompanyReputation`, `getPlayerInfo`, `studyForCharisma`, `monitorStudies`, `classHeuristic`, `breakToMainLoop` (all already in `work-for-factions.js`).

Game facts verified for this task (v3.0.1): `src/Faction/FactionJoinCondition.ts:102-103` `executiveEmployee = someCondition([JobName.software7, JobName.business4, JobName.business5])`; `src/Company/data/CompanyPositionsMetadata.ts` business4 (CFO) `reqdCharisma: 501, reqdHacking: 76, reqdReputation: 800e3, repMultiplier: 1.6`, business5 (CEO) `751 / 101 / 3.2e6 / 1.75`, software7 (CTO) `501 / 751 / 3.2e6 / 2`; business0..3 = cha `1, 51, 101, 226`, hack `1, 6, 51, 51`, rep `-, 8e3, 40e3, 200e3`, repMult `0.9, 1.1, 1.3, 1.5`; `src/Constants.ts:110` `CompanyRequiredReputationMultiplier: 0.75`; `src/Work/Enums.ts:73` `JobField.business = "Business"`; `applyToCompany` climbs every tier the player qualifies for (`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts` `applyForJob` while-loop).

- [ ] **Step 1: Write the failing tests**

Create `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js`:

```js
// Unit tests for progression-rules.js (pure decision rules used by work-for-factions.js / faction-manager.js / ascend.js).
// The table tests parse the game source (v3.0.1) so a game update that changes a requirement fails here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    jobs, executiveJobTitles, silhouetteExecutiveJob, SILHOUETTE_EXECUTIVE_REP, BACKDOOR_REP_MULT,
    pickSilhouetteCompany, jobTierRequirements,
} from "../progression-rules.js";

const SRC = "/home/jubnl/dev/bitburner/bitburner-src/src/";
const positionsSrc = readFileSync(SRC + "Company/data/CompanyPositionsMetadata.ts", "utf8");
const enumsSrc = readFileSync(SRC + "Work/Enums.ts", "utf8");
const joinCondSrc = readFileSync(SRC + "Faction/FactionJoinCondition.ts", "utf8");

/** {software0: {reqdCharisma, reqdHacking, reqdReputation, repMultiplier}, ...} parsed from the game's position metadata */
function gamePositions() {
    const out = {};
    for (const block of positionsSrc.matchAll(/\[JobName\.(\w+)\]: \{([\s\S]*?)\n {4}\}/g))
        out[block[1]] = Object.fromEntries([...block[2].matchAll(/^\s+(reqdCharisma|reqdHacking|reqdReputation|repMultiplier): ([\d.e]+),/gm)]
            .map((m) => [m[1], Number(m[2])]));
    return out;
}
const STAT_OFFSET = 224; // The table stores requirement + 224 (the common megacorp jobStatReqOffset); 0 means "no requirement"
const trackKey = { IT: (i) => `IT${i}`, Software: (i) => `software${i}`, Business: (i) => `business${i}` };

test("CompanyPositionsMetadata.ts parsed", () => {
    const game = gamePositions();
    assert.equal(game.business4.reqdReputation, 800e3);
    assert.equal(game.software7.reqdHacking, 751);
    assert.equal(game.IT0.reqdReputation, undefined);
});

for (const job of jobs) {
    test(`jobs table "${job.name}" matches CompanyPositionsMetadata.ts`, () => {
        const game = gamePositions();
        const wrong = [];
        for (let tier = 0; tier < job.reqRep.length; tier++) {
            const pos = game[trackKey[job.name](tier)];
            assert.ok(pos, `position ${trackKey[job.name](tier)} not found in game source`);
            const expect = (gameValue) => gameValue ? gameValue + STAT_OFFSET : 0;
            if (job.reqRep[tier] !== (pos.reqdReputation ?? 0)) wrong.push(`${job.name}[${tier}].reqRep ${job.reqRep[tier]} vs game ${pos.reqdReputation ?? 0}`);
            if (job.reqHck[tier] !== expect(pos.reqdHacking)) wrong.push(`${job.name}[${tier}].reqHck ${job.reqHck[tier]} vs game ${expect(pos.reqdHacking)}`);
            if (job.reqCha[tier] !== expect(pos.reqdCharisma)) wrong.push(`${job.name}[${tier}].reqCha ${job.reqCha[tier]} vs game ${expect(pos.reqdCharisma)}`);
            if (job.repMult[tier] !== pos.repMultiplier) wrong.push(`${job.name}[${tier}].repMult ${job.repMult[tier]} vs game ${pos.repMultiplier}`);
        }
        assert.deepEqual(wrong, []);
    });
}

test("executive titles match FactionJoinCondition.ts executiveEmployee and Enums.ts", () => {
    const list = joinCondSrc.match(/executiveEmployee[\s\S]*?someCondition\(\[([^\]]*)\]/)[1];
    const keys = [...list.matchAll(/JobName\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(keys, ["software7", "business4", "business5"]);
    const titles = keys.map((k) => enumsSrc.match(new RegExp(`^\\s+${k} = "([^"]+)",`, "m"))[1]);
    assert.deepEqual([...titles].sort(), [...executiveJobTitles].sort());
    // The cheapest executive title is the CFO (business4): 800k rep vs 3.2M for CTO/CEO
    assert.equal(silhouetteExecutiveJob.track, "Business");
    assert.equal(trackKey.Business(silhouetteExecutiveJob.tier), "business4");
    assert.equal(SILHOUETTE_EXECUTIVE_REP, 800e3);
    assert.equal(BACKDOOR_REP_MULT, 0.75);
});

test("jobTierRequirements applies the company stat offset and the backdoor rep multiplier", () => {
    assert.deepEqual(jobTierRequirements("Business", 4, 0, false), { rep: 800e3, hack: 300, cha: 725 });
    assert.deepEqual(jobTierRequirements("Business", 4, 25, true), { rep: 600e3, hack: 325, cha: 750 });
    assert.deepEqual(jobTierRequirements("Software", 0, 25, false), { rep: 0, hack: 250, cha: 0 }); // 0 = no requirement, offset not added
});

test("pickSilhouetteCompany minimises remaining CFO rep / (100 + favor)", () => {
    const companies = ["ECorp", "MegaCorp", "Four Sigma", "Fulcrum Technologies"];
    const rep = { ECorp: 0, MegaCorp: 500e3, "Four Sigma": 0, "Fulcrum Technologies": 900e3 };
    const favor = { ECorp: 300, MegaCorp: 0, "Four Sigma": 0, "Fulcrum Technologies": 0 };
    const backdoored = { ECorp: false, MegaCorp: true, "Four Sigma": false, "Fulcrum Technologies": false };
    // ECorp 800e3/400 = 2000, MegaCorp (600e3-500e3)/100 = 1000, Four Sigma 8000, Fulcrum already past the requirement (0)
    assert.equal(pickSilhouetteCompany(companies, rep, favor, backdoored), "Fulcrum Technologies");
    assert.equal(pickSilhouetteCompany(companies.slice(0, 3), rep, favor, backdoored), "MegaCorp");
    assert.equal(pickSilhouetteCompany(["ECorp", "Four Sigma"], rep, favor, backdoored), "ECorp");
    // Missing rep/favor entries count as 0
    assert.equal(pickSilhouetteCompany(["NWO", "ECorp"], {}, {}, {}), "NWO");
});
```

- [ ] **Step 2: Run the tests, expect the import to fail**

`cd /home/jubnl/dev/bitburner/bitburner-scripts && node --test`
Expected: the new file fails with `Cannot find module '.../progression-rules.js'`; the 126 existing tests still pass.

- [ ] **Step 3: Create `progression-rules.js`**

Create `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js`:

```js
// Pure decision rules shared by work-for-factions.js, faction-manager.js and ascend.js.
// No `ns` usage (0 GB to import) and no imports, so Node can load it for unit tests (test/progression-rules.test.js).

/** Job stat requirements per company track, for a company with a base stat modifier of +224 (all megacorps except ECorp/MegaCorp/NWO, which are +249).
 *  The game stores e.g. reqdHacking [1, 26, 151, 251] and adds the company's jobStatReqOffset; we store the +224 numbers and add the extra 25 where needed.
 *  A 0 means "no requirement" (no offset is added). Verified against v3.0.1 src/Company/data/CompanyPositionsMetadata.ts by the unit tests. */
export const jobs = [
    {
        name: "IT",
        reqRep: [0e0, 7e3, 35e3, 175e3],
        reqHck: [225, 250, 375, 475], // [1, 26, 151, 251] + 224
        reqCha: [0e0, 0e0, 275, 300], // [0,  0, 51,  76] + 224
        repMult: [0.9, 1.1, 1.3, 1.4]
    },
    {
        name: "Software",
        reqRep: [0e0, 8e3, 4e4, 2e5, 4e5, 8e5, 16e5, 32e5],
        reqHck: [225, 275, 475, 625, 725, 725, 825, 975],   // [1, 51, 251, 401, 501, 501, 601, 751] + 224
        reqCha: [0e0, 0e0, 275, 375, 475, 475, 625, 725],   // [0,  0,  51, 151, 251, 251, 401, 501] + 224
        repMult: [0.9, 1.1, 1.3, 1.5, 1.6, 1.6, 1.75, 2.0]
    },
    {
        name: "Business", // Only used to take an executive title (CFO = tier 4) for the Silhouette invite; rep is earned faster on IT/Software
        reqRep: [0e0, 8e3, 4e4, 2e5, 8e5, 32e5],
        reqHck: [225, 230, 275, 275, 300, 325],   // [1, 6, 51, 51, 76, 101] + 224
        reqCha: [225, 275, 325, 450, 725, 975],   // [1, 51, 101, 226, 501, 751] + 224
        repMult: [0.9, 1.1, 1.3, 1.5, 1.6, 1.75]
    },
];

/** Job titles that satisfy Silhouette's `executiveEmployee()` invite condition (src/Faction/FactionJoinCondition.ts) */
export const executiveJobTitles = ["Chief Technology Officer", "Chief Financial Officer", "Chief Executive Officer"];
/** The cheapest executive title is the CFO: Business track tier 4, 800k company rep (CTO and CEO need 3.2M) */
export const silhouetteExecutiveJob = { track: "Business", tier: 4 };
export const SILHOUETTE_EXECUTIVE_REP = jobs.find(j => j.name == silhouetteExecutiveJob.track).reqRep[silhouetteExecutiveJob.tier]; // 800e3
/** Company job/faction rep requirements are multiplied by this when the company server is backdoored (src/Constants.ts CompanyRequiredReputationMultiplier) */
export const BACKDOOR_REP_MULT = 0.75;

/** Pick the company at which we can reach the executive rep requirement soonest: minimise remaining_rep / (100 + favor).
 * @param {string[]} companies @param {{[c: string]: number}} repByCompany @param {{[c: string]: number}} favorByCompany
 * @param {{[c: string]: boolean}} backdooredByCompany @param {number} repRequired */
export function pickSilhouetteCompany(companies, repByCompany, favorByCompany, backdooredByCompany, repRequired = SILHOUETTE_EXECUTIVE_REP) {
    const timeToRep = c => Math.max(0, (backdooredByCompany[c] ? BACKDOOR_REP_MULT : 1) * repRequired - (repByCompany[c] || 0)) / (100 + (favorByCompany[c] || 0));
    return companies.slice().sort((a, b) => timeToRep(a) - timeToRep(b))[0];
}

/** Requirements of one tier of a job track at a company with the given extra stat modifier (0 or 25) and backdoor status.
 * @returns {{rep: number, hack: number, cha: number}} */
export function jobTierRequirements(trackName, tier, statModifier = 0, backdoored = false) {
    const job = jobs.find(j => j.name == trackName);
    const withOffset = v => v === 0 ? 0 : v + statModifier; // A 0 requirement stays 0 (the game has no requirement at all)
    return { rep: job.reqRep[tier] * (backdoored ? BACKDOOR_REP_MULT : 1), hack: withOffset(job.reqHck[tier]), cha: withOffset(job.reqCha[tier]) };
}
```

- [ ] **Step 4: Run the tests, expect them to pass**

`cd /home/jubnl/dev/bitburner/bitburner-scripts && node --test`
Expected: `pass 133` (126 + 3 table tests + 4 others), `fail 0`.

- [ ] **Step 5: Wire `work-for-factions.js` to the module and to the CFO path**

(a) Lines 1-4, add the import after the helpers import:

```js
import {
    instanceCount, getConfiguration, getNsDataThroughFile, getFilePath, getActiveSourceFiles, tryGetBitNodeMultipliers,
    formatDuration, formatMoney, formatNumberShort, disableLogs, log, getErrorInfo, tail
} from './helpers.js'
import { jobs, executiveJobTitles, silhouetteExecutiveJob, SILHOUETTE_EXECUTIVE_REP, BACKDOOR_REP_MULT, pickSilhouetteCompany, jobTierRequirements } from './progression-rules.js'
```

(b) Lines 45-63. Replace the Silhouette entry (lines 45-46) and delete the whole `const jobs = [ ... ]` block (lines 48-63, it now lives in `progression-rules.js`). Old:

```js
    { name: "Silhouette", companyName: "TBD", repRequiredForFaction: 1.0e7 } // Hack: 3.2e6 should be enough rep to get the CTO position, but once
    // we hit this rep we might break out of the work loop before getting the final promotion, so we keep working until we get the faction invite.
]
const jobs = [ // Job stat requirements for a company with a base stat modifier of +224 (modifier of all megacorps except the ones above which are 25 higher)
    ... (16 lines, through the closing `]`)
```

New:

```js
    // Silhouette invites any CTO / CFO / CEO (src/Faction/FactionJoinCondition.ts executiveEmployee). The cheapest is the CFO: Business tier 4 at
    // 800k company rep (CTO needs 3.2M). We earn the rep on the IT/Software track (best rep/s for a hacker), then apply to Business (see earnExecutiveJob)
    { name: "Silhouette", companyName: "TBD", repRequiredForFaction: SILHOUETTE_EXECUTIVE_REP, executiveJob: silhouetteExecutiveJob }
]
// The job stat requirement tables (IT / Software / Business) live in progression-rules.js (`jobs`) so they can be unit-tested against the game source.
```

(c) Silhouette block in `earnFactionInvite` (lines 580-601). Old lines 580-593:

```js
    // Special case: earn a CEO position to gain an invite to Silhouette
    if ("Silhouette" == factionName) {
        ns.print(`You must be a CO (e.g. CEO/CTO) of a company to earn an invite to "Silhouette". This may take a while!`);
        let factionConfig = companySpecificConfigs.find(f => f.name == "Silhouette"); // We set up Silhouette with a "company-specific-config" so that we can work for an invite like any megacorporation faction.
        let companyNames = preferredCompanyFactionOrder.map(f => companySpecificConfigs.find(cf => cf.name == f)?.companyName || f);
        let favorByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyFavor(o)'), '/Temp/getCompanyFavors.txt', companyNames);
        let repByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyRep(o)'), '/Temp/getCompanyReps.txt', companyNames);
        // Change the company to work for into whichever company we can get to CEO fastest with.
        // Minimize needed_rep/rep_gain_rate. CEO job is at 3.2e6 rep, so (3.2e6-current_rep)/(100+favor).
        // Also take into account that some companies will have lowered rep requirement if they are backdoored
        const backdoorByServer = await backdoorStatusByServer(ns);
        factionConfig.companyName = companyNames.sort((a, b) =>
            ((backdoorByServer[serverByCompany[a]] ? 0.75 : 1.0) * 3.2e6 - repByCompany[a]) / (100 + favorByCompany[a]) -
            ((backdoorByServer[serverByCompany[b]] ? 0.75 : 1.0) * 3.2e6 - repByCompany[b]) / (100 + favorByCompany[b]))[0];
```

New:

```js
    // Special case: earn an executive position (CFO is the cheapest: 800k company rep on the Business track) to gain an invite to Silhouette
    if ("Silhouette" == factionName) {
        ns.print(`You must be a CTO, CFO or CEO of a company to earn an invite to "Silhouette". Working towards CFO ` +
            `(${SILHOUETTE_EXECUTIVE_REP.toLocaleString('en')} company rep, x${BACKDOOR_REP_MULT} if the company server is backdoored)...`);
        let factionConfig = companySpecificConfigs.find(f => f.name == "Silhouette"); // We set up Silhouette with a "company-specific-config" so that we can work for an invite like any megacorporation faction.
        let companyNames = preferredCompanyFactionOrder.map(f => companySpecificConfigs.find(cf => cf.name == f)?.companyName || f);
        let favorByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyFavor(o)'), '/Temp/getCompanyFavors.txt', companyNames);
        let repByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyRep(o)'), '/Temp/getCompanyReps.txt', companyNames);
        // Change the company to work for into whichever company we can reach the CFO rep requirement with soonest:
        // minimize needed_rep/rep_gain_rate = (800e3 * (backdoored ? 0.75 : 1) - current_rep) / (100 + favor)
        const backdoorByServer = await backdoorStatusByServer(ns);
        const backdooredByCompany = Object.fromEntries(companyNames.map(c => [c, backdoorByServer[serverByCompany[c]] ?? false]));
        factionConfig.companyName = pickSilhouetteCompany(companyNames, repByCompany, favorByCompany, backdooredByCompany);
```

And line 600, old:

```js
        workedForInvite = await workForMegacorpFactionInvite(ns, factionName, false); // Work until CTO and the external script joins this faction, triggering an exit condition.
```

New:

```js
        workedForInvite = await workForMegacorpFactionInvite(ns, factionName, false); // Work until the CFO rep, then earnExecutiveJob takes the title; the waitForFactionInvite below picks up the invite
```

(d) In `workForMegacorpFactionInvite`, line 1196, old:

```js
    let repRequiredForFaction = (companyConfig?.repRequiredForFaction || 400_000) - (backdoored ? 100_000 : 0);
```

New:

```js
    // src/Company/utils.ts calculateEffectiveRequiredReputation: every company rep requirement is x0.75 while the company server is backdoored (400k -> 300k, 800k -> 600k)
    let repRequiredForFaction = Math.round((companyConfig?.repRequiredForFaction || 400_000) * (backdoored ? BACKDOOR_REP_MULT : 1));
```

Line 1279, old:

```js
                repRequiredForFaction -= 100_000; // Adjust total required faction reputation (since this was initialized outside of the loop)
```

New:

```js
                repRequiredForFaction = Math.round(repRequiredForFaction * BACKDOOR_REP_MULT); // Adjust total required faction reputation (since this was initialized outside of the loop)
```

(e) Loop exit, lines 1323-1327. Old:

```js
    if (currentReputation >= repRequiredForFaction) {
        ns.print(`Attained ${repRequiredForFaction.toLocaleString('en')} rep with "${companyName}".`);
        if (!player.factions.includes(factionName) && waitForInvite)
            return await waitForFactionInvite(ns, factionName);
        return true;
    }
```

New:

```js
    if (currentReputation >= repRequiredForFaction) {
        ns.print(`Attained ${repRequiredForFaction.toLocaleString('en')} rep with "${companyName}".`);
        // Silhouette: rep alone does not earn the invite, we must also hold an executive title (CFO) at this company
        if (companyConfig?.executiveJob && !player.factions.includes(factionName) &&
            !(await earnExecutiveJob(ns, companyName, companyConfig.executiveJob, statModifier, backdoored)))
            return false;
        if (!player.factions.includes(factionName) && waitForInvite)
            return await waitForFactionInvite(ns, factionName);
        return true;
    }
```

(f) Append at the end of `work-for-factions.js` (after the closing `}` of `workForMegacorpFactionInvite`):

```js

/** Silhouette special case: once the company rep for the executive tier is earned, switch tracks and apply for the title. The game's
 *  applyToCompany starts at the track's entry position and climbs every tier we qualify for (src/PersonObjects/Player/PlayerObjectGeneralMethods.ts
 *  applyForJob), so one application lands directly on CFO. Studies Leadership first if charisma is the only missing requirement.
 * @param {NS} ns
 * @param {string} companyName
 * @param {{track: string, tier: number}} executiveJob The job track and tier index (in `jobs`) whose title satisfies the invite condition
 * @param {number} statModifier Extra stat requirement of this company (0 or 25)
 * @param {boolean} backdoored Whether the company server is backdoored (rep requirements x0.75)
 * @returns {Promise<boolean>} true once player.jobs[companyName] is an executive title */
async function earnExecutiveJob(ns, companyName, executiveJob, statModifier, backdoored) {
    const req = jobTierRequirements(executiveJob.track, executiveJob.tier, statModifier, backdoored);
    const jobDesc = `'${executiveJob.track}' #${executiveJob.tier} at "${companyName}"`;
    while (!breakToMainLoop()) {
        const player = await getPlayerInfo(ns);
        if (executiveJobTitles.includes(player.jobs[companyName])) {
            log(ns, `SUCCESS: We are now "${player.jobs[companyName]}" at "${companyName}", which qualifies for the Silhouette invite.`, false, 'success');
            return true;
        }
        const currentRep = await getCompanyReputation(ns, companyName);
        const missing = [];
        if (currentRep < req.rep) missing.push(`Rep ${Math.round(currentRep).toLocaleString('en')}/${req.rep.toLocaleString('en')}`);
        if (player.skills.hacking < req.hack) missing.push(`Hack ${player.skills.hacking}/${req.hack}`);
        if (player.skills.charisma < req.cha) missing.push(`Cha ${player.skills.charisma}/${req.cha}`);
        if (missing.length == 0) { // All requirements met: apply for the track, the game promotes us straight to the highest tier we qualify for
            if (await tryApplyToCompany(ns, companyName, executiveJob.track)) {
                log(ns, `Applied to "${companyName}" for a '${executiveJob.track}' position (expecting tier ${executiveJob.tier}).`, false, 'success');
                continue; // Re-read player.jobs to confirm the title
            }
            ns.print(`ERROR: Application for ${jobDesc} failed although the rep/hack/cha requirements appear to be met.`);
            return false;
        }
        // Only charisma can be trained here (company rep is earned by workForMegacorpFactionInvite, hack by daemon.js)
        if (missing.length == 1 && player.skills.charisma < req.cha && !options['no-studying']) {
            const em = req.cha / options['training-stat-per-multi-threshold'];
            const chaHeuristic = classHeuristic(player, 'charisma');
            if (chaHeuristic < em) {
                ns.print(`Cannot become ${jobDesc}: charisma ${player.skills.charisma} < ${req.cha}, and our charisma multipliers look too low to train it ` +
                    `in a reasonable amount of time (${formatNumberShort(chaHeuristic)} < ${formatNumberShort(em, 2)} - configure with --training-stat-per-multi-threshold)`);
                return false;
            }
            if (!(await studyForCharisma(ns, shouldFocus))) return false;
            if (!(await monitorStudies(ns, 'charisma', req.cha))) return false;
            continue;
        }
        ns.print(`Cannot yet become ${jobDesc}. Missing: ${missing.join(', ')}`);
        return false;
    }
    return false;
}
```

Design decision: the rep loop still runs on the IT/Software track (higher rep/s for a hack-heavy player) and only switches to Business once the CFO rep is reached; when charisma cannot reasonably be trained the function returns false so `earnFactionInvite` stops re-entering the grind every 10 minutes.

- [ ] **Step 6: Syntax, RAM and unit checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check work-for-factions.js
node --check progression-rules.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs work-for-factions.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs progression-rules.js
node --test
```
Expected: both `--check` silent; collide prints `work-for-factions.js: +[] -[]` and `progression-rules.js: +[] -[]`; `pass 133 fail 0`.

- [ ] **Step 7: In-game check (throwaway profile, test save)**

In the game terminal: `run work-for-factions.js --first Silhouette --no-tail-windows` then `tail work-for-factions.js`. Look for, in order: `Working towards CFO (800,000 company rep ...`, `Going to work for Company "<picked company>" next...`, the usual promotion status lines with `to unlock company faction "Silhouette"` quoting `800,000` (or `600,000` if that server is backdoored), and once the rep is reached either `Applied to "<company>" for a 'Business' position (expecting tier 4).` followed by `SUCCESS: We are now "Chief Financial Officer" ...` and `Joined faction "Silhouette"`, or `Cannot become 'Business' #4 ... charisma ...` (on the test save charisma is far too low, so this second outcome is the expected one there; the point is that the loop exits at 800k instead of continuing to 10M). Also `mem work-for-factions.js` must print the same value as before the change.

- [ ] **Step 8: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add progression-rules.js test/progression-rules.test.js work-for-factions.js
git commit -m "work-for-factions: earn the Silhouette invite via CFO (800k rep, Business track) instead of CTO (PR-1)"
```

---

### Task 2: PR-2 — `--install-for-augs` must also fire for an already-queued aug (labyrinth Red Pill)

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js` lines 911-912.
- Test: none possible in Node (autopilot.js is not importable); verification is `node --check` + in-game.

**Interfaces:** Consumes `facman.awaiting_install_augs` (already produced by `faction-manager.js:238`). Produces nothing new.

- [ ] **Step 1: Edit the reset condition**

Old (lines 911-912):

```js
        let shouldReset = options['install-for-augs'].some(a => facman.affordable_augs.includes(a)) ||
            pendingAugCount >= augsNeeded || pendingAugInclNfCount >= augsNeededInclNf;
```

New:

```js
        // An --install-for-augs aug triggers the install whether we can buy it now or it is already queued: the darknet labyrinth *queues* its
        // reward (src/DarkNet/effects/cacheFiles.ts getLabReward -> Player.queueAugmentation), and while The Red Pill sits in the queue every
        // other aug costs 1.9x (src/Augmentation/AugmentationHelpers.ts). shouldDelayInstall still applies (grafting, 4S, BN8 rules).
        let shouldReset = options['install-for-augs'].some(a => facman.affordable_augs.includes(a) || facman.awaiting_install_augs.includes(a)) ||
            pendingAugCount >= augsNeeded || pendingAugInclNfCount >= augsNeededInclNf;
```

Design decision: when the only trigger is a queued aug and nothing is affordable, `totalCost` is 0, so the reserve/countdown block is skipped and `ascend.js` is invoked on this loop (no `--allow-soft-reset`, because `pendingAugInclNfCount` counts the queued aug). Installing immediately is the desired behaviour for a queued TRP, so no countdown hack (like the Daedalus `totalCost = 1`) is added.

- [ ] **Step 2: Syntax and RAM checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check autopilot.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs autopilot.js
node --test
```
Expected: silent, `autopilot.js: +[] -[]`, all tests pass.

- [ ] **Step 3: In-game check (throwaway profile)**

On a save with at least one cheap affordable aug: `run faction-manager.js --purchase` once so that aug is *queued* (check with `run faction-manager.js` that it appears under "awaiting install"), then `run autopilot.js --install-for-augs "<that aug's exact name>" --disable-auto-destroy-bn` and `tail autopilot.js`. Expected within one loop: the status changes from `Waiting for N new augs ...` to `Reserving ... to install ...` / `Invoking ascend.js at ...` (kill autopilot.js and ascend.js immediately with `kill autopilot.js` / `kill ascend.js` if you do not want the install to happen). Before the change the same setup stays on `Waiting for N new augs`.

- [ ] **Step 4: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add autopilot.js
git commit -m "autopilot: trigger --install-for-augs for an aug that is already queued (PR-2)"
```

---

### Task 3: PR-3 — never auto-join a city faction unless it is deliberate

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js` lines 4 (import), 108-113 (globals), 269-276 (invite acceptance in `mainLoop`), 288-309 (work-order computation in `mainLoop`).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/ascend.js` lines 1-4 (import), 152-157 (STEP 9).

**Interfaces:**
- Produces (`progression-rules.js`): `export const cityFactions`, `export function filterCityFactionInvites(invites, joinedFactions, allowedFactions = [])` → `string[]`.
- Produces (`work-for-factions.js`): `function getFactionWorkOrder(ns, player, verbose = false)` → `string[]` (extracted from the Strategy 1 block; same result as before).
- Consumes: `firstFactions`, `skipFactions`, `softCompletedFactions`, `fulcrumHackReq`, `currentBitnode`, `options` globals.

Game facts: `src/Faction/FactionInfo.tsx` Volhaven `enemies: [Chongqing, Sector12, NewTokyo, Aevum, Ishima]`; Sector-12/Aevum ban the other four; Chongqing/New Tokyo/Ishima ban S12/Aevum/Volhaven; `src/Faction/FactionHelpers.tsx joinFaction` sets `isBanned` on every enemy; bans clear only in `prestigeAugmentation`.

- [ ] **Step 1: Write the failing tests**

Append to `test/progression-rules.test.js` (extend the import list with `cityFactions, filterCityFactionInvites`):

```js
test("filterCityFactionInvites: city invites are held back unless allowed or a city is already joined", () => {
    assert.deepEqual([...cityFactions].sort(), ["Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12", "Volhaven"]);
    const invites = ["Volhaven", "CyberSec", "Aevum", "Tian Di Hui"];
    // No city joined, nothing allowed: only non-city invites survive
    assert.deepEqual(filterCityFactionInvites(invites, ["CyberSec"]), ["CyberSec", "Tian Di Hui"]);
    // --first / next work-order entry allows exactly that city
    assert.deepEqual(filterCityFactionInvites(invites, [], ["Aevum"]), ["CyberSec", "Aevum", "Tian Di Hui"]);
    // A city faction already joined: the game has already banned the incompatible ones, so everything may be joined
    assert.deepEqual(filterCityFactionInvites(invites, ["Sector-12"]), invites);
    // Input is not mutated
    assert.deepEqual(invites, ["Volhaven", "CyberSec", "Aevum", "Tian Di Hui"]);
    assert.deepEqual(filterCityFactionInvites([], []), []);
});
```

- [ ] **Step 2: Run, expect failure**

`cd /home/jubnl/dev/bitburner/bitburner-scripts && node --test`
Expected: `SyntaxError: The requested module '../progression-rules.js' does not provide an export named 'cityFactions'`.

- [ ] **Step 3: Append to `progression-rules.js`**

```js

/** The six city factions are mutually exclusive: joining one bans its `enemies` for the whole reset
 *  (src/Faction/FactionInfo.tsx; src/Faction/FactionHelpers.tsx joinFaction; bans clear only in Faction.prestigeAugmentation). */
export const cityFactions = ["Sector-12", "Aevum", "Chongqing", "New Tokyo", "Ishima", "Volhaven"];

/** Decide which pending invites may be auto-accepted. A city faction is only accepted when (a) some city faction is already joined
 *  (the game has already banned the incompatible ones), or (b) it is explicitly allowed (--first, or the next faction in our work order).
 * @param {string[]} invites @param {string[]} joinedFactions @param {string[]} allowedFactions @returns {string[]} */
export function filterCityFactionInvites(invites, joinedFactions, allowedFactions = []) {
    if (joinedFactions.some(f => cityFactions.includes(f))) return invites.slice();
    return invites.filter(f => !cityFactions.includes(f) || allowedFactions.includes(f));
}
```

- [ ] **Step 4: Run, expect pass**

`node --test` → all pass (134).

- [ ] **Step 5: Edit `work-for-factions.js`**

(a) Line 4 import (as left by Task 1), add the two names:

```js
import { jobs, executiveJobTitles, silhouetteExecutiveJob, SILHOUETTE_EXECUTIVE_REP, BACKDOOR_REP_MULT, pickSilhouetteCompany, jobTierRequirements, cityFactions, filterCityFactionInvites } from './progression-rules.js'
```

(b) Globals: after line 113 (`let bitNodeMults = ...`) add:

```js
let lastCityInviteNotice = ""; // De-duplicates the "not auto-joining city faction" log line
```

(c) Extract the work-order computation. Old lines 288-306 (from `// Remove Fulcrum from our "EarlyFactionOrder"` through the `factionWorkOrder` assignment):

```js
    // Remove Fulcrum from our "EarlyFactionOrder" if hack level is insufficient to backdoor their server
    let priorityFactions = options['crime-focus'] ? preferredCrimeFactionOrder.slice() : preferredEarlyFactionOrder.slice();
    if (player.skills.hacking < fulcrumHackReq - 10) { // Assume that if we're within 10, we'll get there by the time we've earned the invite
        const fulcrumIdx = priorityFactions.findIndex(c => c == "Fulcrum Secret Technologies")
        if (fulcrumIdx !== -1) {
            priorityFactions.splice(fulcrumIdx, 1);
            ns.print(`Fulcrum faction server requires ${fulcrumHackReq} hack, so removing from our initial priority list for now.`);
        }
    } // TODO: Otherwise, if we get Fulcrum, we have no need for a couple other company factions
    // If we're in BN 10, we can purchase special Sleeve-related things from the Covenant, so we should always try join it
    if (currentBitnode == 10 && !priorityFactions.includes("The Covenant")) {
        priorityFactions.push("The Covenant");
        ns.print(`We're in BN10, which means we should add The Covenant to our priority faction list, so you can purchase sleeves and sleeve memory.`);
    }

    // Strategy 1: Tackle a consolidated list of desired faction order, interleaving simple factions and megacorporations
    const factionWorkOrder = firstFactions.concat(priorityFactions.filter(f => // Remove factions from our initial "work order" if we've bought all desired augmentations.
        !firstFactions.includes(f) && !skipFactions.includes(f) && !softCompletedFactions.includes(f)));
```

New:

```js
    // Strategy 1: Tackle a consolidated list of desired faction order, interleaving simple factions and megacorporations
    const factionWorkOrder = getFactionWorkOrder(ns, player, true);
```

And add this function right before `/** @param {NS} ns */ async function mainLoop(ns) {` (i.e. above `let lastMainLoopMessage = "";`, line 254):

```js
/** The consolidated list of factions to work for, in order: --first factions, then the preferred early (or crime) faction order,
 *  minus factions that are skipped, soft-completed, or (Fulcrum) unreachable at our hack level. Depends only on the current globals.
 * @param {NS} ns @param {Player} player @param {boolean} verbose Log the Fulcrum / BN10 adjustments (once per main loop)
 * @returns {string[]} */
function getFactionWorkOrder(ns, player, verbose = false) {
    // Remove Fulcrum from our "EarlyFactionOrder" if hack level is insufficient to backdoor their server
    let priorityFactions = options['crime-focus'] ? preferredCrimeFactionOrder.slice() : preferredEarlyFactionOrder.slice();
    if (player.skills.hacking < fulcrumHackReq - 10) { // Assume that if we're within 10, we'll get there by the time we've earned the invite
        const fulcrumIdx = priorityFactions.findIndex(c => c == "Fulcrum Secret Technologies")
        if (fulcrumIdx !== -1) {
            priorityFactions.splice(fulcrumIdx, 1);
            if (verbose) ns.print(`Fulcrum faction server requires ${fulcrumHackReq} hack, so removing from our initial priority list for now.`);
        }
    } // TODO: Otherwise, if we get Fulcrum, we have no need for a couple other company factions
    // If we're in BN 10, we can purchase special Sleeve-related things from the Covenant, so we should always try join it
    if (currentBitnode == 10 && !priorityFactions.includes("The Covenant")) {
        priorityFactions.push("The Covenant");
        if (verbose) ns.print(`We're in BN10, which means we should add The Covenant to our priority faction list, so you can purchase sleeves and sleeve memory.`);
    }
    return firstFactions.concat(priorityFactions.filter(f => // Remove factions from our initial "work order" if we've bought all desired augmentations.
        !firstFactions.includes(f) && !skipFactions.includes(f) && !softCompletedFactions.includes(f)));
}
```

(d) Invite acceptance, old lines 269-276:

```js
    // Immediately accept any outstanding faction invitations for factions we want to earn rep with soon
    // TODO: If check if we would qualify for an invite to any factions just by travelling, and do so to start earning passive rep
    const invites = await checkFactionInvites(ns);
    const invitesToAccept = options['get-invited-to-every-faction'] || options['prioritize-invites'] ?
        invites.filter(f => !skipFactions.includes(f)) :
        invites.filter(f => !skipFactions.includes(f) && !softCompletedFactions.includes(f));
    for (const invite of invitesToAccept)
        await tryJoinFaction(ns, invite);
```

New:

```js
    // Immediately accept any outstanding faction invitations for factions we want to earn rep with soon
    // TODO: If check if we would qualify for an invite to any factions just by travelling, and do so to start earning passive rep
    const invites = await checkFactionInvites(ns);
    let invitesToAccept = options['get-invited-to-every-faction'] || options['prioritize-invites'] ?
        invites.filter(f => !skipFactions.includes(f)) :
        invites.filter(f => !skipFactions.includes(f) && !softCompletedFactions.includes(f));
    // City factions ban each other for the whole reset (Volhaven bans the other five), so never join one just because its invite arrived first.
    // Only --first factions and the next entry of our work order are joined here; any other city is joined deliberately by earnFactionInvite.
    const nextWorkOrderFaction = getFactionWorkOrder(ns, player).find(f => !player.factions.includes(f));
    const allowedCities = firstFactions.concat(nextWorkOrderFaction ? [nextWorkOrderFaction] : []);
    const filteredInvites = filterCityFactionInvites(invitesToAccept, player.factions, allowedCities);
    const heldBackCities = invitesToAccept.filter(f => !filteredInvites.includes(f));
    const cityInviteNotice = heldBackCities.length == 0 ? "" : `INFO: Not auto-joining city faction invite(s) ${heldBackCities.join(", ")} ` +
        `(joining one bans the others for this reset). They will be joined when they come up in the work order.`;
    if (cityInviteNotice != lastCityInviteNotice) ns.print((lastCityInviteNotice = cityInviteNotice) || "INFO: No more city faction invites held back.");
    invitesToAccept = filteredInvites;
    for (const invite of invitesToAccept)
        await tryJoinFaction(ns, invite);
```

Design decision: "next entry of the work order" = the first entry of `getFactionWorkOrder()` not yet joined, so in the default order Aevum is auto-accepted only once Netburners and Tian Di Hui are joined; before that, `earnFactionInvite("Aevum")` (Strategy 1) joins it deliberately when its turn comes. In `--crime-focus` mode the work order has no city, so cities are only joined via Strategy 5+ `earnFactionInvite`.

- [ ] **Step 6: Edit `ascend.js` STEP 9**

Line 1-4 import: add a second import line after the helpers import:

```js
import { filterCityFactionInvites } from './progression-rules.js'
```

Old lines 152-157:

```js
    // STEP 9: Join every faction we've been invited to (gives a little INT XP)
    let invites = await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()');
    if (invites.length > 0) {
        pid = await runCommand(ns, 'ns.args.forEach(f => ns.singularity.joinFaction(f))', '/Temp/join-factions.js', invites);
        await waitForProcessToComplete(ns, pid, true);
    }
```

New:

```js
    // STEP 9: Join every faction we've been invited to (gives a little INT XP) - except city factions, which ban each other.
    // (Bans are cleared by the install anyway, but keep the same rule as work-for-factions.js / faction-manager.js in case the install is aborted.)
    const joinedFactions = (await getNsDataThroughFile(ns, 'ns.getPlayer()')).factions;
    let invites = filterCityFactionInvites(await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()'), joinedFactions);
    if (invites.length > 0) {
        pid = await runCommand(ns, 'ns.args.forEach(f => ns.singularity.joinFaction(f))', '/Temp/join-factions.js', invites);
        await waitForProcessToComplete(ns, pid, true);
    }
```

- [ ] **Step 7: Syntax, RAM and unit checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check work-for-factions.js
node --check ascend.js
node --check progression-rules.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs work-for-factions.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs ascend.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs progression-rules.js
node --test
```
Expected: all `+[] -[]`; `pass 134 fail 0`. (`ns.getPlayer()` through `getNsDataThroughFile` is a temp script; ascend.js's own RAM is unchanged - confirm with `mem ascend.js` in game.)

- [ ] **Step 8: In-game check**

On the test save (no city faction joined, in Sector-12 with > $15m so a Sector-12 invite is pending; travel with `run work-for-factions.js` stopped and `connect` not needed - just make sure `ns.singularity.checkFactionInvitations()` lists a city): `run work-for-factions.js --get-invited-to-every-faction --no-tail-windows`, `tail work-for-factions.js`. Expected: `INFO: Not auto-joining city faction invite(s) Sector-12 (joining one bans the others for this reset)...` and the faction is NOT in `ns.getPlayer().factions`; later, when Aevum comes up in Strategy 1, `Travelled from ... to Aevum` / `Joined faction "Aevum"` (deliberate path). With `--first Sector-12` instead, the invite is joined immediately (`Joined faction "Sector-12"`).

- [ ] **Step 9: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add progression-rules.js test/progression-rules.test.js work-for-factions.js ascend.js
git commit -m "work-for-factions, ascend: only join city factions deliberately, never in invite-arrival order (PR-3)"
```

---

### Task 4: PR-4 — stat-grind crime: pick the best combat exp/s crime (Mug beats Homicide/Heist)

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js` line 4 (import), lines 657-667 (crime choice in `crimeForKillsKarmaStats`).

**Interfaces:**
- Produces (`progression-rules.js`): `export const crimeStats` (`{Mug|Homicide|Assassination|Heist: {timeMs, combatExp}}`), `export const slowCrimes = ["Heist", "Assassination"]`, `export function crimeCombatExpRate(crime, chance)` → exp per stat per second, `export function bestCombatExpCrime(crimeChances, fastCrimesOnly = false)` → crime name.
- Consumes (`work-for-factions.js`): `crimeChances` (already fetched for `["Heist", "Assassination", "Homicide", "Mug"]`), `needStats`, `needKarmaOrKills`, `forever`, `doFastCrimesOnly`.

Game facts: `src/Crime/Crimes.ts` Mug 4e3 ms / 3 exp per combat stat, Homicide 3e3 ms / 2, Assassination 300e3 ms / 300, Heist 600e3 ms / 450; `src/Work/CrimeWork.ts commit`: on failure `gains = scaleWorkStats(gains, 0.25)`. Expected exp/s = base * (0.25 + 0.75 p). Crossovers: Homicide never beats Mug (0.667 < 0.75 even at p = 1); Assassination beats Mug at p_mug = 1 once p > 2/3; Heist ties Mug only at p = 1.

- [ ] **Step 1: Write the failing tests**

Append to `test/progression-rules.test.js` (extend the import list with `crimeStats, slowCrimes, crimeCombatExpRate, bestCombatExpCrime`):

```js
const crimesSrc = readFileSync(SRC + "Crime/Crimes.ts", "utf8");
test("crimeStats match Crimes.ts (time = 4th constructor arg, strength_exp)", () => {
    const key = { Mug: "mug", Homicide: "homicide", Assassination: "assassination", Heist: "heist" };
    for (const [crime, stats] of Object.entries(crimeStats)) {
        const block = crimesSrc.match(new RegExp(`\\[CrimeType\\.${key[crime]}\\]: new Crime\\(([\\s\\S]*?)\\n {2}\\),`))[1];
        const timeMs = Number(block.match(/^\s+([\d.e]+),$/m)[1]); // first bare numeric argument = time
        const combatExp = Number(block.match(/strength_exp: ([\d.]+)/)[1]);
        assert.equal(stats.timeMs, timeMs, `${crime} time`);
        assert.equal(stats.combatExp, combatExp, `${crime} exp`);
        for (const stat of ["defense_exp", "dexterity_exp", "agility_exp"])
            assert.equal(Number(block.match(new RegExp(`${stat}: ([\\d.]+)`))[1]), combatExp, `${crime} ${stat} equals strength_exp`);
    }
    assert.deepEqual(slowCrimes, ["Heist", "Assassination"]);
});

test("crimeCombatExpRate = exp/time * (0.25 + 0.75 chance)", () => {
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
    near(crimeCombatExpRate("Mug", 1), 0.75);
    near(crimeCombatExpRate("Homicide", 0.5), 2 / 3 * 0.625); // 0.4167, the spec's "Homicide at threshold" number
    near(crimeCombatExpRate("Assassination", 0.9), 0.925);
    near(crimeCombatExpRate("Heist", 0.75), 0.75 * (0.25 + 0.75 * 0.75)); // 0.609
    near(crimeCombatExpRate("Mug", 0), 0.1875); // a 0 % crime still yields 25 % of the exp
});

test("bestCombatExpCrime prefers Mug over Homicide/Heist and Assassination only above ~67 %", () => {
    // The spec's table: Homicide at its 50 % threshold (0.417) vs Mug (0.75)
    assert.equal(bestCombatExpCrime({ Heist: 0, Assassination: 0, Homicide: 0.5, Mug: 0.95 }), "Mug");
    assert.equal(bestCombatExpCrime({ Heist: 0.1, Assassination: 0.2, Homicide: 1, Mug: 1 }), "Mug"); // Homicide 0.667 < Mug 0.75
    assert.equal(bestCombatExpCrime({ Heist: 1, Assassination: 0.6, Homicide: 1, Mug: 1 }), "Mug"); // Heist ties at p=1 -> shorter crime wins; Assassination 0.70 < 0.75
    assert.equal(bestCombatExpCrime({ Heist: 1, Assassination: 0.9, Homicide: 1, Mug: 1 }), "Assassination"); // 0.925 > 0.75
    assert.equal(bestCombatExpCrime({ Heist: 1, Assassination: 0.9, Homicide: 1, Mug: 1 }, true), "Mug"); // --fast-crimes-only excludes the slow crimes
    assert.equal(bestCombatExpCrime({ Homicide: 0.3, Mug: 0.4 }), "Mug"); // only the crimes present are considered
    assert.equal(bestCombatExpCrime({}), undefined);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test` → `does not provide an export named 'crimeStats'`.

- [ ] **Step 3: Append to `progression-rules.js`**

```js

/** Duration and combat exp (per physical stat, at 100 % success) of the crimes the stat grind chooses between (src/Crime/Crimes.ts).
 *  Every player / bitnode / focus multiplier applies equally to all crimes, so they cancel when comparing. */
export const crimeStats = {
    "Mug": { timeMs: 4e3, combatExp: 3 },
    "Homicide": { timeMs: 3e3, combatExp: 2 },
    "Assassination": { timeMs: 300e3, combatExp: 300 },
    "Heist": { timeMs: 600e3, combatExp: 450 },
};
/** Crimes excluded by --fast-crimes-only (too long to interrupt at will) */
export const slowCrimes = ["Heist", "Assassination"];

/** Expected combat exp per stat per second of a crime at the given success chance: a failed crime still grants 25 % of the exp
 *  (src/Work/CrimeWork.ts commit: scaleWorkStats(gains, 0.25)), so the expectation is base * (0.25 + 0.75 * chance). */
export function crimeCombatExpRate(crime, chance) {
    const stats = crimeStats[crime];
    return stats.combatExp / (stats.timeMs / 1000) * (0.25 + 0.75 * chance);
}

/** The crime that trains the four combat stats fastest at the given success chances. Ties go to the shorter crime (interruptible sooner).
 * @param {{[crime: string]: number}} crimeChances success chance (0-1) per crime name (ns.singularity.getCrimeChance); crimes missing here are not considered
 * @param {boolean} fastCrimesOnly exclude Heist and Assassination (--fast-crimes-only)
 * @returns {string|undefined} */
export function bestCombatExpCrime(crimeChances, fastCrimesOnly = false) {
    const candidates = Object.keys(crimeStats).filter(c => c in crimeChances && !(fastCrimesOnly && slowCrimes.includes(c)));
    return candidates.sort((a, b) => crimeCombatExpRate(b, crimeChances[b]) - crimeCombatExpRate(a, crimeChances[a]) || crimeStats[a].timeMs - crimeStats[b].timeMs)[0];
}
```

- [ ] **Step 4: Run, expect pass**

`node --test` → `pass 137 fail 0`.

- [ ] **Step 5: Edit `work-for-factions.js`**

(a) Line 4 import: add `bestCombatExpCrime` to the `./progression-rules.js` import list.

(b) Lines 663-667 in `crimeForKillsKarmaStats`. Old:

```js
        const homicideForKarma = needKarmaOrKills && !(options ? options['crime-warmup-with-mug'] : false);
        crime = (crimeCount < 2 && !homicideForKarma) ? (crimeChances["Homicide"] > 0.75 ? "Homicide" : "Mug") : // Start with a few fast & easy crimes to boost stats if we're just starting
            (!needStats && needKarmaOrKills) ? "Homicide" : // If *all* we need now is kills or Karma, homicide is the fastest way to do that, even at low proababilities
                bestCrimesByDifficulty.find((c, index) => doFastCrimesOnly && index <= 1 ? 0 : crimeChances[c] >= chanceThresholds[index]); // Otherwise, crime based on success chance vs relative reward (precomputed)
        if (crime == "Mug" && homicideForKarma) crime = "Homicide"; // Never fall back to Mug while karma/kills are still needed (Heist/Assassination tiers are kept for money/stat grinding)
```

New:

```js
        const homicideForKarma = needKarmaOrKills && !(options ? options['crime-warmup-with-mug'] : false);
        // Pure stat grind (karma/kills satisfied, finite stat target): pick the crime with the best combat exp/s at our current success chances.
        // Homicide at 50 % gives 0.42 exp/s per stat vs Mug's 0.75 (src/Crime/Crimes.ts exp/time, src/Work/CrimeWork.ts failure x0.25);
        // only Assassination above ~67 % beats Mug. crime.js's "forever" mode keeps the money-oriented tiers below.
        const statGrindOnly = needStats && !needKarmaOrKills && !forever;
        crime = (crimeCount < 2 && !homicideForKarma) ? (crimeChances["Homicide"] > 0.75 ? "Homicide" : "Mug") : // Start with a few fast & easy crimes to boost stats if we're just starting
            (!needStats && needKarmaOrKills) ? "Homicide" : // If *all* we need now is kills or Karma, homicide is the fastest way to do that, even at low proababilities
                statGrindOnly ? bestCombatExpCrime(crimeChances, doFastCrimesOnly) : // Best combat exp/s for the stat grind
                    bestCrimesByDifficulty.find((c, index) => doFastCrimesOnly && index <= 1 ? 0 : crimeChances[c] >= chanceThresholds[index]); // Otherwise (forever mode), crime based on success chance vs relative reward (precomputed)
        if (crime == "Mug" && homicideForKarma) crime = "Homicide"; // Never fall back to Mug while karma/kills are still needed (Heist/Assassination tiers are kept for money/stat grinding)
```

Design decision: `crime.js` with no arguments runs this function with `reqStats = MAX_SAFE_INTEGER` (`forever`), which users run for money as much as stats, so the exp-argmax only applies to finite stat targets (faction invites, `--crime-focus`); the karma/kills path is untouched (Homicide always).

- [ ] **Step 6: Syntax, RAM and unit checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check work-for-factions.js
node --check progression-rules.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs work-for-factions.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs progression-rules.js
node --test
```
Expected: `+[] -[]` for both; `pass 137 fail 0`. Also `node --check crime.js` (it imports `crimeForKillsKarmaStats`; unchanged file, must still parse).

- [ ] **Step 7: In-game check**

Test save (fresh combat stats, karma near 0): `run work-for-factions.js --first Tetrads --fast-crimes-only --no-tail-windows` (Tetrads needs 75 of each combat stat and -18 karma). `tail work-for-factions.js`. Expected: first `Committing "Homicide" ... until we reach ... -18 Karma` (karma path unchanged), then once karma is satisfied and only stats remain: `Committing "Mug" (xx% success) until we reach 75 of each combat stat` - never `"Homicide"` at 50-75 % in that phase. Without `--fast-crimes-only` and with high stats, `"Assassination"` appears only when its chance is above ~67 %.

- [ ] **Step 8: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add progression-rules.js test/progression-rules.test.js work-for-factions.js
git commit -m "work-for-factions: grind combat stats with the best exp/s crime instead of Homicide/Heist tiers (PR-4)"
```

---

### Task 5: PR-5 — check money and installed augs before grinding for Daedalus / The Covenant / Illuminati

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js` line 4 (import), line 111 (globals), lines 200-206 (`loadStartupData`), lines 455-459 (`earnFactionInvite`, right after the precluding-city check).

**Interfaces:**
- Produces (`progression-rules.js`): `export const endgameInviteRequirements`, `export function endgameInviteBlocker(factionName, money, installedAugCount, daedalusAugsRequirement)` → `null | {reason: "augs"|"money", have: number, need: number}`.
- Produces (`work-for-factions.js`): global `numInstalledAugs` (set in `loadStartupData`).
- Consumes: `bitNodeMults.DaedalusAugsRequirement`, `player.money`, `formatMoney`.

Game facts: `src/Faction/FactionInfo.tsx:132` Illuminati `haveAugmentations(30), haveMoney(150e9)`, `:142` Daedalus `haveAugmentations(DaedalusAugsRequirement)` + `haveMoney(100e9)`, `:167` The Covenant `haveAugmentations(20), haveMoney(75e9)`; `src/Faction/FactionJoinCondition.ts haveAugmentations` counts `p.augmentations.length` (installed; NeuroFlux is one entry) = `ns.singularity.getOwnedAugmentations(false).length`.

- [ ] **Step 1: Write the failing tests**

Append to `test/progression-rules.test.js` (extend the import list with `endgameInviteRequirements, endgameInviteBlocker`):

```js
const factionInfoSrc = readFileSync(SRC + "Faction/FactionInfo.tsx", "utf8");
test("endgameInviteRequirements match FactionInfo.tsx", () => {
    const req = (faction) => {
        const block = factionInfoSrc.match(new RegExp(`\\[FactionName\\.${faction}\\]: new FactionInfo\\(\\{([\\s\\S]*?)inviteReqs: \\[([^\\n]*)`))[2];
        return { augs: block.match(/haveAugmentations\((\d+)\)/)?.[1], money: Number(block.match(/haveMoney\(([\d.e]+)\)/)[1]) };
    };
    assert.deepEqual(req("Illuminati"), { augs: "30", money: 150e9 });
    assert.deepEqual(req("TheCovenant"), { augs: "20", money: 75e9 });
    assert.deepEqual(endgameInviteRequirements["Illuminati"], { augs: 30, money: 150e9 });
    assert.deepEqual(endgameInviteRequirements["The Covenant"], { augs: 20, money: 75e9 });
    assert.deepEqual(endgameInviteRequirements["Daedalus"], { augs: null, money: 100e9 });
    assert.match(factionInfoSrc, /\[FactionName\.Daedalus\][\s\S]*?haveMoney\(100e9\)/);
    assert.match(factionInfoSrc, /\[FactionName\.Daedalus\][\s\S]*?haveAugmentations\(currentNodeMults\.DaedalusAugsRequirement\)/);
});

test("endgameInviteBlocker: augs first, then money, null when satisfied or not an end-game faction", () => {
    assert.deepEqual(endgameInviteBlocker("The Covenant", 1e12, 5, 30), { reason: "augs", have: 5, need: 20 });
    assert.deepEqual(endgameInviteBlocker("The Covenant", 1e9, 25, 30), { reason: "money", have: 1e9, need: 75e9 });
    assert.equal(endgameInviteBlocker("The Covenant", 75e9, 20, 30), null);
    assert.deepEqual(endgameInviteBlocker("Daedalus", 1e12, 29, 30), { reason: "augs", have: 29, need: 30 });
    assert.deepEqual(endgameInviteBlocker("Daedalus", 1e12, 29, 25), null); // BN-specific requirement honoured
    assert.deepEqual(endgameInviteBlocker("Illuminati", 149e9, 40, 30), { reason: "money", have: 149e9, need: 150e9 });
    assert.equal(endgameInviteBlocker("Tetrads", 0, 0, 30), null);
});
```

- [ ] **Step 2: Run, expect failure**

`node --test` → `does not provide an export named 'endgameInviteRequirements'`.

- [ ] **Step 3: Append to `progression-rules.js`**

```js

/** Invite prerequisites that no stat grinding can satisfy right now, for the three end-game factions
 *  (src/Faction/FactionInfo.tsx Illuminati / Daedalus / The Covenant inviteReqs). `augs: null` = bitNodeMults.DaedalusAugsRequirement.
 *  haveAugmentations counts *installed* augs (src/Faction/FactionJoinCondition.ts: p.augmentations.length, NeuroFlux counts once). */
export const endgameInviteRequirements = {
    "The Covenant": { augs: 20, money: 75e9 },
    "Daedalus": { augs: null, money: 100e9 },
    "Illuminati": { augs: 30, money: 150e9 },
};

/** @returns {null|{reason: "augs"|"money", have: number, need: number}} why we cannot be invited yet regardless of stats, or null */
export function endgameInviteBlocker(factionName, money, installedAugCount, daedalusAugsRequirement) {
    const req = endgameInviteRequirements[factionName];
    if (!req) return null;
    const augsNeeded = req.augs ?? daedalusAugsRequirement;
    if (installedAugCount < augsNeeded) return { reason: "augs", have: installedAugCount, need: augsNeeded };
    if (money < req.money) return { reason: "money", have: money, need: req.money };
    return null;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test` → `pass 139 fail 0`.

- [ ] **Step 5: Edit `work-for-factions.js`**

(a) Line 4 import: add `endgameInviteBlocker` to the `./progression-rules.js` import list.

(b) Line 111, old:

```js
let dictSourceFiles, dictFactionFavors, playerGang, mainLoopStart, scope, numJoinedFactions, lastTravel, crimeCount;
```

New:

```js
let dictSourceFiles, dictFactionFavors, playerGang, mainLoopStart, scope, numJoinedFactions, lastTravel, crimeCount, numInstalledAugs;
```

(c) In `loadStartupData`, after line 206 (`hasSimulacrum = installedAugmentations.includes("The Blade's Simulacrum");`) add:

```js
    numInstalledAugs = installedAugmentations.length; // What the game's haveAugmentations(n) invite condition counts (NeuroFlux appears once)
```

(d) In `earnFactionInvite`, right after the precluding-city `return` (line 459, `return ns.print(\`${reasonPrefix} precluding faction ...\`);`) and before `let requirement;` (line 460), insert:

```js
    // Daedalus / The Covenant / Illuminati also need N *installed* augs and a lot of money (src/Faction/FactionInfo.tsx). Neither can be earned
    // by the crime / study grinds below, so check them first instead of spending up to 10 minutes per pass on stats that cannot yield the invite.
    const inviteBlocker = endgameInviteBlocker(factionName, player.money, numInstalledAugs, bitNodeMults.DaedalusAugsRequirement);
    if (inviteBlocker?.reason == "augs")
        return ns.print(`${reasonPrefix} you have ${inviteBlocker.have} of the ${inviteBlocker.need} installed augmentations required.`);
    if (inviteBlocker?.reason == "money")
        return ns.print(`${reasonPrefix} you have insufficient money. Need: ${formatMoney(inviteBlocker.need)}, Have: ${formatMoney(inviteBlocker.have)}`);
```

Design decision: the money check uses `player.money` only (like the existing check at line 561); autopilot already liquidates stocks and reserves $100b when rushing Daedalus, so work-for-factions does not spend 4 temp scripts on `getStocksValue` here. The existing money check at line 561 stays for the other factions.

- [ ] **Step 6: Syntax, RAM and unit checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check work-for-factions.js
node --check progression-rules.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs work-for-factions.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs progression-rules.js
node --test
```
Expected: `+[] -[]`; `pass 139 fail 0`.

- [ ] **Step 7: In-game check**

Test save (few installed augs, < $75b): `run work-for-factions.js --first The_Covenant --no-tail-windows`, `tail work-for-factions.js`. Expected immediately: `Cannot join faction "The Covenant" because you have N of the 20 installed augmentations required.` and no `Committing "..."` / `Started studying` lines for it. Before the change the same command starts a crime or Algorithms grind first.

- [ ] **Step 8: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add progression-rules.js test/progression-rules.test.js work-for-factions.js
git commit -m "work-for-factions: check installed augs and money before grinding for Daedalus/Covenant/Illuminati invites (PR-5)"
```

---

### Task 6: PR-6 — buy NeuroFlux from the joined faction that already has the rep, then fall back to donations

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/progression-rules.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/test/progression-rules.test.js` (append).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/faction-manager.js` lines 1-4 (import), 474-481 (`getFromJoined` NF branch), 832-866 (NF purchase loop in `managePurchaseableAugs`).

**Interfaces:**
- Produces (`progression-rules.js`): `export function pickNeurofluxFaction(factions, repNeeded)` → the faction object or `null` (`factions` are `{name, reputation, donationsUnlocked}`; `FactionData` instances qualify).
- Consumes (`faction-manager.js`): `AugmentationData.joinedFactionsWithAug()`, `factionData`, `purchaseFactionDonations`, `getReqDonationForRep`.

Game facts: `src/Faction/formulas/donation.ts` donation = rep * 1e6 / faction_rep_mult / FactionWorkRepGain; NF rep requirement x1.14 per level (`Constants.ts NeuroFluxGovernorLevelMult`). Rep is not consumed by purchases, so a faction with rep R covers every level whose requirement is <= R.

- [ ] **Step 1: Write the failing tests**

Append to `test/progression-rules.test.js` (extend the import list with `pickNeurofluxFaction`):

```js
test("pickNeurofluxFaction: free rep first (most rep), then donations, else null", () => {
    const daedalus = { name: "Daedalus", reputation: 2e6, donationsUnlocked: false };
    const cybersec = { name: "CyberSec", reputation: 100e3, donationsUnlocked: true };
    const nitesec = { name: "NiteSec", reputation: 500e3, donationsUnlocked: true };
    const factions = [cybersec, daedalus, nitesec];
    assert.equal(pickNeurofluxFaction(factions, 94e3), daedalus);   // level 20-40 rep, free from Daedalus although it cannot take donations
    assert.equal(pickNeurofluxFaction(factions, 400e3), daedalus);
    assert.equal(pickNeurofluxFaction(factions, 2.5e6), nitesec);   // beyond every faction's rep: cheapest donation = most rep among donation-unlocked
    assert.equal(pickNeurofluxFaction([daedalus], 2.5e6), null);    // nothing free and no donations possible
    assert.equal(pickNeurofluxFaction([], 1), null);
    assert.deepEqual(factions, [cybersec, daedalus, nitesec]);      // not mutated
});
```

- [ ] **Step 2: Run, expect failure**

`node --test` → `does not provide an export named 'pickNeurofluxFaction'`.

- [ ] **Step 3: Append to `progression-rules.js`**

```js

/** Choose the joined faction to buy the next NeuroFlux level from: one that already has the rep (free; the most rep so it keeps covering
 *  later levels), otherwise one with donations unlocked (most rep = cheapest donation), otherwise null. Rep is not consumed by purchases.
 * @param {{name: string, reputation: number, donationsUnlocked: boolean}[]} factions joined factions offering NeuroFlux
 * @param {number} repNeeded reputation requirement of the next NeuroFlux level */
export function pickNeurofluxFaction(factions, repNeeded) {
    const byRep = factions.slice().sort((a, b) => b.reputation - a.reputation);
    return byRep.find(f => f.reputation >= repNeeded) ?? byRep.find(f => f.donationsUnlocked) ?? null;
}
```

- [ ] **Step 4: Run, expect pass**

`node --test` → `pass 140 fail 0`.

- [ ] **Step 5: Edit `faction-manager.js`**

(a) Import (lines 1-4): add after the helpers import:

```js
import { pickNeurofluxFaction } from './progression-rules.js'
```

(b) `getFromJoined` NF branch, old lines 474-481:

```js
        // The "Neuroflux" augmentation uses a different approach.
        // Prefer to purchase NF first from whatever joined factions have donations unlocked (allow us to continuously donate for more), next by faction with the most current reputation.
        return augFactions.sort((a, b) => // This sort order prefers factions that support donations over ones that already have sufficient rep for one or more NF levels.
            ((b.donationsUnlocked ? 1 : 0) - (a.donationsUnlocked ? 1 : 0)) || (b.reputation - a.reputation))[0]?.name;
        // This (disabled) sort order prefers factions that already have enough reputation to buy at least one level of NF (whether they support donations or not)
        // augFactions.sort((a, b) => ((b.reputation >= this.reputation ? 1 : 0) - (a.reputation >= this.reputation ? 1 : 0)) ||
        //    ((b.donationsUnlocked ? 1 : 0) - (a.donationsUnlocked ? 1 : 0)) || (b.reputation - a.reputation))[0]?.name;
        // TODO: #145 Is there a way to first buy NF from factions that already have enough rep, before switching to a different faction that supports donations?
```

New:

```js
        // The "Neuroflux" augmentation uses a different approach: take the next level from a faction that already has the rep (free), else from one
        // with donations unlocked, else the one with the most rep. (#145: managePurchaseableAugs re-picks the faction for every level it adds.)
        return (pickNeurofluxFaction(augFactions, this.reputation) ?? augFactions.sort((a, b) => b.reputation - a.reputation)[0])?.name;
```

(c) NF purchase loop. Old line 832:

```js
    const augNfFaction = factionData[augNf.getFromJoined()];
```

New:

```js
    let augNfFaction = factionData[augNf.getFromJoined()]; // Re-picked per level below: free rep first, then a donation faction (#145)
    const nfFactions = augNf.joinedFactionsWithAug();
```

Old lines 839-840:

```js
        const nextNfCost = augNf.price * (nfCountMult ** nfPurchased) * (augCountMult ** purchaseableAugs.length);
        const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
```

New:

```js
        const nextNfCost = augNf.price * (nfCountMult ** nfPurchased) * (augCountMult ** purchaseableAugs.length);
        const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
        // Source this level from a faction that already has the rep (free), else a donation-unlocked one; keep the previous pick if neither exists (the break below fires)
        augNfFaction = pickNeurofluxFaction(nfFactions, nextNfRep) ?? augNfFaction;
```

Old lines 858-863:

```js
        // Otherwise, add the next NF to our purchase order, and see if we can afford any more.
        // TODO: #145 Buy NF from different factions as we move from ones with enough rep to ones that support donation
        const nextNfPrice = augNf.price * (nfCountMult ** nfPurchased); // Note this should be the base price, before scaling for number of augs purchased
        const nfClone = new AugmentationData(augNf.name, nextNfRep, nextNfPrice, augNf.stats, augNf.prereqs); // { ...augNf };
        nfClone.displayName += ` Level ${nextNfLevel}`
        // Note, insert all NF purchases after the current NF purchase, in front of all augs cheaper than the first NF
```

New:

```js
        // Otherwise, add the next NF to our purchase order, and see if we can afford any more.
        const nextNfPrice = augNf.price * (nfCountMult ** nfPurchased); // Note this should be the base price, before scaling for number of augs purchased
        const nfClone = new AugmentationData(augNf.name, nextNfRep, nextNfPrice, augNf.stats, augNf.prereqs); // { ...augNf };
        nfClone.displayName += ` Level ${nextNfLevel}`
        const nfFactionName = augNfFaction.name; // Pin the faction this level is bought from (purchaseDesiredAugs / computeCosts use aug.getFromJoined())
        nfClone.getFromJoined = () => nfFactionName;
        // Note, insert all NF purchases after the current NF purchase, in front of all augs cheaper than the first NF
```

The per-faction donation accounting (`currentNfFactionDonation = purchaseFactionDonations[augNfFaction.name]`, line 841, and `purchaseFactionDonations[augNfFaction.name] = newDonationForRep`, line 866) already keys by the current `augNfFaction`, so no other change is needed; the break condition on line 848 (`nextNfRep > augNfFaction.reputation && !augNfFaction.donationsUnlocked`) now only fires when no joined faction can supply the level.

- [ ] **Step 6: Syntax, RAM and unit checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check faction-manager.js
node --check progression-rules.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs faction-manager.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs progression-rules.js
node --test
```
Expected: `+[] -[]`; `pass 140 fail 0`; `mem faction-manager.js` in game unchanged.

- [ ] **Step 7: In-game check (dry run, no `--purchase`)**

On a save that has joined at least one faction with rep above the next NF requirement and one donation-unlocked faction with less rep: `run faction-manager.js -v` and read the output. Expected: `Getting NF from faction <most-rep faction> (rep: ...)`, then the purchase-order rows `NeuroFlux Governor Level N` list that faction for the first levels and switch to the donation faction (`Faction: <other>`) exactly at the first level whose `Requires ... reputation` exceeds the first faction's rep; `Donate: {...}` only names the donation faction. Before the change every row named the donation faction.

- [ ] **Step 8: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add progression-rules.js test/progression-rules.test.js faction-manager.js
git commit -m "faction-manager: buy NeuroFlux levels from factions with free rep before donating (PR-6)"
```

---

### Task 7: PR-7 — autopilot: compute stock value once per loop and move slow-changing checks to the 10 s cadence

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js` lines 97-103 (globals), 251-263 (`mainLoop`), 275-285 (`updateCachedData`), 414-420 (`checkIfBnIsComplete`), 793-803 (`maybeDoCasino`), 858-860 and 951 (`maybeInstallAugmentations`), 1010-1025 (`shouldDelayInstall`).
- Test: none in Node; `node --check` + collide + in-game.

**Interfaces:** Changed signatures inside `autopilot.js` only: `maybeDoCasino(ns, player, stocksValue)`, `maybeInstallAugmentations(ns, player, stocksValue)`, `shouldDelayInstall(ns, player, facmanOutput, stocksValue)`. New globals `lastCachedDataUpdate`, `lastBladeburnerCheck`, `bladeburnerComplete`, `lastCasinoCheck`. Consumes `options['interval-check-scripts']` (default 10000).

- [ ] **Step 1: Add the globals**

After line 103 (`let lastScriptsCheck = 0; // Last time we got a listing of all running scripts`) add:

```js
    let lastCachedDataUpdate = 0; // Last time updateCachedData refreshed the installed-augs list (on the --interval-check-scripts cadence)
    let lastBladeburnerCheck = 0, bladeburnerComplete = false; // Bladeburner win-condition polling (on the --interval-check-scripts cadence)
    let lastCasinoCheck = 0; // Last time maybeDoCasino evaluated whether to run casino.js (on the --interval-check-scripts cadence)
```

- [ ] **Step 2: `mainLoop` - pass the single stock value**

Old lines 261-262:

```js
        await maybeDoCasino(ns, player);
        await maybeInstallAugmentations(ns, player);
```

New:

```js
        await maybeDoCasino(ns, player, stocksValue);
        await maybeInstallAugmentations(ns, player, stocksValue);
```

- [ ] **Step 3: `updateCachedData` - 10 s cadence**

Old lines 275-277:

```js
    async function updateCachedData(ns) {
        // Now that grafting is a thing, we need to check if new augmentations have been installed between resets
        if ((4 in unlockedSFs)) { // Note: Installed augmentations can also be obtained from getResetInfo() (without SF4), but this seems unintended and will probably be removed from the game.
```

New:

```js
    async function updateCachedData(ns) {
        // Installed augs only change on install / graft completion, so refresh on the --interval-check-scripts cadence rather than every 2 s loop
        if (lastCachedDataUpdate > Date.now() - options['interval-check-scripts']) return;
        lastCachedDataUpdate = Date.now();
        // Now that grafting is a thing, we need to check if new augmentations have been installed between resets
        if ((4 in unlockedSFs)) { // Note: Installed augmentations can also be obtained from getResetInfo() (without SF4), but this seems unintended and will probably be removed from the game.
```

- [ ] **Step 4: `checkIfBnIsComplete` - bladeburner polling on the cadence**

Old lines 413-420:

```js
        // Detect the BB win condition (requires SF7 (bladeburner API) or being in BN6)
        if (7 in unlockedSFs) // No point making this async check if bladeburner API is unavailable
            playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
        if (!bnComplete && playerInBladeburner)
            bnComplete = await getNsDataThroughFile(ns,
                `ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0`,
                '/Temp/bladeburner-completed.txt');
```

New:

```js
        // Detect the BB win condition (requires SF7 (bladeburner API) or being in BN6). Poll on the --interval-check-scripts cadence, not every 2 s loop.
        if (7 in unlockedSFs && !bladeburnerComplete && lastBladeburnerCheck <= Date.now() - options['interval-check-scripts']) {
            lastBladeburnerCheck = Date.now();
            playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
            if (playerInBladeburner)
                bladeburnerComplete = await getNsDataThroughFile(ns,
                    `ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0`,
                    '/Temp/bladeburner-completed.txt');
        }
        if (bladeburnerComplete) bnComplete = true;
```

- [ ] **Step 5: `maybeDoCasino` - cadence and shared stock value**

Old lines 793-803:

```js
    async function maybeDoCasino(ns, player) {
        if (ranCasino || options['disable-casino']) return;
        // Figure out whether we've already been kicked out of the casino for earning more than 10b there
        const moneySources = await getPlayerMoneySources(ns);
        const casinoEarnings = moneySources.sinceInstall.casino;
        if (casinoEarnings >= 1e10) {
            log(ns, `INFO: Skipping running casino.js, as we've previously earned ${formatMoney(casinoEarnings)} and been kicked out.`);
            return ranCasino = true;
        }
        // If we already have more than 1t money but hadn't run casino.js yet, don't bother. Another 10b won't move the needle much.
        const playerWealth = player.money + (await getStocksValue(ns));
```

New:

```js
    async function maybeDoCasino(ns, player, stocksValue) {
        if (ranCasino || options['disable-casino']) return;
        // Casino earnings and our income trend change slowly: evaluate on the --interval-check-scripts cadence rather than every 2 s loop
        if (lastCasinoCheck > Date.now() - options['interval-check-scripts']) return;
        lastCasinoCheck = Date.now();
        // Figure out whether we've already been kicked out of the casino for earning more than 10b there
        const moneySources = await getPlayerMoneySources(ns);
        const casinoEarnings = moneySources.sinceInstall.casino;
        if (casinoEarnings >= 1e10) {
            log(ns, `INFO: Skipping running casino.js, as we've previously earned ${formatMoney(casinoEarnings)} and been kicked out.`);
            return ranCasino = true;
        }
        // If we already have more than 1t money but hadn't run casino.js yet, don't bother. Another 10b won't move the needle much.
        const playerWealth = player.money + stocksValue;
```

Also update the JSDoc above it (line 790-792) to `@param {number} stocksValue Current value of all stock positions (computed once per main loop)`.

- [ ] **Step 6: `maybeInstallAugmentations` / `shouldDelayInstall` - shared stock value**

Old line 858 (`async function maybeInstallAugmentations(ns, player) {`) → `async function maybeInstallAugmentations(ns, player, stocksValue) {` (add `@param {number} stocksValue` to its JSDoc).
Old line 951:

```js
        if (await shouldDelayInstall(ns, player, facman)) // If we're currently in a state where we should not be resetting, skip reset logic
```

New:

```js
        if (await shouldDelayInstall(ns, player, facman, stocksValue)) // If we're currently in a state where we should not be resetting, skip reset logic
```

Old line 1017 (`async function shouldDelayInstall(ns, player, facmanOutput) {`) → `async function shouldDelayInstall(ns, player, facmanOutput, stocksValue) {` (add `@param {number} stocksValue` to its JSDoc, line 1016).
Old line 1025:

```js
            const totalWorth = player.money + await getStocksValue(ns);
```

New:

```js
            const totalWorth = player.money + stocksValue;
```

Result per 2 s loop: `getPlayer` + `getStocksValue` (4) = 5 temp scripts steady state (was 7-14); the augs / bladeburner / casino checks now run every 10 s; the pending-install path still runs `getCurrentWork` and the 4S checks (2-3 scripts) but no longer a third `getStocksValue`.

- [ ] **Step 7: Syntax and RAM checks**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check autopilot.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs autopilot.js
node --test
```
Expected: silent; `autopilot.js: +[] -[]`; all tests pass. Also `grep -n "getStocksValue(ns)" autopilot.js` must list exactly one call (line 255).

- [ ] **Step 8: In-game check**

`run autopilot.js` on the test save, `tail autopilot.js`: no `ERROR`/`ReferenceError` lines over 2 minutes; the casino decision line (`Waiting a minute to establish player income ...` or `Skipping running casino.js ...`) still appears within 10 s of start; the status line still updates. Open the Active Scripts page: the `/Temp/*.js` churn per 2 s should be visibly lower than before (5 short-lived scripts instead of 7-14).

- [ ] **Step 9: Commit**

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
git add autopilot.js
git commit -m "autopilot: compute stock value once per loop and poll augs/bladeburner/casino on the 10 s cadence (PR-7)"
```

---

### Task 8: PR-obs — three low observations (NaN method sort, install-countdown overwrite, stale comment)

**Files:**
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/faction-manager.js` lines 449 and 993.
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/autopilot.js` lines 929-939, 958, 969, 981 (in `maybeInstallAugmentations`; line numbers as at HEAD - after Task 7 they are +3).
- Modify: `/home/jubnl/dev/bitburner/bitburner-scripts/work-for-factions.js` line 106.
- Test: none (display / logging only); `node --check` + collide.

**Interfaces:** none.

- [ ] **Step 1: `faction-manager.js` - call the methods**

Old line 449:

```js
        this.getFromAny = factionNames.map(f => factionData[f]).sort((a, b) => a.mostExpensiveAugCost - b.mostExpensiveAugCost)
```

New:

```js
        this.getFromAny = factionNames.map(f => factionData[f]).sort((a, b) => a.mostExpensiveAugCost() - b.mostExpensiveAugCost())
```

Old line 993:

```js
        let sort4 = a.mostExpensiveAugCost().length - b.mostExpensiveAugCost().length; // If tied, "soonest to unlock", estimated by their most expensive aug cost
```

New:

```js
        let sort4 = a.mostExpensiveAugCost() - b.mostExpensiveAugCost(); // If tied, "soonest to unlock", estimated by their most expensive aug cost
```

Checks and commit:

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check faction-manager.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs faction-manager.js
node --test
git add faction-manager.js
git commit -m "faction-manager: compare mostExpensiveAugCost() values instead of the method objects (PR-obs)"
```

- [ ] **Step 2: `autopilot.js` - do not overwrite `--install-countdown` for the rest of the process**

In `maybeInstallAugmentations`, insert immediately before the quick-install heuristic comment (`// Heuristic: if we can afford 4 or more augs in the first ~20 minutes ...`, line 929 at HEAD):

```js
        // Local copy of --install-countdown: the quick-install branch below shortens it for this evaluation only (not for the rest of the process)
        let installCountdownMs = options['install-countdown'];
```

Old lines 938-939:

```js
            if (options['install-countdown'] > 30 * 1000 && !playerInGang)
                options['install-countdown'] = 30 * 1000; // Install relatively quickly in this scenario (30s)
```

New:

```js
            if (installCountdownMs > 30 * 1000 && !playerInGang)
                installCountdownMs = 30 * 1000; // Install relatively quickly in this scenario (30s)
```

Old line 958: `installCountdown = Date.now() + options['install-countdown'];` → `installCountdown = Date.now() + installCountdownMs;`
Old line 969: `options['install-countdown'] * (1 - (installCountdownResets / augsNeededInclNf)));` → `installCountdownMs * (1 - (installCountdownResets / augsNeededInclNf)));`
Old line 981: `resetStatus += \`\n  Waiting for ${formatDuration(options['install-countdown'])} (--install-countdown) \` +` → `resetStatus += \`\n  Waiting for ${formatDuration(installCountdownMs)} (--install-countdown) \` +`

After the edit, `grep -n "options\['install-countdown'\]" autopilot.js` must list only the argsSchema line (13) and the new local-copy line.

Checks and commit:

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check autopilot.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs autopilot.js
node --test
git add autopilot.js
git commit -m "autopilot: keep the quick-install 30 s countdown local instead of overwriting --install-countdown (PR-obs)"
```

- [ ] **Step 3: `work-for-factions.js` - stale comment**

Old line 106:

```js
const waitForFactionInviteTime = 30 * 1000; // The game will only issue one new invite every 25 seconds, so if you earned two by travelling to one city, might have to wait a while
```

New:

```js
const waitForFactionInviteTime = 30 * 1000; // The game re-checks every faction's invite requirements every 10 cycles (2 s, src/engine.tsx), so this is just a generous upper bound
```

Checks and commit:

```
cd /home/jubnl/dev/bitburner/bitburner-scripts
node --check work-for-factions.js
node /home/jubnl/dev/bitburner/tools/harness/collide.mjs work-for-factions.js
node --test
git add work-for-factions.js
git commit -m "work-for-factions: fix the stale invite-timing comment (PR-obs)"
```

---

## Skipped

- **Finding 8 (rep-rate measurement assumes one game tick between samples) - marked *suspected* in the spec, not planned.** If it is later confirmed, the fix the spec suggests is to read `cyclesWorked` from `getCurrentWork()` before and after in `measureRepGainRate` (`work-for-factions.js:1056-1065`) and divide the rep delta by the cycle delta (x5 per second).

## Self-review

**Spec coverage (section 2, confirmed findings → tasks):**
| Finding | Status in spec | Task |
|---|---|---|
| 1 Silhouette CFO vs CTO | high, confirmed (corrected numbers: CFO 800e3 rep, cha 501+offset, hack 76+offset - re-verified in `CompanyPositionsMetadata.ts` business4 and `FactionJoinCondition.ts executiveEmployee`) | Task 1 (PR-1) |
| 2 `--install-for-augs` ignores queued augs | medium, confirmed | Task 2 (PR-2) |
| 3 city factions joined in invite order | medium, mechanics confirmed | Task 3 (PR-3), incl. `ascend.js` |
| 4 stat-grind crime choice | medium, confirmed | Task 4 (PR-4) - pure function + unit test as required |
| 5 invite grinding order (money / installed augs) | low, logic confirmed | Task 5 (PR-5) |
| 6 NeuroFlux sourcing | low, confirmed | Task 6 (PR-6) |
| 7 autopilot temp-script launches | low, confirmed | Task 7 (PR-7) |
| Other observations (NaN sort, countdown overwrite, stale comment) | not counted | Task 8 (PR-obs), three commits |
| 8 rep-rate sampling | suspected | Skipped (listed above) |

**Placeholder scan:** every step shows the exact old/new code or the full new function; no "TBD/TODO/similar to" steps. Line numbers are as at HEAD `7d13c98`; Tasks 3-8 note where earlier tasks shift them (Task 1 removes 16 lines from `work-for-factions.js` at 48-63 and adds one import line, so line numbers cited for Tasks 3-5 in that file are HEAD numbers - re-locate by the quoted old text). Task 8 Step 2 states its +3 shift after Task 7.

**Name/signature consistency:** `progression-rules.js` exports used across tasks: `jobs`, `executiveJobTitles`, `silhouetteExecutiveJob`, `SILHOUETTE_EXECUTIVE_REP`, `BACKDOOR_REP_MULT`, `pickSilhouetteCompany`, `jobTierRequirements` (Task 1); `cityFactions`, `filterCityFactionInvites` (Task 3, used by `work-for-factions.js` and `ascend.js`); `crimeStats`, `slowCrimes`, `crimeCombatExpRate`, `bestCombatExpCrime` (Task 4); `endgameInviteRequirements`, `endgameInviteBlocker` (Task 5); `pickNeurofluxFaction` (Task 6, used by `faction-manager.js`). The `work-for-factions.js` import line is extended cumulatively in Tasks 1, 3, 4, 5 (final form: `import { jobs, executiveJobTitles, silhouetteExecutiveJob, SILHOUETTE_EXECUTIVE_REP, BACKDOOR_REP_MULT, pickSilhouetteCompany, jobTierRequirements, cityFactions, filterCityFactionInvites, bestCombatExpCrime, endgameInviteBlocker } from './progression-rules.js'`). `earnExecutiveJob(ns, companyName, executiveJob, statModifier, backdoored)` is called with `companyConfig.executiveJob` = `silhouetteExecutiveJob` (`{track, tier}`) and `jobTierRequirements(track, tier, statModifier, backdoored)` matches. `getFactionWorkOrder(ns, player, verbose)` is defined and used only inside `work-for-factions.js`. autopilot's `maybeDoCasino / maybeInstallAugmentations / shouldDelayInstall` gain a trailing `stocksValue` parameter and their three call sites are updated in Task 7. None of the new identifiers (`jobs`, `crimeStats`, `timeMs`, `combatExp`, `reason`, `track`, `tier`, `augs`, `money`) is an NS function name, so collide stays `+[]`.
