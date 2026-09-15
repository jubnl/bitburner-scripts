import { getConfiguration, disableLogs, formatMoney as importedFormatMoney, scanAllServers } from './helpers.js'

const argsSchema = [
    ['all', false], // Set to true to report on all servers, not just the ones within our hack level
    ['silent', false], // Set to true to disable outputting the best servers to the terminal
    ['at-hack-level', 0], // Simulate expected gains when the player reaches the specified hack level. 0 means use the player's current hack level.
    ['hack-percent', -1], // Compute gains when hacking a certain percentage of each server's money. -1 estimates hack percentage based on current ram available, capped at 98%
    ['include-hacknet-ram', false], // Whether to include hacknet servers' RAM when computing current ram available
    ['disable-formulas-api', false], // Disables use of the formulas API even if it is available (useful for debugging the fallback logic used when formulas is unavailable)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** Hack-exp rates per RAM-second, relative units (HC-7).
 * expRate: per hack thread, weighted by success chance (a failed hack grants 1/4 exp, src/Netscript/NetscriptHelpers.tsx hack()) and including the weaken
 *   needed to undo the hack's hardening - the right ranking for hack-based (--xp-only / advanced) XP farming.
 * growExpRate: per grow thread. grow() and weaken() grant calculateHackingExpGain * threads unconditionally (src/NetscriptFunctions.ts grow/weaken),
 *   grow takes 0.8x weaken time, and a grow at max money adds no security (src/Server/ServerHelpers.ts processSingleServerGrowth only fortifies when
 *   money changed), so the basic weaken/grow farm needs no chance weighting and no recovery weaken. */
export function xpRatesPerRamSecond(hackExp, hackChance, hackCost, growRam, growTime) {
    const expectedExpPerHackThread = hackExp * (hackChance + (1 - hackChance) / 4);
    return {
        expRate: expectedExpPerHackThread * (1 + 0.002 / 0.05) / hackCost * 1000,
        growExpRate: hackExp / (growRam * growTime) * 1000,
    };
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    disableLogs(ns, ["scan", "sleep"]);

    let serverNames = [""]; // Provide a type hint to the IDE
    serverNames = scanAllServers(ns);

    var weaken_ram = 1.75;
    var grow_ram = 1.75;
    var hack_ram = 1.7;

    var hack_percent = options['hack-percent'] / 100;
    var use_est_hack_percent = false;
    if (options['hack-percent'] == -1) {
        use_est_hack_percent = true;
    } else {
        hack_percent = options['hack-percent'] / 100;
        if (hack_percent <= 0 || hack_percent >= 1) {
            ns.tprint("hack-percent out of range (0-100)");
            return;
        }
    }

    var player = ns.getPlayer();
    //ns.print(JSON.stringify(player));
    const realHackLevel = player.skills.hacking; // Needed by the no-formulas fallback to rescale ns.getHackTime (which is at our real level) to another level

    if (options['at-hack-level']) player.skills.hacking = options['at-hack-level'];
    let servers = serverNames.map(ns.getServer);
    // Compute the total RAM available to us on all servers (e.g. for running hacking scripts)
    var ram_total = servers.reduce(function (total, server) {
        if (!server.hasAdminRights || (server.hostname.startsWith('hacknet') && !options['include-hacknet-ram'])) return total;
        return total + server.maxRam;
    }, 0);

    // Override the imported formatMoney to handle amounts less than 0.01:
    let formatMoney = (amt) => amt > 0.01 ? importedFormatMoney(amt) : '$' + amt.toPrecision(3);

    /** Helper to compute server gain/exp rates at a specific hacking level
     * @param {Server} server
     * @param {Player} player */
    function getRatesAtHackLevel(server, player, hackLevel) {
        // Assume we will have weakened the server to min-security and taken it to max money before targetting
        const minDifficulty = server.minDifficulty;
        // Remember the server's real current security (this function may be called several times per server, and the formulas branch overwrites hackDifficulty)
        server.currentDifficulty ??= server.hackDifficulty;
        // The per-thread primitives the rate calculation needs. Taken from the formulas API when available, otherwise from closed-form replicas of the game's formulas.
        let hackTime, growTime, weakenTime; // (ms) at min security and the requested hack level
        let growGain; // Log of the growth multiplier per (1-core) grow thread
        let hackGain; // Fraction of the server's money stolen per hack thread
        let hackChance; // Probability that a hack succeeds
        let hackExp; // Hack exp per thread for a *successful* hack
        let useFormulas = !options['disable-formulas-api'];
        if (useFormulas) {
            // Temporarily change the hack level on the player object to the requested level
            const real_player_hack_skill = player.skills.hacking;
            player.skills.hacking = hackLevel;
            server.hackDifficulty = minDifficulty;
            server.moneyAvailable = server.moneyMax;
            try {
                hackTime = ns.formulas.hacking.hackTime(server, player);
                growTime = ns.formulas.hacking.growTime(server, player);
                weakenTime = ns.formulas.hacking.weakenTime(server, player);
                growGain = Math.log(ns.formulas.hacking.growPercent(server, 1, player, 1));
                hackGain = ns.formulas.hacking.hackPercent(server, player);
                hackChance = ns.formulas.hacking.hackChance(server, player);
                hackExp = ns.formulas.hacking.hackExp(server, player);
            }
            catch { // Formulas API unavailable?
                useFormulas = false;
            } finally {
                player.skills.hacking = real_player_hack_skill; // Restore the real hacking skill if we changed it temporarily
            }
        }
        // Solution for when formulas API is disabled or unavailable: replicate the game's formulas (src/Hacking.ts) in closed form.
        // Multipliers that scale every server by the same factor (bitnode mults, hacking_speed, hacking_exp) are omitted where they would
        // only rescale the results, since we only need a relative ranking (the same approach daemon.js takes in percentageStolenPerHackThread).
        if (!useFormulas) {
            const req = server.requiredHackingSkill;
            const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
            // calculateHackingTime: time = 5 * (2.5 * req * difficulty + 500) / (hack + 50) / (speed mults). We take the absolute time (with all
            // mults) from ns.getHackTime, which is at our *real* hack level and the server's *current* security, and rescale it to min security
            // and the requested hack level (all other factors cancel out).
            const timeFactor = (difficulty, hackLevel) => (2.5 * req * difficulty + 500) / (hackLevel + 50);
            hackTime = ns.getHackTime(server.hostname) * timeFactor(minDifficulty, hackLevel) / timeFactor(server.currentDifficulty, realHackLevel);
            growTime = hackTime * 3.2; // calculateGrowTime = 3.2 * hack time
            weakenTime = hackTime * 4; // calculateWeakenTime = 4 * hack time
            // calculateServerGrowthLog (src/Server/formulas/grow.ts) for 1 thread on a 1-core host: min(log1p(0.03 / difficulty), log1p(0.0035)) * serverGrowth / 100 * hacking_grow
            growGain = Math.min(Math.log1p(0.03 / minDifficulty), 0.00349388925425578) * (server.serverGrowth / 100) * player.mults.hacking_grow;
            // calculatePercentMoneyHacked: (100 - difficulty) / 100 * (hack - (req - 1)) / hack * hacking_money / 240 (BN ScriptHackMoney mult omitted)
            hackGain = clamp(((100 - minDifficulty) / 100) * ((hackLevel - (req - 1)) / hackLevel) * player.mults.hacking_money / 240, 0, 1);
            // calculateHackingChance: (1.75 * hack - req) / (1.75 * hack) * (100 - difficulty) / 100 * hacking_chance * intelligence bonus (1 + int^0.8 / 600)
            const skillMult = Math.max(1, 1.75 * hackLevel);
            hackChance = clamp(((skillMult - req) / skillMult) * ((100 - minDifficulty) / 100) * player.mults.hacking_chance *
                (1 + Math.pow(player.skills.intelligence ?? 0, 0.8) / 600), 0, 1);
            // calculateHackingExpGain: 3 + baseDifficulty * 0.3 (hacking_exp and BN HackExpGain mults omitted)
            hackExp = 3 + (server.baseDifficulty ?? minDifficulty) * 0.3;
        }

        // Compute the cost (ram*seconds) for each tool, including the weaken threads needed to undo its security hardening
        // (hack +0.002 / grow +0.004 per thread, weaken -0.05 per thread: src/Server/data/Constants.ts ServerFortifyAmount / ServerWeakenAmount)
        // HC-8: this assumes a thread holds RAM for its own duration, which daemon.js now does (batch tasks are exec'd about 1 s before they start,
        // HC-1); do not scale these toward weaken time.
        const weakenCost = weaken_ram * weakenTime;
        const growCost = grow_ram * growTime + weakenCost * 0.004 / 0.05;
        const hackCost = hack_ram * hackTime + weakenCost * 0.002 / 0.05;
        // If hack gain is less than this minimum (very high BN12 levels?) We must coerce it to some minimum value to avoid NAN results.
        const minHackGain = 1e-10;
        if (hackGain <= minHackGain)
            ns.print(`WARN: hackGain is ${hackGain.toPrecision(3)}. Coercing it to the minimum value ${minHackGain} (${server.hostname})`);
        server.estHackPercent = Math.max(minHackGain, Math.min(0.98,
            Math.min(ram_total * hackGain / hackCost, 1 - 1 / Math.exp(ram_total * growGain / growCost)))); // TODO: I think these might be off by a factor of 2x
        if (use_est_hack_percent) hack_percent = server.estHackPercent;
        const grows_per_cycle = -Math.log(1 - hack_percent) / growGain;
        const hacks_per_cycle = hack_percent / hackGain;
        const hackProfit = server.moneyMax * hack_percent * hackChance;
        // Compute the relative monetary gain
        const theoreticalGainRate = hackProfit / (growCost * grows_per_cycle + hackCost * hacks_per_cycle) * 1000 /* Convert per-millisecond rate to per-second */;
        // A failed hack still grants 1/4 of the exp of a successful one (src/Netscript/NetscriptHelpers.tsx hack(): expGainedOnFailure = expGainedOnSuccess / 4);
        // the basic weaken/grow farm gets the unweighted growExpRate (HC-7)
        const { expRate, growExpRate } = xpRatesPerRamSecond(hackExp, hackChance, hackCost, grow_ram, growTime);
        // The practical cap on revenue is based on your hacking scripts. For my hacking scripts this is about 20% per second, adjust as needed
        // No idea why we divide by ram_total - Basically ensures that as our available RAM gets larger, the sort order merely becomes "by server max money"
        const cappedGainRate = Math.min(theoreticalGainRate, hackProfit / ram_total);
        ns.print(`${useFormulas ? '' : '(Without formulas.exe, closed-form estimate) '}At hack level ${hackLevel} and steal ${(hack_percent * 100).toPrecision(3)}%: ` +
            `Theoretical ${formatMoney(theoreticalGainRate)}, Limit: ${formatMoney(hackProfit / ram_total)}, Exp: ${expRate.toPrecision(3)}, ` +
            `Hack Chance: ${(hackChance * 100).toPrecision(3)}% (${server.hostname})`);
        return [theoreticalGainRate, cappedGainRate, expRate, growExpRate];
    }

    ns.print(`All? ${options['all']} Player hack: ${player.skills.hacking} Ram total: ${ram_total}`);
    //ns.print(`\n` + servers.map(s => `${s.hostname} bought: ${s.purchasedByPlayer} moneyMax: ${s.moneyMax} admin: ${s.hasAdminRights} hack: ${s.requiredHackingSkill}`).join('\n'));

    // Filter down to the list of servers we wish to report on
    servers = servers.filter(server => !server.purchasedByPlayer && (server.moneyMax || 0) > 0 &&
        (options['all'] || server.hasAdminRights && server.requiredHackingSkill <= player.skills.hacking));

    // First address the servers within our hacking level
    const unlocked_servers = servers.filter(s => s.requiredHackingSkill <= player.skills.hacking)
        .map(function (server) {
            [server.theoreticalGainRate, server.gainRate, server.expRate, server.growExpRate] = getRatesAtHackLevel(server, player, player.skills.hacking);
            return server;
        });
    // The best server's gain rate will be used to pro-rate the relative gain of servers that haven't been unlocked yet (if they were unlocked at this level)
    const best_unlocked_server = unlocked_servers.sort((a, b) => b.gainRate - a.gainRate)[0];
    ns.print("Best unlocked server: ", best_unlocked_server.hostname, " with ", formatMoney(best_unlocked_server.gainRate), " per ram-second");
    // Compute locked server's gain rates (pro rated back to the current player's hack level)
    const locked_servers = servers.filter(s => s.requiredHackingSkill > player.skills.hacking).sort((a, b) => a.requiredHackingSkill - b.requiredHackingSkill)
        .map(function (server) {
            // We will need to fake the hacking skill to get the numbers for when this server will first be unlocked, but to keep the comparison
            // fair, we will need to scale down the gain by the amount current best server gains now, verses what it would gain at that hack level.
            const [bestUnlockedScaledGainRate, _, bestUnlockedScaledExpRate, bestUnlockedScaledGrowExpRate] = getRatesAtHackLevel(best_unlocked_server, player, server.requiredHackingSkill);
            const gainRateScaleFactor = bestUnlockedScaledGainRate ? best_unlocked_server.theoreticalGainRate / bestUnlockedScaledGainRate : 1;
            const expRateScaleFactor = bestUnlockedScaledExpRate ? best_unlocked_server.expRate / bestUnlockedScaledExpRate : 1;
            const growExpRateScaleFactor = bestUnlockedScaledGrowExpRate ? best_unlocked_server.growExpRate / bestUnlockedScaledGrowExpRate : 1;
            const [theoreticalGainRate, cappedGainRate, expRate, growExpRate] = getRatesAtHackLevel(server, player, server.requiredHackingSkill);
            // Apply the scaling factors, as well as the same cap as above
            server.theoreticalGainRate = theoreticalGainRate * gainRateScaleFactor;
            server.expRate = expRate * expRateScaleFactor;
            server.growExpRate = growExpRate * growExpRateScaleFactor;
            server.gainRate = Math.min(server.theoreticalGainRate, cappedGainRate);
            ns.print(`${server.hostname}: Scaled theoretical gain by ${gainRateScaleFactor.toPrecision(3)} to ${formatMoney(server.theoreticalGainRate)} ` +
                `(capped at ${formatMoney(cappedGainRate)}) and exp by ${expRateScaleFactor.toPrecision(3)} to ${server.expRate.toPrecision(3)}`);
            return server;
        }) || [];
    // Combine the lists, sort, and display a summary.
    const server_eval = unlocked_servers.concat(locked_servers);
    const best_server = server_eval.sort((a, b) => b.gainRate - a.gainRate)[0];
    if (!options['silent'])
        ns.tprint("Best server: ", best_server.hostname, " with ", formatMoney(best_server.gainRate), " per ram-second");

    // Print all servers by best to work hack money value
    let order = 1;
    let serverListByGain = `Servers in order of best to worst hack money at Hack ${player.skills.hacking}:`;
    for (const server of server_eval)
        serverListByGain += `\n ${order++} ${server.hostname}, with ${formatMoney(server.gainRate)} per ram-second while stealing ` +
            `${(server.estHackPercent * 100).toPrecision(3)}% (unlocked at hack ${server.requiredHackingSkill})`;
    ns.print(serverListByGain);

    // Reorder servers by exp and sort by best to work hack experience gain rate
    var best_exp_server = server_eval.sort(function (a, b) {
        return b.expRate - a.expRate;
    })[0];
    if (!options['silent'])
        ns.tprint("Best exp server: ", best_exp_server.hostname, " with ", best_exp_server.expRate, " exp per ram-second");
    order = 1;
    let serverListByExp = `Servers in order of best to worst hack exp at Hack ${player.skills.hacking}:`;
    for (let i = 0; i < Math.min(5, server_eval.length); i++)
        serverListByExp += `\n ${order++} ${server_eval[i].hostname}, with ${server_eval[i].expRate.toPrecision(3)} exp per ram-second`;
    ns.print(serverListByExp);

    ns.write('/Temp/analyze-hack.txt', JSON.stringify(server_eval.map(s => ({
        hostname: s.hostname,
        gainRate: s.gainRate,
        expRate: s.expRate,
        growExpRate: s.growExpRate // HC-7: unweighted weaken/grow exp rate for daemon.js's basic XP farm
    }))), "w");
    // Below is stats for hacknet servers - uncomment at cost of 4 GB Ram
    /*
    var hacknet_nodes = [...(function* () {
        var n = ns.hacknet.numNodes();
        for (var i = 0; i < n; i++) {
            var server = ns.hacknet.getNodeStats(i);
            server.gainRate = 1000000 / 4 * server.production / server.ram;
            yield server;
        }
    })()];
    var best_hacknet_node = hacknet_nodes.sort(function (a, b) {
        return b.gainRate - a.gainRate;
    })[0];
    if (best_hacknet_node) ns.tprint("Best hacknet node: ", best_hacknet_node.name, " with $", best_hacknet_node.gainRate, " per ram-second");
    */
}