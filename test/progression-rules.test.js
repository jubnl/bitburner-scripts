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
