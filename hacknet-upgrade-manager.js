import { getConfiguration, disableLogs, formatDuration, formatMoney, } from './helpers.js'

let haveHacknetServers = true; // Cached flag after detecting whether we do (or don't) have hacknet servers
const argsSchema = [
    ['max-payoff-time', '1h'], // Controls how far to upgrade hacknets. Can be a number of seconds, or an expression of minutes/hours (e.g. '123m', '4h')
    ['time', null], // alias for max-payoff-time
    ['c', false], // Set to true to run continuously, otherwise, it runs once
    ['continuous', false],
    ['interval', 1000], // Rate at which the program purchases upgrades when running continuously
    ['max-spend', Number.MAX_VALUE], // The maximum amount of money to spend on upgrades
    ['toast', false], // Set to true to toast purchases
    ['reserve', null], // Reserve this much cash (defaults to contents of reserve.txt if not specified)
    ['legacy-production-estimates', false], // Set to true to restore the old marginal-production estimates (hacknet *server* formulas applied to hacknet nodes too, and no Formulas API). By default we use the exact game formulas for nodes vs servers, and ns.formulas.hacknet* when Formulas.exe is available.
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const continuous = options.c || options.continuous;
    const interval = options.interval;
    let maxSpend = options["max-spend"];
    let maxPayoffTime = options['time'] || options['max-payoff-time'];
    // A little string parsing to be more user friendly
    if (maxPayoffTime && String(maxPayoffTime).endsWith("m"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("m", "")) * 60
    else if (maxPayoffTime && String(maxPayoffTime).endsWith("h"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("h", "")) * 3600
    else
        maxPayoffTime = Number.parseFloat(maxPayoffTime);
    disableLogs(ns, ['sleep', 'getServerUsedRam', 'getServerMoneyAvailable']);
    setStatus(ns, `Starting hacknet-upgrade-manager with purchase payoff time limit of ${formatDuration(maxPayoffTime * 1000)} and ` +
        (maxSpend == Number.MAX_VALUE ? 'no spending limit' : `a spend limit of ${formatMoney(maxSpend)}`) +
        `. Current fleet: ${ns.hacknet.numNodes()} nodes...`);
    do {
        try {
            const moneySpent = upgradeHacknet(ns, maxSpend, maxPayoffTime, options);
            // Using this method, we cannot know for sure that we don't have hacknet servers until we have purchased one
            if (haveHacknetServers && ns.hacknet.numNodes() > 0 && ns.hacknet.hashCapacity() == 0)
                haveHacknetServers = false;
            if (maxSpend && moneySpent === false) {
                setStatus(ns, `Spending limit reached. Breaking...`);
                break; // Hack, but we return a non-number (false) when we've bought all we can for the current config
            }
            maxSpend -= moneySpent;
        }
        catch (err) {
            setStatus(ns, `WARNING: hacknet-upgrade-manager.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        if (continuous) await ns.sleep(interval);
    } while (continuous);
}

let lastUpgradeLog = "";
function setStatus(ns, logMessage) {
    if (logMessage != lastUpgradeLog) ns.print(lastUpgradeLog = logMessage);
}

// HN-1: upgrade cost constants from src/Hacknet/data/Constants.ts (HacknetNodeConstants / HacknetServerConstants)
const hacknetNodeCostConstants = { levelBaseCost: 500, ramBaseCost: 30e3, coreBaseCost: 500e3, upgradeLevelMult: 1.04, upgradeRamMult: 1.28, upgradeCoreMult: 1.48, levelExponentOffset: 1 };
const hacknetServerCostConstants = { levelBaseCost: 10 * 50e3, ramBaseCost: 200e3, coreBaseCost: 1e6, upgradeLevelMult: 1.1, upgradeRamMult: 1.4, upgradeCoreMult: 1.55, levelExponentOffset: 0 };

/** HN-1: money needed to take a fresh node/server (level 1, 1 GB, 1 core) to the given level, ram and cores, transcribed from the game's
 * cost formulas (src/Hacknet/formulas/HacknetNodes.ts and HacknetServers.ts calculateLevelUpgradeCost / calculateRamUpgradeCost /
 * calculateCoreUpgradeCost, which ns.hacknet.get*UpgradeCost and ns.formulas.hacknet* call). Servers: 10*BaseCost*sum_{L=1}^{level-1} 1.1^L;
 * nodes: LevelBaseCost*sum_{L=1}^{level-1} 1.04^(L-1). RAM (both): sum over doublings r=1,2,..,ram/2 of r*RamBaseCost*UpgradeRamMult^log2(r).
 * Cores (both): CoreBaseCost*sum_{c=1}^{cores-1} UpgradeCoreMult^(c-1). Each component is scaled by the player's cost multiplier.
 * @param {boolean} isServer @param {number} level @param {number} ram @param {number} cores
 * @param {{hacknet_node_level_cost?: number, hacknet_node_ram_cost?: number, hacknet_node_core_cost?: number}} mults */
export function costToMatchStats(isServer, level, ram, cores, mults = {}) {
    const c = isServer ? hacknetServerCostConstants : hacknetNodeCostConstants;
    let levelCost = 0;
    for (let l = 1; l < level; l++) levelCost += Math.pow(c.upgradeLevelMult, l - c.levelExponentOffset);
    levelCost *= c.levelBaseCost * (mults.hacknet_node_level_cost ?? 1);
    let ramCost = 0;
    for (let r = 1, n = 0; r < ram; r *= 2, n++) ramCost += r * c.ramBaseCost * Math.pow(c.upgradeRamMult, n);
    ramCost *= mults.hacknet_node_ram_cost ?? 1;
    let coreCost = 0;
    for (let k = 1; k < cores; k++) coreCost += Math.pow(c.upgradeCoreMult, k - 1);
    coreCost *= c.coreBaseCost * (mults.hacknet_node_core_cost ?? 1);
    return levelCost + ramCost + coreCost;
}

// Will buy the most effective hacknet upgrade, so long as it will pay for itself in the next {payoffTimeSeconds} seconds.
/** @param {NS} ns **/
export function upgradeHacknet(ns, maxSpend, maxPayoffTimeSeconds = 3600 /* 3600 sec == 1 hour */, options) {
    const playerMults = ns.getPlayer().mults;
    const currentHacknetMult = playerMults.hacknet_node_money;
    // Detect up-front whether we have hacknet nodes or hacknet servers (hashCapacity is 0 for plain nodes), so the right formulas are used from the first purchase
    if (haveHacknetServers && ns.hacknet.numNodes() > 0 && ns.hacknet.hashCapacity() == 0)
        haveHacknetServers = false;
    // Get the lowest cache level, we do not consider upgrading the cache level of servers above this until all have the same cache level
    const minCacheLevel = [...Array(ns.hacknet.numNodes()).keys()].reduce((min, i) => Math.min(min, ns.hacknet.getNodeStats(i).cache), Number.MAX_VALUE);
    const legacyEstimates = options?.['legacy-production-estimates'] ?? false;
    // Production of a node/server with the given stats via the Formulas API (exact; 0 RAM per RamCostGenerator formulas.hacknetNodes/hacknetServers, but throws without Formulas.exe)
    const fnProduction = (level, ram, cores) => haveHacknetServers ?
        ns.formulas.hacknetServers.hashGainRate(level, 0, ram, cores, currentHacknetMult) : // (level, ramUsed, maxRam, cores, mult)
        ns.formulas.hacknetNodes.moneyGainRate(level, ram, cores, currentHacknetMult); // (level, ram, cores, mult)
    let formulasAvailable = true;
    try { fnProduction(1, 1, 1); } catch { formulasAvailable = false; }
    const haveFormulas = formulasAvailable && !legacyEstimates; // Whether to use the formulas API for exact marginal production
    // Relative production gain from a single upgrade, used when the formulas API is unavailable. Derived from the game's production formulas:
    //   Hacknet Nodes   (src/Hacknet/formulas/HacknetNodes.ts calculateMoneyGainRate):  level * gainPerLevel * 1.035^(ram - 1) * (cores + 5) / 6 * mult * BN
    //   Hacknet Servers (src/Hacknet/formulas/HacknetServers.ts calculateHashGainRate): hashesPerLevel * level * 1.07^log2(ram) * (1 + (cores - 1) / 5) * mult * BN
    // (The legacy estimates applied the server formulas to plain nodes as well, which over-values cores and under-values RAM on nodes.)
    const useServerFormulas = haveHacknetServers || legacyEstimates;
    const relativeGain = {
        level: s => (s.level + 1) / s.level - 1, // Linear in level for both nodes and servers
        ram: s => useServerFormulas ? 0.07 : Math.pow(1.035, s.ram) - 1, // Servers: 1.07^log2(2r) / 1.07^log2(r) = 1.07. Nodes: 1.035^(2r-1) / 1.035^(r-1) = 1.035^r
        cores: s => useServerFormulas ? (s.cores + 5) / (s.cores + 4) - 1 : (s.cores + 6) / (s.cores + 5) - 1, // Servers: ((c+1)+4)/(c+4). Nodes: ((c+1)+5)/(c+5)
    };
    const addedProduction = (s, stat) => {
        if (haveFormulas) { // Exact marginal production from the formulas API
            const next = { level: s.level, ram: s.ram, cores: s.cores };
            next[stat] = stat == "ram" ? s.ram * 2 : next[stat] + 1;
            return fnProduction(next.level, next.ram, next.cores) - fnProduction(s.level, s.ram, s.cores);
        }
        return s.production * relativeGain[stat](s);
    };
    const upgrades = [{ name: "none", cost: 0 }, {
        name: "level", upgrade: ns.hacknet.upgradeLevel, cost: i => ns.hacknet.getLevelUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.level + 1,
        addedProduction: nodeStats => addedProduction(nodeStats, "level")
    }, {
        name: "ram", upgrade: ns.hacknet.upgradeRam, cost: i => ns.hacknet.getRamUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.ram * 2,
        addedProduction: nodeStats => addedProduction(nodeStats, "ram")
    }, {
        name: "cores", upgrade: ns.hacknet.upgradeCore, cost: i => ns.hacknet.getCoreUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.cores + 1,
        addedProduction: nodeStats => addedProduction(nodeStats, "cores")
    }, {
        name: "cache", upgrade: ns.hacknet.upgradeCache, cost: i => ns.hacknet.getCacheUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.cache + 1,
        addedProduction: nodeStats => nodeStats.cache > minCacheLevel || !haveHacknetServers ? 0 : nodeStats.production * 0.01 / nodeStats.cache // Note: Does not actually give production, but it has "worth" to us so we can buy more things
    }];
    // Find the best upgrade we can make to an existing node
    let nodeToUpgrade = -1;
    let bestUpgrade;
    let bestUpgradePayoff = 0; // Hashes per second per dollar spent. Bigger is better.
    let cost = 0;
    let upgradedValue = 0;
    let worstNodeProduction = Number.MAX_VALUE; // Used to how productive a newly purchased node might be
    let worstNodeStats = null, worstNodeIndex = -1; // HN-1: the (level, ram, cores) a new node must be upgraded to before it produces worstNodeProduction
    for (var i = 0; i < ns.hacknet.numNodes(); i++) {
        let nodeStats = ns.hacknet.getNodeStats(i);
        if (haveHacknetServers && formulasAvailable) // When a hacknet server runs scripts, nodeStats.production lags behind what it should be for current ram usage. Get the "raw" rate
            nodeStats.production = fnProduction(nodeStats.level, nodeStats.ram, nodeStats.cores);
        // (If we do not have the formulas API yet, we cannot account for this and must simply fall-back to using the production reported by the node)
        if (nodeStats.production < worstNodeProduction) [worstNodeStats, worstNodeIndex] = [nodeStats, i];
        worstNodeProduction = Math.min(worstNodeProduction, nodeStats.production);
        for (let up = 1; up < upgrades.length; up++) {
            let currentUpgradeCost = upgrades[up].cost(i);
            let payoff = upgrades[up].addedProduction(nodeStats) / currentUpgradeCost; // Production (Hashes per second) per dollar spent
            if (payoff > bestUpgradePayoff) {
                nodeToUpgrade = i;
                bestUpgrade = upgrades[up];
                bestUpgradePayoff = payoff;
                cost = currentUpgradeCost;
                upgradedValue = upgrades[up].nextValue(nodeStats);
            }
        }
    }
    // Compare this to the cost of adding a new node. A new node produces next to nothing (level 1, 1 GB, 1 core) until it has been upgraded to
    // match our worst existing node, so (HN-1) the worst node's production is priced at the node cost PLUS the upgrades needed to reach its
    // level, ram and cores: the game's cost formulas via ns.formulas when available, otherwise the same formulas transcribed in costToMatchStats.
    // (Each of those upgrades is later tested against the payoff limit individually, so without this the true payoff of node + upgrades was ~2x the limit.)
    let newNodeCost = ns.hacknet.getPurchaseNodeCost();
    const fnCosts = haveHacknetServers ? ns.formulas.hacknetServers : ns.formulas.hacknetNodes;
    const upgradeCostToMatchWorst = worstNodeStats == null ? 0 : haveFormulas ?
        fnCosts.levelUpgradeCost(1, worstNodeStats.level - 1, playerMults.hacknet_node_level_cost) +
        fnCosts.ramUpgradeCost(1, Math.log2(worstNodeStats.ram), playerMults.hacknet_node_ram_cost) +
        fnCosts.coreUpgradeCost(1, worstNodeStats.cores - 1, playerMults.hacknet_node_core_cost) :
        costToMatchStats(haveHacknetServers, worstNodeStats.level, worstNodeStats.ram, worstNodeStats.cores, playerMults);
    let newNodePayoff = ns.hacknet.numNodes() == ns.hacknet.maxNumNodes() ? 0 : worstNodeProduction / (newNodeCost + upgradeCostToMatchWorst);
    let shouldBuyNewNode = newNodePayoff > bestUpgradePayoff;
    if (newNodePayoff == 0 && bestUpgradePayoff == 0) {
        setStatus(ns, `All upgrades have no value (is hashNet income disabled in this BN?)`);
        return false; // As long as maxSpend doesn't change, we will never purchase another upgrade
    }
    // If specified, only buy upgrades that will pay for themselves in {payoffTimeSeconds}.
    const hashDollarValue = haveHacknetServers ? 2.5e5 : 1; // Dollar value of one hash-per-second (0.25m dollars per production).
    let payoffTimeSeconds = 1 / (hashDollarValue * (shouldBuyNewNode ? newNodePayoff : bestUpgradePayoff));
    if (shouldBuyNewNode) cost = newNodeCost;

    // Prepare info about the next uprade. Whether we end up purchasing or not, we will display this info.
    let strPurchase = (shouldBuyNewNode ? `a new node "hacknet-node-${ns.hacknet.numNodes()}"` :
        `hacknet-node-${nodeToUpgrade} ${bestUpgrade.name} ${upgradedValue}`) + ` for ${formatMoney(cost)}` +
        (shouldBuyNewNode && upgradeCostToMatchWorst > 0 ? ` (+ ${formatMoney(upgradeCostToMatchWorst)} of upgrades to match hacknet-node-${worstNodeIndex})` : '');
    let strPayoff = `production ${(shouldBuyNewNode ? worstNodeProduction : bestUpgradePayoff * cost).toPrecision(3)} payoff time: ${formatDuration(1000 * payoffTimeSeconds)}`
    if (cost > maxSpend) {
        setStatus(ns, `The next best purchase would be ${strPurchase}, but the cost exceeds the spending limit (${formatMoney(maxSpend)})`);
        return false; // Shut-down. As long as maxSpend doesn't change, we will never purchase another upgrade
    }
    if (payoffTimeSeconds > maxPayoffTimeSeconds) {
        setStatus(ns, `The next best purchase would be ${strPurchase}, but the ${strPayoff} is worse than the limit (${formatDuration(1000 * maxPayoffTimeSeconds)})`);
        return false; // Shut-down. As long as maxPayoffTimeSeconds doesn't change, we will never purchase another upgrade
    }
    const reserve = (options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0));
    const playerMoney = ns.getPlayer().money;
    if (cost > playerMoney - reserve) {
        setStatus(ns, `The next best purchase would be ${strPurchase}, but the cost exceeds the our ` +
            `current available funds` + (reserve == 0 ? '.' : ` (after reserving ${formatMoney(reserve)}).`));
        return 0; //
    }
    let success = shouldBuyNewNode ? ns.hacknet.purchaseNode() !== -1 : bestUpgrade.upgrade(nodeToUpgrade, 1);
    if (success && options.toast) ns.toast(`Purchased ${strPurchase}`, 'success');
    setStatus(ns, success ? `Purchased ${strPurchase} with ${strPayoff}` : `Insufficient funds to purchase the next best upgrade: ${strPurchase}`);
    return success ? cost : 0;
}