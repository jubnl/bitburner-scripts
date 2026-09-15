import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("worker", me, ns.pid, p));
    // Positional args only: ns.args still contains the flags (ns.flags does not consume them),
    // so ns.args.map(String) would hand promoteStock("--port") and crash the worker on its
    // first call. getConfiguration returns ns.flags' output, whose `_` holds exactly the
    // positional arguments the controller's agent passed (the stock symbols).
    const symbols = (options._ ?? []).map(s => String(s));
    if (!symbols.length) return ns.print("promote.js: no symbols given, nothing to promote");
    let calls = 0;
    let idx = 0;
    while (true) {
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop) break;
        const stillPresent = symbols.some(s => cmd.promoteSymbols.includes(s));
        if (!stillPresent) break;
        if (ns.read(FILES.promoteResize) === "1") break;   // the agent wants to re-size us (R9 fix round 1)
        const sym = symbols[idx % symbols.length];
        await ns.dnet.promoteStock(sym);
        calls++;
        idx++;
        if (calls % 20 === 0) send({ kind: "promote", host: me, calls });
    }
}
