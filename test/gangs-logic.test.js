// Pure decision helpers of gangs.js (lib/gang-logic.js) checked against the task weights and formulas of src/Gang.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gangStatKeys, taskStatWeights, equipmentScore, rankEquipment, weightedStat, weightedAscensionGain, pickTrainingTask, referenceTask, missedGangCycles, nextUpdateHasTerritoryTick, retrainTargetFor, needsRetraining } from "../lib/gang-logic.js";

// src/Gang/data/tasks.ts:317-332 and :295-311 (no agiWeight on either)
const terrorism = { hackWeight: 20, strWeight: 20, defWeight: 20, dexWeight: 20, chaWeight: 20, difficulty: 36 };
const trafficking = { hackWeight: 30, strWeight: 5, defWeight: 5, dexWeight: 30, chaWeight: 30, difficulty: 36 };

test("GG-1: task weights are the game's weights / 100, missing weights are 0", () => {
    assert.deepEqual(gangStatKeys, ["hack", "str", "def", "dex", "agi", "cha"]);
    assert.deepEqual(taskStatWeights(terrorism), { hack: 0.2, str: 0.2, def: 0.2, dex: 0.2, agi: 0, cha: 0.2 });
    assert.deepEqual(taskStatWeights({ hackWeight: 100 }), { hack: 1, str: 0, def: 0, dex: 0, agi: 0, cha: 0 });
    assert.deepEqual(taskStatWeights(undefined), { hack: 0, str: 0, def: 0, dex: 0, agi: 0, cha: 0 });
});

test("GG-1: equipment is scored by the weight of the stats it multiplies (GangMember.ts applyUpgrade)", () => {
    const w = taskStatWeights(trafficking);
    assert.ok(Math.abs(equipmentScore({ agi: 1.6 }, w) - 0) < 1e-12);                // Bionic Legs: agility has no weight in Human Trafficking
    assert.ok(Math.abs(equipmentScore({ hack: 1.15 }, w) - 0.045) < 1e-12);          // Neuralstimulator: 0.3 * 0.15
    assert.ok(Math.abs(equipmentScore({ str: 1.5, agi: 1.5 }, w) - 0.025) < 1e-12);  // Synthetic Heart: 0.05 * 0.5
    assert.ok(Math.abs(equipmentScore({ hack: 1.05 }, w) - 0.015) < 1e-12);          // NUKE Rootkit
    assert.equal(equipmentScore(undefined, w), 0);
});

test("GG-1: rankEquipment puts the best score per dollar first and zero-score items last (cheapest first)", () => {
    const w = taskStatWeights(trafficking);
    const items = [
        { name: "Bionic Legs", cost: 10e9, score: equipmentScore({ agi: 1.6 }, w) },
        { name: "Neuralstimulator", cost: 10e9, score: equipmentScore({ hack: 1.15 }, w) },
        { name: "Synthetic Heart", cost: 25e9, score: equipmentScore({ str: 1.5, agi: 1.5 }, w) },
        { name: "NUKE Rootkit", cost: 5e6, score: equipmentScore({ hack: 1.05 }, w) },
        { name: "Baseball Bat", cost: 1e6, score: equipmentScore({ str: 1.04, def: 1.04 }, w) },
        { name: "Bionic Arms", cost: 3e9, score: 0 },
    ];
    assert.deepEqual(rankEquipment(items).map(i => i.name),
        ["Baseball Bat", "NUKE Rootkit", "Neuralstimulator", "Synthetic Heart", "Bionic Arms", "Bionic Legs"]);
    assert.equal(items[0].name, "Bionic Legs", "input array is not mutated");
});

