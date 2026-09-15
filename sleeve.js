import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, runCommand, formatMoney, formatDuration, getErrorInfo } from './helpers.js'

const argsSchema = [
    ['min-shock-recovery', 97], // Minimum shock recovery before attempting to train or do crime (Set to 100 to disable, 0 to recover fully)
    ['shock-recovery', 0.05], // Set to a number between 0 and 1 to devote that ratio of time to periodic shock recovery (until shock is at 0)
    ['crime', null], // If specified, sleeves will perform only this crime regardless of stats
    ['homicide-chance-threshold', 0.5], // Sleeves on crime will automatically start homicide once their chance of success exceeds this ratio
    ['disable-gang-homicide-priority', false], // By default, sleeves will do homicide to farm Karma until we're in a gang. Set this flag to disable this priority.
    ['aug-budget', 0.1], // Spend up to this much of current cash on augs per tick (Default is high, because these are permanent for the rest of the BN)
    ['buy-cooldown', 60 * 1000], // Must wait this may milliseconds before buying more augs for a sleeve
    ['min-aug-batch', 20], // Must be able to afford at least this many augs before we pull the trigger (or fewer if buying all remaining augs)
    ['reserve', null], // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
    ['disable-follow-player', false], // Set to true to disable having Sleeve 0 work for the same faction/company as the player to boost reputation gain rates
    ['disable-training', false], // Set to true to disable having sleeves workout at the gym (costs money)
    ['train-to-strength', 105], // Sleeves will go to the gym until they reach this much Str
    ['train-to-defense', 105], // Sleeves will go to the gym until they reach this much Def
    ['train-to-dexterity', 70], // Sleeves will go to the gym until they reach this much Dex
    ['train-to-agility', 70], // Sleeves will go to the gym until they reach this much Agi
    ['study-to-hacking', 25], // Sleeves will go to university until they reach this much Hak
    ['study-to-charisma', 25], // Sleeves will go to university until they reach this much Cha
    ['training-reserve', null], // Defaults to global reserve.txt. Can be set to a negative number to allow debt. Sleeves will not train if money is below this amount.
    ['training-cap-seconds', 2 * 60 * 60 /* 2 hours */], // Time since the start of the bitnode after which we will no longer attempt to train sleeves to their target "train-to" settings
    ['disable-spending-hashes-for-gym-upgrades', false], // Set to true to disable spending hashes on gym upgrades when training up sleeves.
    ['disable-spending-hashes-for-study-upgrades', false], // Set to true to disable spending hashes on study upgrades when smarting up sleeves.
    ['enable-bladeburner-team-building', false], // Set to true to have one sleeve support the main sleeve, and another do recruitment. Otherwise, they will just do more "Infiltrate Synthoids"
    ['disable-bladeburner', false], // Set to true to disable having sleeves workout at the gym (costs money)
    ['failed-bladeburner-contract-cooldown', 30 * 60 * 1000], // Default 30 minutes: time to wait after failing a bladeburner contract before we try again
    ['sync-first', false], // Set to true to always synchronize sleeves to 100% before doing anything else (legacy behaviour). By default we only sync when the sleeve's next job is crime for karma.
    ['train-max-shock', 10], // Only train (gym/university) sleeves whose shock is at or below this. Class exp is multiplied by (100 - shock)% but the cost is not.
    ['train-with-pending-augs', false], // Set to true to train sleeves even when they still have purchasable augmentations (installing an aug resets all sleeve exp)
    ['max-faction-sleeves', 8], // Up to this many sleeves may work for (distinct) joined factions that still have unowned augmentations we need rep for. 0 to disable.
    ['faction-work-max-shock', 25], // Extra faction-work sleeves (above) must have shock at or below this (rep earned is scaled by (100 - shock)%), else they recover shock first
    ['darknet-charisma', true], // When otherwise idle, study Leadership to help satisfy the charisma goal left by darknet.js in /Temp/darknet-charisma-goal.txt
];

const interval = 1000; // Update (tick) this often to check on sleeves and recompute their ideal task
const rerollTime = 61000; // How often we re-roll for each sleeve's chance to be randomly placed on shock recovery
const statusUpdateInterval = 10 * 60 * 1000; // Log sleeve status this often, even if their task hasn't changed
const trainingReserveFile = '/Temp/sleeves-training-reserve.txt';
const works = ['security', 'field', 'hacking']; // When doing faction work, we prioritize physical work since sleeves tend towards having those stats be highest
const trainStats = ['strength', 'defense', 'dexterity', 'agility'];
const trainSmarts = ['hacking', 'charisma'];
const sleeveBbContractNames = ["Tracking", "Bounty Hunter", "Retirement"];
const minBbContracts = 2; // There should be this many contracts remaining before sleeves attempt them
const minBbProbability = 0.99; // Player chance should be this high before sleeves attempt contracts
const waitForContractCooldown = 60 * 1000; // 1 minute - Cooldown when contract count or probability gets too low

let cachedCrimeStats, workByFaction, factionWorkUnsupported; // Cache of crime statistics and which factions support which work
let task, lastStatusUpdateTime, lastPurchaseTime, lastPurchaseStatusUpdate, availableAugs, cacheExpiry,
    shockChance, lastRerollTime, bladeburnerCooldown, lastSleeveHp, lastSleeveShock; // State by sleeve
