import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("worker", me, ns.pid, p));
    const symbols = ns.args.map(s => String(s));
    let calls = 0;
    let idx = 0;
    while (true) {
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop) break;
        const stillPresent = symbols.some(s => cmd.promoteSymbols.includes(s));
        if (!stillPresent) break;
        const sym = symbols[idx % symbols.length];
        await ns.dnet.promoteStock(sym);
        calls++;
        idx++;
        if (calls % 20 === 0) send({ type: "promote", host: me, calls });
    }
}
