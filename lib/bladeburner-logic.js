// Pure decision helpers for bladeburner.js. No ns dependency, so this file is unit-tested in Node (test/bladeburner-logic.test.js).

/** Classify an estimated success-chance range against a threshold.
 * ns.bladeburner.getActionEstimatedSuccessChance returns [low, high] (src/Bladeburner/Actions/Action.ts getSuccessRange): the true chance lies
 * inside, and the two ends coincide only when the city's population estimate is exact (popEst == pop). Only the low end is guaranteed not to
 * exceed the true chance, so "go" requires it; "uncertain" means improving the population estimate could turn the range into a "go".
 * @param {[number, number]} range
 * @param {number} threshold
 * @returns {"go"|"uncertain"|"no"} */
export function chanceRangeVerdict(range, threshold) {
    const lo = Math.min(range[0], range[1]), hi = Math.max(range[0], range[1]);
    if (lo > threshold) return "go";
    if (hi > threshold) return "uncertain";
    return "no";
}
