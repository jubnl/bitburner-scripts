import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT], ["unlink", false]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("worker", me, ns.pid, p));
    const result = await ns.dnet.setStasisLink(!options.unlink);
    send({ type: "stasis", host: me, success: result.success, code: result.code });
}
