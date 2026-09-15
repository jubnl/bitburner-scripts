// Pure decision helpers for sleeve.js. No ns dependency, so this file is unit-tested in Node (test/sleeve-logic.test.js).

// Powerhouse Gym (src/Locations/data/LocationsMetadata.ts: costMult 20, expMult 10) running a gym class (src/Work/ClassWork.tsx:
// money -120/s, 1 exp/s). A sleeve's class exp is scaled by shockBonus() = (100 - shock)/100 but the fee is not
// (src/PersonObjects/Sleeve/Work/SleeveClassWork.ts calculateRates: scaleWorkStats(..., sleeve.shockBonus(), false)).
export const gymCostPerSecond = 120 * 20;
export const gymExpPerSecond = 1 * 10;

/** @param {number} shock The sleeve's shock (0..100)
 * @returns {number} Dollars paid per point of exp at Powerhouse Gym (Infinity at shock 100, where exp is exactly 0) */
export function trainingCostPerExp(shock) {
    const shockBonus = (100 - shock) / 100;
    return shockBonus > 0 ? gymCostPerSecond / (gymExpPerSecond * shockBonus) : Infinity;
}

/** @param {number} shock
 * @param {number} maxCostPerExp The --train-max-cost-per-exp option
 * @returns {boolean} Whether paying for gym/university time is worth it at this shock level */
export function canAffordTraining(shock, maxCostPerExp) {
    const costPerExp = trainingCostPerExp(shock);
    return costPerExp !== Infinity && costPerExp <= maxCostPerExp;
}

/** Karma from sleeve crime is only awarded on a successful crime and is scaled by sync (src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts
 * process: `if (success) Player.karma -= crime.karma * sleeve.syncBonus()`), so the expected karma per attempt is chance x sync/100 x crime.karma.
 * @returns {number} Expected fraction (0..1) of the crime's karma earned per attempt */
export function karmaRatePerAttempt(successChance, sync) {
    return Math.min(1, Math.max(0, successChance)) * Math.min(100, Math.max(0, sync)) / 100;
}

/** @returns {boolean} Whether farming Homicide for gang karma is worth more than falling through to the sleeve's productive tasks */
export function shouldFillWithKarmaHomicide(successChance, sync, minRate) {
    return karmaRatePerAttempt(successChance, sync) >= minRate;
}

/** Default bladeburner task per sleeve index. Sleeve 0 may still be used for faction work (unless --disable-follow-player). Each contract type can
 * only be performed by one sleeve at a time (sleeves 1-3). Everyone else infiltrates: each infiltrating sleeve adds sqrt(n)/2 count per minute to
 * every contract and operation (src/Bladeburner/Bladeburner.ts sleeveSupport, SleeveInfiltrateWork.ts), i.e. several rank per minute of
 * Assassination / Stealth Retirement count, far more than a low-stat sleeve's own Field Analysis (0.1 rank per 30 s) or Diplomacy. Chaos-driven
 * Diplomacy is assigned separately (sleeve.js pickSleeveTask escalation by city chaos).
 * @param {boolean} enableTeamBuilding The --enable-bladeburner-team-building option
 * @returns {[string, string?][]} [action, contractName?] by sleeve index */
export function bladeburnerSleeveTasks(enableTeamBuilding) {
    return [
        /*0*/enableTeamBuilding ? ["Support main sleeve"] : ["Infiltrate Synthoids"],
        /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
        /*4*/["Infiltrate Synthoids"], /*5*/["Infiltrate Synthoids"], /*6*/["Infiltrate Synthoids"],
        /*7*/enableTeamBuilding ? ["Recruitment"] : ["Infiltrate Synthoids"],
    ];
}
