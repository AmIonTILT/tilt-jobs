// Live check against Hyperliquid: the bundled scorer must match the site for the public demo wallet. node precompute/test-live.mjs
import assert from 'node:assert/strict';
import { computeShare, parseRange } from '../lib/score.mjs';
const DEMO = '0x20438cfdd36d75e185d6601697eb1973f4aee79d';
const d30 = await computeShare(DEMO, parseRange('30d')), all = await computeShare(DEMO, parseRange('all'));
assert.equal(d30.score, 39, `demo 30d score ${d30.score}, site shows 39`); assert.equal(all.score, 22, `demo all-time score ${all.score}, site shows 22`);
console.log('ok  demo wallet: 30d 39, all-time 22 (matches the site)');
