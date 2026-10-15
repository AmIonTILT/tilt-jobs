// Daily score refresh for public Hyperliquid wallets -> the site's score cache (Upstash hashes tilt:sc2:<range>).
// Usage: node precompute/run.mjs [--shard 0..N-1 (default: UTC hour / (24/N))] [--shards 4] [--concurrency 2] [--budget-min 340]
//   [--ranges 30d,all] [--limit N] [--batch 20] [--gap-ms 250] [--timeout-s 90] [--wallets 0x..,0x..] [--dry]
// Logs never print wallet addresses (job logs are public): only counts, timings and error kinds.
import { computeShare, parseRange } from '../lib/score.mjs';
import { store, pack, hashKey } from '../lib/store.mjs';
import { linkedWallets, visitedWallets, leaderboard, order, shard } from './plan.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SHARDS = +arg('shards', '4'), CONC = +arg('concurrency', '2'), BUDGET = +arg('budget-min', '340') * 60_000, DRY = process.argv.includes('--dry');
const RANGES = arg('ranges', '30d,all').split(',').map((r) => parseRange(r.trim()));
const LIMIT = +arg('limit', '0'), BATCH = +arg('batch', '20'), GAP = +arg('gap-ms', '250'), TIMEOUT = +arg('timeout-s', '90') * 1000;
const K = arg('shard', '') === '' ? Math.floor(new Date().getUTCHours() / (24 / SHARDS)) : +arg('shard', '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (e) => String(e?.message ?? e).replace(/0x[0-9a-fA-F]{40}/g, '<wallet>').slice(0, 60);

const t0 = Date.now(); const db = store();
if (!db && !DRY) throw new Error('Missing KV_REST_API_URL / KV_REST_API_TOKEN repository secrets.');
let pick;
if (arg('wallets', '')) pick = arg('wallets', '').toLowerCase().split(',').filter((w) => /^0x[0-9a-f]{40}$/.test(w));
else {
  const [linked, visited, lb] = await Promise.all([db ? linkedWallets(db).catch(() => []) : [], db ? visitedWallets(db).catch(() => []) : [], leaderboard()]);
  const all = order(linked, lb.top, visited, lb.pool); pick = shard(all, K, SHARDS);
  console.log(`run ${K + 1}/${SHARDS}: ${pick.length} of ${all.length} wallets (priority groups: linked ${linked.length}, top ${lb.top.length}, visited ${visited.length})`);
}
if (LIMIT > 0) pick = pick.slice(0, LIMIT);
console.log(`plan: ${pick.length} wallets x ranges [${RANGES}], concurrency ${CONC}, save every ${BATCH}, timeout ${TIMEOUT / 1000}s`);

let i = 0, done = 0, saved = 0, slow = 0; const ok = Object.fromEntries(RANGES.map((r) => [r, 0])), fails = {}, buf = Object.fromEntries(RANGES.map((r) => [r, []]));
let backoff = 0; // shared cool-down after rate limits, so all workers slow down together
const flush = async (r) => { const b = buf[r]; if (!b.length) return; buf[r] = []; if (DRY) return;
  for (let a = 0; ; a++) { try { await db.call(['HSET', hashKey(r), ...b.flatMap((s) => [s.address, pack(s)])]); saved += b.length; return; }
    catch (e) { if (a >= 3) { fails[`save: ${clean(e)}`] = (fails[`save: ${clean(e)}`] ?? 0) + b.length; return; } await sleep(2000 * (a + 1)); } } };
const once = (w, r) => { let t; return Promise.race([computeShare(w, r), new Promise((_, no) => { t = setTimeout(() => no(new Error('timeout')), TIMEOUT); })]).finally(() => clearTimeout(t)); };
const worker = async () => { while (i < pick.length && Date.now() - t0 < BUDGET) { const w = pick[i++];
  for (const r of RANGES) { const ts = Date.now();
    for (let a = 0; a < 4; a++) {
      if (backoff > Date.now()) await sleep(backoff - Date.now());
      try { const s = await once(w, r); ok[r]++; buf[r].push(s); if (Date.now() - ts > 30_000) slow++; break; }
      catch (e) { const m = clean(e); const retry = /429|rate|fetch|timeout|5\d\d/i.test(m);
        if (/429|rate/i.test(m)) backoff = Math.max(backoff, Date.now() + 15_000 * (a + 1));
        if (a === 3 || !retry) { fails[m] = (fails[m] ?? 0) + 1; break; } await sleep(5000 * (a + 1)); } }
    if (buf[r].length >= BATCH) await flush(r); }
  done++; if (done % 10 === 0 || done === pick.length) console.log(`progress ${done}/${pick.length} ok ${JSON.stringify(ok)} saved ${saved} failed ${Object.values(fails).reduce((a, b) => a + b, 0)} ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await sleep(GAP); } };
await Promise.all(Array.from({ length: CONC }, worker)); for (const r of RANGES) await flush(r);
const mins = (Date.now() - t0) / 60000;
console.log(JSON.stringify({ run: K, requested: pick.length, ok, saved, failed: fails, slowOver30s: slow, notReached: Math.max(0, pick.length - i), minutes: +mins.toFixed(1), perMinute: +(done / mins).toFixed(1) }));
if (pick.length && saved === 0 && !DRY) process.exit(1); // a run that saves nothing is a failure, not a silent success
