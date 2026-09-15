import { log, disableLogs, getConfiguration, instanceCount, getNsDataThroughFile, runCommand, getFilePath, getActiveSourceFiles, formatNumberShort, formatDuration } from './helpers.js'
import { chanceRangeVerdict, fieldAnalysisEffect, rankPopulationActions, chaosDifficultyMult, diplomacyMinutesTo, shouldRunDiplomacy, planSkillUpgradeCount } from './lib/bladeburner-logic.js'

const cityNames = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
const antiChaosOperation = "Stealth Retirement Operation"; // Note: Faster and more effective than Diplomacy at reducing city chaos
const simulacrumAugName = "The Blade's Simulacrum"; // This augmentation lets you do bladeburner actions while busy

// In general, we will buy the skill upgrade with the next highest cost, but to tweak the priority of various skills,
// we use the following configuration to change their relative cost. Higher number means lower priority
// Note: Ideally we could emphasize Tracer "early-game" and Digital Observer "late-game", but this is too much of a pain to solve for
// Skill effects and cost slopes are from src/Bladeburner/data/Skills.ts (cost = baseCost + costInc * level, roughly)
const costAdjustments = {
    "Overclock": 0.8, // -1% action time per level (max 90). Speed up contracts/operations. More important now that sleeves remove the operation count bottleneck
    "Cyber's Edge": 1.5, // +2% max stamina per level. baseCost 1 but costInc 3 (steepest slope), so it's cheap early and self-limiting later. Stamina drives the success penalty, so worth some points.
    "Evasive Systems": 1.2, // +4% effective Dex/Agi per level (Action.ts: stats enter competence as stat^0.9, and Dex/Agi also reduce action time)
    "Reaper": 2, // +2% effective Str/Def/Dex/Agi per level. Stats enter competence as stat^0.9 (~1.8%/level) vs Blade's Intuition's flat +3%/level, so it's a weaker buy at equal cost
    "Cloak": 1.5, // Cheap, and stealth ends up with plenty of boost, so we don't need to invest in Cloak as much.
    "Hyperdrive": 2, // Improves stats gained, but not Rank gained. Less useful if training outside of BB
    "Tracer": 2, // Only boosts Contract success chance, which are relatively easy to begin with.
    "Datamancer": 5, // +5% population-estimate accuracy per level only. It has the lowest cost slope of all skills (costInc 1), so left unadjusted it would absorb most SP.
    "Hands of Midas": 10 // Improves money gain. It is assumed that Bladeburner will *not* be a main source of income
};

// Action level tuning: difficulty(L) = baseDifficulty * difficultyFac^(L-1) (src/Bladeburner/Actions/LevelableAction.ts getDifficulty) and
// success chance = min(1, competence / difficulty) (src/Bladeburner/Actions/Action.ts getSuccessChance), so while below 100%:
//   chance(L) = chance(L0) * difficultyFac^(L0 - L)
// Per-action factors from src/Bladeburner/data/Contracts.ts and Operations.ts:
const difficultyFacByAction = {
    "Tracking": 1.02, "Bounty Hunter": 1.04, "Retirement": 1.03,
    "Investigation": 1.03, "Undercover Operation": 1.04, "Sting Operation": 1.04, "Raid": 1.045, "Stealth Retirement Operation": 1.05, "Assassination": 1.06,
};

// Some bladeburner info gathered at startup and cached
let skillNames, generalActionNames, contractNames, operationNames, remainingBlackOpsNames, blackOpsRanks; // blackOpsRanks is fetched once at startup (gatherBladeburnerInfo)
let cachedMaxLevels = {}, maxLevelsRank = -1; // Action max levels only rise on a success (Bladeburner.ts completeAction), which also changes rank: refetched when rank changes
let inFaction, haveSimulacrum, lastBlackOpComplete, lowStaminaTriggered, timesTrained, currentTaskEndTime, maxRankNeeded, lastAssignedTask;
let ownedSourceFiles;
let player = (/**@returns{Player}*/() => undefined)();
let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // Information about the current bitnode
let options;

