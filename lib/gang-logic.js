// Pure decision helpers for gangs.js. No ns dependency, so this file is unit-tested in Node (test/gangs-logic.test.js).
// Stat names are only ever strings here (never bare identifiers or object-literal keys) because the game charges RAM for any identifier
// whose name equals an NS function ("hack").
export const gangStatKeys = ["hack", "str", "def", "dex", "agi", "cha"];

// Which stats each training task raises (src/Gang/data/tasks.ts: Train Combat str/def/dex/agi 25 each, Train Hacking hack 100, Train Charisma cha 100)
export const trainingTaskStats = { "Train Combat": ["str", "def", "dex", "agi"], "Train Hacking": ["hack"], "Train Charisma": ["cha"] };

/** @param {GangTaskStats} taskStats From ns.gang.getTaskStats (src/Gang/data/tasks.ts hackWeight..chaWeight)
 * @returns {{[stat: string]: number}} The share (0..1) of the task's statWeight carried by each stat
 * (src/Gang/formulas/formulas.ts: statWeight = sum over stats of weight/100 * stat) */
export function taskStatWeights(taskStats) {
    return Object.fromEntries(gangStatKeys.map(s => [s, (taskStats?.[`${s}Weight`] ?? 0) / 100]));
}

/** @param {EquipmentStats} equipStats From ns.gang.getEquipmentStats: per-stat multipliers (absent = 1)
 * @param {{[stat: string]: number}} weights From taskStatWeights
 * @returns {number} Fractional increase of the task's statWeight this equipment gives a member with equal stats
 * (an upgrade multiplies exactly the stats it lists: src/Gang/GangMember.ts applyUpgrade) */
export function equipmentScore(equipStats, weights) {
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * ((equipStats?.[s] ?? 1) - 1), 0);
}

/** Order purchase candidates best value first: score per dollar descending; zero-score items last, cheapest first. Does not mutate the input.
 * @template T
 * @param {(T & {score: number, cost: number})[]} candidates
 * @returns {(T & {score: number, cost: number})[]} */
export function rankEquipment(candidates) {
    return candidates.slice().sort((a, b) => (b.score / b.cost) - (a.score / a.cost) || a.cost - b.cost);
}

/** @param {GangMemberInfo} memberInfo From ns.gang.getMemberInformation
 * @param {{[stat: string]: number}} weights
 * @param {boolean} stripEquipment Divide each stat by its equipment multiplier (`${stat}_mult`), which ascension resets to 1
 * @returns {number} sum over stats of weight * stat */
export function weightedStat(memberInfo, weights, stripEquipment = false) {
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * memberInfo[s] / (stripEquipment ? (memberInfo[`${s}_mult`] || 1) : 1), 0);
}

/** @param {GangMemberAscension} ascResult From ns.gang.getAscensionResult: per-stat newMult/oldMult
 * @param {GangMemberInfo} memberInfo
 * @param {{[stat: string]: number}} weights
 * @returns {number} The factor by which the member's weighted statWeight for the task grows once its exp is recovered */
export function weightedAscensionGain(ascResult, memberInfo, weights) {
    const before = weightedStat(memberInfo, weights);
    if (!(before > 0)) return Math.max(...gangStatKeys.map(s => ascResult[s] ?? 1));
    return gangStatKeys.reduce((sum, s) => sum + (weights[s] ?? 0) * memberInfo[s] * (ascResult[s] ?? 1), 0) / before;
}

/** Pick the crime whose stat weights should steer a decision, given a pool of members to consider.
 * A single-member `memberNames` list ("that member's own task, else fallback") and the full roster ("gang consensus,
 * else fallback") are both just calls to this one function, so gangs.js's `referenceTaskFor` is a thin wrapper over it.
 * @param {{[gangMember: string]: string}} assignedTasks Current activity per member name (a crime name, a training task, or "Unassigned")
 * @param {string[]} memberNames Members to consider, in priority order
 * @param {string[]} crimes Task names that count as "crime" work (as opposed to training)
 * @param {*} fallback Returned when none of memberNames is currently assigned a crime
 * @returns {string|*} The most common crime among memberNames' assigned tasks; ties are broken deterministically by
 * first occurrence in memberNames order (counts are accumulated into an object keyed by crime name, in the order each
 * crime is first seen while scanning memberNames; Array.prototype.sort is stable, so among equal counts the
 * earlier-first-seen crime sorts first) */