let numSleeves, ownedSourceFiles, playerInGang, playerGangFaction, playerInBladeburner, bladeburnerCityChaos, bladeburnerContractChances, bladeburnerContractCounts, followPlayerSleeve;
let sleeveExpDisabled = false; // bitNodeOptions.disableSleeveExpAndAugmentation: sleeves gain no exp and cannot buy augs
let factionWorkCandidates = [], factionWorkCandidatesExpiry = 0, factionsTakenThisLoop = []; // Factions other sleeves can work for (item 9)
let factionBySleeve = {}; // Sleeve index -> faction it was last successfully set to work for (setToFactionWork throws if another sleeve still works there)
const factionWorkRefreshInterval = 5 * 60 * 1000; // How often to recompute which factions still need rep
const darknetCharismaMinSync = 50; // Minimum sleeve sync% for the --darknet-charisma study task to be worth its tuition (see pickSleeveTask)
let options;
// Sleeve -> bladeburner contract assignment (each contract type can only be performed by one sleeve at a time)
const sleeveBbContractBySleeve = { 1: "Retirement", 2: "Bounty Hunter", 3: "Tracking" };

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ['getServerMoneyAvailable']);
    // Ensure the global state is reset (e.g. after entering a new bitnode)
    task = [], lastStatusUpdateTime = [], lastPurchaseTime = [], lastPurchaseStatusUpdate = [], availableAugs = [],
        cacheExpiry = [], shockChance = [], lastRerollTime = [], bladeburnerCooldown = [], lastSleeveHp = [], lastSleeveShock = [];
    workByFaction = {}, cachedCrimeStats = {}, factionWorkUnsupported = {};
    factionWorkCandidates = [], factionWorkCandidatesExpiry = 0, factionsTakenThisLoop = [], factionBySleeve = {};
    playerInGang = playerInBladeburner = false;
    playerGangFaction = null;
    // Ensure we have access to sleeves
    ownedSourceFiles = await getActiveSourceFiles(ns);
    if (!(10 in ownedSourceFiles))
        return ns.tprint("WARNING: You cannot run sleeve.js until you do BN10.");
    // Start the main loop
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `WARNING: sleeve.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(interval);
    }
}

/** @param {NS} ns
 * Purchases augmentations for sleeves */
async function manageSleeveAugs(ns, i, budget) {
    if ((await getAvailableAugs(ns, i)).length == 0) return 0;

    const cooldownLeft = Math.max(0, options['buy-cooldown'] - (Date.now() - (lastPurchaseTime[i] || 0)));
    const [batchCount, batchCost] = availableAugs[i].reduce(([n, c], aug) => c + aug.cost <= budget ? [n + 1, c + aug.cost] : [n, c], [0, 0]);
    const purchaseUpdate = `sleeve ${i} can afford ${batchCount.toFixed(0).padStart(2)}/${availableAugs[i].length.toFixed(0).padEnd(2)} remaining augs ` +
        `(cost ${formatMoney(batchCost)} of ${formatMoney(availableAugs[i].reduce((t, aug) => t + aug.cost, 0))}).`;
    if (lastPurchaseStatusUpdate[i] != purchaseUpdate)
        log(ns, `INFO: With budget ${formatMoney(budget)}, ${(lastPurchaseStatusUpdate[i] = purchaseUpdate)} ` +
            `(Min batch size: ${options['min-aug-batch']}, Cooldown: ${formatDuration(cooldownLeft)})`);
    if (cooldownLeft == 0 && batchCount > 0 && ((batchCount >= availableAugs[i].length - 1) || batchCount >= options['min-aug-batch'])) { // Don't require the last aug it's so much more expensive
        let strAction = `Purchase ${batchCount}/${availableAugs[i].length} augmentations for sleeve ${i} at total cost of ${formatMoney(batchCost)}`;
        let toPurchase = availableAugs[i].splice(0, batchCount);
        if (await getNsDataThroughFile(ns, `ns.args.slice(1).reduce((s, aug) => s && ns.sleeve.purchaseSleeveAug(ns.args[0], aug), true)`,
            '/Temp/sleeve-purchase.txt', [i, ...toPurchase.map(a => a.name)])) {
            log(ns, `SUCCESS: ${strAction}`, true, 'success');
            [lastSleeveHp[i], lastSleeveShock[i]] = [undefined, undefined]; // Sleeve stats are reset on installation of augs, so forget saved health info
        } else log(ns, `ERROR: Failed to ${strAction}`, true, 'error');
        lastPurchaseTime[i] = Date.now();
        return batchCost; // Even if we think we failed, return the predicted cost so if the purchase did go through, we don't end up over-budget
    }
    return 0;
}

/** @param {NS} ns
 * Retrieve and cache the set of available sleeve augs (cached temporarily, but not forever, in case rules around this change)
 * @returns {Promise<{name: string, cost: number}[]>} */
async function getAvailableAugs(ns, i) {
    if (availableAugs[i] == null || Date.now() > cacheExpiry[i]) {
        cacheExpiry[i] = Date.now() + 60000;
        availableAugs[i] = (await getNsDataThroughFile(ns, `ns.sleeve.getSleevePurchasableAugs(ns.args[0])`,  // list of { name, cost }
            null, [i])).sort((a, b) => a.cost - b.cost);
    }
    return availableAugs[i];
}

/** @param {NS} ns
 * @param {Player} playerInfo
 * Build the list of joined factions that still have unowned augmentations requiring more rep than we have, sorted by lowest rep first.
 * Requires SF4 (singularity). Failures are suppressed (e.g. insufficient RAM for the temp scripts), leaving the previous list in place. */
async function refreshFactionWorkCandidates(ns, playerInfo) {
    factionWorkCandidatesExpiry = Date.now() + factionWorkRefreshInterval;
    try {
        const factions = (playerInfo.factions || []).filter(f => f != playerGangFaction && !factionWorkUnsupported[f]);
        if (factions.length == 0) return factionWorkCandidates = [];
        const ownedAugs = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
        const dictFactionRep = await getDict(ns, factions, 'singularity.getFactionRep', '/Temp/sleeve-faction-rep.txt');
        const dictFactionAugs = await getDict(ns, factions, 'singularity.getAugmentationsFromFaction', '/Temp/sleeve-faction-augs.txt');
        const wantedAugs = [...new Set(Object.values(dictFactionAugs).flat())].filter(a => !ownedAugs.includes(a) && a != "NeuroFlux Governor");
        const dictAugRepReqs = wantedAugs.length == 0 ? {} : await getDict(ns, wantedAugs, 'singularity.getAugmentationRepReq', '/Temp/sleeve-aug-repreqs.txt');
        factionWorkCandidates = factions
            .map(f => ({ name: f, rep: dictFactionRep[f], repNeeded: Math.max(0, ...dictFactionAugs[f].filter(a => a in dictAugRepReqs).map(a => dictAugRepReqs[a])) }))
            .filter(f => f.rep < f.repNeeded)
            .sort((a, b) => a.rep - b.rep)
            .map(f => f.name);
        log(ns, `INFO: ${factionWorkCandidates.length} joined factions still need rep for augmentations (lowest rep first): ${factionWorkCandidates.join(", ") || '(none)'}`);
    } catch (err) {
        log(ns, `WARNING: Failed to determine which factions sleeves should work for (insufficient RAM for singularity temp scripts?): ` +
            (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false);
    }
}

// Ram-dodging helper to get a dictionary mapping each element to the result of ns.<nsFunction>(element)
const getDict = async (ns, elements, nsFunction, fileName) => await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(o => [o, ns.${nsFunction}(o)]))`, fileName, elements);

