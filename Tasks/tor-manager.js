/** @param {NS} ns
 * the purpose of tor-manager is to buy the TOR router ASAP
 * so that another script can buy the port breakers. This script
 * dies a natural death once tor is bought. **/
export async function main(ns) {
    const interval = 2000;

    var keepRunning = ns.args.length > 0 && ns.args[0] == "-c";
    if (!keepRunning)
        ns.print(`tor-manager will run once. Run with argument "-c" to run continuously.`)

    // Note: Since 3.0, ns.scan never returns the "darkweb" server (src/NetscriptFunctions.ts scan: DarknetServer instances are skipped),
    //       so TOR can no longer be detected by scanning for it. ns.hasTorRouter() costs 0.05 GB (src/Netscript/RamCostGenerator.ts).
    let hasTor = () => ns.hasTorRouter();
    if (hasTor())
        return ns.print('Player already has Tor');
    do {
        if (hasTor()) {
            ns.toast(`Purchased the Tor router!`, 'success');
            break;
        }
        ns.singularity.purchaseTor();
        if (keepRunning)
            await ns.sleep(interval);
    }
    while (keepRunning);
}
