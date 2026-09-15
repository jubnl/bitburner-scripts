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

/** Field Analysis improves the current city's population estimate by this percent per 30 s action
 * (src/Bladeburner/Bladeburner.ts completeAction, FieldAnalysis: eff = 0.04*hack^0.3 + 0.04*int^0.9 + 0.02*cha^0.3, x mults.bladeburner_analysis)
 * @param {number} hackingLevel @param {number} intelligence @param {number} charisma @param {number} analysisMult player.mults.bladeburner_analysis */
export function fieldAnalysisEffect(hackingLevel, intelligence, charisma, analysisMult = 1) {
    return (0.04 * Math.pow(hackingLevel, 0.3) + 0.04 * Math.pow(intelligence, 0.9) + 0.02 * Math.pow(charisma, 0.3)) * analysisMult;
}

/** Rank estimate-improving actions by expected improvement per second (pctPerSuccess x chance / time). Actions with no count left are dropped;
 * ties keep the input order, so list the rank-earning operations first.
 * @param {{name: string, pctPerSuccess: number, chance: number, timeMs: number, count: number}[]} candidates
 * @returns {string[]} Action names, best first */
export function rankPopulationActions(candidates) {
    return candidates
        .map((c, i) => ({ i, name: c.name, rate: c.count > 0 && c.timeMs > 0 ? c.pctPerSuccess * Math.min(1, Math.max(0, c.chance)) / c.timeMs : -1 }))
        .filter(c => c.rate >= 0)
        .sort((a, b) => b.rate - a.rate || a.i - b.i)
        .map(c => c.name);
}

/** Chaos above the threshold multiplies action difficulty (src/Bladeburner/Actions/Action.ts getChaosSuccessFactor: sqrt(1 + chaos - 50)) */
export function chaosDifficultyMult(chaos, chaosThreshold = 50) {
    return chaos > chaosThreshold ? Math.sqrt(1 + chaos - chaosThreshold) : 1;
}

/** Diplomacy lowers the current city's chaos by this percent per 60 s action (Bladeburner.ts getDiplomacyPercentage: cha^0.045 + cha/1000) */
export function diplomacyPctPerMinute(charisma) {
    return Math.pow(charisma, 0.045) + charisma / 1000;
}

/** Minutes of Diplomacy needed to bring chaos down to target (each action: chaos *= 1 - pct/100, City.ts changeChaosByPercentage) */
export function diplomacyMinutesTo(chaos, target, charisma) {
    if (chaos <= target) return 0;
    return Math.log(chaos / target) / -Math.log(1 - diplomacyPctPerMinute(charisma) / 100);
}

/** Run Diplomacy when it pays for itself: the time it takes to get back under the threshold is less than the rank-time the penalty would waste
 * over the expected stay. With chance divided by mult, the level model (bladeburner.js getTargetLevel) loses at least the fraction 1 - 1/mult of
 * the rank rate (the real loss is larger: levels drop by log(mult)/log(difficultyFac) and reward with them), so this is a conservative test. */
export function shouldRunDiplomacy(chaos, chaosThreshold, charisma, expectedStayMinutes) {
    if (chaos <= chaosThreshold) return false;
    const lostFraction = 1 - 1 / chaosDifficultyMult(chaos, chaosThreshold);
    return diplomacyMinutesTo(chaos, chaosThreshold, charisma) < expectedStayMinutes * lostFraction;
}

/** How many levels of the chosen skill to buy at once. The cost of the next level grows linearly (src/Bladeburner/Skill.ts calculateCost:
 * baseCost + costInc * level, times the BitNode multiplier), so the per-level increment is recovered from the API cost of one and of two levels.
 * Keep buying while the next level's perceived cost (x adjustment) is still no worse than the best other skill's perceived cost, and it is affordable.
 * @param {number} costForOne ns.bladeburner.getSkillUpgradeCost(name, 1)
 * @param {number} costForTwo ns.bladeburner.getSkillUpgradeCost(name, 2)
 * @param {number} adjustment The skill's costAdjustments factor
 * @param {number} nextBestPerceivedCost The lowest perceived cost among the other skills (Infinity if none)
 * @param {number} unspent Skill points available
 * @param {number} maxCount Levels left before the skill's max level
 * @returns {number} Levels to buy (0 = none) */
export function planSkillUpgradeCount(costForOne, costForTwo, adjustment, nextBestPerceivedCost, unspent, maxCount = Infinity) {
    if (!(costForOne > 0) || costForOne > unspent) return 0;
    const increment = Math.max(0, costForTwo - 2 * costForOne);
    let count = 1, total = costForOne;
    while (count < maxCount) {
        const marginal = costForOne + count * increment;
        if (marginal * adjustment > nextBestPerceivedCost || total + marginal > unspent) break;
        total += marginal;
        count++;
    }
    return count;
}