/** @param {NS} ns
 * @returns {Promise<Player>} the result of ns.getPlayer() */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 * @returns {Promise<Task>} */
async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {};
}

/** @param {NS} ns
 * @param {number} numSleeves
 * @returns {Promise<SleevePerson[]>} */
async function getAllSleeves(ns, numSleeves) {
    return await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`,
        `/Temp/sleeve-getSleeve-all.txt`, [...Array(numSleeves).keys()]);
}

/** @param {NS} ns
 * Main loop that gathers data, checks on all sleeves, and manages them. */
async function mainLoop(ns) {
    // Update info
    numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
    const playerInfo = await getPlayerInfo(ns);
    // If we have not yet detected that we are in bladeburner, do that now (unless disabled)
    if (!options['disable-bladeburner'] && !playerInBladeburner)
        playerInBladeburner = await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
    const playerWorkInfo = await getCurrentWorkInfo(ns);
    if (!playerInGang) playerInGang = !(2 in ownedSourceFiles) ? false : await getNsDataThroughFile(ns, 'ns.gang.inGang()');
    let globalReserve = Number(ns.read("reserve.txt") || 0);
    let budget = (playerInfo.money - (options['reserve'] || globalReserve)) * options['aug-budget'];
    // Estimate the cost of sleeves training over the next time interval to see if (ignoring income) we would drop below our reserve.
    const costByNextLoop = interval / 1000 * task.filter(t => t.startsWith("train")).length * 12000; // TODO: Training cost/sec seems to be a bug. Should be 1/5 this ($2400/sec)
    // Get time in current bitnode (to cap how long we'll train sleeves)
    const resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const timeInBitnode = Date.now() - resetInfo.lastNodeReset;
    // Honour the "disableSleeveExpAndAugmentation" bitnode option (sleeves gain no exp and cannot buy augs, so training/aug-buying is pointless)
    sleeveExpDisabled = resetInfo.bitNodeOptions?.disableSleeveExpAndAugmentation ?? false;
    // Look up our gang's faction (once), since sleeves cannot work for it (src/NetscriptFunctions/Sleeve.ts setToFactionWork)
    if (playerInGang && playerGangFaction == null)
        playerGangFaction = (await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()'))?.faction ?? null;
    // Periodically refresh the list of factions that other sleeves could usefully work for
    if (options['max-faction-sleeves'] > 0 && (4 in ownedSourceFiles) && Date.now() > factionWorkCandidatesExpiry)
        await refreshFactionWorkCandidates(ns, playerInfo);
    factionsTakenThisLoop = []; // Each faction accepts only one sleeve at a time, so track which are spoken for this loop
    let canTrain = !options['disable-training'] && !sleeveExpDisabled &&
        // To avoid training forever when mults are crippling, stop training if we've been in the bitnode a certain amount of time
        (options['training-cap-seconds'] * 1000 > timeInBitnode) &&
        // Don't train if we have no money (unless player has given permission to train into debt)
        (playerInfo.money - costByNextLoop) > (options['training-reserve'] ||
            (promptedForTrainingBudget ? ns.read(trainingReserveFile) : undefined) || globalReserve);
    // If any sleeve is training at the gym, see if we can purchase a gym upgrade to help them
    if (canTrain && task.some(t => t?.startsWith("train")) && !options['disable-spending-hashes-for-gym-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Gym Training")', '/Temp/spend-hashes-on-gym.txt'))
            log(ns, `SUCCESS: Bought "Improve Gym Training" to speed up Sleeve training.`, false, 'success');
    if (canTrain && task.some(t => t?.startsWith("study")) && !options['disable-spending-hashes-for-study-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Studying")', '/Temp/spend-hashes-on-study.txt'))
            log(ns, `SUCCESS: Bought "Improve Studying" to speed up Sleeve studying.`, false, 'success');
    if (playerInBladeburner && (7 in ownedSourceFiles)) {
        const bladeburnerCity = await getNsDataThroughFile(ns, `ns.bladeburner.getCity()`);
        bladeburnerCityChaos = await getNsDataThroughFile(ns, `ns.bladeburner.getCityChaos(ns.args[0])`, null, [bladeburnerCity]);
        // Since v3.0, getActionEstimatedSuccessChance accepts a sleeve number and evaluates the chance with that sleeve's stats
        // (src/NetscriptFunctions/Bladeburner.ts getActionEstimatedSuccessChance: action.getSuccessRange(bladeburner, Player.sleeves[n])).
        // Keyed by sleeve index, since each sleeve has its own designated contract. Only supported for General actions and Contracts.
        bladeburnerContractChances = await getNsDataThroughFile(ns,
            'Object.fromEntries(JSON.parse(ns.args[0]).map(([i, c]) => [i, ns.bladeburner.getActionEstimatedSuccessChance("Contracts", c, i)[0]]))',
            '/Temp/sleeve-bladeburner-success-chances.txt',
            [JSON.stringify(Object.entries(sleeveBbContractBySleeve).map(([i, c]) => [Number(i), c]).filter(([i]) => i < numSleeves))]);
        bladeburnerContractCounts = await getNsDataThroughFile(ns,
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionCountRemaining("Contracts", c)]))',
            '/Temp/sleeve-bladeburner-contract-counts.txt', sleeveBbContractNames);
    } else
        bladeburnerCityChaos = 0, bladeburnerContractChances = {}, bladeburnerContractCounts = {};

    // Update all sleeve information and loop over all sleeves to do some individual checks and task assignments
    let sleeveInfo = await getAllSleeves(ns, numSleeves);

    // If not disabled, set the "follow player" sleeve to be the first sleeve with 0 shock
    followPlayerSleeve = options['disable-follow-player'] ? -1 : undefined;
    for (let i = 0; i < numSleeves; i++) // Hack below: Prioritize sleeves doing bladeburner contracts, don't have them follow player
        if (sleeveInfo[i].shock == 0 && (i > 3 || !playerInBladeburner))
            followPlayerSleeve ??= i; // Skips assignment if previously assigned
    followPlayerSleeve ??= 0; // If all have shock, use the first sleeve
    // Reserve the player's faction for the follow-player sleeve so that a lower-indexed sleeve doesn't claim it first
    if (followPlayerSleeve >= 0 && playerWorkInfo.type == "FACTION") factionsTakenThisLoop.push(playerWorkInfo.factionName);

    for (let i = 0; i < numSleeves; i++) {
        let sleeve = sleeveInfo[i]; // For convenience, merge all sleeve stats/info into one object
        // Manage sleeve augmentations (if available)
        if (sleeve.shock == 0 && !sleeveExpDisabled) // No augs are available augs until shock is 0
            budget -= await manageSleeveAugs(ns, i, budget);

        // Decide what we think the sleeve should be doing for the next little while
        let [designatedTask, command, args, statusUpdate] =
            await pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain);

        // After picking sleeve tasks, take a note of the sleeve's health at the end of the prior loop so we can detect failures
        [lastSleeveHp[i], lastSleeveShock[i]] = [sleeve.hp.current, sleeve.shock];

        // Set the sleeve's new task if it's not the same as what they're already doing.
        let assignSuccess = undefined;
        if (task[i] != designatedTask)
            assignSuccess = await setSleeveTask(ns, i, designatedTask, command, args);

        // For certain tasks, log a periodic status update.
        if (statusUpdate && (assignSuccess === true || (
            assignSuccess === undefined && (Date.now() - (lastStatusUpdateTime[i] ?? 0)) > statusUpdateInterval))) {
            log(ns, `INFO: Sleeve ${i} is ${assignSuccess === undefined ? '(still) ' : ''}${statusUpdate} `);
            lastStatusUpdateTime[i] = Date.now();
        }
    }
}

/** Picks the best task for a sleeve, and returns the information to assign and give status updates for that task.
 * @param {NS} ns
 * @param {Player} playerInfo
 * @param {{ type: "COMPANY"|"FACTION"|"CLASS"|"CRIME", cyclesWorked: number, crimeType: string, classType: string, location: string, companyName: string, factionName: string, factionWorkType: string }} playerWorkInfo
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} a 4-tuple of task name, command, args, and status message */
async function pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain) {
    // Initialize sleeve dicts on first loop
    if (lastSleeveHp[i] === undefined) lastSleeveHp[i] = sleeve.hp.current;
    if (lastSleeveShock[i] === undefined) lastSleeveShock[i] = sleeve.shock;
    // Synchronization only affects karma gained from sleeve crime (src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts: karma * syncBonus())
    // and the exp copied to the player / other sleeves (Work.ts applySleeveGains). The sleeve's own exp, rep and shock recovery are unaffected,
    // so only bother syncing first when this sleeve's job will be crime for gang karma (or when --sync-first is set).
    const wantKarmaCrime = !playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000;
    if (sleeve.sync < 100 && (options['sync-first'] || wantKarmaCrime))
        return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `syncing... ${sleeve.sync.toFixed(2)}%`];
    // Opt to do shock recovery if above the --min-shock-recovery threshold
    if (sleeve.shock > options['min-shock-recovery'])
        return shockRecoveryTask(sleeve, i, `shock is above ${options['min-shock-recovery'].toFixed(0)}% (--min-shock-recovery)`);
    // To time-balance between being useful and recovering from shock more quickly - sleeves have a random chance to be put
    // on shock recovery. To avoid frequently interrupting tasks that take a while to complete, only re-roll every so often.
    if (sleeve.shock > 0 && options['shock-recovery'] > 0) {
        if (Date.now() - (lastRerollTime[i] || 0) >= rerollTime) { // Re-roll once the previous roll is at least rerollTime old (or has never been made)
            shockChance[i] = Math.random();
            lastRerollTime[i] = Date.now();
        }
        if (shockChance[i] < options['shock-recovery'])
            return shockRecoveryTask(sleeve, i, `there is a ${(options['shock-recovery'] * 100).toFixed(1)}% chance (--shock-recovery) of picking this task every minute until fully recovered.`);
    }
    // Train if our sleeve's physical stats aren't where we want them.
    // Class exp is scaled by shockBonus() = (100 - shock)/100 (src/PersonObjects/Sleeve/Work/SleeveClassWork.ts calculateRates) but the class
    // cost is not, so don't pay to train a heavily shocked sleeve (--train-max-shock). Also, installing any sleeve augmentation zeroes all of
    // its exp (src/PersonObjects/Sleeve/Sleeve.ts installAugmentation), so don't train while augs remain to be bought (--train-with-pending-augs).
    let augsPending = false;
    if (canTrain && sleeve.shock <= options['train-max-shock'] && !options['train-with-pending-augs'] && !sleeveExpDisabled)
        augsPending = (await getAvailableAugs(ns, i)).length > 0;
    if (canTrain && sleeve.shock <= options['train-max-shock'] && !augsPending) {
        const univClasses = {
            "hacking": ns.enums.UniversityClassType.algorithms,
            "charisma": ns.enums.UniversityClassType.leadership
        };
        let untrainedStats = trainStats.filter(stat => sleeve.skills[stat] < options[`train-to-${stat}`]);
        let untrainedSmarts = trainSmarts.filter(smart => sleeve.skills[smart] < options[`study-to-${smart}`]);

        // prioritize physical training
        if (untrainedStats.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns); // If we've never checked, see if we can train into debt.
            if (sleeve.city != ns.enums.CityName.Sector12) {
                log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Sector-12 so that they can study at Powerhouse Gym.`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Sector12]);
            }
            var trainStat = untrainedStats.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedStats[0]);
            var gym = ns.enums.LocationName.Sector12PowerhouseGym;
            return [
                `train ${trainStat} (${gym})`,
                `ns.sleeve.setToGymWorkout(ns.args[0], ns.args[1], ns.args[2])`,
                [i, gym, trainStat.slice(0, 3)], // Gym expects the short form stat names ('str', 'def', 'dex', 'agi')
                `training ${trainStat}... ${sleeve.skills[trainStat]}/${(options[`train-to-${trainStat}`])}`
            ];
            // if we're tough enough, flip over to studying to improve the mental stats
        } else if (untrainedSmarts.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns); // check we can go into training debt
            if (sleeve.city != ns.enums.CityName.Volhaven) {
                log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Volhaven so that they can study at ZB Institute.`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Volhaven]);
            }
            var trainSmart = untrainedSmarts.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedSmarts[0]);
            var univ = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
            var course = univClasses[trainSmart];
            return [
                `study ${trainSmart} (${univ})`,
                `ns.sleeve.setToUniversityCourse(ns.args[0], ns.args[1], ns.args[2])`,
                [i, univ, course],
                `studying ${trainSmart}... ${sleeve.skills[trainSmart]}/${(options[`study-to-${trainSmart}`])}`
            ];
        }
    }
    // If player is currently working for faction or company rep, a sleeve can help him out (Note: Only one sleeve can work for a faction)
    if (i == followPlayerSleeve && playerWorkInfo.type == "FACTION") {
        // TODO: We should be able to borrow logic from work-for-factions.js to have more sleeves work for useful factions / companies
        // We'll cycle through work types until we find one that is supported. TODO: Auto-determine the most productive faction work to do.
        const faction = playerWorkInfo.factionName;
        if (!factionsTakenThisLoop.includes(faction)) factionsTakenThisLoop.push(faction);
        return factionWorkTask(i, faction);
    } // Same as above if player is currently working for a megacorp
    if (i == followPlayerSleeve && playerWorkInfo.type == "COMPANY") {
        const companyName = playerWorkInfo.companyName;
        return [
            `work for company '${companyName}'`,
            `ns.sleeve.setToCompanyWork(ns.args[0], ns.args[1])`,
            [i, companyName],
            `helping earn rep with company ${companyName}.`
        ];
    }
    // If gangs are available, prioritize homicide until we've got the requisite -54K karma to unlock them
    if (!playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000)
        return await crimeTask(ns, 'Homicide', i, sleeve, 'we want gang karma'); // Ignore chance - even a failed homicide generates more Karma than every other crime
    // If the player is in bladeburner, and has already unlocked gangs with Karma, generate contracts and operations
    if (playerInBladeburner) {
        // Hack: Without paying much attention to what's happening in bladeburner, pre-assign a variety of tasks by sleeve index
        const bbTasks = [
            // Note: Sleeve 0 might still be used for faction work (unless --disable-follow-player is set), so don't assign them a 'unique' task
            /*0*/options['enable-bladeburner-team-building'] ? ["Support main sleeve"] : ["Infiltrate Synthoids"],
            // Note: Each contract type can only be performed by one sleeve at a time (similar to working for factions)
            /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
            // Other bladeburner work can be duplicated, but tackling a variety is probably useful. Overrides occur below
            /*4*/["Infiltrate Synthoids"], /*5*/["Diplomacy"], /*6*/["Field Analysis"],
            /*7*/options['enable-bladeburner-team-building'] ? ["Recruitment"] : ["Infiltrate Synthoids"]
        ];
        let [action, contractName] = bbTasks[i];
        const contractChance = bladeburnerContractChances[i] ?? 1; // Per-sleeve estimate (keyed by sleeve index, see mainLoop)
        const contractCount = bladeburnerContractCounts[contractName] ?? Infinity;
        const onCooldown = () => Date.now() <= bladeburnerCooldown[i]; // Function to check if we're on cooldown
        // Detect if the sleeve recently failed the task. If so, put them on a "cooldown" before trying again
        if (sleeve.hp.current < lastSleeveHp[i] || sleeve.shock > lastSleeveShock[i]) {
            bladeburnerCooldown[i] = Date.now() + options['failed-bladeburner-contract-cooldown'];
            log(ns, `Sleeve ${i} appears to have recently failed its designated bladeburner task '${action} - ${contractName}' ` +
                `(HP ${lastSleeveHp[i].toFixed(1)} -> ${sleeve.hp.current.toFixed(1)}, ` +
                `Shock: ${lastSleeveShock[i].toFixed(2)} -> ${sleeve.shock.toFixed(2)}). ` +
                `Will try again in ${formatDuration(options['failed-bladeburner-contract-cooldown'])}`);
        } // If the contract success chance appears too low, or there are insufficient contracts remaining, smaller cooldown
        else if (!onCooldown() && (contractChance <= minBbProbability || contractCount < minBbContracts)) {
            bladeburnerCooldown[i] = Date.now() + waitForContractCooldown;
            log(ns, `Delaying sleeve ${i} designated bladeburner task '${action} - ${contractName}' - ` +
                (contractCount < minBbContracts ? `Insufficient contract count (${contractCount} < ${minBbContracts})` :
                    `Player chance is too low (${(contractChance * 100).toFixed(2)}% < ${(minBbProbability * 100)}%). `) +
                `Will try again in ${formatDuration(waitForContractCooldown)}`);
        }
        // As current city chaos gets progressively bad, assign more and more sleeves to Diplomacy to help get it under control
        if (bladeburnerCityChaos > (10 - i) * 10) // Later sleeves are first to get assigned, sleeve 0 is last at 100 chaos.
            [action, contractName] = ["Diplomacy"];
        // If the sleeve is on cooldown ,do not perform their designated bladeburner task
        else if (onCooldown()) { // When on cooldown from a failed task, recover shock if applicable, or else add contracts
            if (sleeve.shock > 0) return shockRecoveryTask(sleeve, i, `bladeburner task is on cooldown`);
            [action, contractName] = ["Infiltrate Synthoids"]; // Fall-back to something long-term useful
        }
        return [`Bladeburner ${action} ${contractName || ''}`.trimEnd(),
        /*   */ `ns.sleeve.setToBladeburnerAction(ns.args[0], ns.args[1], ns.args[2])`, [i, action, contractName ?? ''],
        /*   */ `doing ${action}${contractName ? ` - ${contractName}` : ''} in Bladeburner.`];
    }
    // Each faction accepts one sleeve (src/NetscriptFunctions/Sleeve.ts setToFactionWork), so up to --max-faction-sleeves sleeves can each work
    // for a different joined faction that still needs rep for augmentations (lowest rep first). Rep earned is scaled by (100 - shock)%.
    if (sleeve.shock <= options['faction-work-max-shock'] && factionsTakenThisLoop.length < options['max-faction-sleeves']) {
        // Keep a sleeve on the faction it already works for, and never hand another sleeve's current faction to this one: the game throws
        // (src/NetscriptFunctions/Sleeve.ts setToFactionWork "Sleeve X cannot work for faction F because Sleeve Y is already working for them")
        // and the candidate list is re-sorted by rep every refresh, so a naive "first free candidate" pick can swap two sleeves' factions
        // and make both assignments fail (which setSleeveTask would otherwise misread as the work type being unsupported).
        const isFree = f => !factionsTakenThisLoop.includes(f) && !factionWorkUnsupported[f] &&
            !Object.entries(factionBySleeve).some(([j, held]) => Number(j) != i && held == f);
        const current = factionBySleeve[i];
        const faction = (current && factionWorkCandidates.includes(current) && isFree(current)) ? current : factionWorkCandidates.find(isFree);
        if (faction) {
            factionsTakenThisLoop.push(faction);
            return factionWorkTask(i, faction);
        }
    }
    // If darknet.js is waiting on the player's charisma to unlock its next blocked action, put an otherwise-idle, healthy sleeve to studying Leadership too
    // Only the player's charisma matters for that goal, and a sleeve's class exp reaches the player scaled by its sync%
    // (src/PersonObjects/Sleeve/Work/Work.ts applySleeveGains: applyWorkStatsExp(Player, stats, mult * sleeve.syncBonus())), so an
    // unsynchronised sleeve (sync starts at max(memory, 1)%) would pay ZB Institute tuition for ~1% of the exp. Synchronising first is not
    // an option either: SleeveSynchroWork gains ~0.0002 sync per 200 ms cycle, i.e. a day per sleeve. So only sleeves that already
    // carry a meaningful sync (from purchased memory) take this job.
    if (options['darknet-charisma'] && canTrain && sleeve.shock <= options['train-max-shock'] && sleeve.sync >= darknetCharismaMinSync) {
        const charismaGoal = Number(ns.read("/Temp/darknet-charisma-goal.txt")) || 0;
        if (charismaGoal > playerInfo.skills.charisma) {
            if (sleeve.city != ns.enums.CityName.Volhaven) {
                log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Volhaven so that they can study at ZB Institute.`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Volhaven]);
            }
            const darknetUniv = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
            const darknetCourse = ns.enums.UniversityClassType.leadership;
            return [
                `study charisma for darknet (${darknetUniv})`,
                `ns.sleeve.setToUniversityCourse(ns.args[0], ns.args[1], ns.args[2])`,
                [i, darknetUniv, darknetCourse],
                `studying Leadership to help reach the darknet charisma goal of ${charismaGoal} (player currently at ${playerInfo.skills.charisma}).`
            ];
        }
    }
    // If there's nothing more productive to do (above) and there's still shock, prioritize recovery
    if (sleeve.shock > 0)
        return shockRecoveryTask(sleeve, i, `there appears to be nothing better to do`);
    // Finally, do crime for Karma. Pick the best crime based on success chances
    var crime = options.crime || (await calculateCrimeChance(ns, sleeve, "Homicide")) >= options['homicide-chance-threshold'] ? 'Homicide' : 'Mug';
    return await crimeTask(ns, crime, i, sleeve, `there appears to be nothing better to do`);
}

