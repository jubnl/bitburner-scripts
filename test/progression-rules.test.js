// Unit tests for progression-rules.js (pure decision rules used by work-for-factions.js / faction-manager.js / ascend.js).
// The table tests parse the game source (v3.0.1) so a game update that changes a requirement fails here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    jobs, executiveJobTitles, silhouetteExecutiveJob, SILHOUETTE_EXECUTIVE_REP, BACKDOOR_REP_MULT,
    pickSilhouetteCompany, jobTierRequirements, cityFactions, filterCityFactionInvites,
    crimeStats, slowCrimes, crimeCombatExpRate, bestCombatExpCrime,
    endgameInviteRequirements, endgameInviteBlocker,
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
    assert.deepEqual(jobTierRequirements("Business", 4, 0, false), { rep: 800e3, hacking: 300, cha: 725 });
    assert.deepEqual(jobTierRequirements("Business", 4, 25, true), { rep: 600e3, hacking: 325, cha: 750 });
    assert.deepEqual(jobTierRequirements("Software", 0, 25, false), { rep: 0, hacking: 250, cha: 0 }); // 0 = no requirement, offset not added
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
