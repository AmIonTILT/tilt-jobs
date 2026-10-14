// Offline checks: node precompute/test.mjs
import assert from 'node:assert/strict';
import { order, shard, linkedWallets, visitedWallets } from './plan.mjs';
import { pack } from '../lib/store.mjs';
const w = (c) => '0x' + c.repeat(40);
const all = order([w('a'), w('b')], [w('b'), w('c')], [w('d'), w('a')], [w('e'), w('c'), w('f')]);
assert.deepEqual(all, [w('a'), w('b'), w('c'), w('d'), w('e'), w('f')]); console.log('ok  priority order: linked, top, visited, pool; de-duplicated');
const big = Array.from({ length: 10001 }, (_, i) => String(i)); const parts = [0, 1, 2, 3].map((k) => shard(big, k, 4));
assert.equal(parts.flat().length, 10001); assert.equal(new Set(parts.flat()).size, 10001); assert.equal(parts[0][0], '0'); console.log('ok  4 shards cover every wallet once a day; shard 0 starts with the priority wallets');
const calls = []; const db = { call: async (c) => { calls.push(c); if (c[0] === 'SCAN') return c[1] === '0' ? ['7', ['wa:' + w('a'), 'wa:junk']] : ['0', ['wa:' + w('B')]]; if (c[0] === 'ZREVRANGE') return [w('d'), 'nope']; } };
assert.deepEqual(await linkedWallets(db), [w('a'), w('b')]); assert.ok(calls.every((c) => c[0] === 'SCAN'), 'only SCAN (key names), never GET of values');
assert.deepEqual(await visitedWallets(db), [w('d')]); console.log('ok  linked wallets read from key names only (no values, no emails); visits filtered to wallet addresses');
assert.equal(pack({ score: NaN, grade: 'x', tax: 1.234, flagged: 1, closed: 0, net: -2.345, lowConfidence: true, computedAt: 5 }), '[-1,"x",1.23,1,0,-2.35,1,5]'); console.log('ok  compact format matches the site reader');