/** Helper to prepare a faction work task. We'll cycle through work types until we find one that is supported (see setSleeveTask).
 * TODO: Auto-determine the most productive faction work to do. */
function factionWorkTask(i, faction) {
    const work = works[workByFaction[faction] || 0];
    return [
        `work for faction '${faction}' (${work})`,
        `ns.sleeve.setToFactionWork(ns.args[0], ns.args[1], ns.args[2])`,
        [i, faction, work],
        `helping earn rep with faction ${faction} by doing ${work} work.`
    ];
}

/** Helper to prepare the shock recovery task
 * @param {SleevePerson} sleeve */
function shockRecoveryTask(sleeve, i, reason) {
    return [`recover from shock`, `ns.sleeve.setToShockRecovery(ns.args[0])`, [i],
    /*   */ `recovering from shock (${sleeve.shock.toFixed(2)}%) beacause ${reason}...`];
}

/** Helper to prepare the crime task
 * @param {NS} ns
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} a 4-tuple of task name, command, args, and status message */
async function crimeTask(ns, crime, i, sleeve, reason) {
    const successChance = await calculateCrimeChance(ns, sleeve, crime);
    return [`commit ${crime}`, `ns.sleeve.setToCommitCrime(ns.args[0], ns.args[1])`, [i, crime],
    /*   */ `committing ${crime} with chance ${(successChance * 100).toFixed(2)}% because ${reason}` +
    /*   */ (options.crime || crime == "Homicide" ? '' : // If auto-criming, user may be curious how close we are to switching to homicide
    /*   */     ` (Note: Homicide chance would be ${((await calculateCrimeChance(ns, sleeve, "Homicide")) * 100).toFixed(2)}%)`)];
}


