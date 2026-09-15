import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT } from "./lib.js";

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema); if (!options) return;
    const me = ns.getHostname();
    const send = (p) => ns.tryWritePort(options.port, encodeMsg("cache", me, ns.pid, p));
    for (const cacheName of ns.ls(me, ".cache")) {
        const result = await ns.dnet.openCache(cacheName, true);
        send({ host: me, name: cacheName, success: result.success, message: result.message, karmaLoss: result.karmaLoss });
    }
}
