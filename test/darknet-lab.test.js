import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, makeLab, labStep, labReport } from "./darknet-mock.js";
import { nextMove, cellKey, stepTo, findExit } from "../darknet/lab.js";

/* Drives darknet/lab.js's move selection against the ported maze generator.
 *
 * `nextMove` is the whole navigation decision: given the visited cell set, the backtrack
 * stack, the current coordinates, which of the four walls are open and (optionally) the
 * exit seen on radar, it returns the direction to authenticate with. It is pure -- it
 * never mutates `visited` or `stack` -- so the walker loop and this test can drive it the
 * same way: the caller records the cell, applies the move and pushes/pops the stack.
 *
 * The mock's labReport/labStep are ports of the game's getLocationStatus/handleLabyrinthPassword,
 * so a walk that terminates here is the same walk the walker performs in game.
 *
 * Note the mock's labRadar never renders the exit (getSurroundingsVisualized is called with
 * showEnd false), so the radar branch is covered two ways: `target: null` (the far-corner
 * heuristic, what the walker uses until radar shows an X) and `target: lab.end` (what the
 * walker switches to once it does), plus a direct unit test of `findExit` below.
 */

const SEEDS = [1, 2, 3, 4, 5];
const SIZES = [
    { width: 20, height: 14, offsets: false },
    { width: 30, height: 20, offsets: false },
    { width: 60, height: 40, offsets: true },
];

/** Cells sit on the odd lattice of the rendered maze; walls are the even rows/columns. */
function cellCount(lab) {
    return Math.floor((lab.maze[0].length - 1) / 2) * Math.floor((lab.maze.length - 1) / 2);
}

/** Run one complete walk, returning whether the exit was reached and in how many moves. */
function walk(lab, target) {
    const visited = new Set();
    const stack = [];
    const limit = 4 * cellCount(lab);
    let position = lab.start.slice();
    let steps = 0;
    while (steps < limit) {
        const report = labReport(lab, position);
        visited.add(cellKey(report.coords));
        const walls = { north: report.north, east: report.east, south: report.south, west: report.west };
        const move = nextMove(visited, stack, report.coords, walls, target);
        if (!move.dir) return { solved: false, steps, why: "no move left" };
        if (move.push) {
            stack.push(move.dir);
        } else {
            assert.ok(stack.length > 0, "a backtrack move must have something to pop");
            stack.pop();
        }
        const outcome = labStep(lab, position, move.dir);
        // labreport already told us which walls are open, so the walker must never waste an
        // authentication (and its network delay) walking into one.
        assert.ok(!/cannot go that way/i.test(outcome.message), `walked into a wall at ${report.coords} going ${move.dir}`);
        assert.deepEqual(outcome.pos, stepTo(report.coords, move.dir), "stepTo must agree with the game's move");
        position = outcome.pos;
        steps++;
        if (outcome.code === 200) return { solved: true, steps };
    }
    return { solved: false, steps, why: "step limit" };
}

for (const { width, height, offsets } of SIZES) {
    for (const target of ["corner heuristic", "radar exit"]) {
        test(`walks a ${width}x${height} labyrinth${offsets ? " with offset start/end" : ""} (${target})`, () => {
            for (const seed of SEEDS) {
                const lab = makeLab(width, height, makeRng(seed), offsets);
                const budget = 4 * cellCount(lab);
                const result = walk(lab, target === "radar exit" ? lab.end : null);
                assert.ok(result.solved, `${width}x${height} seed ${seed} (${target}) did not finish: ${result.why} after ${result.steps} steps`);
                assert.ok(result.steps < budget, `${width}x${height} seed ${seed} (${target}) took ${result.steps} steps, budget ${budget}`);
            }
        });
    }
}

test("nextMove prefers an unvisited cell, biased toward the target", () => {
    const visited = new Set([cellKey([3, 3])]);
    const open = { north: true, east: true, south: true, west: true };
    // North is [3,1], east [5,3], south [3,5], west [1,3]; the target sits south-east.
    const move = nextMove(visited, [], [3, 3], open, [9, 9]);
    assert.ok(move.push, "stepping into a new cell pushes the direction onto the stack");
    assert.ok(move.dir === "east" || move.dir === "south", `expected a move toward the target, got ${move.dir}`);
});

test("nextMove backtracks along the stack when every open neighbour is visited", () => {
    const visited = new Set([cellKey([3, 3]), cellKey([3, 1]), cellKey([5, 3])]);
    const open = { north: true, east: true, south: false, west: false };
    const move = nextMove(visited, ["east"], [3, 3], open, null);
    assert.equal(move.push, false, "backtracking pops instead of pushing");
    assert.equal(move.dir, "west", "backtracking reverses the last direction taken");
});

test("nextMove reports no move when the walk is exhausted", () => {
    const visited = new Set([cellKey([1, 1]), cellKey([1, 3])]);
    const open = { north: false, east: false, south: true, west: false };
    assert.deepEqual(nextMove(visited, [], [1, 1], open, null), { dir: null, push: false });
});

test("nextMove never mutates the visited set or the stack", () => {
    const visited = new Set([cellKey([3, 3])]);
    const stack = ["east"];
    const open = { north: true, east: false, south: false, west: true };
    nextMove(visited, stack, [3, 3], open, null);
    assert.equal(visited.size, 1);
    assert.deepEqual(stack, ["east"]);
});

test("findExit converts a radar window into absolute coordinates", () => {
    // labradar renders a 7x7 window with '@' at the walker and 'X' at the exit.
    const radar = [
        "███████",
        "█     █",
        "█ ███ █",
        "█  @  █",
        "█ ███ █",
        "█   X █",
        "███████",
    ].join("\n");
    // '@' is at window column 3 / row 3, 'X' at column 4 / row 5: two rows south, one column east.
    assert.deepEqual(findExit(radar, [11, 7]), [12, 9]);
    assert.equal(findExit(radar.replace("X", " "), [11, 7]), null, "no X in the window means the exit is not in range");
});