test("GG-1: ascension gain is weighted by each stat's contribution to the task", () => {
    const w = taskStatWeights(terrorism);
    const member = { hack: 50, str: 1000, def: 1000, dex: 1000, agi: 1000, cha: 50 };
    const asc = { respect: 1, hack: 1, str: 1.6, def: 1.6, dex: 1.6, agi: 1.6, cha: 1 };
    // (0.2*50*1 + 3 * 0.2*1000*1.6 + 0.2*50*1) / (0.2*50 + 3 * 0.2*1000 + 0.2*50) = 980 / 620
    assert.ok(Math.abs(weightedAscensionGain(asc, member, w) - 980 / 620) < 1e-12);
    // Agility alone does nothing for Terrorism
    assert.equal(weightedAscensionGain({ hack: 1, str: 1, def: 1, dex: 1, agi: 2, cha: 1 }, member, w), 1);
    // A member with no weighted stats yet: fall back to the best single-stat ratio so it can still ascend
    assert.equal(weightedAscensionGain(asc, { hack: 0, str: 0, def: 0, dex: 0, agi: 0, cha: 0 }, w), 1.6);
});

test("GG-1: weightedStat can strip equipment multipliers (lost on ascension)", () => {
    const w = taskStatWeights(terrorism);
    const member = { hack: 100, str: 300, def: 300, dex: 300, agi: 300, cha: 100, hack_mult: 1, str_mult: 3, def_mult: 3, dex_mult: 3, agi_mult: 3, cha_mult: 1 };
    assert.ok(Math.abs(weightedStat(member, w) - 0.2 * (100 + 900 + 100)) < 1e-9);
    assert.ok(Math.abs(weightedStat(member, w, true) - 0.2 * (100 + 300 + 100)) < 1e-9);
});

test("GG-1: training task follows the weight mass (Terrorism: 60 % combat, 20 % hacking, 20 % charisma)", () => {
    const w = taskStatWeights(terrorism);
    assert.equal(pickTrainingTask(w), "Train Combat");
    assert.equal(pickTrainingTask(w, 0.59), "Train Combat");
    assert.equal(pickTrainingTask(w, 0.61), "Train Hacking");
    assert.equal(pickTrainingTask(w, 0.81), "Train Charisma");
    assert.equal(pickTrainingTask(taskStatWeights({ hackWeight: 80, chaWeight: 20 })), "Train Hacking"); // Cyberterrorism
    assert.equal(pickTrainingTask(taskStatWeights({ hackWeight: 80, chaWeight: 20 }), 0.9), "Train Charisma");
});

test("GG-1: referenceTask picks the member's own crime if it is one, else the gang's most common crime (ties broken by first occurrence), else the fallback", () => {
    const crimes = ["Terrorism", "Human Trafficking"];
    // Path 1 (a single-member memberNames list is how gangs.js's referenceTaskFor asks "is this member's own task a crime?"):
    // the member's own crime wins even though the fallback differs from it.
    assert.equal(referenceTask({ Thug1: "Terrorism" }, ["Thug1"], crimes, "Human Trafficking"), "Terrorism");
    // ...and if that member isn't on a crime (training, Unassigned, or no entry at all), the fallback is returned.
    assert.equal(referenceTask({ Thug1: "Train Combat" }, ["Thug1"], crimes, "Human Trafficking"), "Human Trafficking");
    assert.equal(referenceTask({}, ["Thug1"], crimes, "Human Trafficking"), "Human Trafficking");

    // Path 2 (memberName == null in gangs.js: consider the whole roster, no member's task takes priority): a clear
    // majority wins regardless of order.
    const assignedTasks = { Thug1: "Terrorism", Thug2: "Terrorism", Thug3: "Human Trafficking" };
    assert.equal(referenceTask(assignedTasks, ["Thug1", "Thug2", "Thug3"], crimes, "Terrorism"), "Terrorism");

    // Path 3 (tie-break): with equal counts, the crime whose first occurrence comes first in memberNames order wins,
    // regardless of which member name happens to be assigned which crime.
    const tied = { Thug1: "Terrorism", Thug2: "Human Trafficking", Thug3: "Terrorism", Thug4: "Human Trafficking" };
    assert.equal(referenceTask(tied, ["Thug1", "Thug2", "Thug3", "Thug4"], crimes, "Terrorism"), "Terrorism"); // Terrorism (via Thug1) is seen first
    assert.equal(referenceTask(tied, ["Thug2", "Thug1", "Thug3", "Thug4"], crimes, "Terrorism"), "Human Trafficking"); // now Human Trafficking (via Thug2) is seen first

    // Path 4 (bootstrap fallback): nobody in the pool is on a crime yet (everyone training or Unassigned).
    const noCrimes = { Thug1: "Train Combat", Thug2: "Unassigned", Thug3: "Train Hacking" };
    assert.equal(referenceTask(noCrimes, ["Thug1", "Thug2", "Thug3"], crimes, "Terrorism"), "Terrorism");
});

