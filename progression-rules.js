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
 *  Note: the hacking field is named `hacking`, not `hack` — `hack` collides with the NS function name and would be RAM-charged
 *  wherever a caller writes `req.hack` (the game's RAM walker charges any property access matching an NS function name).
 * @returns {{rep: number, hacking: number, cha: number}} */
export function jobTierRequirements(trackName, tier, statModifier = 0, backdoored = false) {
    const job = jobs.find(j => j.name == trackName);
    const withOffset = v => v === 0 ? 0 : v + statModifier; // A 0 requirement stays 0 (the game has no requirement at all)
    return { rep: job.reqRep[tier] * (backdoored ? BACKDOOR_REP_MULT : 1), hacking: withOffset(job.reqHck[tier]), cha: withOffset(job.reqCha[tier]) };
}
