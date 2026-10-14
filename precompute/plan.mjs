// Who gets refreshed, in priority order. Pure functions plus two light reads. Wallet lists are never printed (job logs are public).
const ADDR = /^0x[0-9a-f]{40}$/;

/** 1) Wallets linked to signed-in accounts. Only key NAMES are read (`wa:<wallet>`); values are never fetched. */
export async function linkedWallets(db, maxScans = 200) {
  const out = new Set(); let cursor = '0';
  for (let i = 0; i < maxScans; i++) {
    const [next, keys] = await db.call(['SCAN', cursor, 'MATCH', 'wa:*', 'COUNT', 1000]);
    for (const k of keys) { const w = String(k).slice(3).toLowerCase(); if (ADDR.test(w)) out.add(w); }
    cursor = String(next); if (cursor === '0') break;
  }
  return [...out];
}
/** 3) Most viewed wallets (share pages, OG images, wallet-page previews). */
export async function visitedWallets(db, n = 2000) {
  const r = await db.call(['ZREVRANGE', 'tilt:visits', 0, n - 1]); return (r ?? []).map((w) => String(w).toLowerCase()).filter((w) => ADDR.test(w));
}
/** 2) + 4) Public Hyperliquid leaderboard: top by 30d PnL, and the active pool ranked by 30d volume. */
export async function leaderboard(pool = 10000, topPnl = 500) {
  const r = await fetch('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'); if (!r.ok) throw new Error(`leaderboard ${r.status}`);
  const rows = (await r.json()).leaderboardRows.filter((x) => ADDR.test(String(x.ethAddress).toLowerCase()));
  const m = (x, k) => Number(x.windowPerformances.find(([w]) => w === 'month')?.[1][k] ?? 0);
  const active = rows.filter((x) => m(x, 'vlm') > 0);
  return { top: [...active].sort((a, b) => m(b, 'pnl') - m(a, 'pnl')).slice(0, topPnl).map((x) => x.ethAddress.toLowerCase()),
    pool: [...active].sort((a, b) => m(b, 'vlm') - m(a, 'vlm')).slice(0, pool).map((x) => x.ethAddress.toLowerCase()) };
}
/** Ordered, de-duplicated list: linked accounts, top leaderboard, most visited, then the rest of the top 10K. */
export function order(linked, top, visited, pool) {
  const seen = new Set(), out = []; for (const list of [linked, top, visited, pool]) for (const w of list) if (!seen.has(w)) { seen.add(w); out.push(w); }
  return out;
}
/** Contiguous slice for this run. Slice 0 (first run of the UTC day) holds the priority wallets. */
export function shard(list, k, n) { const per = Math.ceil(list.length / n); return list.slice(k * per, (k + 1) * per); }
