import { getConfiguration } from "../helpers.js";
import { encodeMsg, PORT_DEFAULT, AGENT_FILES, FILES, LABS, hostFromArg } from "./lib.js";

/* The labyrinth walker. Runs on a darknet server that is directly connected to the current
 * labyrinth (that is the game's requirement for labreport/labradar/authenticate) and walks
 * the maze with an iterative depth-first search over the cell lattice.
 *
 * Usage: run darknet/lab.js <labHost> [--port 15]   (launched by darknet.js)
 *
 * Static RAM budget:
 *   base 1.60 | dnet.authenticate 0.40 | scp 0.60 | exec 1.30 | getHostname 0.05
 *   dnet.labreport 0 | dnet.labradar 0 | tryWritePort/print/tprint/sleep/disableLog 0
 *                                                                          => 3.95 GB
 *
 * Never call ns.dnet.connectToSession on a labyrinth: the game tracks the walker's position
 * per pid and opening a session corrupts it. authenticate(lab, direction) is the only call
 * that may target the lab while the walk is in progress.
 *
 * Game facts this relies on (bitburner-src/src/DarkNet/effects/labyrinth.ts):
 *   - authenticate(lab, "north"|"east"|"south"|"west") moves one cell, so coordinates change
 *     by 2; failures come back as code 401 with "You have moved to X,Y." or "You cannot go
 *     that way. You are still at X,Y.".
 *   - The move reply's `data` is the 3x3 window around the new cell, the same one labreport reads its
 *     north/east/south/west from, so labreport is only needed once at the start and after a failure.
 *   - Reaching the exit returns success with `data` set to the lab's password, and grants
 *     admin rights plus a `the_great_work` cache. A script has to run ON the lab to open it,
 *     so the walker scp's the agent payload over and execs the agent there.
 *   - The charisma gate is reported as ResponseCodeEnum.NotEnoughCharisma (451) *inside* the
 *     labyrinth handler, but NetscriptFunctions/Darknet.ts overwrites the code with 401 for
 *     labyrinth servers and only forwards the message. So the gate has to be recognised from
 *     the message text as well as from the code.
 *   - Each pid gets its own start position, so several walkers on different hosts explore
 *     independently; once any of them wins, every other walker's next authenticate succeeds
 *     immediately ("You have discovered the end of the labyrinth.") with the same password.
 *   - A page reload regenerates the maze and drops every walker at a fresh start position, so
 *     coordinates can jump for no reason the walker caused. Spec section 8 calls for a restart
 *     in that case: everything learned describes a maze that no longer exists.
 */

const argsSchema = [["port", PORT_DEFAULT]];
export function autocomplete(data) { data.flags(argsSchema); return []; }

const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPP = { north: "south", south: "north", east: "west", west: "east" };
const FAR_CORNER = 1e9;         // the exit sits at the bottom-right, up to a small random offset
const RADAR_EVERY = 5;          // steps between radar sweeps while the exit has not been seen
const PROGRESS_EVERY = 25;      // steps between progress reports to the controller
const RETRY_DELAY = 5000;       // ms to wait when labreport says we are lost or disconnected
const HEARTBEAT = 60000;        // ms: report at least this often so the controller can tell we live
const MAX_LOST = 12;            // give up after this many consecutive failed labreports
const CHARISMA_PATTERN = /charismatic|charming|charisma|moxie/i;
const BLOCKED_PATTERN = /cannot go that way/i;
const POSITION_PATTERN = /(?:moved to|still at) (-?\d+),(-?\d+)\./;

/** Cell coordinates as a set key. */
export function cellKey(coords) {
    return `${coords[0]},${coords[1]}`;
}

/** The coordinates one move away: the maze stores walls between cells, so a move is +/-2. */
export function stepTo(coords, direction) {
    const [dx, dy] = DIRS[direction];
    return [coords[0] + dx * 2, coords[1] + dy * 2];
}

/** Manhattan distance from the cell `direction` leads to, to `target` (the far corner when
 * the exit has not been seen on radar yet). */
function distanceAfter(coords, direction, target) {
    const cell = stepTo(coords, direction);
    const goal = target ?? [FAR_CORNER, FAR_CORNER];
    return Math.abs(goal[0] - cell[0]) + Math.abs(goal[1] - cell[1]);
}

/** Pick the next direction to authenticate with. Pure: neither `visited` nor `stack` is
 * modified, so the caller decides when to record a cell and when to push/pop.
 *
 * Returns `{ dir, push }`: `push` true means `dir` steps into an unexplored cell and the
 * caller must push it onto the stack; `push` false means `dir` walks the last move back and
 * the caller must pop. `{ dir: null }` means the reachable maze is exhausted.
 *
 * This is a plain iterative DFS, so it enters each cell at most once and backtracks out of it
 * at most once: a complete walk costs under 2 moves per cell whatever the maze looks like.
 * The distance sort only decides which unexplored branch to try first, which is what makes
 * the radar worth calling -- it does not affect termination.
 *
 * @param {Set<string>} visited cells already reported, as `cellKey` strings
 * @param {string[]} stack directions taken to get here, oldest first
 * @param {number[]} coords the walker's current cell
 * @param {{north:boolean,east:boolean,south:boolean,west:boolean}} open which walls are open
 * @param {number[]|null} target the exit's coordinates once radar has shown them */
