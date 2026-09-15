import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname(), target = String(ns.args[0] ?? me) === "self" ? me : String(ns.args[0] ?? me);
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("freed", me, ns.pid, p));
    let calls = 0, freed = 0, before = ns.dnet.getBlockedRam(target);
    while (ns.dnet.getBlockedRam(target) > 0) {
        const r = await ns.dnet.memoryReallocation(target);
        if (r.code !== 200) { ns.print(`realloc stopped: ${r.code} ${r.message}`); break; }
        calls++; const now = ns.dnet.getBlockedRam(target); freed = before - now;
        if (calls % 10 === 0) send({ host: target, gb: freed, remaining: now });
        if (parseCmd(ns.read(FILES.cmd)).stop) break;
    }
    send({ host: target, gb: freed, remaining: ns.dnet.getBlockedRam(target), done: true });
}
