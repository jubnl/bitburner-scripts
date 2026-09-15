import { getConfiguration } from "../helpers.js";
import { FILES, AGENT_FILES, WORKER_RAM, PORT_DEFAULT, parseCmd, parsePasswords, encodeMsg, isLabHost, parseClueText } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT], ["interval", 4000]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname(); const port = options.port;
    const dispatch = (type, payload) => { const line = encodeMsg(type, me, ns.pid, payload); if (!ns.tryWritePort(port, line)) queued.push(line); };
    const queued = [];                        // retry queue for a full port
    const lastSeen = {};                      // host -> last details JSON string, to report only changes
    const notifiedFiles = new Set();
    const myDetails = ns.dnet.getServerDetails(me);
    dispatch("hello", { host: me, maxRam: ns.getServerMaxRam(me), freeRam: ns.getServerMaxRam(me) - ns.getServerUsedRam(me), depth: myDetails.depth, difficulty: myDetails.difficulty });
    while (true) {
        while (queued.length && ns.tryWritePort(port, queued[0])) queued.shift();
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop) return ns.print("stop requested");
        const passwords = parsePasswords(ns.read(FILES.passwords));
        // 1. discover
        const neighbours = ns.dnet.probe();
        const detailsByHost = {};
        for (const h of neighbours) {
            const d = ns.dnet.getServerDetails(h); detailsByHost[h] = d;
            const key = JSON.stringify([d.isOnline, d.depth, d.difficulty, d.blockedRam, d.modelId, d.hasSession]);
            if (lastSeen[h] !== key) { lastSeen[h] = key; dispatch("server", { host: h, details: d, neighbours: null }); }
        }
        dispatch("server", { host: me, details: ns.dnet.getServerDetails(me), neighbours });
        // 2. crack unknown neighbours
        for (const h of neighbours) {
            const d = detailsByHost[h];
            if (!d.isOnline || passwords[h] !== undefined || cmd.claimed.includes(h) || isLabHost(h)) continue;
            if (ns.isRunning("darknet/crack.js", me, h)) continue;
            const threads = Math.max(1, Math.min(cmd.threads.crack || 6, Math.floor(freeRam(ns, me) / WORKER_RAM.crack)));
            if (threads >= 1) { const pid = ns.exec("darknet/crack.js", me, { threads }, h, "--port", port); dispatch("worker", { type: "crack", host: h, threads, pid }); }
        }
        // 3. spread to known neighbours without an agent
        for (const h of neighbours) {
            const d = detailsByHost[h]; const pw = passwords[h];
            if (!d.isOnline || pw === undefined || isLabHost(h)) continue;
            if (ns.isRunning("darknet/agent.js", h)) continue;
            const session = ns.dnet.connectToSession(h, pw);
            if (!session.success) { dispatch("crack", { host: h, success: false, attempts: 0, reason: "session:" + session.code, stale: session.code === 401 }); continue; }
            if (freeRam(ns, h) < 5) { if (d.blockedRam > 0 && !ns.isRunning("darknet/realloc.js", me, h)) spawnRealloc(ns, me, h, cmd, port); continue; }
            ns.scp(AGENT_FILES, h, me); ns.scp([FILES.passwords, FILES.cmd], h, me);
            const pid = ns.exec("darknet/agent.js", h, { threads: 1, preventDuplicates: true }, "--port", port);
            dispatch("worker", { type: "agent", host: h, pid });
        }
        // 4. spend free RAM: realloc self, migrate, promote, share, phish
        if (ns.dnet.getBlockedRam(me) > 0 && !ns.isRunning("darknet/realloc.js", me, "self")) spawnRealloc(ns, me, "self", cmd, port);
        if (cmd.migrateTarget && neighbours.includes(cmd.migrateTarget) && !ns.isRunning("darknet/migrate.js", me, cmd.migrateTarget) && (cmd.threads.migrate || 0) > 0)
            ns.exec("darknet/migrate.js", me, { threads: Math.min(cmd.threads.migrate, Math.floor(freeRam(ns, me) / WORKER_RAM.migrate)) || 1 }, cmd.migrateTarget, "--port", port);
        if (cmd.promoteSymbols.length && !ns.isRunning("darknet/promote.js", me) && (cmd.threads.promote || 0) > 0)
            ns.exec("darknet/promote.js", me, { threads: Math.min(cmd.threads.promote, Math.floor(freeRam(ns, me) / WORKER_RAM.promote)) || 1 }, ...cmd.promoteSymbols, "--port", port);
        if (cmd.storm && ns.fileExists("STORM_SEED.exe", me)) { const r = ns.dnet.unleashStormSeed(); dispatch("worker", { type: "storm", host: me, success: r.success, code: r.code }); }
        if (cmd.stasis && !ns.fileExists("darknet/stasis-done.txt", me) && freeRam(ns, me) >= WORKER_RAM.stasis) { ns.exec("darknet/stasis.js", me, 1, "--port", port); ns.write("darknet/stasis-done.txt", "1", "w"); }
        const spare = Math.floor(freeRam(ns, me) / (cmd["share"] ? WORKER_RAM["share"] : WORKER_RAM.phish));
        if (cmd["share"]) { if (spare > 0 && !ns.isRunning("Remote/share.js", me)) ns.exec("Remote/share.js", me, spare); }
        else if (spare > 0 && !ns.isRunning("darknet/phish.js", me)) ns.exec("darknet/phish.js", me, spare, "--port", port);
        // NOTE: no ns.scriptKill here; phish.js exits on its own once cmd["share"] becomes true.
        // 5. caches and clues
        if (ns.ls(me, ".cache").length && !ns.isRunning("darknet/cache.js", me) && freeRam(ns, me) >= WORKER_RAM.cache) ns.exec("darknet/cache.js", me, 1, "--port", port);
        for (const f of [...ns.ls(me, ".data.txt"), ...ns.ls(me, ".lit")]) {
            if (notifiedFiles.has(f)) continue; notifiedFiles.add(f);
            const c = parseClueText(ns.read(f), neighbours); dispatch("clue", { host: me, file: f, passwords: c.passwords, contains: c.contains });
        }
        await ns.sleep(options.interval);
    }
}
function freeRam(ns, host) { return ns.getServerMaxRam(host) - ns.getServerUsedRam(host); }
function spawnRealloc(ns, me, target, cmd, port) {
    const threads = Math.max(1, Math.min(cmd.threads.realloc || 50, Math.floor(freeRam(ns, me) / 2.6)));
    ns.exec("darknet/realloc.js", me, { threads }, target, "--port", port);
}