export function nextMove(visited, stack, coords, open, target) {
    const choices = Object.keys(DIRS).filter(dir => open[dir] && !visited.has(cellKey(stepTo(coords, dir))));
    if (choices.length) {
        choices.sort((a, b) => distanceAfter(coords, a, target) - distanceAfter(coords, b, target));
        return { dir: choices[0], push: true };
    }
    if (stack.length) return { dir: OPP[stack[stack.length - 1]], push: false };
    return { dir: null, push: false };
}

/** True when a labreport's coordinates cannot be explained by the move we just made.
 *
 * `expected` is where the move should have put us and `previous` is where we were before it
 * (a blocked move or a timeout leaves us there). Anything else means the maze was regenerated
 * under us and the walker was teleported to a fresh start, so `visited` and the backtrack
 * stack now describe a maze that no longer exists and have to be thrown away.
 *
 * `expected` null (the first report of the run) is never a restart. */
export function shouldRestart(coords, expected, previous) {
    if (!expected) return false;
    const here = cellKey(coords);
    return here !== cellKey(expected) && here !== cellKey(previous ?? expected);
}

/** Absolute coordinates of the exit in a labradar window, or null when it is out of range.
 * The window is a square of odd size with '@' on the walker and 'X' on the exit. */
export function findExit(radar, coords) {
    const rows = String(radar ?? "").split("\n");
    let centreRow = -1;
    let centreColumn = -1;
    let exitRow = -1;
    let exitColumn = -1;
    for (let row = 0; row < rows.length; row++) {
        const at = rows[row].indexOf("@");
        if (at >= 0) { centreRow = row; centreColumn = at; }
        const cross = rows[row].indexOf("X");
        if (cross >= 0) { exitRow = row; exitColumn = cross; }
    }
    if (exitRow < 0) return null;
    if (centreRow < 0) {                       // no '@' rendered: fall back to the window centre
        centreRow = (rows.length - 1) / 2;
        centreColumn = (rows[exitRow].length - 1) / 2;
    }
    return [coords[0] + (exitColumn - centreColumn), coords[1] + (exitRow - centreRow)];
}

/** Position and open walls from an authenticate(lab, direction) reply, or null when the reply has neither.
 * The game answers every move with "You have moved to X,Y." (or "...still at X,Y." for a wall) and puts the
 * 3x3 window around the new cell in `data` (labyrinth.ts handleLabyrinthPassword). labreport's north/east/
 * south/west are that same window's [0][1], [1][2], [2][1], [1][0] === " " (labyrinth.ts getLocationStatus),
 * so reading them here saves the second lab authentication delay every step would otherwise cost (R5). */
