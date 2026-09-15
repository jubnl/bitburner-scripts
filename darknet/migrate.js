import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, FILES, parseCmd, hostFromArg } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const target = hostFromArg(options._[0] ?? me);
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("worker", me, ns.pid, p));
    let calls = 0;
    while (true) {
        const cmd = parseCmd(ns.read(FILES.cmd));
        if (cmd.stop || cmd.migrateTarget !== target) break;
        const result = await ns.dnet.induceServerMigration(target);
        if (result.code !== 200) break;
        calls++;
    }
    send({ kind: "migrate", host: target, calls });
}
