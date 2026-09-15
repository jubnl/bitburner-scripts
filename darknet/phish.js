import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("worker", me, ns.pid, p));
    let calls = 0, successes = 0;
    while (true) {
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop || (cmd.threads.phish || 0) === 0) break;
        if (ns.read(FILES.phishResize) === "1") break;   // the agent wants to re-size us
        const result = await ns.dnet.phishingAttack();
        if (result.success) successes++;
        calls++;
        if (calls % 20 === 0) send({ kind: "phish", host: me, successes });
    }
}