export function referenceTask(assignedTasks, memberNames, crimes, fallback) {
    const counts = {};
    for (const m of memberNames)
        if (crimes.includes(assignedTasks[m])) counts[assignedTasks[m]] = (counts[assignedTasks[m]] || 0) + 1;
    const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return mostCommon ? mostCommon[0] : fallback;
}

/** Choose a training task by the share of the task's weight each one raises.
 * @param {{[stat: string]: number}} weights
 * @param {number|null} roll A number in [0, 1) for a weighted random pick, or null for the deterministic best
 * @returns {string} "Train Combat" | "Train Hacking" | "Train Charisma" */
export function pickTrainingTask(weights, roll = null) {
    const masses = Object.entries(trainingTaskStats).map(([taskName, stats]) => [taskName, stats.reduce((sum, s) => sum + (weights[s] ?? 0), 0)]);
    const total = masses.reduce((sum, [, mass]) => sum + mass, 0);
    if (roll === null || !(total > 0)) return masses.reduce((best, cur) => cur[1] > best[1] ? cur : best)[0];
    let acc = 0;
    for (const [taskName, mass] of masses) {
        acc += mass / total;
        if (roll < acc) return taskName;
    }
    return masses[masses.length - 1][0];
}

/** ns.gang.nextUpdate() only reports updates that resolve while a promise is pending (src/Gang/Gang.ts process: the resolver is created on demand),
 * so updates that pass while the script is busy must be estimated: one update of `cyclesPerUpdate` cycles every cyclesPerUpdate * 200 ms.
 * @returns {number} Gang cycles processed during `elapsedMs` with no pending nextUpdate() */
export function missedGangCycles(elapsedMs, cyclesPerUpdate) {
    return cyclesPerUpdate * Math.floor(elapsedMs / (cyclesPerUpdate * 200));
}

/** @param {number|null} cyclesSinceTick Cycles counted since the last observed territory tick (null = no tick observed yet)
 * @param {number} cyclesPerUpdate 10 in normal play, 25 in bonus time
 * @param {number} cyclesPerTick src/Gang/data/Constants.ts CyclesPerTerritoryAndPowerUpdate
 * @returns {boolean} Whether the NEXT gang update will include the territory tick (Gang.ts processTerritoryAndPowerGains) */
export function nextUpdateHasTerritoryTick(cyclesSinceTick, cyclesPerUpdate, cyclesPerTick = 100) {
    return cyclesSinceTick != null && cyclesSinceTick + cyclesPerUpdate >= cyclesPerTick;
}

/** @param {number} preWeightedStat The member's task-weighted, equipment-stripped stat before the ascension (weightedStat(..., true))
 * @param {{[stat: string]: number}} weights The task weights `preWeightedStat` was computed with. Pinned into the returned object so that
 * needsRetraining always re-measures against these same weights later, rather than a freshly-looked-up memberWeights() - which, while a member
 * is on a training task (not a crime), falls back to the gang's consensus reference task and can drift mid-retrain.
 * @param {number} recoveryFraction The --retrain-recovery-fraction option
 * @returns {{target: number, weights: {[stat: string]: number}}|null} The retrain target (with the weights it was computed from), or null for no gate */
export function retrainTargetFor(preWeightedStat, weights, recoveryFraction) {
    return preWeightedStat > 0 && recoveryFraction > 0 ? { target: preWeightedStat * recoveryFraction, weights } : null;
}

/** @param {GangMemberInfo} memberInfo Current member info
 * @param {{target: number, weights: {[stat: string]: number}}|null} retrainTarget From retrainTargetFor; always re-measured with its own
 * pinned `weights`, never a weight vector supplied by the caller, so the yardstick can't drift out of step with the target
 * @returns {boolean} Whether the member must keep training to reach its retrain target */
export function needsRetraining(memberInfo, retrainTarget) {
    return retrainTarget != null && weightedStat(memberInfo, retrainTarget.weights, true) < retrainTarget.target;
}
