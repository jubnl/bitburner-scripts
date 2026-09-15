import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, makeLab, labStep, labReport } from "./darknet-mock.js";
import { nextMove, cellKey, stepTo, findExit, shouldRestart } from "../darknet/lab.js";

/* Drives darknet/lab.js's navigation against the ported maze generator.
 *
 * Two pure functions are the whole decision surface of the walk, and `walk` below wires them
 * together exactly as darknet/lab.js's main loop does:
 *
 *   nextMove(visited, stack, coords, open, target) -> { dir, push }
 *       given the visited cell set, the backtrack stack, the current coordinates, which of the
 *       four walls are open and (optionally) the exit seen on radar, the direction to
 *       authenticate with. It never mutates `visited` or `stack`: the caller records the cell
 *       and pushes/pops.
 *   shouldRestart(coords, expected, previous) -> boolean
 *       true when a labreport's coordinates cannot be explained by the move just made, which
 *       means the maze was regenerated and everything learned so far is stale (spec section 8).
 *
 * The mock's labReport/labStep are ports of the game's getLocationStatus/handleLabyrinthPassword,
 * so a walk that terminates here is the same walk the walker performs in game.
 *
 * Note the mock's labRadar never renders the exit (getSurroundingsVisualized is called with
 * showEnd false), so the radar branch is covered two ways: target "corner" (the far-corner
 * heuristic, what the walker uses until radar shows an X) and target "exit" (what it switches
 * to once it does), plus a direct unit test of `findExit` below.
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

/** Run one complete walk. `mode` is "corner" (no radar fix) or "exit" (radar has shown the X).
 * `swap` is an optional `{ at, to }` that replaces the maze after `at` steps and drops the
 * walker at the new maze's start, which is what a page reload does in game. */
function walk(initial, mode, swap) {
    const visited = new Set();
    const stack = [];
    const limit = 4 * cellCount(initial) + (swap ? 4 * cellCount(swap.to) : 0) + 16;
    let lab = initial;
    let position = lab.start.slice();
    let expected = null;
    let previous = null;
    let steps = 0;
    let stepsAfterSwap = 0;
    let restarts = 0;
    let swapped = false;
    while (steps < limit) {
        if (swap && !swapped && steps >= swap.at) {
            swapped = true;
            lab = swap.to;
            position = lab.start.slice();
        }
        const report = labReport(lab, position);
        if (shouldRestart(report.coords, expected, previous)) {
            visited.clear();
            stack.length = 0;
            restarts++;
        }
        previous = report.coords;
        visited.add(cellKey(report.coords));
        const walls = { north: report.north, east: report.east, south: report.south, west: report.west };
        const move = nextMove(visited, stack, report.coords, walls, mode === "exit" ? lab.end : null);
        if (!move.dir) return { solved: false, steps, stepsAfterSwap, restarts, why: "no move left" };
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
        expected = stepTo(report.coords, move.dir);
        steps++;
        if (swapped) stepsAfterSwap++;
        if (outcome.code === 200) return { solved: true, steps, stepsAfterSwap, restarts };
    }
    return { solved: false, steps, stepsAfterSwap, restarts, why: "step limit" };
}

for (const { width, height, offsets } of SIZES) {
    for (const mode of ["corner", "exit"]) {
        test(`walks a ${width}x${height} labyrinth${offsets ? " with offset start/end" : ""} (${mode} target)`, () => {
            for (const seed of SEEDS) {
                const lab = makeLab(width, height, makeRng(seed), offsets);
                const budget = 4 * cellCount(lab);
                const result = walk(lab, mode);
                assert.ok(result.solved, `${width}x${height} seed ${seed} (${mode}) did not finish: ${result.why} after ${result.steps} steps`);
                assert.ok(result.steps < budget, `${width}x${height} seed ${seed} (${mode}) took ${result.steps} steps, budget ${budget}`);
                assert.equal(result.restarts, 0, "an undisturbed walk must never think the maze changed");
            }
        });
    }
}

test("restarts and still finishes when the maze is regenerated mid-walk", () => {
    // A page reload regenerates the maze and drops every walker at a fresh start, so the next
    // labreport lands somewhere the last move cannot explain. Everything the walker learned
    // describes the old maze, so it has to throw the visited set and the stack away.
    for (const seed of SEEDS) {
        const before = makeLab(30, 20, makeRng(seed), false);
        const after = makeLab(30, 20, makeRng(seed + 100), true);
        const budget = 4 * cellCount(after);
        const result = walk(before, "corner", { at: 10, to: after });
        assert.ok(result.restarts >= 1, `seed ${seed}: the swap must be detected as a restart`);
        assert.ok(result.solved, `seed ${seed}: did not finish after the swap: ${result.why}`);
        assert.ok(result.stepsAfterSwap < budget,
            `seed ${seed}: took ${result.stepsAfterSwap} steps after the swap, budget ${budget}`);
    }
});

test("shouldRestart accepts the two coordinates a move can legitimately produce", () => {
    assert.equal(shouldRestart([5, 3], [5, 3], [3, 3]), false, "landing where the move aimed is normal");
    assert.equal(shouldRestart([3, 3], [3, 3], [3, 3]), false, "a blocked move or a timeout leaves us put");
    assert.equal(shouldRestart([9, 11], [5, 3], [3, 3]), true, "anything else means the maze changed");
    assert.equal(shouldRestart([9, 11], null, null), false, "the first report of a run explains nothing");
});

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
