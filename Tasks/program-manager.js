import { getConfiguration, formatMoney } from '../helpers.js'

// Every program purchasable on the darkweb, with its price (src/DarkWeb/DarkWebItems.ts - prices are fixed constants, no multipliers apply),
// in purchase-priority order. Port crackers come first: while any cracker is missing, nothing else is bought.
// Note: STORM_SEED.exe is not purchasable (src/Programs/Programs.ts), and daemon.js keeps a matching list to decide when to (re)launch us.
const darkwebPrograms = [
    // Port crackers (needed to root servers)
    { name: "BruteSSH.exe", price: 500e3, cracker: true },
    { name: "FTPCrack.exe", price: 1500e3, cracker: true },
    { name: "relaySMTP.exe", price: 5e6, cracker: true },
    { name: "HTTPWorm.exe", price: 30e6, cracker: true },
    { name: "SQLInject.exe", price: 250e6, cracker: true },
    // Cheap terminal utilities (nice to have)
    { name: "ServerProfiler.exe", price: 500e3 },
    { name: "DeepscanV1.exe", price: 500e3 },
    { name: "AutoLink.exe", price: 1e6 },
    { name: "DeepscanV2.exe", price: 25e6 },
    // 3.0: Unlocks access to the Dark Net (src/DarkNet/Constants.ts DarkscapeNavigatorPrice)
    { name: "DarkscapeNavigator.exe", price: 50e6 },
    // Unlocks the formulas API (lets daemon.js / analyze-hack.js compute exact thread counts). Expensive, see --formulas-money-multiple
    { name: "Formulas.exe", price: 5e9 },
];

const argsSchema = [
    ['c', false], // Set to true to run continuously until every program is purchased (by default we run once, daemon.js re-launches us periodically)
    ['run-continuously', false], // Long-form alias for the above flag
    ['interval', 2000], // (ms) Delay between purchase attempts when running continuously
    // Formulas.exe costs $5b. Only buy it once our money is this many multiples of its price, so that it doesn't starve early progress
    // (home RAM, servers, augmentations). Set to 1 to buy it as soon as it is affordable.
    ['formulas-money-multiple', 10],
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns
 * the purpose of the program-manager is to buy all the programs
 * from the darkweb we can afford so we don't have to do it manually
 * or write them ourselves. Like tor-manager, this script dies a natural death
 * once all programs are bought. **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const keepRunning = options.c || options['run-continuously'];
    if (!keepRunning)
        ns.print(`program-manager will run once. Run with argument "-c" to run continuously.`)

    /** Attempt to buy each missing program in priority order. @returns {number} The number of programs we still do not own. */
    const purchasePass = () => {
        let missing = 0, crackerMissing = false;
        let money = ns.getServerMoneyAvailable("home");
        for (const program of darkwebPrograms) {
            if (ns.fileExists(program.name, "home")) continue;
            missing++;
            if (crackerMissing && !program.cracker) continue; // Save our money for the port crackers before buying anything else
            if (program.name == "Formulas.exe" && money < program.price * options['formulas-money-multiple']) {
                ns.print(`Waiting to buy ${program.name} (${formatMoney(program.price)}) until we have ${options['formulas-money-multiple']}x its price ` +
                    `(--formulas-money-multiple). Current money: ${formatMoney(money)}`);
                continue;
            }
            if (ns.singularity.purchaseProgram(program.name)) {
                ns.toast(`Purchased ${program.name}`, 'success');
                money -= program.price;
                missing--;
            } else {
                ns.print(`Could not purchase ${program.name} (${formatMoney(program.price)}), current money: ${formatMoney(money)}`);
                if (program.cracker) crackerMissing = true;
            }
        }
        return missing;
    };

    do {
        if (!ns.hasTorRouter()) { // Note: purchaseProgram fails without TOR. tor-manager.js is responsible for buying it.
            ns.print(`WARN: Cannot purchase programs until the TOR router has been purchased.`);
        } else if (purchasePass() == 0)
            return ns.print(`All ${darkwebPrograms.length} darkweb programs have been purchased.`);
        if (keepRunning)
            await ns.sleep(options['interval']);
    } while (keepRunning);
}
