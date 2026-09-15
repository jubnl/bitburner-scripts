// HC-4: share only multiplies faction-work rep (src/PersonObjects/formulas/reputation.ts), so daemon.js must gate it on the current work type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFactionWork } from "../daemon.js";

test("faction work is recognised from ns.singularity.getCurrentWork()", () => {
    assert.equal(isFactionWork({ type: "FACTION", factionName: "CyberSec", factionWorkType: "hacking", cyclesWorked: 3 }), true);
});

test("everything else is not faction work", () => {
    for (const w of [{ type: "CRIME" }, { type: "COMPANY" }, { type: "CLASS" }, { type: "CREATE_PROGRAM" }, { type: "GRAFTING" }, {}, null, undefined])
        assert.equal(isFactionWork(w), false, JSON.stringify(w));
});
