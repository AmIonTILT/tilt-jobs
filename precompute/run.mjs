// Daily score refresh for public Hyperliquid wallets -> the site's score cache (Upstash hash tilt:sc2:30d).
// Usage: node precompute/run.mjs [--shard 0..N-1 (default: UTC hour / (24/N))] [--shards 4] [--concurrency 3] [--budget-min 340] [--dry]
import { computeShare, parseRange } from '../lib/score.mjs';
import { store, pack, hashKey } from '../lib/store.mjs';
import { linkedWallets, visitedWallets, leaderboard, order, shard } from './plan.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SHARDS = +arg('shards', '4'), CONC = +arg('concurrency', '3'), BUDGET = +arg('budget-min', '340') * 60_000, RANGE = parseRange(arg('range', '30d')), DRY = process.argv.includes('--dry');
const K = arg('shard', '') === '' ? Math.floor(new Date().getUTCHours() / (24 / SHARDS)) : +arg('shard', '0');

const t0 = Date.now(); const db = store();
if (!db && !DRY) throw new Error('Missing KV_REST_API_URL / KV_REST_API_TOKEN repository secrets.');
const [linked, visited, lb] = await Promise.all([db ? linkedWallets(db).catch(() => []) : [], db ? visitedWallets(db).catch(() => []) : [], leaderboard()]);
const all = order(linked, lb.top, visited, lb.pool); const pick = shard(all, K, SHARDS);
console.log(`run ${K + 1}/${SHARDS}: ${pick.length} of ${all.length} wallets (priority groups: linked ${linked.length}, top ${lb.top.length}, visited ${visited.length})`);
let i = 0, ok = 0, buf = []; const fails = {};
const flush = async () => { if (!buf.length || DRY) { buf = []; return; } const b = buf; buf = []; await db.call(['HSET', hashKey(RANGE), ...b.flatMap((s) => [s.address, pack(s)])]); };
const worker = async () => { while (i < pick.length && Date.now() - t0 < BUDGET) { const w = pick[i++];
  for (let a = 0; a < 3; a++) { try { const s = await computeShare(w, RANGE); ok++; buf.push(s); break; }
    catch (e) { const m = String(e?.message ?? e).replace(/0x[0-9a-fA-F]{40}/g, '<wallet>').slice(0, 40); if (a === 2 || !/429|rate|fetch|timeout/i.test(m)) { fails[m] = (fails[m] ?? 0) + 1; break; } await new Promise((r) => setTimeout(r, 4000 * (a + 1))); } }
  if (buf.length >= 100) await flush(); } };
await Promise.all(Array.from({ length: CONC }, worker)); await flush();
const mins = (Date.now() - t0) / 60000;
console.log(JSON.stringify({ run: K, requested: pick.length, ok, failed: fails, notReached: Math.max(0, pick.length - i), minutes: +mins.toFixed(1), perMinute: +(ok / mins).toFixed(1) }));