const argsSchema = [
    // Since v3.0.0 action difficulty is no longer randomized, and since v3.0.1 failing an action no longer costs faction rep (changelog.md),
    // so a 90% success chance is a reasonable default (failures still cost rank and HP).
    ['success-threshold', 0.9], // Attempt the best contract/operation whose minimum chance of success exceeds this threshold (its level is tuned to meet it)
    ['blackop-success-threshold', 0.99], // Black ops are attempted only when the LOW end of their estimated chance range exceeds this (failure costs 10-20k rank, HP and a team member)
    ['disable-action-leveling', false], // By default, contract/operation levels are set to the highest level whose estimated success chance meets --success-threshold
    ['chaos-recovery-threshold', 50], // Prefer to do "Stealth Retirement" operations to reduce chaos when it reaches this number
    ['max-chaos', 100], // If chaos exceeds this amount in every city, we will reluctantly resort to diplomacy to reduce it.
    ['chaos-diplomacy-horizon-minutes', 60], // When every city is above --chaos-recovery-threshold and no Stealth Retirement is available, run Diplomacy if it pays for itself over this expected stay (lib/bladeburner-logic.js shouldRunDiplomacy)
    ['max-chaos-for-incite', 15], // Only "Incite Violence" (to generate more contracts/operations) while chaos in every city is below this
    ['toast-upgrades', false], // Set to true to toast each time a skill is upgraded
    ['toast-operations', false], // Set to true to toast each time we switch operations
    ['toast-relocations', false], // Set to true to toast each time we change cities
    ['low-stamina-pct', 0.5], // Switch to no-stamina actions when we drop below this stamina percent
    ['high-stamina-pct', 0.6], // Switch back to stamina-consuming actions when we rise above this stamina percent
    ['training-limit', 50], // Don't bother training more than this many times, since Training is slow and earns no rank
    ['update-interval', 2000], // How often to refresh bladeburner status
    ['ignore-busy-status', false], // If set to true, we will attempt to do bladeburner tasks even if we are currently busy and don't have The Blade's Simulacrum
    ['allow-raiding-highest-pop-city', false], // Set to true, we will allow Raid to be used even in our highest-population city (disabled by default)
    ['reserved-action-count', 200], // Some operation types are "reserved" for chaos reduction / population estimate increase. Start by reserving this many, reduced automatically as we approach maxRankNeeded
    ['disable-spending-hashes', false], // Set to true to not spawn spend-hacknet-hashes.js to spend hashes on bladeburner
];
export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ['sleep'])
    player = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    // Ensure we have access to bladeburner
    ownedSourceFiles = await getActiveSourceFiles(ns);
    //if (!(6 in ownedSourceFiles) && resetInfo.currentNode != 7) // NOTE: Despite the SF6 description, it seems you don't need SF6
    //    return log(ns, "ERROR: You have not yet unlocked bladeburner outside of BNs 6 & 7 (need SF6)", true, 'error');
    if (!(7 in ownedSourceFiles))
        return log(ns, "ERROR: You have not yet unlocked the bladeburner API (need SF7 or to be in BN7)", true, 'error');
    if (resetInfo.currentNode == 8)
        return log(ns, "ERROR: Bladeburner is completely disabled in Bitnode 8 :`(\nHappy stonking", true, 'error');
    // Ensure we've joined bladeburners before proceeding further
    await beingInBladeburner(ns);
    // Gather one-time info such as contract and operation names
    await gatherBladeburnerInfo(ns);
    // Start the main loop which monitors stats and changes activities as needed
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `WARNING: bladeburner.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        const nextTaskComplete = currentTaskEndTime - Date.now();
        await ns.sleep(Math.min(options['update-interval'], nextTaskComplete > 0 ? nextTaskComplete : Number.MAX_VALUE));
        // Re-read state right after the next bladeburner tick (1 s, faster in bonus time) rather than mid-tick. 0 GB (RamCostGenerator.ts CycleTiming).
        try { await ns.bladeburner.nextUpdate(); } catch { /* Not in bladeburner (yet); mainLoop reports it */ }
    }
}

// Calculate how long we've been in the current bitnode
function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

// Ram dodging helper to execute a parameterless bladeburner function
const getBBInfo = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(ns, `ns.bladeburner.${strFunction}`, null, args);
// Ram-dodging helper to get information for each item in a list (bit hacky). Temp script will be created such that
// the first argument recieved is an array of values to map, and any additional arguments are appended afterwards.
// The strFunction should contain a '%' sign indicating where the elements from the list should be mapped to a single call.
const getBBDict = async (ns, strFunction, elements, ...args) => await getNsDataThroughFile(ns,
    `Object.fromEntries(JSON.parse(ns.args[0]).map(e => [e, ns.bladeburner.${strFunction.replace('%', 'e')}]))`,
    `/Temp/bladeburner-${strFunction.split('(')[0]}-all.txt`, [JSON.stringify(elements), ...args]);
// Helper for dual-parameter bladeburner functions e.g. getActionCountRemaining(actionType, action)
const getBBDictByActionType = async (ns, strFunction, actionType, elements) =>
    await getBBDict(ns, `${strFunction}(ns.args[1], %)`, elements, actionType);

/** @param {NS} ns
 * Refresh the cached player object (used for Field Analysis effectiveness and Diplomacy rate, which depend on current skills) */
async function refreshPlayer(ns) { return player = await getNsDataThroughFile(ns, 'ns.getPlayer()'); }

/** @param {NS} ns
 * Gather all one-time bladeburner info using ram-dodging scripts. */
async function gatherBladeburnerInfo(ns) {
    skillNames = await getBBInfo(ns, 'getSkillNames()');
    generalActionNames = await getBBInfo(ns, 'getGeneralActionNames()');
    contractNames = (await getBBInfo(ns, 'getContractNames()')).reverse(); // Reversed to put in order of highest rep to lowest
    operationNames = (await getBBInfo(ns, 'getOperationNames()')).reverse(); // Reversed to put in order of highest rep to lowest
    // Blackops data is a bit special, each can be completed one time, they should be done in order
    const blackOpsNames = await getBBInfo(ns, 'getBlackOpNames()');
    blackOpsRanks = await getBBDict(ns, 'getBlackOpRank(%)', blackOpsNames);
    const blackOpsToBeDone = await getBBDictByActionType(ns, 'getActionCountRemaining', "Black Operations", blackOpsNames);
    remainingBlackOpsNames = blackOpsNames.filter(n => blackOpsToBeDone[n] === 1)
        .sort((b1, b2) => blackOpsRanks[b1] - blackOpsRanks[b2]);
    log(ns, `There are ${remainingBlackOpsNames.length} remaining BlackOps operations to complete in order:\n` +
        remainingBlackOpsNames.map(n => `${n} (${blackOpsRanks[n]})`).join(", "));
    maxRankNeeded = blackOpsRanks[remainingBlackOpsNames[remainingBlackOpsNames.length - 1]];
    // Check if we have the aug that lets us do bladeburner while otherwise busy
    haveSimulacrum = !(4 in ownedSourceFiles) ? true : // If player doesn't have SF4, we cannot check, so hope for the best.
        await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations().includes("${simulacrumAugName}")`, '/Temp/bladeburner-hasSimulacrum.txt');
    // Initialize some flags that may change over time
    lastAssignedTask = null;
    lastBlackOpComplete = false; // Flag will track whether we've notified the user that the last black-op is ready
    lowStaminaTriggered = false; // Flag will track whether we've previously switched to stamina recovery to reduce noise
    timesTrained = 0; // Count of how many times we've trained (capped at --training-limit)
    currentTaskEndTime = 0; // When set to a date, we will not assign new tasks until that date.
    inFaction = player.factions.includes("Bladeburners"); // Whether we've joined the Bladeburner faction yet
}

