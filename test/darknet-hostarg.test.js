// Darknet hostnames can begin with "--" (e.g. the reversed lore host `--;SREVRES-ELBAT-PORD;)`).
// ns.flags treats any token starting with "-" as an option and throws ArgError, so workers must
// never receive a raw hostname as a positional argument. hostArg/hostFromArg wrap the name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hostArg, hostFromArg } from "../darknet/lib.js";

const NASTY = ["--;SREVRES-ELBAT-PORD;)", "-dash", "n00dles", "1234", "", "host:already", "--port"];

test("hostArg never yields a token that ns.flags would parse as an option", () => {
    for (const h of NASTY) assert.ok(!hostArg(h).startsWith("-"), `hostArg(${JSON.stringify(h)}) = ${hostArg(h)}`);
});

test("hostFromArg round-trips every hostname exactly", () => {
    for (const h of NASTY) assert.equal(hostFromArg(hostArg(h)), h);
});

test("hostFromArg tolerates a raw (unwrapped) hostname and non-strings", () => {
    assert.equal(hostFromArg("n00dles"), "n00dles");
    assert.equal(hostFromArg(1234), "1234");
    assert.equal(hostFromArg(undefined), "");
});

// Every exec/isRunning that passes a hostname positionally must wrap it, and the workers that
// receive it must unwrap it, otherwise the crash loop returns the next time such a host is met.
const POSITIONAL_HOST_WORKERS = ["darknet/crack.js", "darknet/realloc.js", "darknet/migrate.js", "darknet/lab.js"];
for (const worker of POSITIONAL_HOST_WORKERS) {
    test(`${worker}: decodes its positional host with hostFromArg`, () => {
        const src = readFileSync(new URL(`../${worker}`, import.meta.url), "utf8");
        assert.match(src, /hostFromArg\(options\._\[0\]/, `${worker} must read its target via hostFromArg(options._[0] ...)`);
    });
}

for (const launcher of ["darknet/agent.js", "darknet.js"]) {
    test(`${launcher}: every positional-host exec/isRunning wraps the host with hostArg`, () => {
        const src = readFileSync(new URL(`../${launcher}`, import.meta.url), "utf8");
        const re = /ns\.(exec|isRunning)\("darknet\/(crack|realloc|migrate|lab)\.js",[^\n]*?"--port"/g;
        let m, count = 0;
        while ((m = re.exec(src))) {
            count++;
            assert.match(m[0], /hostArg\(/, `${launcher}: ${m[0]}`);
        }
        assert.ok(count > 0, `${launcher}: expected at least one positional-host launch`);
    });
}
