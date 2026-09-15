import { getConfiguration } from "../helpers.js";
import { FILES, AGENT_FILES, WORKER_RAM, PORT_DEFAULT, parseCmd, parsePasswords, encodeMsg, isLabHost, parseClueText, hostArg } from "./lib.js";

/* The darknet agent. One per cracked, online darknet server. It never plans: it executes the
 * command file the controller pushes, reports what it sees, and spreads itself to neighbours.
 *
 * Static RAM budget (target: under 5 GB):
 *   base 1.60 | exec 1.30 | scp 0.60 | dnet.probe 0.20 | ls 0.20 | dnet.getServerDetails 0.10
 *   isRunning 0.10 | fileExists 0.10 | dnet.unleashStormSeed 0.10 | getServerMaxRam 0.05
 *   getServerUsedRam 0.05 | dnet.connectToSession 0.05 | getHostname 0.05
 *   dnet.getBlockedRam 0 | read/write/tryWritePort/print/disableLog/flags/sleep 0  => 4.50 GB
 */

const argsSchema = [["port", PORT_DEFAULT], ["interval", 4000]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

const MAX_QUEUED = 200;             // most port-retry lines to keep when the port stays full
const SELF_REPORT_INTERVAL = 60000; // force one `server` report about ourselves at least this often

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname(); const port = options.port;
    const dispatch = (type, payload) => {
        const line = encodeMsg(type, me, ns.pid, payload);
        // A port nobody drains (controller down) must not grow this list without bound: keep
        // the newest MAX_QUEUED lines and drop the oldest.
        if (!ns.tryWritePort(port, line)) { queued.push(line); if (queued.length > MAX_QUEUED) queued.splice(0, queued.length - MAX_QUEUED); }
    };
    const queued = [];                        // retry queue for a full port, capped at MAX_QUEUED
    const lastSeen = {};                      // host -> last details JSON string, to report only changes
    const sessionFailed = {};                 // host -> the stored password whose session failed, to report it once
    let selfReportedAt = 0;                   // last time we force-reported ourselves regardless of change
    const notifiedFiles = new Set();
    const myDetails = ns.dnet.getServerDetails(me);
    dispatch("hello", { host: me, maxRam: ns.getServerMaxRam(me), freeRam: ns.getServerMaxRam(me) - ns.getServerUsedRam(me), depth: myDetails.depth, difficulty: myDetails.difficulty, exes: ns.ls(me, ".exe") });
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
            if (lastSeen[h] !== key) { lastSeen[h] = key; dispatch("server", { host: h, details: d, neighbours: null, maxRam: ns.getServerMaxRam(h) }); }
        }
        // Our own `server` report is gated on change exactly like the neighbour reports above
        // (the neighbour list is part of the key), with a forced report every
        // SELF_REPORT_INTERVAL so the controller's SERVER_TTL never expires on a quiet host.
        const mine = ns.dnet.getServerDetails(me);
        const myKey = JSON.stringify([mine.isOnline, mine.depth, mine.difficulty, mine.blockedRam, mine.modelId, mine.hasSession, neighbours]);
        if (lastSeen[me] !== myKey || Date.now() - selfReportedAt >= SELF_REPORT_INTERVAL) {
            lastSeen[me] = myKey; selfReportedAt = Date.now();
            dispatch("server", { host: me, details: mine, neighbours });
        }
        // Cracking always outranks spare-RAM work (promote/phish/share): reserve enough RAM for
        // up to 4 crack.js threads whenever a live, non-lab, unclaimed neighbour still needs one.
        let needsCrack = false;
        for (const h of neighbours) {
            const d = detailsByHost[h];
            if (d.isOnline && passwords[h] === undefined && !cmd.claimed.includes(h) && !isLabHost(h)) { needsCrack = true; break; }
        }
        // NOTE: `reserve` is deliberately only subtracted from promote/phish/share below.
        // realloc and migrate outrank the crack reservation on purpose: that is the spending
        // order the spec gives (section 6 -- realloc, migrate, promote, share, phish), realloc
        // is what *creates* the RAM a crack worker needs, and a migration charge is lost work
        // if it stalls. Promote/phish/share are pure filler and always yield to a pending crack.
        let reserve = needsCrack ? Math.min(cmd.threads.crack || 6, 4) * WORKER_RAM.crack : 0;
        // A commanded labyrinth walker outranks spare-RAM work too: hold its RAM back from
        // promote/phish/share so it has somewhere to land once buildCmd's threads.phish = 0 /
        // threads.promote = 0 / share = false empty the host out (may take a loop or two).
        if (cmd.walk && (cmd.walkThreads || 0) >= 1) reserve += cmd.walkThreads * WORKER_RAM.lab;
        // 2. crack unknown neighbours
        for (const h of neighbours) {
            const d = detailsByHost[h];
            if (!d.isOnline || passwords[h] !== undefined || cmd.claimed.includes(h) || isLabHost(h)) continue;
            if (ns.isRunning("darknet/crack.js", me, hostArg(h), "--port", port)) continue;
            const threads = Math.min(cmd.threads.crack || 6, Math.floor(freeRam(ns, me) / WORKER_RAM.crack));
            if (threads >= 1) { const pid = ns.exec("darknet/crack.js", me, { threads, preventDuplicates: true }, hostArg(h), "--port", port); dispatch("worker", { kind: "crack", host: h, threads, workerPid: pid }); }
        }
        // 3. spread to known neighbours without an agent
        for (const h of neighbours) {
            const d = detailsByHost[h]; const pw = passwords[h];
            if (!d.isOnline || pw === undefined || isLabHost(h)) continue;
            // The args must match the exec below exactly: ns.isRunning only matches a process
            // whose args are identical to the ones it was exec'd with, so dropping "--port"
            // here would report "not running" for every agent we ever started and respawn it.
            if (ns.isRunning("darknet/agent.js", h, "--port", port)) continue;
            const session = ns.dnet.connectToSession(h, pw);
            if (!session.success) {
                // Once per host per stored password: a password the server no longer accepts
                // fails on every loop, and re-reporting it floods the port and the log.
                if (sessionFailed[h] !== pw) {
                    sessionFailed[h] = pw;
                    dispatch("crack", { host: h, success: false, attempts: 0, reason: "session:" + session.code, stale: session.code === 401 });
                }
                continue;
            }
            sessionFailed[h] = undefined;
            if (freeRam(ns, h) < WORKER_RAM.agent) { if (d.blockedRam > 0) spawnRealloc(ns, me, h, cmd, port); continue; }
            ns.scp(AGENT_FILES, h, me); ns.scp([FILES.passwords, FILES.cmd], h, me);
            const pid = ns.exec("darknet/agent.js", h, { threads: 1, preventDuplicates: true }, "--port", port);
            dispatch("worker", { kind: "agent", host: h, workerPid: pid });
        }
        // 4. spend free RAM: realloc self, migrate, promote, share, phish
        if (ns.dnet.getBlockedRam(me) > 0) spawnRealloc(ns, me, "self", cmd, port);
        if (cmd.migrateTarget && !isLabHost(cmd.migrateTarget) && neighbours.includes(cmd.migrateTarget) && !ns.isRunning("darknet/migrate.js", me, hostArg(cmd.migrateTarget), "--port", port) && (cmd.threads.migrate || 0) > 0) {
            const migrateThreads = Math.min(cmd.threads.migrate, Math.floor(freeRam(ns, me) / WORKER_RAM.migrate));
            if (migrateThreads >= 1) ns.exec("darknet/migrate.js", me, { threads: migrateThreads, preventDuplicates: true }, hostArg(cmd.migrateTarget), "--port", port);
        }
        if (cmd.promoteSymbols.length && ns.getServerMaxRam(me) >= 64 && !ns.isRunning("darknet/promote.js", me, ...cmd.promoteSymbols, "--port", port) && (cmd.threads.promote || 0) > 0) {
            const promoteThreads = Math.min(cmd.threads.promote, Math.floor((freeRam(ns, me) - reserve) / WORKER_RAM.promote));
            if (promoteThreads >= 1) ns.exec("darknet/promote.js", me, { threads: promoteThreads, preventDuplicates: true }, ...cmd.promoteSymbols, "--port", port);
        }
        // The labyrinth walker has to run on a host directly connected to the lab, and ns.exec
        // needs a direct connection to its target, so only this agent can start it -- the
        // controller just names the host in the command file.
        if (cmd.walk && neighbours.includes(cmd.walk) && (cmd.walkThreads || 0) >= 1 && !ns.isRunning("darknet/lab.js", me, hostArg(cmd.walk), "--port", port)) {
            const walkThreads = Math.min(cmd.walkThreads, Math.floor(freeRam(ns, me) / WORKER_RAM.lab));
            if (walkThreads >= 1) {
                const pid = ns.exec("darknet/lab.js", me, { threads: walkThreads, preventDuplicates: true }, hostArg(cmd.walk), "--port", port);
                dispatch("worker", { kind: "walker-launch", host: me, lab: cmd.walk, threads: walkThreads, workerPid: pid });
            }
        }
        if (cmd.storm && ns.fileExists("STORM_SEED.exe", me)) { const r = ns.dnet.unleashStormSeed(); dispatch("worker", { kind: "storm", host: me, success: r.success, code: r.code }); }
        // Stasis is a two-way command. The marker holds "1" while this host is linked and "0"
        // once it has been released, so the controller can take the link back by flipping
        // cmd.stasis to false (a file-*existence* marker could never express that). It is only
        // written after ns.exec actually returned a pid, so a launch that failed for want of
        // RAM is retried next loop instead of being remembered as done.
        const stasisMark = ns.read(FILES.stasisMark);
        if (freeRam(ns, me) >= WORKER_RAM.stasis) {
            if (cmd.stasis && stasisMark !== "1") {
                if (ns.exec("darknet/stasis.js", me, { threads: 1, preventDuplicates: true }, "--port", port)) ns.write(FILES.stasisMark, "1", "w");
            } else if (!cmd.stasis && stasisMark === "1") {
                if (ns.exec("darknet/stasis.js", me, { threads: 1, preventDuplicates: true }, "--unlink", "--port", port)) ns.write(FILES.stasisMark, "0", "w");
            }
        }
        const spare = Math.floor((freeRam(ns, me) - reserve) / (cmd["share"] ? WORKER_RAM["share"] : WORKER_RAM.phish));
        // Both branches are explicitly gated on the command file: share only when the
        // controller says to share, phish only when it actually allotted phish threads. A walk
        // host gets threads.phish = 0 and share = false, so it spawns neither and its spare RAM
        // stays free for the walker.
        if (cmd["share"]) {
            if (spare > 0 && !ns.isRunning("Remote/share.js", me)) ns.exec("Remote/share.js", me, { threads: spare, preventDuplicates: true });
        } else if (spare > 0 && (cmd.threads.phish || 0) > 0 && !ns.isRunning("darknet/phish.js", me, "--port", port)) {
            ns.exec("darknet/phish.js", me, { threads: spare, preventDuplicates: true }, "--port", port);
        }
        // NOTE: no ns.scriptKill here; phish.js exits on its own once cmd["share"] becomes true.
        // 5. caches and clues
        if (ns.ls(me, ".cache").length && !ns.isRunning("darknet/cache.js", me, "--port", port) && freeRam(ns, me) >= WORKER_RAM.cache) ns.exec("darknet/cache.js", me, { threads: 1, preventDuplicates: true }, "--port", port);
        for (const f of [...ns.ls(me, ".data.txt"), ...ns.ls(me, ".lit")]) {
            if (notifiedFiles.has(f)) continue; notifiedFiles.add(f);
            const c = parseClueText(ns.read(f), neighbours); dispatch("clue", { host: me, file: f, passwords: c.passwords, contains: c.contains });
        }
        await ns.sleep(options.interval);
    }
}
function freeRam(ns, host) { return ns.getServerMaxRam(host) - ns.getServerUsedRam(host); }
// The duplicate check lives here rather than at the call sites so ns.isRunning and ns.exec
// can never be handed different args (they have to match exactly for isRunning to find it).
function spawnRealloc(ns, me, target, cmd, port) {
    if (ns.isRunning("darknet/realloc.js", me, hostArg(target), "--port", port)) return 0;
    const threads = Math.min(cmd.threads.realloc || 50, Math.floor(freeRam(ns, me) / WORKER_RAM.realloc));
    if (threads >= 1) return ns.exec("darknet/realloc.js", me, { threads, preventDuplicates: true }, hostArg(target), "--port", port);
    return 0;
}
