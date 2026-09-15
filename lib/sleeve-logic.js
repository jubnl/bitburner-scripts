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
