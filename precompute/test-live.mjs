// Live check against Hyperliquid: the bundled scorer must match the site for the public demo wallet. node precompute/test-live.mjs
// The window is pinned to a fixed end time so the expected scores never drift as new days roll into a rolling 30d range.
// To refresh: run the site's scorer for the demo wallet at PINNED_NOW and update the numbers below together with lib/score.mjs.
import assert from 'node:assert/strict';
import { computeShare, parseRange } from '../lib/score.mjs';
const DEMO = '0x20438cfdd36d75e185d6601697eb1973f4aee79d';
const PINNED_NOW = Date.parse('2026-10-18T00:00:00Z');
const d30 = await computeShare(DEMO, parseRange('30d'), PINNED_NOW), all = await computeShare(DEMO, parseRange('all'), PINNED_NOW);
assert.equal(d30.score, 40, `demo 30d score ${d30.score}, site scorer gives 40 for the window ending 2026-10-18`);
assert.equal(all.score, 22, `demo all-time score ${all.score}, site scorer gives 22 up to 2026-10-18`);
console.log('ok  demo wallet (window ending 2026-10-18): 30d 40, all-time 22 (matches the site scorer)');