// GG-3: territory/power are processed once every 100 gang cycles (Constants.ts CyclesPerTerritoryAndPowerUpdate), i.e. during every 10th
// normal update (10 cycles each) or every 4th bonus-time update (25 cycles each). ns.gang.nextUpdate() resolves with cycles * 200 ms.
test("GG-3: the update after 90 counted cycles carries the territory tick", () => {
    assert.equal(nextUpdateHasTerritoryTick(80, 10), false);
    assert.equal(nextUpdateHasTerritoryTick(90, 10), true);
    assert.equal(nextUpdateHasTerritoryTick(95, 10), true);
    assert.equal(nextUpdateHasTerritoryTick(null, 10), false);
    assert.equal(nextUpdateHasTerritoryTick(75, 25), true); // bonus time: 4 updates of 25 cycles
    assert.equal(nextUpdateHasTerritoryTick(50, 25), false);
});

test("GG-3: updates that resolved while no nextUpdate() was pending are estimated from the wall clock (one per 2 s)", () => {
    assert.equal(missedGangCycles(1900, 10), 0);
    assert.equal(missedGangCycles(2100, 10), 10);
    assert.equal(missedGangCycles(4500, 10), 20);
    assert.equal(missedGangCycles(0, 10), 0);
});

// GG-4: ascension zeroes exp and clears equipment (GangMember.ts ascend), so the member restarts at skill ~= its ascension multiplier. Train until
// the task-weighted, equipment-stripped stat is back to a fraction of its pre-ascension value instead of a blind 200 s.
test("GG-4: retraining lasts until the equipment-stripped weighted stat recovers the configured fraction", () => {
    const w = taskStatWeights(terrorism);
    const before = { hack: 50, str: 1000, def: 1000, dex: 1000, agi: 1000, cha: 50, hack_mult: 1, str_mult: 2, def_mult: 2, dex_mult: 2, agi_mult: 2, cha_mult: 1 };
    const target = retrainTargetFor(weightedStat(before, w, true), 0.9); // 0.9 * 0.2 * (50 + 3 * 500 + 50) = 288
    assert.ok(Math.abs(target - 288) < 1e-9);
    const noMults = { hack_mult: 1, str_mult: 1, def_mult: 1, dex_mult: 1, agi_mult: 1, cha_mult: 1 };
    const justAscended = { hack: 7, str: 7, def: 7, dex: 7, agi: 7, cha: 7, ...noMults };
    assert.equal(needsRetraining(weightedStat(justAscended, w, true), target), true);
    const nearlyThere = { hack: 7, str: 470, def: 470, dex: 470, agi: 470, cha: 7, ...noMults }; // 0.2 * (7 + 1410 + 7) = 284.8
    assert.equal(needsRetraining(weightedStat(nearlyThere, w, true), target), true);
    const recovered = { hack: 7, str: 480, def: 480, dex: 480, agi: 480, cha: 7, ...noMults };  // 0.2 * (7 + 1440 + 7) = 290.8
    assert.equal(needsRetraining(weightedStat(recovered, w, true), target), false);
});

test("GG-4: no target means no gate; a zero fraction disables it", () => {
    assert.equal(retrainTargetFor(0, 0.9), null);
    assert.equal(retrainTargetFor(620, 0), null);
    assert.equal(needsRetraining(5, null), false);
    assert.equal(needsRetraining(5, 4), false);
    assert.equal(needsRetraining(3, 4), true);
});