/** Sets a sleeve to its designated task, with some extra error handling logic for working for factions.
 * @param {NS} ns
 * @param {number} i - Sleeve number
 * @param {string} designatedTask - string describing the designated task
 * @param {string} command - dynamic command to initiate this work
 * @param {any[]} args - arguments consumed by the dynamic command
 * */
async function setSleeveTask(ns, i, designatedTask, command, args) {
    let strAction = `Set sleeve ${i} to ${designatedTask}`;
    let failureReason = '';
    try { // Assigning a task can throw an error rather than simply returning false. We must suppress this
        if (await getNsDataThroughFile(ns, command, `/Temp/sleeve-${command.slice(10, command.indexOf("("))}.txt`, args)) {
            task[i] = designatedTask;
            if (designatedTask.startsWith('work for faction')) factionBySleeve[i] = args[1]; else delete factionBySleeve[i];
            log(ns, `SUCCESS: ${strAction}`);
            return true;
        }
    } catch (err) { failureReason = getErrorInfo(err); }
    // If assigning the task failed...
    lastRerollTime[i] = 0;
    // If working for a faction, it's possible he current work isn't supported, so try the next one.
    if (designatedTask.startsWith('work for faction')) {
        const faction = args[1]; // Hack: Not obvious, but the second argument will be the faction name in this case.
        delete factionBySleeve[i]; // Whatever the reason, this sleeve is not working for the faction
        // A faction only accepts one sleeve at a time (src/NetscriptFunctions/Sleeve.ts setToFactionWork). That failure is transient
        // (e.g. this script was restarted while another sleeve still works there) and says nothing about the work type, so don't blacklist.
        if (failureReason.includes('is already working for them')) {
            log(ns, `INFO: Failed to ${strAction} because another sleeve is still working for ${faction}. Will retry once it has been reassigned.`);
            return false;
        }
        let nextWorkIndex = (workByFaction[faction] || 0) + 1;
        if (nextWorkIndex >= works.length) {
            log(ns, `WARN: Failed to ${strAction}. None of the ${works.length} work types appear to be supported. ` +
                `Other sleeves will no longer be assigned to this faction (it may be our gang's faction, or offer no work).`, true, 'warning');
            factionWorkUnsupported[faction] = true;
            nextWorkIndex = 0;
        } else
            log(ns, `INFO: Failed to ${strAction} - work type may not be supported. Trying the next work type (${works[nextWorkIndex]})`);
        workByFaction[faction] = nextWorkIndex;
    } else if (designatedTask.startsWith('Bladeburner')) { // Bladeburner action may be out of operations
        bladeburnerCooldown[i] = Date.now(); // There will be a cooldown before this task is assigned again.
    } else
        log(ns, `ERROR: Failed to ${strAction}`, true, 'error');
    return false;
}