// Helpers to determine the the dict keys with the lowest/highest value (returns an array [key, minValue] for destructuring)
const getMinKeyValue = (dict, filteredKeys = null) => (filteredKeys || Object.keys(dict)).reduce(([k, min], key) =>
    dict[key] < min ? [key, dict[key]] : [k, min], [null, Number.MAX_VALUE]);
const getMaxKeyValue = (dict, filteredKeys = null) => (filteredKeys || Object.keys(dict)).reduce(([k, max], key) =>
    dict[key] > max ? [key, dict[key]] : [k, max], [null, -Number.MAX_VALUE]);

/** @param {NS} ns
 * The main loop that decides what we should be doing in bladeburner. */
async function mainLoop(ns) {
    // Get player's updated rank
    const rank = await getBBInfo(ns, 'getRank()');
    // Ensure we're in the bladeburner faction ASAP
    if (!inFaction) await tryJoinFaction(ns, rank);
    // Spend any un-spent skill points
    await spendSkillPoints(ns);
    // See if we are able to do bladeburner work
    if (!(await canDoBladeburnerWork(ns))) return;

    // NEXT STEP: Gather data needed to determine what and where to work
    // If any blackops have been completed, remove them from the list of remaining blackops
    const blackOpsToBeDone = await getBBDictByActionType(ns, 'getActionCountRemaining', "Black Operations", remainingBlackOpsNames);
    remainingBlackOpsNames = remainingBlackOpsNames.filter(n => blackOpsToBeDone[n] === 1);
    const nextBlackOp = remainingBlackOpsNames.length === 0 ? null : remainingBlackOpsNames[0];
    // If we have completed the last bladeburner operation notify the user that they can leave the BN
    if (nextBlackOp == null && !lastBlackOpComplete) {
        const msg = `Bladeburner has completed the last BlackOp! (At ${formatDuration(getTimeInBitnode())}). ` +
            `You can destroy the Bitnode on the Bladeburner > BlackOps tab.`;
        log(ns, `SUCCESS: ${msg}`, true, 'success');
        ns.alert(msg);
        lastBlackOpComplete = true;
    }

    // Gather the count of available contracts / operations
    const contractCounts = await getBBDictByActionType(ns, 'getActionCountRemaining', "Contracts", contractNames);
    const operationCounts = await getBBDictByActionType(ns, 'getActionCountRemaining', "Operations", operationNames);
    // Define a helper that gets the count for an action based only on the name (type is auto-determined)
    const getCount = actionName => contractNames.includes(actionName) ? contractCounts[actionName] :
        operationNames.includes(actionName) ? operationCounts[actionName] :
            generalActionNames.includes(actionName) ? Number.POSITIVE_INFINITY :
                remainingBlackOpsNames.includes(actionName) ? 1 : 0;
    // Create some quick-reference collections of action names that are limited in count and/or reserved for special purpose
    const limitedActions = operationNames.concat(contractNames);
    if (nextBlackOp) limitedActions.unshift(nextBlackOp);
    // Actions that improve the population estimate by a percentage (Bladeburner.ts: Undercover 0.8 %, Investigation 0.4 % per success). Tracking
    // only moves it by 100-1000 people (improvePopulationEstimateByCount) on a ~1e9 population and is useless for this. Field Analysis is added
    // in the uncertain branch below since it is a general action (never reserved, unlimited count).
    const populationActions = ["Undercover Operation", "Investigation"];
    const reservedActions = ["Raid", "Stealth Retirement Operation"].concat(populationActions
        // Only reserve these actions if their count is below the configured reserve amount, scaled down as we approach our final rank (stop reserving at 99% of max rank)
        .filter(a => getCount(a) <= (options['reserved-action-count'] * (1 - rank / (0.99 * maxRankNeeded)))));
    if (nextBlackOp && rank < blackOpsRanks[nextBlackOp]) reservedActions.push(nextBlackOp); // Remove blackop from "available actions" if we have insufficient rank.
    const unreservedActions = limitedActions.filter(o => !reservedActions.includes(o));
    //log(ns, 'Unreserved Action Counts: ' + unreservedActions.map(a => `${a}: ${getCount(a)}`).join(", ")); // Debug log to see what unreserved actions remain
    //log(ns, 'Reserved Action Counts: ' + reservedActions.map(a => `${a}: ${getCount(a)}`).join(", ")); // Debug log to see what unreserved actions remain

    // NEXT STEP: Determine which city to work in
    // Get the population, communities, and chaos in each city
    const populationByCity = await getBBDict(ns, 'getCityEstimatedPopulation(%)', cityNames);
    const communitiesByCity = await getBBDict(ns, 'getCityCommunities(%)', cityNames);
    const chaosByCity = await getBBDict(ns, 'getCityChaos(%)', cityNames);
    let goToCity, population, travelReason, goingRaiding = false;

    // SPECIAL CASE: GO TO LOWEST-POPULATION CITY
    // If the only operations left to us are "Raid" (reduces population by a %, which, counter-intuitively, is bad for us),
    // thrash the city with the lowest population (but still having some communities to enable Raid).
    if (getCount("Raid") > 0 && unreservedActions.every(c => getCount(c) == 0)) {
        const raidableCities = cityNames.filter(c => communitiesByCity[c] > 0); // Cities with at least one community
        // Only allow Raid if we would not be raiding our highest-population city (need to maintain at least one)
        const [highestPopCity, _] = getMaxKeyValue(populationByCity, cityNames);
        goingRaiding = raidableCities.length > 0 && (raidableCities[0] != highestPopCity || options['allow-raiding-highest-pop-city']);
        if (goingRaiding) { // Select the raid-able city with the smallest population
            [goToCity, population] = getMinKeyValue(populationByCity, raidableCities);
            travelReason = `Lowest population (${formatNumberShort(population)}) city with communities (${communitiesByCity[goToCity]}) to use up ${getCount("Raid")} Raid operations`;
        }// else log(ns, `INFO: Cannot use up raid operations because there are ${raidableCities.length} cities with communities. ` +
        //    `(--allow-raiding-highest-pop-city is set to ${options['allow-raiding-highest-pop-city']})`);
    }
    // SPECIAL CASE: GO TO HIGHEST-CHAOS CITY
    if (!goToCity && unreservedActions.every(c => getCount(c) == 0)) {
        let [maxChaosCity, maxChaos] = getMaxKeyValue(chaosByCity, cityNames);
        // If all we have left is "Stealth Retirement Operation", switch to the city with the most chaos (if it's a decent amount), and use them up.
        if (getCount("Stealth Retirement Operation") && maxChaos > options['chaos-recovery-threshold']) {
            goToCity = maxChaosCity;
            travelReason = `Highest-chaos (${maxChaos.toFixed(1)}) city to use up Stealth Retirement Operations`;
        } else if (maxChaos > options['max-chaos']) {
            goToCity = maxChaosCity;
            travelReason = `Nothing better to do, and city chaos ${maxChaos.toFixed(1)} is above --max-chaos threshold ${options['max-chaos']} - should use Diplomacy`;
        }
    } // Also, if we have nothing to do (even no Stealth Retirement), but chaos is above 'max-chaos' in some city, switch to it to do Diplomacy

    // GENERAL CASE: GO TO HIGHEST-POPULATION CITY
    // Cities with no chaos penalty (chaos above --chaos-recovery-threshold multiplies action difficulty by sqrt(1 + chaos - 50), Action.ts getChaosSuccessFactor)
    const citiesWithinChaos = cityNames.filter(city => chaosByCity[city] <= options['chaos-recovery-threshold']);
    if (!goToCity) { // Otherwise, cities with higher populations give better operation chances
        // Pick the city (within chaos thresholds) with the highest population to maximize success chance.
        // If no city is within thresholds, the largest population city will be picked regardless of chaos (and Diplomacy considered below)
        [goToCity, population] = getMaxKeyValue(populationByCity, citiesWithinChaos.length > 0 ? citiesWithinChaos : cityNames);
        travelReason = `Highest population (${formatNumberShort(population)}) city, with chaos ${chaosByCity[goToCity].toFixed(1)}` +
            (citiesWithinChaos.length == 0 ? ` (all cities above chaos threshold of ${options['chaos-recovery-threshold']})` : '');
    }

    let currentCity = await getBBInfo(ns, 'getCity()');
    // Change cities if we aren't blocked on our last task, and found a better city to work in
    if (currentCity != goToCity && Date.now() > currentTaskEndTime && (await switchToCity(ns, goToCity, travelReason)))
        currentCity = goToCity;

    // Gather the success chance of contracts (based on our current city)
    const contractChances = await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Contracts", contractNames);
    const operationChances = await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Operations", operationNames);
    // Black ops ignore population (src/Bladeburner/Actions/BlackOperation.ts getPopulationSuccessFactor() = 1), so their estimated and real
    // chances are identical, but Action.ts getSuccessRange still returns [real * r, real] when the population is over-estimated (r = pop/popEst < 1)
    // and [real, real * r] when it is under-estimated. Only the LOW end never exceeds the true chance, so the go/no-go uses it (minChance /
    // chanceRangeVerdict), and a range that straddles --blackop-success-threshold is resolved first by improving the population estimate
    // (populationUncertain below): both Field Analysis and Investigation/Undercover move popEst toward pop, and lo == hi only when popEst == pop.
    const blackOpsChance = nextBlackOp === null || rank < blackOpsRanks[nextBlackOp] ? [0, 0] : // Insufficient rank for blackops means chance is zero
        (([lo, hi]) => [Math.min(lo, hi), Math.max(lo, hi)])((await getBBDictByActionType(ns, 'getActionEstimatedSuccessChance', "Black Operations", [nextBlackOp]))[nextBlackOp]);
    // Gather current/max levels of levelable actions so we can tune them to meet our success threshold (4 GB each, ram-dodged).
    // Max levels only change on a successful action (Bladeburner.ts completeAction), which also changes rank, so they are cached until rank moves.
    let currentLevels = {}, maxLevels = {};
    if (!options['disable-action-leveling']) {
        currentLevels = { ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionCurrentLevel', "Operations", operationNames) };
        if (rank != maxLevelsRank) {
            cachedMaxLevels = { ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Contracts", contractNames), ...await getBBDictByActionType(ns, 'getActionMaxLevel', "Operations", operationNames) };
            maxLevelsRank = rank;
        }
        maxLevels = cachedMaxLevels;
    }
    const thresholdFor = actionName => actionName == nextBlackOp ? options['blackop-success-threshold'] : options['success-threshold'];
    // Define some helpers for determining min/max chance for each action
    const getChance = actionName => contractNames.includes(actionName) ? contractChances[actionName] :
        operationNames.includes(actionName) ? operationChances[actionName] :
            generalActionNames.includes(actionName) ? [1, 1] : nextBlackOp == actionName ? blackOpsChance : [0, 0];
    const minChance = actionName => getChance(actionName)[0];
    const maxChance = actionName => getChance(actionName)[1];

    // NEXT STEP: Pick the action we should be working on.
    let bestActionName, reason, bestActionLevel = 0; // bestActionLevel > 0 means we want the action at that level (0 = leave the level alone)
    const actionSummaryString = (action) => `Success Chance: ${(100 * minChance(action)).toFixed(1)}%` +
        (maxChance(action) - minChance(action) < 0.001 ? '' : ` to ${(100 * maxChance(action)).toFixed(1)}%`) + `, Remaining: ${getCount(action)}` +
        (currentLevels[action] ? `, Level: ${currentLevels[action]}/${maxLevels[action]}` : '')

    // Trigger stamina recovery if we drop below our --low-stamina-pct configuration, and remain trigered until we've recovered to --high-stamina-pct
    const stamina = await getBBInfo(ns, `getStamina()`); // Returns [current, max];
    const staminaPct = stamina[0] / stamina[1];
    lowStaminaTriggered = staminaPct < options['low-stamina-pct'] || lowStaminaTriggered && staminaPct < options['high-stamina-pct'];
    // If we are suffering a stamina penalty, perform an action that consumes no stamina
    if (lowStaminaTriggered) {
        bestActionName = chaosByCity[currentCity] > options['max-chaos'] ? "Diplomacy" : "Field Analysis";
        reason = `Stamina is low: ${(100 * staminaPct).toFixed(1)}% < ${(100 * options['low-stamina-pct']).toFixed(1)}%`
    } // If current city chaos is greater than our threshold, keep it low with "Stealth Retirement" if odds are good. Above the threshold every
    // action already runs at 1/sqrt(1 + chaos - 50) of its chance, so the normal --success-threshold is the right gate here, not 99%.
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > options['success-threshold']) {
        bestActionName = antiChaosOperation;
        reason = `Chaos is high: ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} (--chaos-recovery-threshold) ${actionSummaryString(bestActionName)}`;
    } // No Stealth Retirement to spend and no city under the threshold to move to: the penalty is a cliff at 50 (x1.41 at 51, x7 at 100), so spend
    // Diplomacy time now if it pays for itself over the expected stay (lib/bladeburner-logic.js shouldRunDiplomacy)
    else if (chaosByCity[currentCity] > options['chaos-recovery-threshold'] && citiesWithinChaos.length == 0 &&
        shouldRunDiplomacy(chaosByCity[currentCity], options['chaos-recovery-threshold'], (await refreshPlayer(ns)).skills.charisma, options['chaos-diplomacy-horizon-minutes'])) {
        bestActionName = "Diplomacy";
        reason = `Chaos ${chaosByCity[currentCity].toFixed(2)} > ${options['chaos-recovery-threshold']} in every city (x${chaosDifficultyMult(chaosByCity[currentCity], options['chaos-recovery-threshold']).toFixed(2)} difficulty); ` +
            `Diplomacy at charisma ${player.skills.charisma} needs ~${formatDuration(60000 * diplomacyMinutesTo(chaosByCity[currentCity], options['chaos-recovery-threshold'], player.skills.charisma))}`;
    } // If current city chaos is very high, we should be very wary of the snowballing effects, and try to reduce it.
    else if (chaosByCity[currentCity] > options['max-chaos']) {
        bestActionName = getCount(antiChaosOperation) > 0 && minChance(antiChaosOperation) > 0.8 ? antiChaosOperation : "Diplomacy";
        reason = `Out of ${antiChaosOperation}s, and chaos ${chaosByCity[currentCity].toFixed(2)} is higher than --max-chaos ${options['max-chaos']}`;
    } // If we've previously detemined we will be raiding the lowest-population city
    else if (goingRaiding && maxChance("Raid") > options['success-threshold']) { // Special-case: Ignore min-chance. Population estimate turns bad as we decimate it, but doesn't seem to affect success.
        bestActionName = "Raid";
        reason = `Only remaining Operations. ${actionSummaryString(bestActionName)}`;
    } else { // Otherwise, pick the "highest-tier" action we can confidently perform, which should lead to the fastest rep-gain.
        // Note: Candidate actions will be maintained in order of highest-rep to lowest-rep earning, so we can pick the first after filtering.
        let candidateActions = limitedActions;
        // We should deal with population uncertainty if it is causing some mission (including the next BlackOp, at its own threshold) to straddle its success threshold
        let populationUncertain = candidateActions.some(a => chanceRangeVerdict(getChance(a), thresholdFor(a)) == "uncertain");
        // If current population uncertainty is such that some actions have a maxChance above threshold, but not a minChance, focus on the action
        // that improves the population estimate fastest (expected % per second, lib/bladeburner-logic.js rankPopulationActions); otherwise,
        // reserve the population actions for later
        if (populationUncertain) {
            await refreshPlayer(ns); // Field Analysis effectiveness depends on current hacking / intelligence / charisma
            const popActionTimes = await getNsDataThroughFile(ns,
                'Object.fromEntries(JSON.parse(ns.args[0]).map(([t, n]) => [n, ns.bladeburner.getActionTime(t, n)]))',
                '/Temp/bladeburner-population-action-times.txt',
                [JSON.stringify([["Operations", "Undercover Operation"], ["Operations", "Investigation"], ["General", "Field Analysis"]])]);
            const expectedChance = a => (minChance(a) + maxChance(a)) / 2;
            candidateActions = rankPopulationActions([
                { name: "Undercover Operation", pctPerSuccess: 0.8, chance: expectedChance("Undercover Operation"), timeMs: popActionTimes["Undercover Operation"], count: getCount("Undercover Operation") },
                { name: "Investigation", pctPerSuccess: 0.4, chance: expectedChance("Investigation"), timeMs: popActionTimes["Investigation"], count: getCount("Investigation") },
                { name: "Field Analysis", pctPerSuccess: fieldAnalysisEffect(player.skills.hacking, player.skills.intelligence, player.skills.charisma, player.mults.bladeburner_analysis), chance: 1, timeMs: popActionTimes["Field Analysis"], count: Number.POSITIVE_INFINITY },
            ]);
        } else
            candidateActions = unreservedActions;
        // Filter out candidates with no contract counts remaining
        candidateActions = candidateActions.filter(a => getCount(a) > 0);
        //log(ns, `The following actions are available: ${candidateActions}`); // Debug log to see what candidate actions are

        // Pick the first candidate action (highest rep first) that can meet our success threshold, lowering its level if necessary (or raising it
        // if it has headroom). When population uncertainty is high, proceed so long as the max chance is high enough.
        const chanceFn = populationUncertain ? maxChance : minChance;
        for (const a of candidateActions.filter(a => getCount(a) >= 1)) {
            const level = getTargetLevel(a, chanceFn(a), thresholdFor(a), currentLevels[a], maxLevels[a]);
            if (level === null) continue;
            [bestActionName, bestActionLevel] = [a, level];
            break;
        }

        if (!bestActionName) // If there were none, allow us to fall-back to an action with a minimum chance >50%, and maximum chance > threshold (never a BlackOp: its range is resolved first)
            bestActionName = candidateActions.filter(a => a != nextBlackOp && minChance(a) > 0.5 && maxChance(a) > thresholdFor(a) && getCount(a) >= 1)[0];
        if (bestActionName) // If we found something to do, log details about its success chance range
            reason = actionSummaryString(bestActionName) + (bestActionLevel > 0 && bestActionLevel != currentLevels[bestActionName] ?
                ` (setting level ${currentLevels[bestActionName]} -> ${bestActionLevel} to meet --success-threshold ${options['success-threshold']})` : '');

        // If there were no operations/contracts, resort to a "General" action which always have 100% chance, but take longer and gives less reward
        if (!bestActionName) {
            const [maxChaosCity, maxChaos] = getMaxKeyValue(chaosByCity, cityNames);
            const noWorkLeft = unreservedActions.every(a => getCount(a) == 0);
            if (populationUncertain) { // Lower population uncertainty
                bestActionName = "Field Analysis";
                reason = `High population uncertainty in ${currentCity}`;
            } // If all (non-reserved) operation counts are 0, and chaos is low everywhere, Incite Violence to get more work.
            // Incite Violence (src/Bladeburner/Bladeburner.ts InciteViolence) adds only ~3 minutes' worth of contract/operation count regen,
            // but adds 10 + chaos/log10(chaos) chaos to EVERY city. Chaos above 50 scales action difficulty by sqrt(1 + chaos - 50)
            // (src/Bladeburner/Actions/Action.ts getChaosSuccessFactor), so only incite while chaos is low everywhere (--max-chaos-for-incite).
            else if (noWorkLeft && maxChaos < options['max-chaos-for-incite']) {
                bestActionName = "Incite Violence";
                reason = `No work available, and max city chaos is ${maxChaos.toFixed(1)} in ${maxChaosCity}, ` +
                    `which is less than --max-chaos-for-incite threshold ${options['max-chaos-for-incite']}`;
            } // Otherwise, consider training
            else if (unreservedActions.some(a => maxChance(a) < options['success-threshold']) && // Only if we aren't at 100% chance for everything
                staminaPct > options['high-stamina-pct'] && timesTrained < options['training-limit']) { // Only if we have plenty of stamina and have barely trained
                timesTrained += options['update-interval'] / 30000; // Take into account the training time (30 seconds) vs how often this code is called
                bestActionName = "Training";
                reason = `Nothing better to do, times trained (${timesTrained.toFixed(0)}) < --training-limit (${options['training-limit']}), and ` +
                    `actions are below success threshold: ` + unreservedActions.filter(a => maxChance(a) < options['success-threshold'])
                        .map(a => `${a} (${(100 * maxChance(a)).toFixed(1)}%)`).join(", ");
            } // If there's no work and stamina isn't full, regenerate it (and HP) so we're at full strength when work becomes available
            else if (noWorkLeft && staminaPct < options['high-stamina-pct']) {
                bestActionName = "Hyperbolic Regeneration Chamber";
                reason = `No work available, and stamina is ${(100 * staminaPct).toFixed(1)}% < --high-stamina-pct ${(100 * options['high-stamina-pct']).toFixed(1)}%`;
            } else { // Otherwise, Field Analysis
                bestActionName = "Field Analysis"; // Gives a little rank, and improves population estimate. Best we can do when there's nothing else.
                reason = `Nothing better to do`;
            }
        }
        // NOTE: We never "Recruit". Community consensus is that team mates die too readily, and have minimal impact on success.
    }

    // Apply any action level change (autolevel must be disabled, or the game snaps the level back to max on every completion: src/Bladeburner/Bladeburner.ts completeAction)
    if (bestActionLevel > 0 && bestActionLevel != currentLevels[bestActionName]) {
        const levelType = contractNames.includes(bestActionName) ? "Contracts" : "Operations";
        await runCommand(ns, 'ns.bladeburner.setActionAutolevel(ns.args[0], ns.args[1], false); ns.bladeburner.setActionLevel(ns.args[0], ns.args[1], ns.args[2]);',
            '/Temp/bladeburner-setActionLevel.js', [levelType, bestActionName, bestActionLevel]);
        log(ns, `INFO: Set Bladeburner ${levelType} "${bestActionName}" level ${currentLevels[bestActionName]} -> ${bestActionLevel} (max ${maxLevels[bestActionName]})`);
    }

    // Detect our current action (API returns an object like { "type":"Operations", "name":"Investigation" })
    const currentAction = await getBBInfo(ns, `getCurrentAction()`);
    // Special case: If the user has manually kicked off the last BlackOps, don't interrupt it, let it be our last task
    if (currentAction?.name == remainingBlackOpsNames[remainingBlackOpsNames.length - 1]) lastAssignedTask = currentAction;
    // Warn the user if it looks like a task was interrupted by something else (user activity or bladeburner automation). Ignore if our last assigned task has run out of actions.
    if (lastAssignedTask && lastAssignedTask != currentAction?.name && getCount(lastAssignedTask) > 0) {
        log(ns, `WARNING: The last task this script assigned was "${lastAssignedTask}", but you're now doing "${currentAction?.name || '(nothing)'}". ` +
            `Have you been using Bladeburner Automation? If so, try typing "automate dis" in the Bladeburner Console.`, false, 'warning');
    } else if (currentAction?.name) {
        const currentDuration = await getBBInfo(ns, `getActionTime(ns.args[0], ns.args[1])`, currentAction.type, currentAction.name);
        if (!lastAssignedTask) { // Leave a log acknowledging if we just started up and there was an activity already underway.
            log(ns, `INFO: At startup, Bladeburner was already doing "${currentAction?.name}", ` +
                (bestActionName != currentAction.name ? `but we would prefer to do "${bestActionName}", so we will be switching.` :
                    `which is what we were planning to do, so we will leave the current task alone.`));
            lastAssignedTask = bestActionName;
        }
        // Normally, we don't switch tasks if our previously assigned task hasn't had time to complete once.
        // EXCEPTION: Early after a reset, this time is LONG, and in a few seconds it may be faster to just stop and restart it.
        if (currentDuration < currentTaskEndTime - Date.now()) {
            log(ns, `INFO: ${bestActionName == currentAction.name ? 'Restarting' : 'Cancelling'} action "${currentAction.name}" because its new duration ` +
                `is less than the time remaining (${formatDuration(currentDuration)} < ${formatDuration(currentTaskEndTime - Date.now())})`);
        } else if (Date.now() < currentTaskEndTime || bestActionName == currentAction.name) return;
    } // Otherwise prior action was stopped or ended and no count remain, so we should start a new one regardless of expected currentTaskEndTime

    // Change actions if we're not currently doing the desired action
    const bestActionType = nextBlackOp == bestActionName ? "Black Operations" : contractNames.includes(bestActionName) ? "Contracts" :
        operationNames.includes(bestActionName) ? "Operations" : "General";
    const success = await getBBInfo(ns, `startAction(ns.args[0], ns.args[1])`, bestActionType, bestActionName);
    const expectedDuration = await getBBInfo(ns, `getActionTime(ns.args[0], ns.args[1])`, bestActionType, bestActionName);
    log(ns, (success ? `INFO: Switched to Bladeburner ${bestActionType} "${bestActionName}" (${reason}). ETA: ${formatDuration(expectedDuration)}` :
        `ERROR: Failed to switch to Bladeburner ${bestActionType} "${bestActionName}" (Count: ${getCount(bestActionName)}, ` +
        `ETA: ${formatDuration(expectedDuration)}, Details: ${reason})`),
        !success, success ? (options['toast-operations'] ? 'info' : undefined) : 'error');
    // Ensure we perform this new action at least once before interrupting it
    lastAssignedTask = bestActionName;
    currentTaskEndTime = !success ? 0 : Date.now() + expectedDuration + 10; // Pad this a little to ensure we don't interrupt it.
}

/** Determine the highest level of an action whose estimated success chance should meet the threshold (see difficultyFacByAction).
 * @param {string} actionName
 * @param {number} chance The estimated success chance at the current level
 * @param {number} threshold The required success chance
 * @param {number} currentLevel The action's current level (undefined if the action isn't levelable, or leveling is disabled)
 * @param {number} maxLevel The action's max level
 * @returns {number|null} The target level (1..maxLevel), 0 if the action is acceptable but not levelable, or null if no level meets the threshold */
function getTargetLevel(actionName, chance, threshold, currentLevel, maxLevel) {
    const fac = difficultyFacByAction[actionName];
    if (!fac || !currentLevel || !maxLevel) return chance > threshold ? 0 : null; // Not levelable (general actions, black ops) or leveling disabled
    const lnFac = Math.log(fac);
    if (chance > threshold) { // We can raise the level by k while chance * fac^-k >= threshold. If the estimate is capped at 100%, assume it is exactly 100%
        const k = Math.floor(Math.log(Math.min(chance, 1) / threshold) / lnFac);
        return Math.max(currentLevel, Math.min(maxLevel, currentLevel + k));
    }
    if (chance <= 0) return null;
    const k = Math.ceil(Math.log(threshold / chance) / lnFac); // Lower the level by k so that chance * fac^k >= threshold
    return currentLevel - k >= 1 ? currentLevel - k : null;
}

/** @param {NS} ns
 * Helper to switch cities. */
async function switchToCity(ns, city, reason) {
    const success = await getBBInfo(ns, `switchCity(ns.args[0])`, city);
    log(ns, (success ? 'INFO: Switched' : 'ERROR: Failed to switch') + ` to Bladeburner city "${city}" (${reason})`,
        !success, success ? (options['toast-relocations'] ? 'info' : undefined) : 'error');
    return success;
}

/** @param {NS} ns
 * Decides how to spend skill points. */
async function spendSkillPoints(ns) {
    while (true) { // Loop until we determine there's nothing left to spend skill points on
        const unspent = await getBBInfo(ns, 'getSkillPoints()');
        if (unspent == 0) return;
        const skillLevels = await getBBDict(ns, 'getSkillLevel(%)', skillNames);
        const skillCosts = await getBBDict(ns, 'getSkillUpgradeCost(%)', skillNames);
        // Perceived cost of the next level of each skill (costAdjustments tweak the priority). The API returns null/Infinity for a maxed skill.
        const perceivedCostOf = skillName => (skillName === "Overclock" && skillLevels[skillName] >= 90) ? Number.POSITIVE_INFINITY :
            (skillCosts[skillName] ?? Number.POSITIVE_INFINITY) * (costAdjustments[skillName] || 1);
        const [skillToUpgrade, minPercievedCost] = getMinKeyValue(Object.fromEntries(skillNames.map(s => [s, perceivedCostOf(s)])));
        // If the percieved or actual cost of the next best upgrade is too high, save our remaining points for later
        if (skillToUpgrade == null || minPercievedCost > unspent || skillCosts[skillToUpgrade] > unspent) return;
        // Buy in bulk: getSkillUpgradeCost(name, count) / upgradeSkill(name, count) take a count (closed-form cost, src/Bladeburner/Skill.ts calculateCost).
        // Keep buying levels of this skill while its perceived cost stays below the next best skill's, and we can afford them.
        const costForTwo = await getBBInfo(ns, `getSkillUpgradeCost(ns.args[0], ns.args[1])`, skillToUpgrade, 2);
        const nextBestPerceivedCost = Math.min(...skillNames.filter(s => s != skillToUpgrade).map(perceivedCostOf));
        const maxCount = skillToUpgrade === "Overclock" ? 90 - skillLevels[skillToUpgrade] : Number.POSITIVE_INFINITY;
        let count = planSkillUpgradeCount(skillCosts[skillToUpgrade], Number.isFinite(costForTwo) ? costForTwo : 2 * skillCosts[skillToUpgrade],
            costAdjustments[skillToUpgrade] || 1, nextBestPerceivedCost, unspent, maxCount);
        let success = count > 0 && await getBBInfo(ns, `upgradeSkill(ns.args[0], ns.args[1])`, skillToUpgrade, count);
        if (!success && count > 1) { // The bulk cost estimate rounds; fall back to a single level, which we verified is affordable
            count = 1;
            success = await getBBInfo(ns, `upgradeSkill(ns.args[0], ns.args[1])`, skillToUpgrade, count);
        }
        if (success)
            log(ns, `SUCCESS: Upgraded Bladeburner skill ${skillToUpgrade} by ${count} level${count == 1 ? '' : 's'} (${skillLevels[skillToUpgrade]} -> ${skillLevels[skillToUpgrade] + count})`, false, options['toast-upgrades'] ? 'success' : undefined);
        else
            log(ns, `WARNING: Something went wrong while trying to upgrade Bladeburner skill ${skillToUpgrade}. ` +
                `Currently have ${unspent} SP, upgrade should cost ${skillCosts[skillToUpgrade]} SP.`, false, 'warning');
        await ns.sleep(10);
    }
}

/** @param {NS} ns
 * Helper to try and join the Bladeburner faction ASAP. */
async function tryJoinFaction(ns, rank) {
    if (inFaction) return;
    if (rank >= 25 && await getBBInfo(ns, 'joinBladeburnerFaction()')) {
        log(ns, 'SUCCESS: Joined the Bladeburner Faction!', false, 'success');
        inFaction = true;
    } else if (rank >= 25)
        log(ns, `WARNING: Failed to join the Bladeburner faction despite rank of ${rank.toFixed(1)}`, false, 'warning');
}

let lastCanWorkCheckIdle = true;

/** @param {NS} ns
 * Helper to see if we are able to do bladeburner work */
async function canDoBladeburnerWork(ns) {
    if (options['ignore-busy-status'] || haveSimulacrum) return true;
    // Check if the player is busy doing something else
    const busy = await getNsDataThroughFile(ns, 'ns.singularity.isBusy()');
    if (!busy) return lastCanWorkCheckIdle = true;
    if (lastCanWorkCheckIdle)
        log(ns, `WARNING: Cannot perform Bladeburner actions because the player is busy ` +
            `and hasn't installed the augmentation "${simulacrumAugName}"...`, false, 'warning');
    return lastCanWorkCheckIdle = false;
}

/** @param {NS} ns
 * Ensure we're in the Bladeburner division */
async function beingInBladeburner(ns) {
    // Ensure we're in the Bladeburner division. If not, wait until we've joined it.
    while (!(await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()'))) {
        try {
            if (player.skills.strength < 100 || player.skills.defense < 100 || player.skills.dexterity < 100 || player.skills.agility < 100)
                log(ns, `Waiting for physical stats >100 to join bladeburner ` +
                    `(Currently Str: ${player.skills.strength}, Def: ${player.skills.defense}, Dex: ${player.skills.dexterity}, Agi: ${player.skills.agility})`);
            else if (await getBBInfo(ns, 'joinBladeburnerDivision()')) {
                let message = `SUCCESS: Joined Bladeburner (At ${formatDuration(getTimeInBitnode())} into BitNode)`;
                if (9 in ownedSourceFiles && options['disable-spending-hashes'])
                    message += ' --disable-spending-hashes is set, but consider running the following command to give it a boost:\n' +
                        'run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_Rank --spend-on Exchange_for_Bladeburner_SP --liquidate';
                log(ns, message, true, 'success');
                break;
            } else
                log(ns, 'WARNING: Failed to joined Bladeburner despite physical stats. Will try again...', false, 'warning');
            player = await getNsDataThroughFile(ns, 'ns.getPlayer()');
        }
        catch (err) {
            log(ns, `WARNING: bladeburner.js Caught (and suppressed) an unexpected error while waiting to join bladeburner, but will keep going:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(5000);
    }
    log(ns, "INFO: We are in Bladeburner. Starting main loop...")
    // If not disabled, launch an external script to spend hashes on bladeburner rank
    if (!(9 in ownedSourceFiles)) return; // Hacknet not unlocked
    if (options['disable-spending-hashes'])
        return log(ns, `INFO: Not spending hashes on bladeburner (--disable-spending-hashes flag is set)`);
    const fPath = getFilePath('spend-hacknet-hashes.js');
    const args = ['--spend-on', 'Exchange_for_Bladeburner_Rank', '--spend-on', 'Exchange_for_Bladeburner_SP', '--liquidate'];
    if (ns.run(fPath, { preventDuplicates: true }, ...args))
        log(ns, `INFO: Launched '${fPath}' to gain Bladeburner Rank and Skill Points more quickly (Can be disabled with --disable-spending-hashes)`)
    else
        log(ns, `WARNING: Failed to launch '${fPath}' (already running?)`)
}