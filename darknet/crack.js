import { getConfiguration } from "../helpers.js";
import { solve } from "./solvers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parsePasswords, parseClueText, safeParse, hostFromArg } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT], ["clues", ""]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const target = hostFromArg(options._[0]); if (!target) return ns.tprint("crack.js: missing target host");
    const me = ns.getHostname(), pid = ns.pid;
    const send = (payload) => { const line = encodeMsg("crack", me, pid, payload); if (!ns.tryWritePort(options.port, line)) ns.print(`WARN: port full, dropped: ${line}`); };
    const details = ns.dnet.getServerDetails(target);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return send({ host: target, success: false, attempts: 0, reason: "unreachable" });
    details.hostname = target;
    // Clues: passwords for this host from local clue files
    const known = parsePasswords(ns.read(FILES.passwords)); const clues = [];
    if (known[target]) clues.push(known[target]);
    for (const f of ns.ls(me, ".data.txt")) { const c = parseClueText(ns.read(f), [target]); if (c.passwords[target]) clues.push(c.passwords[target]); for (const p of (c.passwords.unknown || [])) clues.push(p); }
    let attempts = 0;
    const attemptFn = async (password) => {
        let incremented = false;
        for (let tries = 0; tries < 5; tries++) {
            const r = await ns.dnet.authenticate(target, password);
            if (r.success) {
                if (!incremented) attempts++;
                return { success: true, feedback: { code: 200, message: r.message, data: r.data } };
            }
            if (r.code === 408) continue;                       // timeout: independent of correctness, retry
            if (!incremented) { attempts++; incremented = true; }
            if (r.code === 351 || r.code === 503) throw new Error("unreachable");
            const hb = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 });
            if (!hb.success) { if (hb.code === 451) throw new Error("charisma"); throw new Error("heartbleed:" + hb.code); }
            const fb = safeParse(hb.logs[0] ?? "", null);
            if (!fb || fb.passwordAttempted !== password) continue;  // not our line (race with another PID); retry
            return { success: false, feedback: fb };
        }
        throw new Error("timeouts");
    };
    let result;
    try { result = await solve(details, attemptFn, { clues, log: m => ns.print(m) }); }
    catch (e) { return send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: false, attempts, reason: String(e.message || e), chaReq: details.requiredCharismaSkill }); }
    if (result.password !== null) {
        known[target] = result.password; ns.write(FILES.passwords, JSON.stringify(known), "w");   // persist first
        send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: true, password: result.password, attempts: result.attempts, reason: result.reason });
    } else send({ host: target, modelId: details.modelId, difficulty: details.difficulty, success: false, attempts: result.attempts, reason: result.reason, chaReq: details.requiredCharismaSkill });
}
