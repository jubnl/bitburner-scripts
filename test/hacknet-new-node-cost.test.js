// HN-1: costToMatchStats transcribes src/Hacknet/formulas/HacknetServers.ts and HacknetNodes.ts calculateLevel/Ram/CoreUpgradeCost from a
// fresh node (level 1, 1 GB, 1 core). Expected values are computed by hand from src/Hacknet/data/Constants.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costToMatchStats } from "../hacknet-upgrade-manager.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test("a fresh node needs no upgrades", () => {
    assert.equal(costToMatchStats(true, 1, 1, 1), 0);
    assert.equal(costToMatchStats(false, 1, 1, 1), 0);
});

test("hacknet server upgrade costs (10*50e3*1.1^L levels, 200e3*r*1.4^log2(r) ram, 1e6*1.55^(c-1) cores)", () => {
    close(costToMatchStats(true, 3, 1, 1), 10 * 50e3 * (1.1 + 1.1 ** 2)); // 1,155,000
    close(costToMatchStats(true, 1, 4, 1), 1 * 200e3 * 1 + 2 * 200e3 * 1.4); // 760,000
    close(costToMatchStats(true, 1, 1, 3), 1e6 * (1 + 1.55)); // 2,550,000
    close(costToMatchStats(true, 3, 4, 3), 1155000 + 760000 + 2550000);
});

test("hacknet node upgrade costs (500*1.04^(L-1) levels, 30e3*r*1.28^log2(r) ram, 500e3*1.48^(c-1) cores)", () => {
    close(costToMatchStats(false, 3, 1, 1), 500 * (1 + 1.04)); // 1,020
    close(costToMatchStats(false, 1, 4, 1), 30e3 + 2 * 30e3 * 1.28); // 106,800
    close(costToMatchStats(false, 1, 1, 3), 500e3 * (1 + 1.48)); // 1,240,000
});

test("player cost multipliers scale each component independently", () => {
    const mults = { hacknet_node_level_cost: 0.5, hacknet_node_ram_cost: 2, hacknet_node_core_cost: 0.25 };
    close(costToMatchStats(true, 3, 4, 3, mults), 0.5 * 1155000 + 2 * 760000 + 0.25 * 2550000);
});

test("new node payoff is bounded by the upgrade cost, not just the node cost", () => {
    const worstProduction = 1, nodeCost = 1e6, upgrades = costToMatchStats(true, 100, 8192, 16);
    assert.ok(upgrades > 100 * nodeCost); // for early servers the upgrades dominate the price of the assumed production
    assert.ok(worstProduction / (nodeCost + upgrades) < worstProduction / nodeCost);
});
