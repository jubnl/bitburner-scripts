import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Static lint of the darknet scripts for two mistakes the game punishes silently.
 *
 * 1. `ns.isRunning(script, host, ...args)` only matches a process whose arguments are
 *    *identical* to the ones `ns.exec` was given. An isRunning guard that drops (or renames)
 *    a trailing argument therefore never matches, and the agent respawns the worker on every
 *    loop -- which is exactly how "darknet/agent.js" was being re-exec'd forever.
 *
 * 2. `ns.flags` does NOT consume the flags it parses: `ns.args` still holds them. So a worker
 *    that reads its positional arguments out of `ns.args` (`ns.args.map`, `ns.args.slice`,
 *    `ns.args[0]`) can be handed "--port" or 15 as if it were a stock symbol or a hostname.
 *    Positional arguments come from `getConfiguration`'s `options._`, which holds only them.
 *
 * Node-only: this parses the scripts as text, it never runs them.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["darknet.js", ...readdirSync(join(ROOT, "darknet")).filter(name => name.endsWith(".js")).map(name => `darknet/${name}`)];

/** Strip line and block comments without touching string/template/regex literals. */
function stripComments(src) {
    let out = "";
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];
        if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
        if (c === "/" && next === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
        if (c === '"' || c === "'" || c === "`") {
            out += c; i++;
            while (i < src.length && src[i] !== c) { if (src[i] === "\\") { out += src[i]; i++; } out += src[i]; i++; }
            out += src[i] ?? ""; i++;
            continue;
        }
        out += c; i++;
    }
    return out;
}

/** The argument list of the call starting at `open` (the index of its "("), split on the
 * commas that sit at nesting depth 0 and outside any string. */
function callArgs(src, open) {
    let depth = 0;
    const args = [];
    let current = "";
    let i = open;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            current += c; i++;
            while (i < src.length && src[i] !== quote) { if (src[i] === "\\") { current += src[i]; i++; } current += src[i]; i++; }
            current += src[i] ?? "";
            continue;
        }
        if (c === "(" || c === "[" || c === "{") { depth++; if (depth === 1 && c === "(") continue; current += c; continue; }
        if (c === ")" || c === "]" || c === "}") {
            depth--;
            if (depth === 0 && c === ")") { args.push(current); return { args: args.map(a => a.trim()).filter((a, index) => !(index === 0 && a === "")), end: i }; }
            current += c; continue;
        }
        if (c === "," && depth === 1) { args.push(current); current = ""; continue; }
        current += c;
    }
    return null;
}

function findCalls(src, name) {
    const out = [];
    const needle = `ns.${name}(`;
    let at = src.indexOf(needle);
    while (at >= 0) {
        const parsed = callArgs(src, at + needle.length - 1);
        if (parsed) out.push(parsed.args);
        at = src.indexOf(needle, at + needle.length);
    }
    return out;
}

const normalise = (args) => args.map(a => a.replace(/\s+/g, " ").trim()).join(", ");

for (const file of FILES) {
    const src = stripComments(readFileSync(join(ROOT, file), "utf8"));

    test(`${file}: every ns.isRunning has a matching ns.exec`, () => {
        const execs = findCalls(src, "exec");
        for (const args of findCalls(src, "isRunning")) {
            const script = args[0];
            if (!/^["'].*\.js["']$/.test(script)) continue;      // not a literal script name
            const trailing = normalise(args.slice(2));           // args after (script, host)
            const candidates = execs.filter(row => row[0] === script);
            assert.ok(candidates.length > 0, `${file}: ns.isRunning(${script}, ...) but nothing ever ns.exec's ${script} in this file`);
            const matched = candidates.some(row => normalise(row.slice(3)) === trailing);  // exec args after (script, host, opts)
            assert.ok(matched, `${file}: ns.isRunning(${script}, host, ${trailing}) matches no ns.exec of ${script} `
                + `(exec'd with: ${candidates.map(row => normalise(row.slice(3)) || "(no args)").join(" | ")}). `
                + `isRunning only matches identical args, so this guard can never fire.`);
        }
    });

    if (file !== "darknet.js") {
        test(`${file}: positional args come from options._, not ns.args`, () => {
            assert.equal(/ns\.args\s*\.\s*(map|slice)/.test(src), false,
                `${file}: ns.args still contains the flags (--port ...), so mapping/slicing it feeds them to the worker as positional values; use getConfiguration's options._`);
            assert.equal(/ns\.args\s*\[/.test(src), false,
                `${file}: read positional arguments from options._ instead of indexing ns.args`);
        });
    }
}

test("the lint's own call parser handles nested calls, objects and strings", () => {
    const src = `ns.exec("a.js", host, { threads: f(1, 2), preventDuplicates: true }, "--port", port);`;
    const args = findCalls(src, "exec")[0];
    assert.deepEqual(args, ['"a.js"', "host", "{ threads: f(1, 2), preventDuplicates: true }", '"--port"', "port"]);
    assert.equal(normalise(args.slice(3)), '"--port", port');
    assert.equal(stripComments(`a; // ns.isRunning("x.js")\nb; /* ns.exec("y.js") */ c;`).includes("isRunning"), false);
});

test("the lint catches the bug it was written for", () => {
    // The real defect: the guard omitted the "--port" pair the exec passes, so it never matched.
    const bad = `ns.isRunning("darknet/agent.js", h); ns.exec("darknet/agent.js", h, { threads: 1 }, "--port", port);`;
    const guard = findCalls(bad, "isRunning")[0];
    const spawn = findCalls(bad, "exec")[0];
    assert.notEqual(normalise(guard.slice(2)), normalise(spawn.slice(3)));
    const good = `ns.isRunning("darknet/agent.js", h, "--port", port); ns.exec("darknet/agent.js", h, { threads: 1 }, "--port", port);`;
    assert.equal(normalise(findCalls(good, "isRunning")[0].slice(2)), normalise(findCalls(good, "exec")[0].slice(3)));
});
