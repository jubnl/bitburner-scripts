// SM-4: pre-4S volatility is the largest single-tick move over the near-term window only (a darknet-promoted stock's volatility decays
// x0.4 every cycle, src/StockMarket/StockMarket.ts scaleDarknetVolatilityIncreases), unbiased by (n+1)/n for the max of n uniform draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateVolatility } from "../stockmaster.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("uses only the newest windowLength moves (history is newest-first)", () => {
    // moves (newest first): 1%, 2%, 3%, then an old 50% spike outside a 3-move window
    const history = [103.02, 102, 100, 100 / 1.03, 200 / 1.03, 200 / 1.03];
    close(estimateVolatility(history, 3), 0.03 * 4 / 3);
    close(estimateVolatility(history, 5), 0.5 * 6 / 5); // a wider window still sees the spike
});

test("window is clipped to the available history and empty history gives 0", () => {
    close(estimateVolatility([101, 100], 10), 0.01 * 2 / 1);
    assert.equal(estimateVolatility([100], 10), 0);
    assert.equal(estimateVolatility([], 10), 0);
});