export function parseMoveOutcome(message, data) {
    const found = String(message ?? "").match(POSITION_PATTERN);
    if (!found) return null;
    const rows = String(data ?? "").split("\n");
    if (rows.length < 3 || rows[0].length < 2 || rows[1].length < 3 || rows[2].length < 2) return null;
    return {
        coords: [Number(found[1]), Number(found[2])],
        open: { north: rows[0][1] === " ", east: rows[1][2] === " ", south: rows[2][1] === " ", west: rows[1][0] === " " },
    };
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    const labHost = hostFromArg(options._[0]);
    if (!labHost) return ns.tprint("ERROR: darknet/lab.js needs a labyrinth hostname as its first argument.");
    const me = ns.getHostname();
    const port = options.port;
    const send = (payload) => {
        reportedAt = Date.now();
        const line = encodeMsg("walker", me, ns.pid, { lab: labHost, ...payload });
        if (!ns.tryWritePort(port, line)) ns.print(`WARN: port ${port} full, dropped: ${line}`);
    };

    const chaReq = (LABS.find(row => row.host === labHost) ?? {}).cha ?? 0;
    const visited = new Set();
    const stack = [];
    let steps = 0;
    let sinceRadar = RADAR_EVERY;   // sweep on the very first cell
    let lost = 0;
    let target = null;
    let expected = null;            // where the last move should have left us
    let previous = null;            // where we were before the last move
    let reportedAt = 0;

    let report = null;              // { coords, open } from the last move reply; null = ask labreport
    while (true) {
        if (!report) {
            const status = await ns.dnet.labreport();
            if (!status.success) {
                // "You feel lost..." (no lab) or "You feel disconnected..." (the host stopped
                // neighbouring the lab, which happens when a darknet server migrates).
                lost++;
                send({ steps, done: false, reason: String(status.message ?? "no labreport") });
                if (lost >= MAX_LOST) return ns.print("giving up: labreport keeps failing");
                await ns.sleep(RETRY_DELAY);
                continue;
            }
            lost = 0;
            report = { coords: status.coords, open: { north: status.north, east: status.east, south: status.south, west: status.west } };
        }
        const coords = report.coords;
        const open = report.open;
        if (shouldRestart(coords, expected, previous)) {
            ns.print(`WARN: expected to be at ${cellKey(expected)} but the lab says ${cellKey(coords)}; the maze was regenerated, restarting the walk`);
            send({ steps, done: false, reason: "restart" });
            visited.clear();
            stack.length = 0;
            target = null;              // the exit moved with the maze
            sinceRadar = RADAR_EVERY;   // so the next loop sweeps immediately
        }
        expected = null;
        previous = coords;
        visited.add(cellKey(coords));

        if (target === null && sinceRadar >= RADAR_EVERY) {
            sinceRadar = 0;
            const radar = await ns.dnet.labradar();
            if (radar.success) target = findExit(radar.message, coords);
        }
        sinceRadar++;

        const move = nextMove(visited, stack, coords, open, target);
        if (!move.dir) {
            send({ steps, done: false, reason: "exhausted" });
            return ns.print("giving up: every reachable cell has been visited");
        }
        if (move.push) stack.push(move.dir); else stack.pop();

        const outcome = await ns.dnet.authenticate(labHost, move.dir);
        report = null;                  // anything unparseable below falls back to labreport
        expected = coords;              // unless the move landed, we are still where we were
        if (outcome.code === 408) {
            // A network timeout says nothing about the move; undo the bookkeeping and retry.
            if (move.push) stack.pop(); else stack.push(OPP[move.dir]);
            continue;
        }
        if (outcome.success) {
            send({ steps: steps + 1, done: true, password: outcome.data });
            deliverAgent(ns, labHost, port);
            return;
        }
        const message = String(outcome.message ?? "");
        if (outcome.code === 451 || CHARISMA_PATTERN.test(message)) {
            send({ steps, done: false, reason: "charisma", chaReq });
            return ns.print(`giving up: charisma is too low for ${labHost}`);
        }
        // The reply already carries the new position and the 3x3 wall window (R5): use it and skip
        // next loop's labreport. A 351/503 or an unexpected message leaves `report` null instead.
        const parsed = parseMoveOutcome(message, outcome.data);
        if (BLOCKED_PATTERN.test(message)) {
            // The walls we knew said that way was open, so the maze was regenerated under us (a page
            // reload does that). Treat the cell beyond it as a dead end and re-read the position.
            visited.add(cellKey(stepTo(coords, move.dir)));
            // Undo a push, because we never entered the cell. A *backtrack* that is blocked
            // keeps its pop on purpose: the recorded path no longer exists, so unwinding
            // further is the only thing that makes progress (and the only thing that
            // terminates -- restoring the stack would retry the same blocked move forever).
            if (move.push) stack.pop();
            report = parsed;
            continue;
        }
        expected = stepTo(coords, move.dir);
        report = parsed;
        steps++;
        // Also report on a timer: the controller treats a walker that has been silent for five
        // minutes as dead, and 25 moves through a deep lab can take longer than that.
        if (steps % PROGRESS_EVERY === 0 || Date.now() - reportedAt >= HEARTBEAT) send({ steps, done: false });
    }
}

/** Copy the agent payload onto the solved lab and start it there, so `cache.js` opens the
 * `the_great_work` cache the win just created and the reward augmentation gets queued. The
 * walker's own pid holds the lab session the win granted, which is what makes scp/exec legal.
 * @param {NS} ns */
function deliverAgent(ns, labHost, port) {
    // One file at a time: ns.scp throws on a missing source and copies nothing, so a single
    // gap in this host's payload would otherwise cost us the whole delivery. No command file is
    // shipped on purpose: this host's cmd.txt is a walk host's, which normally carries
    // stasis:true, and the lab agent would put a stasis link on the labyrinth with it -- a link
    // that counts against the global limit and that no command can ever release. With no cmd
    // file the lab agent runs on parseCmd's defaults (no stasis, no walk, no fillers) and only
    // opens the cache.
    for (const file of [...AGENT_FILES, FILES.passwords]) {
        try {
            ns.scp(file, labHost);
        } catch (err) {
            ns.print(`WARN: could not copy ${file} to ${labHost}: ${err}`);
        }
    }
    const started = ns.exec("darknet/agent.js", labHost, { threads: 1, preventDuplicates: true }, "--port", port);
    ns.print(started ? `started the agent on ${labHost} (pid ${started})` : `WARN: could not start the agent on ${labHost}`);
}
