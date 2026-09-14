import { formatMoney, formatRam, getConfiguration, getNsDataThroughFile, log } from '../helpers.js'

const max_ram = 2 ** 30;
const max_cores = 8; // Game: src/NetscriptFunctions/Singularity.ts upgradeHomeCores refuses once cpuCores >= 8
const argsSchema = [
    ['budget', 0.2], // Spend up to this much of current cash on ram upgrades per tick (Default is high, because these are permanent for the rest of the BN)
    ['reserve', null], // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
    // Set to true to skip buying home CPU cores. Cores boost grow/weaken/share scripts run on home by 1 + (cores - 1) / 16 (src/Server/ServerHelpers.ts getCoreBonus),
    // and daemon.js schedules those scripts on home preferentially. Cores are bought with whatever budget is left after RAM upgrades.
    ['no-cores', false],
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const reserve = (options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0));
    const money = await getNsDataThroughFile(ns, `ns.getServerMoneyAvailable(ns.args[0])`, null, ["home"]);
    let spendable = Math.min(money - reserve, money * options.budget);
    if (isNaN(spendable))
        return log(ns, `ERROR: One of the arguments could not be parsed as a number: ${JSON.stringify(options)}`, true, 'error');
    // RAM first (it benefits every script), then spend whatever budget is left on cores
    spendable = await buyHomeRam(ns, spendable, money);
    if (!options['no-cores'] && spendable > 0)
        await buyHomeCores(ns, spendable, money);
}

/** Quickly buy as many home RAM upgrades as we can within the budget
 * @param {NS} ns
 * @returns {Promise<number>} The budget remaining after any purchases **/
async function buyHomeRam(ns, spendable, money) {
    do {
        let cost = await getNsDataThroughFile(ns, `ns.singularity.getUpgradeHomeRamCost()`);
        let currentRam = await getNsDataThroughFile(ns, `ns.getServerMaxRam(ns.args[0])`, null, ["home"]);
        if (cost >= Number.MAX_VALUE || currentRam == max_ram) {
            log(ns, `INFO: We're at max home RAM (${formatRam(currentRam)})`);
            return spendable;
        }
        const nextRam = currentRam * 2;
        const upgradeDesc = `home RAM from ${formatRam(currentRam)} to ${formatRam(nextRam)} (cost: ${formatMoney(cost)})`;
        if (spendable < cost) {
            log(ns, `Money we're allowed to spend (${formatMoney(spendable)}) is less than the cost (${formatMoney(cost)}) to upgrade ${upgradeDesc}`);
            return spendable;
        }
        if (!(await getNsDataThroughFile(ns, `ns.singularity.upgradeHomeRam()`))) {
            log(ns, `ERROR: Failed to upgrade ${upgradeDesc} thinking we could afford it ` +
                `(cash: ${formatMoney(money)} budget: ${formatMoney(spendable)})`, true, 'error');
            return spendable;
        }
        // Otherwise, we've successfully upgraded home ram.
        log(ns, `SUCCESS: Upgraded ${upgradeDesc}`, true, 'success');
        const newMaxRam = await getNsDataThroughFile(ns, `ns.getServerMaxRam(ns.args[0])`, null, ["home"]);
        if (nextRam != newMaxRam)
            log(ns, `WARNING: Expected to upgrade ${upgradeDesc}, but new home ram is ${newMaxRam}`, true, 'warning');
        // Only loop again if we successfully upgraded home ram, to see if we can upgrade further
        spendable -= cost;
        await ns.sleep(100); // On the off-chance we have an infinite loop bug, this makes us killable.
    } while (spendable > 0)
    return spendable;
}

/** Buy home CPU cores while they fit in the remaining budget. Note: ns.singularity.upgradeHomeCores / getUpgradeHomeCoresCost cost the same
 * RAM as their RAM-upgrade counterparts (src/Netscript/RamCostGenerator.ts SingularityFn2), and are ram-dodged the same way.
 * @param {NS} ns
 * @returns {Promise<number>} The budget remaining after any purchases **/
async function buyHomeCores(ns, spendable, money) {
    do {
        const cores = await getNsDataThroughFile(ns, `ns.getServer(ns.args[0]).cpuCores`, '/Temp/home-cpu-cores.txt', ["home"]);
        if (cores >= max_cores) {
            log(ns, `INFO: We're at max home cores (${cores})`);
            return spendable;
        }
        // Game: cost = 1e9 * 7.5 ^ cores (src/PersonObjects/Player/PlayerObjectServerMethods.ts getUpgradeHomeCoresCost)
        const cost = await getNsDataThroughFile(ns, `ns.singularity.getUpgradeHomeCoresCost()`);
        const upgradeDesc = `home cores from ${cores} to ${cores + 1} (cost: ${formatMoney(cost)})`;
        if (spendable < cost) {
            log(ns, `Money we're allowed to spend (${formatMoney(spendable)}) is less than the cost (${formatMoney(cost)}) to upgrade ${upgradeDesc}`);
            return spendable;
        }
        if (!(await getNsDataThroughFile(ns, `ns.singularity.upgradeHomeCores()`))) {
            log(ns, `ERROR: Failed to upgrade ${upgradeDesc} thinking we could afford it ` +
                `(cash: ${formatMoney(money)} budget: ${formatMoney(spendable)})`, true, 'error');
            return spendable;
        }
        log(ns, `SUCCESS: Upgraded ${upgradeDesc}`, true, 'success');
        spendable -= cost;
        await ns.sleep(100); // On the off-chance we have an infinite loop bug, this makes us killable.
    } while (spendable > 0)
    return spendable;
}
