// ST-2: a layout is worth the sum over stat fragments of power x (product of the powers of the distinct adjacent boosters), which is how the
// game values it (src/CotMG/StaneksGift.ts effect: boost *= neighbour.fragment().power; src/CotMG/formulas/effect.ts: effect ~ power * boost).
// Fragment powers from src/CotMG/Fragment.ts: Hacking 1, HackingSpeed 1.3, HackingMoney 2, HackingGrow 0.5, Rep 0.5, boosters 1.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLayout } from "../optimize-stanek.js";

const stat = (key, power, adjacentBoosterKeys) => ({ key, fragment: { power }, adjacentBoosters: Int16Array.from(adjacentBoosterKeys) });
const booster = (key) => ({ key, fragment: { power: 1.1 } });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("no boosters: the sum of the fragment powers", () => {
    close(scoreLayout([stat(0, 1, []), stat(1, 2, []), stat(2, 0.5, [])], []), 3.5);
});

test("boosters multiply each adjacent stat by 1.1 per distinct booster", () => {
    close(scoreLayout([stat(0, 2, [7, 8]), stat(1, 0.5, [8])], [booster(7), booster(8)]), 2 * 1.1 * 1.1 + 0.5 * 1.1);
    close(scoreLayout([stat(0, 2, [7, 8])], [booster(7)]), 2 * 1.1); // booster 8 is not placed
});

test("a booster next to HackingMoney (power 2) beats one next to Rep (power 0.5)", () => {
    const layoutA = scoreLayout([stat(0, 2, [7]), stat(1, 0.5, [])], [booster(7)]);
    const layoutB = scoreLayout([stat(0, 2, []), stat(1, 0.5, [7])], [booster(7)]);
    assert.ok(layoutA > layoutB);
});