let promptedForTrainingBudget = false;
/** @param {NS} ns
 * For when we are at risk of going into debt while training with sleeves.
 * Contains some fancy logic to spawn an external script that will prompt the user and wait for an answer. */
async function promptForTrainingBudget(ns) {
    if (promptedForTrainingBudget) return;
    promptedForTrainingBudget = true;
    await ns.write(trainingReserveFile, '', "w");
    if (options['training-reserve'] === null && !options['disable-training'])
        await runCommand(ns, `let ans = await ns.prompt("Do you want to let sleeves put you in debt while they train?"); \n` +
            `await ns.write("${trainingReserveFile}", ans ? '-1E100' : '0', "w")`, '/Temp/sleeves-training-reserve-prompt.js');
}

/** @param {NS} ns
 * @param {SleevePerson} sleeve
 * Calculate the chance a sleeve has of committing homicide successfully. */
async function calculateCrimeChance(ns, sleeve, crimeName) {
    // If not in the cache, retrieve this crime's stats
    const crimeStats = cachedCrimeStats[crimeName] ?? (cachedCrimeStats[crimeName] = (4 in ownedSourceFiles ?
        await getNsDataThroughFile(ns, `ns.singularity.getCrimeStats(ns.args[0])`, null, [crimeName]) :
        // Hack: To support players without SF4, hard-code values as of the current release
        crimeName == "Homicide" ? { difficulty: 1, strength_success_weight: 2, defense_success_weight: 2, dexterity_success_weight: 0.5, agility_success_weight: 0.5 } :
            crimeName == "Mug" ? { difficulty: 0.2, strength_success_weight: 1.5, defense_success_weight: 0.5, dexterity_success_weight: 1.5, agility_success_weight: 0.5, } :
                undefined));
    let chance =
        (crimeStats.hacking_success_weight || 0) * sleeve.skills.hacking +
        (crimeStats.strength_success_weight || 0) * sleeve.skills.strength +
        (crimeStats.defense_success_weight || 0) * sleeve.skills.defense +
        (crimeStats.dexterity_success_weight || 0) * sleeve.skills.dexterity +
        (crimeStats.agility_success_weight || 0) * sleeve.skills.agility +
        (crimeStats.charisma_success_weight || 0) * sleeve.skills.charisma;
    chance /= 975;
    chance /= crimeStats.difficulty;
    return Math.min(chance, 1);
}
