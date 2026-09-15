// HK-F3: helpers.js getHardCodedBitNodeMultipliers is the fallback used whenever SF-5 / RAM are
// missing, so its table must match the game's src/BitNode/BitNode.tsx getBitNodeMultipliers.
// BN12 scales every value by 1.02^lvl and is skipped (no literal to compare); everything else
// that the game writes as a numeric literal, or leaves at the BitNodeMultipliers.ts default, is
// compared for every key the table carries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getHardCodedBitNodeMultipliers } from "../helpers.js";

const SRC = "/home/jubnl/dev/bitburner/bitburner-src/src/BitNode/";
const tsx = readFileSync(SRC + "BitNode.tsx", "utf8");
const defaultsSrc = readFileSync(SRC + "BitNodeMultipliers.ts", "utf8");

const defaults = Object.fromEntries([...defaultsSrc.matchAll(/^\s+(\w+) = (-?[\d.]+);/gm)].map((m) => [m[1], Number(m[2])]));
const fn = tsx.slice(tsx.indexOf("export function getBitNodeMultipliers("));
function gameMults(bn) {
    const start = fn.indexOf(`case ${bn}: {`);
    const next = fn.indexOf(`case ${bn + 1}: {`);
    const block = fn.slice(start, next > 0 ? next : fn.indexOf("default:"));
    const literals = Object.fromEntries([...block.matchAll(/^\s+(\w+): (-?[\d.]+),/gm)].map((m) => [m[1], Number(m[2])]));
    return { ...defaults, ...literals };
}

test("BitNode.tsx parsed: defaults and per-BN literals were found", () => {
    assert.equal(defaults.DarknetMoneyMultiplier, 1);
    assert.equal(gameMults(8).DarknetMoneyMultiplier, 0);
    assert.equal(gameMults(14).DefenseLevelMultiplier, 0.5);
});

for (let bn = 1; bn <= 15; bn++) {
    if (bn === 12) continue;
    test(`hard-coded multipliers match BitNode.tsx for BN${bn}`, async () => {
        const table = await getHardCodedBitNodeMultipliers(null, null, bn);
        const game = gameMults(bn);
        const wrong = Object.entries(table).filter(([key, value]) => key in game && game[key] !== value)
            .map(([key, value]) => `${key}: table ${value}, game ${game[key]}`);
        assert.deepEqual(wrong, []);
        const unknown = Object.keys(table).filter((key) => !(key in defaults));
        assert.deepEqual(unknown, [], "keys the game does not define");
    });
}
