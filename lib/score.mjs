// Tilt scoring core: the same code that scores Hyperliquid wallets on the site, bundled for this job. Generated; do not edit by hand.

// src/lib/analytics.ts
var EPS = 1e-9;
var n = (s) => s == null ? 0 : Number(s);
var isSpot = (coin) => coin.startsWith("@") || coin.includes("/");
var dexOf = (coin) => coin.includes(":") ? coin.split(":")[0] : "";
var CATEGORY_LABEL = {
  crypto: "Crypto",
  stocks: "Equities",
  indices: "Indices",
  commodities: "Commodities",
  fx: "FX",
  preipo: "Pre-IPO",
  rates: "Rates",
  other: "Other"
};
function categoryOf(coin, cats) {
  if (!coin.includes(":")) return "crypto";
  let c = cats[coin];
  if (c === "stock") c = "stocks";
  return c && c in CATEGORY_LABEL ? c : "other";
}
function buildTrades(fills, funding, cats) {
  const perp = fills.filter((f) => !isSpot(f.coin)).sort((a, b) => a.time - b.time || a.tid - b.tid);
  const open = /* @__PURE__ */ new Map();
  const trades = [];
  const start = (f, side, carried) => ({
    id: `${f.coin}-${f.time}-${side}${carried ? "-c" : ""}`,
    coin: f.coin,
    dex: dexOf(f.coin),
    category: categoryOf(f.coin, cats),
    side,
    openTime: f.time,
    closeTime: null,
    carried,
    entryNotional: 0,
    entrySize: 0,
    exitNotional: 0,
    exitSize: 0,
    maxSize: 0,
    fills: 0,
    gross: 0,
    fees: 0,
    funding: 0,
    net: 0,
    liquidated: false,
    builderFees: 0
  });
  for (const f of perp) {
    const sz = n(f.sz), px = n(f.px), fee = f.feeToken?.trim() === "USDC" || !f.feeToken ? n(f.fee) : 0;
    const startPos = n(f.startPosition);
    const delta = f.side === "B" ? sz : -sz;
    const endPos = startPos + delta;
    let t = open.get(f.coin);
    if (!t) {
      if (Math.abs(startPos) < EPS) t = start(f, delta > 0 ? "long" : "short", false);
      else t = start(f, startPos > 0 ? "long" : "short", true);
      open.set(f.coin, t);
      trades.push(t);
    }
    const flips = Math.abs(startPos) > EPS && Math.abs(endPos) > EPS && Math.sign(startPos) !== Math.sign(endPos);
    const closingSz = flips ? Math.abs(startPos) : Math.abs(endPos) < Math.abs(startPos) ? sz : 0;
    const openingSz = sz - closingSz;
    const closeFrac = sz > 0 ? closingSz / sz : 0;
    if (f.liquidation || /liquidat/i.test(f.dir)) t.liquidated = true;
    if (closingSz > EPS) {
      t.exitNotional += closingSz * px;
      t.exitSize += closingSz;
      t.gross += n(f.closedPnl);
      t.fees += fee * (flips ? closeFrac : 1);
      t.fills++;
      t.builderFees += n(f.builderFee) * (flips ? closeFrac : 1);
    }
    if (Math.abs(endPos) < EPS || flips) {
      t.closeTime = f.time;
      open.delete(f.coin);
    }
    if (openingSz > EPS) {
      if (flips) {
        t = start(f, endPos > 0 ? "long" : "short", false);
        open.set(f.coin, t);
        trades.push(t);
      }
      t.entryNotional += openingSz * px;
      t.entrySize += openingSz;
      t.fees += fee * (flips ? 1 - closeFrac : 1);
      t.builderFees += n(f.builderFee) * (flips ? 1 - closeFrac : 1);
      t.fills++;
      if (closingSz <= EPS) t.gross += n(f.closedPnl);
    }
    t.maxSize = Math.max(t.maxSize, Math.abs(endPos));
  }
  const byCoin = /* @__PURE__ */ new Map();
  for (const t of trades) (byCoin.get(t.coin) ?? byCoin.set(t.coin, []).get(t.coin)).push(t);
  const unattached = /* @__PURE__ */ new Map();
  for (const e of funding) {
    const usdc = n(e.delta.usdc);
    const target = byCoin.get(e.delta.coin)?.find((t) => (t.carried || e.time >= t.openTime) && (t.closeTime == null || e.time <= t.closeTime));
    if (target) target.funding += usdc;
    else unattached.set(e.delta.coin, (unattached.get(e.delta.coin) ?? 0) + usdc);
  }
  for (const t of trades) t.net = t.gross - t.fees + t.funding;
  return { trades: trades.sort((a, b) => (b.closeTime ?? Date.now()) - (a.closeTime ?? Date.now())), unattachedFunding: unattached };
}
function totals(fills, funding, trades) {
  const perp = fills.filter((f) => !isSpot(f.coin));
  let gross = 0, fees = 0, volume = 0, builderFees = 0, rebates = 0, nonUsdcFees = 0;
  for (const f of perp) {
    gross += n(f.closedPnl);
    volume += n(f.px) * n(f.sz);
    builderFees += n(f.builderFee);
    if (f.feeToken?.trim() === "USDC" || !f.feeToken) {
      fees += n(f.fee);
      if (n(f.fee) < 0) rebates += -n(f.fee);
    } else nonUsdcFees++;
  }
  const fund = funding.reduce((s, e) => s + n(e.delta.usdc), 0);
  const closed = trades.filter((t) => t.closeTime != null);
  const wins = closed.filter((t) => t.net > 0), losses = closed.filter((t) => t.net <= 0);
  const sumW = wins.reduce((s, t) => s + t.net, 0), sumL = losses.reduce((s, t) => s + t.net, 0);
  return {
    gross,
    fees,
    funding: fund,
    net: gross - fees + fund,
    volume,
    builderFees,
    rebates,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgWin: wins.length ? sumW / wins.length : 0,
    avgLoss: losses.length ? sumL / losses.length : 0,
    profitFactor: sumL < 0 ? sumW / -sumL : sumW > 0 ? Infinity : 0,
    best: closed.reduce((m, t) => Math.max(m, t.net), 0),
    worst: closed.reduce((m, t) => Math.min(m, t.net), 0),
    spotFills: fills.length - perp.length,
    nonUsdcFees,
    perpFills: perp.length
  };
}
function dailySeries(fills, funding, from, to) {
  const day = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const m = /* @__PURE__ */ new Map();
  for (let d = day(from); d <= to; d += 864e5) m.set(day(d), 0);
  for (const f of fills) if (!isSpot(f.coin)) {
    const k = day(f.time);
    m.set(k, (m.get(k) ?? 0) + n(f.closedPnl) - (f.feeToken?.trim() === "USDC" || !f.feeToken ? n(f.fee) : 0));
  }
  for (const e of funding) {
    const k = day(e.time);
    m.set(k, (m.get(k) ?? 0) + n(e.delta.usdc));
  }
  let cum = 0;
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v, cum: cum += v }));
}
function reconcileOpen(trades, liveCoins) {
  for (const t of trades) if (t.closeTime == null && !liveCoins.has(t.coin)) t.offFills = true;
  return trades;
}
function closeLegTrades(fills, cats) {
  const perp = fills.filter((f) => !isSpot(f.coin)).sort((a, b) => a.time - b.time || a.tid - b.tid);
  const lastAdd = /* @__PURE__ */ new Map();
  const legs = /* @__PURE__ */ new Map();
  const out = [];
  for (const f of perp) {
    const sz = n(f.sz), px = n(f.px), fee = f.feeToken?.trim() === "USDC" || !f.feeToken ? n(f.fee) : 0;
    const startPos = n(f.startPosition), delta = f.side === "B" ? sz : -sz, endPos = startPos + delta;
    const flips = Math.abs(startPos) > EPS && Math.abs(endPos) > EPS && Math.sign(startPos) !== Math.sign(endPos);
    const closingSz = flips ? Math.abs(startPos) : Math.abs(endPos) < Math.abs(startPos) ? sz : 0;
    if (closingSz > EPS && Math.abs(startPos) > EPS) {
      const side = startPos > 0 ? "long" : "short";
      const k = `${f.coin}:${f.oid}:${side}`;
      let t = legs.get(k);
      if (!t) {
        const opened = lastAdd.get(`${f.coin}:${side}`) ?? f.time;
        t = {
          id: `${f.coin}-${f.time}-${side}-leg${f.oid}`,
          coin: f.coin,
          dex: dexOf(f.coin),
          category: categoryOf(f.coin, cats),
          side,
          openTime: Math.min(opened, f.time),
          closeTime: f.time,
          carried: !lastAdd.has(`${f.coin}:${side}`),
          entryNotional: 0,
          entrySize: 0,
          exitNotional: 0,
          exitSize: 0,
          maxSize: Math.abs(startPos),
          fills: 0,
          gross: 0,
          fees: 0,
          funding: 0,
          net: 0,
          liquidated: false,
          builderFees: 0
        };
        legs.set(k, t);
        out.push(t);
      }
      const pnl = n(f.closedPnl), frac = sz > 0 ? closingSz / sz : 0;
      const entryPx = closingSz > 0 ? side === "long" ? px - pnl / closingSz : px + pnl / closingSz : px;
      t.entryNotional += entryPx * closingSz;
      t.entrySize += closingSz;
      t.exitNotional += px * closingSz;
      t.exitSize += closingSz;
      t.gross += pnl;
      t.fees += fee * frac;
      t.builderFees += n(f.builderFee) * frac;
      t.net = t.gross - t.fees - t.builderFees;
      t.fills++;
      t.closeTime = f.time;
      if (f.liquidation) t.liquidated = true;
    }
    if (Math.abs(endPos) > Math.abs(startPos) || flips) lastAdd.set(`${f.coin}:${endPos > 0 ? "long" : "short"}`, f.time);
  }
  return out;
}

// src/lib/hl.ts
var INFO_URL = "https://api.hyperliquid.xyz/info";
var inflight = 0;
var queue = [];
async function limit(fn) {
  if (inflight >= 4) await new Promise((r) => queue.push(r));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    queue.shift()?.();
  }
}
var MEMO_TYPES = /* @__PURE__ */ new Set(["perpDexs", "perpCategories", "clearinghouseState", "spotClearinghouseState", "userRole", "userAbstraction"]);
var memo = /* @__PURE__ */ new Map();
async function info(body, retries = 3) {
  if (!MEMO_TYPES.has(String(body.type))) return infoRaw(body, retries);
  const k = JSON.stringify(body), now = Date.now(), hit = memo.get(k);
  if (hit && now - hit.t < 2e4) return hit.p;
  if (memo.size > 500) {
    for (const [kk, v] of memo) if (now - v.t >= 2e4) memo.delete(kk);
  }
  const p = infoRaw(body, retries);
  memo.set(k, { t: now, p });
  p.catch(() => {
    if (memo.get(k)?.p === p) memo.delete(k);
  });
  return p;
}
async function infoRaw(body, retries = 3) {
  return limit(async () => {
    for (let i = 0; ; i++) {
      const res = await fetch(INFO_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return await res.json();
      if (i >= retries || res.status !== 429 && res.status < 500) throw new Error(`Hyperliquid API ${res.status} for ${String(body.type)}`);
      await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  });
}
var HL_FILL_CAP = 1e4;
var loadProgress = { fills: 0, funding: 0, pages: 0, reset() {
  this.fills = 0;
  this.funding = 0;
  this.pages = 0;
} };
async function paginate(body, startTime, endTime, pageCap, key, maxPages = 40) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  let start = startTime;
  for (let page = 0; page < maxPages; page++) {
    const batch = await info({ ...body, startTime: start, endTime });
    let added = 0;
    for (const x of batch) {
      const k = key(x);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
        added++;
      }
    }
    loadProgress.pages++;
    if (body.type === "userFillsByTime") loadProgress.fills += added;
    else if (body.type === "userFunding") loadProgress.funding += added;
    if (batch.length < pageCap || added === 0) return { items: out.sort((a, b) => a.time - b.time), truncated: false };
    start = Math.max(...batch.map((x) => x.time));
  }
  return { items: out.sort((a, b) => a.time - b.time), truncated: true };
}
function fillCoverage(items, startTime, pagesTruncated) {
  const oldest = items.length ? items[0].time : void 0;
  const capped = items.length >= HL_FILL_CAP * 0.95 && oldest != null && oldest > startTime + 6e4;
  return { truncated: capped || pagesTruncated, capped, coveredFrom: capped || pagesTruncated ? oldest : void 0 };
}
async function fetchFills(user, startTime, endTime = Date.now()) {
  const r = await paginate(
    { type: "userFillsByTime", user, aggregateByTime: true },
    startTime,
    endTime,
    2e3,
    (f) => `${f.tid}:${f.coin}:${f.oid}`,
    8
  );
  return { items: r.items, ...fillCoverage(r.items, startTime, r.truncated) };
}
function fetchFunding(user, startTime, endTime = Date.now()) {
  return paginate(
    { type: "userFunding", user },
    startTime,
    endTime,
    500,
    (f) => `${f.time}:${f.delta.coin}`,
    400
  );
}
async function fetchFundingFast(user, startTime, endTime = Date.now()) {
  const span = endTime - startTime, minChunk = 15 * 864e5;
  const n2 = Math.max(1, Math.min(6, Math.ceil(span / minChunk)));
  if (n2 === 1) return fetchFunding(user, startTime, endTime);
  const step = Math.ceil(span / n2);
  const parts = await Promise.all(Array.from({ length: n2 }, (_, i) => fetchFunding(user, startTime + i * step, Math.min(endTime, startTime + (i + 1) * step - 1))));
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const p of parts) for (const f of p.items) {
    const k = `${f.time}:${f.delta.coin}`;
    if (!seen.has(k)) {
      seen.add(k);
      items.push(f);
    }
  }
  return { items: items.sort((a, b) => a.time - b.time), truncated: parts.some((p) => p.truncated) };
}
async function fetchPerpDexs() {
  const d = await info({ type: "perpDexs" });
  return d.map((x) => x ? x.name : "");
}
function fetchClearinghouse(user, dex) {
  return info({ type: "clearinghouseState", user, dex });
}
function fetchRole(user) {
  return info({ type: "userRole", user });
}
function fetchSpotUsd(user) {
  return info({ type: "spotClearinghouseState", user }).then((r) => r.balances.filter((b) => b.coin === "USDC").reduce((a, b) => a + Number(b.total), 0)).catch(() => 0);
}
function fetchLedger(user, startTime = 0, endTime = Date.now()) {
  return paginate({ type: "userNonFundingLedgerUpdates", user }, startTime, endTime, 2e3, (x) => `${x.hash}:${x.time}:${x.delta.type}`, 20);
}

// src/lib/feelings.ts
var MOODS = [
  { id: "calm", emoji: "\u{1F60C}", label: "Calm", neg: false },
  { id: "confident", emoji: "\u{1F60E}", label: "Confident", neg: false },
  { id: "focused", emoji: "\u{1F3AF}", label: "Focused", neg: false },
  { id: "patient", emoji: "\u{1F9D8}", label: "Patient", neg: false },
  { id: "anxious", emoji: "\u{1F62C}", label: "Anxious", neg: true },
  { id: "fomo", emoji: "\u{1F3C3}", label: "FOMO", neg: true },
  { id: "angry", emoji: "\u{1F620}", label: "Angry", neg: true },
  { id: "revenge", emoji: "\u{1F608}", label: "Revenge", neg: true },
  { id: "bored", emoji: "\u{1F971}", label: "Bored", neg: true },
  { id: "greedy", emoji: "\u{1F911}", label: "Greedy", neg: true },
  { id: "fearful", emoji: "\u{1F628}", label: "Fearful", neg: true },
  { id: "frustrated", emoji: "\u{1F624}", label: "Frustrated", neg: true },
  { id: "euphoric", emoji: "\u{1F680}", label: "Euphoric", neg: true }
];
var moodLabel = (id) => MOODS.find((m) => m.id === id)?.label ?? id;
var isNegMood = (id) => MOODS.find((m) => m.id === id)?.neg ?? false;
var PHASES = ["before", "during", "after"];
var tradeMoods = (f) => [...new Set(PHASES.flatMap((p) => f?.[p]?.moods ?? []))];
var feltTilt = (f) => PHASES.some((p) => {
  const c = f?.[p];
  return !!c && c.intensity >= 3 && c.moods.some(isNegMood);
});
function moodStats(trades, f) {
  const m = /* @__PURE__ */ new Map();
  for (const t of trades) for (const mood of tradeMoods(f[t.id])) {
    const r = m.get(mood) ?? { n: 0, net: 0, w: 0 };
    r.n++;
    r.net += t.net;
    if (t.net > 0) r.w++;
    m.set(mood, r);
  }
  return [...m.entries()].map(([mood, r]) => ({ mood, n: r.n, net: r.net, avg: r.net / r.n, winRate: r.w / r.n })).sort((a, b) => a.net - b.net);
}

// src/lib/tilt.ts
var TH = {
  revengeMin: 30,
  // re-entry within this many minutes after a losing close
  oversizeX: 2,
  // entry notional above this multiple of your median...
  oversizeAfterLossMin: 240,
  // ...opened within this many minutes after closing a losing trade (any market)...
  oversizeVsLossX: 1.5,
  // ...and larger than this multiple of that losing trade's entry (sizing up to win it back)
  overtradeX: 2,
  // daily trade count above this multiple of your median day (and at least overtradeMin)
  overtradeMin: 8,
  holdLoserX: 2,
  // losing trade held longer than this multiple of your median winning hold time
  blowupX: 5,
  // loss above this multiple of your median loss (or a liquidation)
  badHourMinTrades: 5,
  // hours of day (UTC) with at least this many trades and a negative net
  badHours: 3,
  // flag the worst N such hours
  controlledAcctPct: 0.08,
  // a losing trade smaller than this share of account value is a controlled loss, never flagged
  controlledLossX: 2,
  // ...as is a loss within this multiple of your own median loss
  minTrades: 3,
  // below this many closed trades there is no score (n/a)
  fullTrades: 8,
  // at or above this many closed trades the score is full confidence; 3 to 7 is provisional
  fullConfLosses: 8,
  // the loss-share part of the score reaches full weight with this many losing trades
  makerBps: 1.5,
  // fee drag compares taker fills to this maker rate (Hyperliquid base tier); other venues use MAKER_BPS
  capLossPct: 0.2,
  // window PnL worse than -20% of capital at risk caps the score...
  capScore: 70,
  // ...at this value (so it can never read "Zen master" while the account is deep under water)
  capLossPct2: 0.4,
  // worse than -40% of capital at risk...
  capScore2: 50,
  // ...caps it here
  ddFreePct: 0.05,
  // sustained drawdown up to 5% of capital at risk costs nothing...
  ddPtsPerPct: 2,
  // ...beyond that, this many points per percentage point...
  ddMaxPts: 30
  // ...up to this many points
};
var MAKER_BPS = {
  // Coinbase: US Advanced spot entry tier is 0.50% maker / 0.90% taker since 2026-09-16 (Coinbase announcement, as reported; the official
  // fee page shows rates only when signed in). EU/UK entry is 0.25% maker. Re-check if Coinbase changes tiers again.
  hl: TH.makerBps,
  binance: 2,
  bybit: 2,
  okx: 2,
  bitget: 2,
  bingx: 2,
  blofin: 2,
  bitunix: 2,
  coinbase: 50,
  breakout: null,
  generic: null
};
var venueOfFill = (f) => {
  const m = /^([a-z]+):/.exec(f.hash ?? "");
  return m ? m[1] : "hl";
};
var makerBpsFor = (venue) => venue in MAKER_BPS ? MAKER_BPS[venue] : null;
var PATTERNS = [
  { id: "blowup", label: "Blowups", color: "#ff5c5c", rule: `Liquidated, or a loss more than ${TH.blowupX}\xD7 your median loss` },
  { id: "revenge", label: "Revenge trades", color: "#ff7a45", rule: `Opened within ${TH.revengeMin} min of closing a losing trade` },
  { id: "oversize", label: "Oversizing", color: "#ff9f2e", rule: `Sizing up after a loss: entry above ${TH.oversizeX}\xD7 your median trade size, opened within ${TH.oversizeAfterLossMin / 60} h of a losing trade and over ${TH.oversizeVsLossX}\xD7 its size` },
  { id: "overtrade", label: "Overtrading", color: "#ffb000", rule: `Trades beyond ${TH.overtradeX}\xD7 your median daily count on a day with ${TH.overtradeMin}+ trades` },
  { id: "holdloser", label: "Holding losers", color: "#e0c341", rule: `Losing trade held more than ${TH.holdLoserX}\xD7 your median winning hold time` },
  { id: "badhours", label: "Worst hours", color: "#b7c95a", rule: `Trades opened in your ${TH.badHours} worst hours (your local time) (min ${TH.badHourMinTrades} trades, net negative)` },
  { id: "feelings", label: "Felt tilt (logged)", color: "#8fcf72", rule: "You logged a negative mood (FOMO, anger, revenge, fear\u2026) at intensity 3+ on the trade, and automatic patterns did not already charge it" },
  { id: "fees", label: "Fees (shown separately)", color: "#7d8c93", rule: "Fees are not part of the Tilt Tax. They are shown on their own line, split into taker and maker" }
];
var median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
var DAY = 864e5;
var dayKey = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
var weekKey = (t) => {
  const d = new Date(dayKey(t));
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d.getTime();
};
function gradeOf(score) {
  if (isNaN(score)) return { label: "Too few trades to judge", caption: "Needs 3 closed trades." };
  if (score >= 90) return { label: "Zen master", caption: "Almost no losses from flagged trades." };
  if (score >= 80) return { label: "Cool as a cucumber", caption: "Few, small flagged losses." };
  if (score >= 70) return { label: "Mostly chill", caption: "Occasional costly flags." };
  if (score >= 60) return { label: "Slightly spicy", caption: "Flagged losses are noticeable." };
  if (score >= 50) return { label: "Tilt-adjacent", caption: "Flagged trades drive a large share of losses." };
  if (score >= 35) return { label: "Tilting", caption: "Flagged trades drive most losses." };
  if (score >= 20) return { label: "Full tilt", caption: "Losses are mostly flagged trades." };
  return { label: "Pinball mode", caption: "Nearly all losses are flagged trades." };
}
function feeSplit(fills) {
  let taker = 0, maker = 0, takerFills = 0, makerFills = 0, bench = 0;
  for (const f of fills) {
    const fee = f.feeToken?.trim() === "USDC" || !f.feeToken ? Number(f.fee) || 0 : 0;
    if (f.crossed) {
      taker += fee;
      takerFills++;
      const bps = makerBpsFor(venueOfFill(f));
      bench += bps == null ? fee : (Number(f.px) || 0) * (Number(f.sz) || 0) * bps / 1e4;
    } else {
      maker += fee;
      makerFills++;
    }
  }
  return { total: taker + maker, taker, maker, takerFills, makerFills, drag: Math.max(0, taker - bench) };
}
function analyzeTilt(trades, fills, feelings = {}, opts = {}) {
  const closed = trades.filter((t) => t.closeTime != null && !t.offFills).sort((a, b) => a.openTime - b.openTime);
  const tags = /* @__PURE__ */ new Map();
  const add = (t, p) => {
    if (t.carried && !t.liquidated && !t.id.includes("-leg")) return;
    (tags.get(t.id) ?? tags.set(t.id, /* @__PURE__ */ new Set()).get(t.id)).add(p);
  };
  const hold = (t) => ((t.closeTime ?? t.openTime) - t.openTime) / 6e4;
  const wins = closed.filter((t) => t.net > 0), losses = closed.filter((t) => t.net <= 0);
  const medSize = median(closed.map((t) => t.entryNotional));
  const medLoss = median(losses.map((t) => -t.net));
  const winHold = median(wins.map(hold)), lossHold = median(losses.map(hold));
  const acct = opts.accountValue ?? 0;
  const limitUsd = Math.max(TH.controlledLossX * medLoss, acct > 0 ? TH.controlledAcctPct * acct : 0);
  const controlled = (t) => t.net < 0 && !t.liquidated && -t.net <= limitUsd;
  const exemptList = closed.filter(controlled);
  const add0 = add;
  const addF = (t, p) => {
    if (!controlled(t)) add0(t, p);
  };
  for (const t of closed) if (t.liquidated || losses.length >= 3 && -t.net > TH.blowupX * medLoss && t.net < 0 && !controlled(t)) add(t, "blowup");
  const lossCloses = closed.filter((t) => t.net < 0).map((t) => ({ c: t.closeTime, coin: t.coin })).sort((a, b) => a.c - b.c);
  const flipOf = (t, l) => l.coin === t.coin && l.c === t.openTime;
  for (const t of closed) {
    const prev = lossCloses.filter((l) => l.c <= t.openTime && t.openTime - l.c <= TH.revengeMin * 6e4 && !flipOf(t, l));
    if (prev.length) addF(t, "revenge");
  }
  const lossOpens = closed.filter((t) => t.net < 0).map((t) => ({ c: t.closeTime, size: t.entryNotional }));
  for (const t of closed) if (medSize > 0 && t.entryNotional > TH.oversizeX * medSize && lossOpens.some((l) => l.c <= t.openTime && t.openTime - l.c <= TH.oversizeAfterLossMin * 6e4 && t.entryNotional > TH.oversizeVsLossX * l.size)) addF(t, "oversize");
  const byDay = /* @__PURE__ */ new Map();
  for (const t of closed) (byDay.get(dayKey(t.openTime)) ?? byDay.set(dayKey(t.openTime), []).get(dayKey(t.openTime))).push(t);
  const medDaily = median([...byDay.values()].map((a) => a.length));
  const cap = Math.max(TH.overtradeMin - 1, Math.ceil(TH.overtradeX * medDaily));
  for (const a of byDay.values()) if (a.length > cap) a.slice(cap).forEach((t) => addF(t, "overtrade"));
  if (winHold > 0) {
    for (const t of losses) if (t.net < 0 && hold(t) > TH.holdLoserX * winHold) addF(t, "holdloser");
  }
  const hr = /* @__PURE__ */ new Map();
  for (const t of closed) {
    const h = new Date(t.openTime).getHours();
    const r = hr.get(h) ?? { net: 0, n: 0 };
    r.net += t.net;
    r.n++;
    hr.set(h, r);
  }
  const badHourList = [...hr.entries()].filter(([, r]) => r.n >= TH.badHourMinTrades && r.net < 0).sort((a, b) => a[1].net - b[1].net).slice(0, TH.badHours).map(([h]) => h);
  for (const t of closed) if (badHourList.includes(new Date(t.openTime).getHours())) addF(t, "badhours");
  for (const t of closed) if (feltTilt(feelings[t.id])) addF(t, "feelings");
  const prio = ["blowup", "revenge", "oversize", "overtrade", "holdloser", "badhours", "feelings"];
  const flagged = [];
  for (const t of closed) {
    const s = tags.get(t.id);
    if (!s || !s.size) continue;
    flagged.push({ trade: t, pattern: prio.find((p) => s.has(p)), tags: prio.filter((p) => s.has(p)) });
  }
  const patterns = PATTERNS.map((p) => {
    if (p.id === "fees") return { ...p, trades: 0, net: 0, tax: 0 };
    const f = flagged.filter((x) => x.pattern === p.id);
    const net = f.reduce((a, x) => a + x.trade.net, 0);
    const anyTagged = closed.filter((t) => tags.get(t.id)?.has(p.id));
    return { ...p, trades: f.length, net, tax: Math.max(0, -net), extra: `${anyTagged.length} trades match this pattern in total (${anyTagged.reduce((a, t) => a + t.net, 0) >= 0 ? "+" : "\u2212"}$${Math.abs(Math.round(anyTagged.reduce((a, t) => a + t.net, 0))).toLocaleString()} net, overlaps counted once in the tax)` };
  });
  const fees = feeSplit(fills);
  const excess = fees.drag;
  const benchLabel = "the venue\u2019s base maker rate";
  const fp = patterns.find((p) => p.id === "fees");
  fp.tax = 0;
  fp.net = -fees.total;
  fp.trades = fees.takerFills + fees.makerFills;
  fp.extra = `Fees paid: $${Math.round(fees.total).toLocaleString()} ($${Math.round(fees.taker).toLocaleString()} taker, $${Math.round(fees.maker).toLocaleString()} maker). Not part of the Tilt Tax`;
  const behaviorTax = patterns.filter((p) => p.id !== "fees").reduce((a, p) => a + p.tax, 0);
  const tax = behaviorTax;
  const lossTotal = losses.reduce((a, t) => a + Math.max(0, -t.net), 0);
  const taxShare = lossTotal > 0 ? Math.min(1, behaviorTax / lossTotal) : 0;
  const costly = flagged.filter((x) => x.trade.net < 0).length;
  const costlyShare = closed.length ? costly / closed.length : 0;
  const lossCount = closed.filter((t) => t.net < 0).length;
  const conf = Math.min(1, lossCount / TH.fullConfLosses);
  const inputs = { closed: closed.length, taxShare, conf, costlyShare };
  const enough = closed.length >= TH.minTrades;
  const raw = enough && opts.behavior ? opts.behavior(inputs) : NaN;
  const pending = enough && !opts.behavior;
  const risk = riskAdjust(raw, opts);
  const score = risk ? risk.score : raw;
  const capped = cappedOf(risk);
  const parts = { acct, medLoss, limitUsd, exempt: { n: exemptList.length, sum: exemptList.reduce((a, t) => a + t.net, 0) }, losses: lossCount, conf, behaviorTax, taxShare, costly, costlyShare };
  const grade = gradeOf(score).label;
  const wk = /* @__PURE__ */ new Map();
  const blank = () => ({ blowup: 0, revenge: 0, oversize: 0, overtrade: 0, holdloser: 0, badhours: 0, feelings: 0, fees: 0 });
  for (const x of flagged) {
    const k = weekKey(x.trade.closeTime);
    const r = wk.get(k) ?? blank();
    r[x.pattern] += Math.max(0, -x.trade.net);
    wk.set(k, r);
  }
  const weekly = [...wk.entries()].sort((a, b) => a[0] - b[0]).map(([week, r]) => ({ week, tax: r, total: Object.values(r).reduce((a, b) => a + b, 0) }));
  const dayNet = /* @__PURE__ */ new Map();
  for (const t of closed) dayNet.set(dayKey(t.closeTime), (dayNet.get(dayKey(t.closeTime)) ?? 0) + t.net);
  const wd = [...dayNet.entries()].sort((a, b) => a[1] - b[1])[0];
  let worstDay = null;
  if (wd && wd[1] < 0) {
    const dts = closed.filter((t) => dayKey(t.closeTime) === wd[0]).sort((a, b) => a.closeTime - b.closeTime);
    const bp = /* @__PURE__ */ new Map();
    for (const t of dts) {
      const f = flagged.find((x) => x.trade.id === t.id);
      if (f) {
        const r = bp.get(f.pattern) ?? { n: 0, net: 0 };
        r.n++;
        r.net += t.net;
        bp.set(f.pattern, r);
      }
    }
    worstDay = {
      day: wd[0],
      net: wd[1],
      trades: dts.length,
      byPattern: [...bp.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.net - b.net),
      seq: dts.slice(0, 40).map((t) => ({ t: t.closeTime, coin: t.coin, side: t.side, net: t.net, tags: [...tags.get(t.id) ?? []] }))
    };
  }
  const cutWinners = winHold > 0 && lossHold > 0 ? { winHoldMin: winHold, lossHoldMin: lossHold, ratio: winHold / lossHold } : null;
  const wdn = /* @__PURE__ */ new Map();
  for (const t of closed) {
    const w = new Date(t.openTime).getDay();
    const r = wdn.get(w) ?? { net: 0, n: 0 };
    r.net += t.net;
    r.n++;
    wdn.set(w, r);
  }
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ww = [...wdn.entries()].filter(([, r]) => r.n >= 5).sort((a, b) => a[1].net - b[1].net)[0];
  const worstWeekday = ww && ww[1].net < 0 ? { name: names[ww[0]], net: ww[1].net, trades: ww[1].n } : null;
  let fix = null;
  const last = closed.length ? closed[closed.length - 1].closeTime : 0;
  if (last) {
    const start = last - 7 * DAY;
    const fl = flagged.filter((x) => x.trade.closeTime >= start);
    const by = /* @__PURE__ */ new Map();
    fl.forEach((x) => by.set(x.pattern, (by.get(x.pattern) ?? 0) + Math.max(0, -x.trade.net)));
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    const money = (v) => `$${Math.round(v).toLocaleString()}`;
    const lines = [];
    if (top && top[1] > 0) {
      const id = top[0];
      lines.push(`Biggest leak this week: ${PATTERNS.find((p) => p.id === id).label.toLowerCase()}, ${money(top[1])} lost on ${fl.filter((x) => x.pattern === id).length} flagged trades.`);
      if (id === "revenge") lines.push(`Try a ${TH.revengeMin}-minute pause after any losing close before the next entry.`);
      if (id === "oversize") lines.push(`After a loss, cap your next entry near ${money(TH.oversizeX * medSize)} (${TH.oversizeX}\xD7 your median of ${money(medSize)}).`);
      if (id === "blowup") lines.push(`Set a hard per-trade loss limit around ${money(TH.blowupX * medLoss)} (${TH.blowupX}\xD7 your median loss).`);
      if (id === "overtrade") lines.push(`Stop after about ${cap} trades in a day. Your median day is ${medDaily}.`);
      if (id === "holdloser") lines.push(`Your median winner is held ${Math.round(winHold)} min. Review any loser still open past ${Math.round(TH.holdLoserX * winHold)} min.`);
      if (id === "feelings") lines.push("You logged negative moods on these trades. Write down what you felt before the next entry and wait for it to fade.");
      if (id === "badhours") lines.push(`Your weakest hours (local time) are ${badHourList.map((h) => `${h}:00`).join(", ")}. Trade smaller or sit those out.`);
    } else lines.push("No flagged leaks in the last 7 days of data. Keep doing what you did.");
    const ms = moodStats(closed.filter((t) => t.closeTime >= start), feelings).filter((m) => m.net < 0 && m.n >= 2);
    if (ms.length) lines.push(`Feelings: ${moodLabel(ms[0].mood)} trades cost you ${money(-ms[0].net)} this week across ${ms[0].n} trades.`);
    if (excess > 0) lines.push(`Fees: ${money(fees.taker)} of your fees were taker fees, ${money(excess)} more than ${benchLabel} would cost. More resting orders cut this (fees are not part of the Tilt Tax).`);
    fix = { title: "What to fix this week", lines, weekStart: start };
  }
  return {
    lowConfidence: !isNaN(score) && closed.length < TH.fullTrades,
    parts,
    closed: closed.length,
    flaggedTrades: flagged.length,
    score,
    grade,
    tax,
    lossTotal,
    taxShare,
    patterns,
    flagged,
    weekly,
    worstDay,
    medians: { size: medSize, winHoldMin: winHold, lossHoldMin: lossHold, dailyTrades: medDaily, loss: medLoss },
    cutWinners,
    worstWeekday,
    badHourList,
    fix,
    fees,
    risk,
    capped,
    inputs,
    pending
  };
}
var cappedOf = (risk) => risk && risk.cap != null && risk.cap < risk.raw - risk.ddPts ? { raw: risk.raw - risk.ddPts, netPnl: risk.netPnl, capital: risk.capital, cap: risk.cap } : null;
var capitalAtRisk = (r) => Math.max(r.netDeposits ?? 0, r.startEquity ?? 0, r.peakEquity ?? 0);
function riskAdjust(raw, r) {
  const capital = capitalAtRisk(r);
  if (!Number.isFinite(raw) || !(capital > 0)) return null;
  const netPnl = r.netPnl ?? 0;
  const ddPct = Math.max(0, (r.maxDdUsd ?? 0) / capital);
  const ddPts = Math.min(TH.ddMaxPts, Math.round(Math.max(0, ddPct - TH.ddFreePct) * 100 * TH.ddPtsPerPct));
  const loss = -netPnl / capital;
  const cap = loss > TH.capLossPct2 ? TH.capScore2 : loss > TH.capLossPct ? TH.capScore : null;
  const score = Math.max(0, Math.min(raw - ddPts, cap ?? 100));
  return { raw, score, capital, netPnl, ddPct, ddPts, cap };
}
function perfStats(trades, series, accountValue, fees, volume) {
  const closed = trades.filter((t) => t.closeTime != null && !t.offFills).sort((a, b) => a.closeTime - b.closeTime);
  const net = series.reduce((a, d) => a + d.v, 0);
  const e0raw = accountValue - net;
  const peakNeed = Math.max(1, -Math.min(0, ...series.reduce((a, d) => [...a, (a[a.length - 1] ?? 0) + d.v], [])));
  const e0 = e0raw > peakNeed ? e0raw : Math.max(peakNeed * 2, 1e3);
  const equityNote = e0raw > peakNeed ? "start equity \u2248 current account value \u2212 period PnL" : "start equity estimated (account value too small to back out PnL)";
  const rets = [];
  let eq = e0, peak = e0, maxDdPct = 0, maxDdUsd = 0;
  for (const d of series) {
    rets.push(d.v / Math.max(eq, 0.5 * accountValue, 1));
    eq += d.v;
    peak = Math.max(peak, eq);
    maxDdUsd = Math.max(maxDdUsd, peak - eq);
    maxDdPct = Math.max(maxDdPct, (peak - eq) / peak);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const dd = Math.sqrt(rets.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / (rets.length || 1));
  const A = Math.sqrt(365);
  const wins = closed.filter((t) => t.net > 0), losses = closed.filter((t) => t.net <= 0);
  const sw = wins.reduce((a, t) => a + t.net, 0), sl = losses.reduce((a, t) => a + t.net, 0);
  let ws = 0, ls = 0, cw = 0, cl = 0;
  for (const t of closed) {
    if (t.net > 0) {
      cw++;
      cl = 0;
    } else {
      cl++;
      cw = 0;
    }
    ws = Math.max(ws, cw);
    ls = Math.max(ls, cl);
  }
  const sorted = [...series].sort((a, b) => a.v - b.v);
  const avgWin = wins.length ? sw / wins.length : 0, avgLoss = losses.length ? sl / losses.length : 0;
  return {
    net,
    fees,
    volume,
    days: series.length,
    equityStart: e0,
    equityNote,
    sharpe: sd > 0 && series.length >= 5 ? mean / sd * A : null,
    sortino: dd > 0 && series.length >= 5 ? mean / dd * A : null,
    volAnn: series.length >= 5 ? sd * A : null,
    maxDdPct,
    maxDdUsd,
    curDdPct: (peak - eq) / peak,
    curDdUsd: peak - eq,
    peakEquity: peak,
    winRate: closed.length ? wins.length / closed.length : 0,
    pf: sl < 0 ? sw / -sl : sw > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    payoff: avgLoss < 0 ? avgWin / -avgLoss : 0,
    expectancy: closed.length ? (sw + sl) / closed.length : 0,
    closed: closed.length,
    bestDay: sorted.length ? sorted[sorted.length - 1] : null,
    worstDay: sorted.length ? sorted[0] : null,
    maxWinStreak: ws,
    maxLossStreak: ls
  };
}

// src/lib/counterfactual.ts
var maxDd = (curve) => {
  let peak = 0, dd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.v);
    dd = Math.min(dd, p.v - peak);
  }
  return dd;
};
function counterfactual(closed, flagged) {
  const tags = /* @__PURE__ */ new Map();
  for (const f of flagged) tags.set(f.trade.id, [.../* @__PURE__ */ new Set([...tags.get(f.trade.id) ?? [], f.pattern, ...f.tags])]);
  const ordered = closed.filter((t) => t.closeTime != null).sort((a2, b) => a2.closeTime - b.closeTime || a2.id.localeCompare(b.id));
  const actual = [{ t: ordered[0]?.openTime ?? 0, v: 0 }], without = [{ t: ordered[0]?.openTime ?? 0, v: 0 }];
  let a = 0, w = 0;
  const rows = [];
  for (const t of ordered) {
    a += t.net;
    const hit = tags.get(t.id);
    if (!hit) w += t.net;
    actual.push({ t: t.closeTime, v: a });
    without.push({ t: t.closeTime, v: w });
    if (hit) rows.push({ id: t.id, coin: t.coin, side: t.side, t: t.closeTime, net: t.net, tags: hit, effect: -t.net });
  }
  const losers = rows.filter((r) => r.net < 0), winners = rows.filter((r) => r.net >= 0);
  return {
    rows: rows.sort((x, y) => y.effect - x.effect || y.t - x.t),
    actual,
    without,
    totals: { actual: a, without: w, delta: w - a, skipped: rows.length, losersSkipped: losers.length, savedFromLosers: -losers.reduce((s, r) => s + r.net, 0), winnersSkipped: winners.length, missedFromWinners: winners.reduce((s, r) => s + r.net, 0), maxDdActual: maxDd(actual), maxDdWithout: maxDd(without) }
  };
}

// src/lib/vaults.ts
var num = (s) => s == null ? 0 : Number(s) || 0;
var lc = (s) => (s ?? "").toLowerCase();
function netDeposits(ledger, user) {
  const me = lc(user);
  let s = 0;
  for (const x of ledger) {
    const d = x.delta;
    if (d.type === "deposit") s += num(d.usdc);
    else if (d.type === "withdraw") s -= num(d.usdc) + num(d.fee);
    else if ((d.type === "send" || d.type === "spotTransfer" || d.type === "internalTransfer") && (d.token == null || d.token === "USDC")) {
      const amt = num(d.usdcValue ?? d.amount ?? d.usdc), from = lc(d.user), to = lc(d.destination);
      if (from === to) continue;
      if (to === me && from !== me) s += amt;
      else if (from === me && to && to !== me) s -= amt;
    }
  }
  return s;
}

// src/lib/socials.ts
var SOCIAL = { ig: "@amiontilt", x: "@AmIonTilt", url: "amiontilt.com" };
var IG_PATH = "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2.2A2.8 2.8 0 0 0 4.2 7v10A2.8 2.8 0 0 0 7 19.8h10a2.8 2.8 0 0 0 2.8-2.8V7A2.8 2.8 0 0 0 17 4.2H7zm5 3.3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM17.4 5.3a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z";
var X_PATH = "M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 19.52h1.83L7.08 4.13H5.12z";

// api/_score-core.ts
var W = { tax: 60, flags: 40, flagSat: 0.5, minTrades: 3 };
var clamp01 = (x) => {
  const n2 = Number(x);
  return Number.isFinite(n2) ? Math.max(0, Math.min(1, n2)) : NaN;
};
function behaviorScore(i) {
  if (!i) return NaN;
  const closed = Number(i.closed), ts = clamp01(i.taxShare), cf = clamp01(i.conf), cs = clamp01(i.costlyShare);
  if (!Number.isFinite(closed) || closed < W.minTrades || [ts, cf, cs].some(Number.isNaN)) return NaN;
  return Math.max(0, Math.min(100, Math.round(100 - W.tax * ts * cf - W.flags * Math.min(1, cs / W.flagSat))));
}

// src/lib/share-core.ts
var RANGE_DAYS = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, all: null };
var RANGE_LABEL = { "1d": "Last 24H", "7d": "Last 7D", "30d": "Last 30D", "90d": "Last 90D", all: "All time" };
var parseRange = (r) => {
  const x = (r ?? "").toLowerCase();
  return x === "1d" || x === "7d" || x === "30d" || x === "90d" || x === "all" ? x : "30d";
};
var maskAddr = (a) => `${a.slice(0, 6)}\u2026${a.slice(-4)}`;
var scoreColor = (s) => isNaN(s) ? "#9a9288" : s >= 80 ? "#a6e05c" : s >= 60 ? "#e6d34a" : s >= 35 ? "#ff5b21" : "#ff5470";
async function computeShare(address, range, now = Date.now(), opts = {}) {
  const days = RANGE_DAYS[range];
  const to = now, from = days == null ? to - 5 * 365 * 864e5 : to - days * 864e5;
  const role = await fetchRole(address);
  if (role.role === "agent") throw new Error("agent wallet");
  const dexs = await fetchPerpDexs().catch(() => [""]);
  const ledgerP = role.role === "vault" ? Promise.resolve(null) : fetchLedger(address).then((r) => r.items).catch(() => null);
  const [fills, funding, spotUsd, states] = await Promise.all([
    fetchFills(address, from, to),
    fetchFundingFast(address, from, to),
    fetchSpotUsd(address),
    Promise.all(dexs.map(async (dex) => ({ dex, state: await fetchClearinghouse(address, dex) })))
  ]);
  let { trades } = buildTrades(fills.items, funding.items, {});
  reconcileOpen(trades, new Set(states.flatMap((s) => s.state.assetPositions.filter((p) => Number(p.position.szi) !== 0).map((p) => p.position.coin))));
  if (role.role === "vault" && trades.filter((x) => x.closeTime != null && !x.offFills).length < TH.fullTrades) {
    const legs = closeLegTrades(fills.items, {});
    if (legs.length >= TH.minTrades) trades = [...legs, ...trades.filter((x) => x.closeTime == null && !x.offFills)];
  }
  const winFrom = days == null ? Math.min(fills.items[0]?.time ?? to, funding.items[0]?.time ?? to) : from;
  const closed = trades.filter((x) => x.closeTime != null && !x.offFills && x.closeTime >= winFrom);
  const acct = states.reduce((a, s) => a + Number(s.state.marginSummary.accountValue), 0) + spotUsd;
  const tot = totals(fills.items, funding.items, trades), net = tot.net;
  const perf = perfStats(closed, dailySeries(fills.items, funding.items, winFrom, to), acct, tot.fees, tot.volume);
  const ledger = await ledgerP;
  const t = analyzeTilt(closed, fills.items, {}, {
    behavior: behaviorScore,
    accountValue: acct,
    netPnl: net,
    netDeposits: ledger ? netDeposits(ledger, address) : void 0,
    startEquity: perf.equityStart,
    peakEquity: perf.peakEquity,
    maxDdUsd: perf.maxDdUsd
  });
  const base = { address, range, score: t.score, grade: gradeOf(t.score).label, tax: t.tax, flagged: t.flaggedTrades, closed: t.closed, net, lowConfidence: t.lowConfidence, computedAt: now };
  return opts.curves ? { ...base, curves: whatIfCurves(closed, t.flagged) } : base;
}
var usd0 = (v) => `${v < 0 ? "\u2212" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
var esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function dialSvg(score, x = 0, y = 0, size = 400) {
  const ok = !isNaN(score);
  const S = 400, c = 200;
  const k = size / S;
  const roll = ok ? -(100 - score) * 0.36 : 0, pitch = ok ? (100 - score) * 0.22 : 0;
  const bp = (v, r) => {
    const a = (-135 + v * 2.7) * Math.PI / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };
  const bez = (v0, v1) => {
    const [x0, y0] = bp(v0, 180), [x1, y1] = bp(v1, 180);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A180 180 0 ${(v1 - v0) * 2.7 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const FG = "#efe9dc", MONO = "IBM Plex Mono", DISP = "Barlow Condensed";
  const ladder = [-30, -20, -10, 10, 20, 30].map((p) => {
    const w = p % 20 ? 34 : 60, yy = c + p * 4.2;
    return `<line x1="${c - w}" x2="${c + w}" y1="${yy}" y2="${yy}" stroke="${FG}" stroke-width="1.6"/><text x="${c + w + 8}" y="${yy + 4}" fill="${FG}" font-family="${MONO}" font-size="11">${Math.abs(p)}</text>`;
  }).join("");
  const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => {
    const r = a * Math.PI / 180, l = a % 30 === 0 ? 18 : 10;
    return `<line x1="${c + Math.sin(r) * 172}" y1="${c - Math.cos(r) * 172}" x2="${c + Math.sin(r) * (172 - l)}" y2="${c - Math.cos(r) * (172 - l)}" stroke="${FG}" stroke-width="2"/>`;
  }).join("");
  const bt = [0, 35, 60, 80, 100].map((v) => {
    const [x0, y0] = bp(v, 171), [x1, y1] = bp(v, 189);
    return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#0a0c0b" stroke-width="3"/>`;
  }).join("");
  const screws = [[22, 22], [378, 22], [22, 378], [378, 378]].map(([sx, sy]) => `<circle cx="${sx}" cy="${sy}" r="7" fill="#1b1f1c" stroke="#3a403b" stroke-width="1.5"/><path d="M${sx - 4} ${sy - 4} L${sx + 4} ${sy + 4}" stroke="#4a514b" stroke-width="2"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${k})">
<defs><clipPath id="dc"><circle cx="${c}" cy="${c}" r="165"/></clipPath></defs>
<rect x="4" y="4" width="392" height="392" rx="26" fill="#0a0c0b" stroke="#2a2d2a" stroke-width="2"/>${screws}
<path d="${bez(0, 100)}" fill="none" stroke="#1d221f" stroke-width="7"/>
${ok && score > 0 ? `<path d="${bez(0, score)}" fill="none" stroke="${scoreColor(score)}" stroke-width="7"/>` : ""}${bt}
<text x="40" y="364" fill="#8a9087" font-family="${MONO}" font-size="9" letter-spacing="1.6">LOW</text><text x="360" y="364" text-anchor="end" fill="#8a9087" font-family="${MONO}" font-size="9" letter-spacing="1.6">STEADY</text>
<g clip-path="url(#dc)"><g transform="rotate(${roll} ${c} ${c}) translate(0 ${pitch * 4.2})">
<rect x="-300" y="-300" width="1000" height="${c + 300}" fill="#1b1f1c"/><rect x="-300" y="${c}" width="1000" height="700" fill="#2a1d0a"/>
<line x1="-300" x2="700" y1="${c}" y2="${c}" stroke="#ffd23f" stroke-width="3"/>${ladder}</g></g>
<circle cx="${c}" cy="${c}" r="165" fill="none" stroke="${FG}" stroke-width="2"/>${ticks}
<path d="M${c - 6} ${c - 176} L${c} ${c - 160} L${c + 6} ${c - 176}Z" fill="#ffd23f"/>
<g transform="rotate(${roll} ${c} ${c})"><path d="M${c - 8} ${c - 150} L${c} ${c - 166} L${c + 8} ${c - 150}Z" fill="#ff3a2e"/></g>
<path d="M${c - 90} ${c} h56 v12 M${c + 90} ${c} h-56 v12" stroke="#ffd23f" stroke-width="5" fill="none"/><rect x="${c - 4}" y="${c - 4}" width="8" height="8" fill="#ffd23f"/>
<rect x="${c - 46}" y="${c + 84}" width="92" height="34" rx="3" fill="#050606" stroke="#3a403b" stroke-width="1.5"/><text x="${c}" y="${c + 109}" text-anchor="middle" font-family="${DISP}" font-weight="800" font-size="28" fill="${ok ? scoreColor(score) : "#9a9288"}">${ok ? Math.round(score) : "N/A"}</text>
</g>`;
}
function ogSvg(s) {
  const ok = !isNaN(s.score);
  const col = scoreColor(s.score);
  const DISP = "Barlow Condensed", MONO = "IBM Plex Mono";
  const glyph = (d, x) => `<path transform="translate(${x} 579) scale(1.1667)" d="${d}" fill="#efe9dc" fill-rule="evenodd"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#111311"/>
${dialSvg(s.score, 85, 40, 470)}
<text x="620" y="100" font-family="${MONO}" font-weight="700" font-size="22" letter-spacing="4" fill="#8a9087">TILT SCORE \xB7 ${esc(RANGE_LABEL[s.range].toUpperCase())}</text>
<text x="614" y="262" font-family="${DISP}" font-weight="800" font-size="180" fill="${col}">${ok ? Math.round(s.score) : "N/A"}<tspan font-size="58" fill="#8a9087">${ok ? "/100" : ""}</tspan></text>
<text x="620" y="314" font-family="${DISP}" font-weight="800" font-size="42" fill="#efe9dc">${esc(s.grade.toUpperCase())}</text>
<text x="620" y="380" font-family="${MONO}" font-weight="700" font-size="22" letter-spacing="4" fill="#8a9087">TILT TAX</text>
<text x="620" y="448" font-family="${DISP}" font-weight="800" font-size="72" fill="${s.tax > 0 ? "#ff5470" : "#a6e05c"}">${s.tax > 0 ? usd0(-s.tax) : "$0"}</text>
<text x="620" y="484" font-family="${MONO}" font-weight="700" font-size="20" fill="#8a9087">${s.flagged} of ${s.closed} trades flagged</text>
<text x="620" y="534" font-family="${DISP}" font-weight="800" font-size="34" fill="#ffd23f">WHAT'S YOURS?</text>
<rect x="60" y="560" width="1080" height="1.5" fill="#3a403b"/>
${glyph(IG_PATH, 60)}<text x="100" y="602" font-family="${MONO}" font-weight="700" font-size="24" fill="#efe9dc">${SOCIAL.ig}</text>
${glyph(X_PATH, 330)}<text x="370" y="602" font-family="${MONO}" font-weight="700" font-size="24" fill="#efe9dc">${SOCIAL.x}</text>
<text x="1140" y="603" text-anchor="end" font-family="${DISP}" font-weight="800" font-size="34" letter-spacing="1" fill="#ffd23f">${SOCIAL.url.toUpperCase()}</text>
</svg>`;
}
function whatIfCurves(closed, flagged, max = 120) {
  const cf = counterfactual(closed, flagged);
  const a = cf.actual, w = cf.without;
  const n2 = Math.max(2, Math.min(max, a.length));
  const t0 = a[0]?.t ?? 0, t1 = a[a.length - 1]?.t ?? 1;
  const pick = (c, i) => c[Math.min(c.length - 1, Math.round(i / (n2 - 1) * (c.length - 1)))]?.v ?? 0;
  const ia = Array.from({ length: n2 }, (_, i) => i);
  return { actual: ia.map((i) => Math.round(pick(a, i))), without: ia.map((i) => Math.round(pick(w, i))), t0, t1, delta: Math.round(cf.totals.delta), skipped: cf.totals.skipped };
}
function whatIfSvg(s, theme = "dark", size = "wide") {
  const L = theme === "light", c = s.curves, tall = size === "tall";
  const P = L ? { bg: "#f5f5f3", fg: "#141413", dim: "#55534e", rule: "#14141320", card: "#ffffff", gain: "#1f7a4a", act: "#55534e", sh: "#14141322" } : { bg: "#121211", fg: "#f3f2ee", dim: "#b4b2ab", rule: "#f3f2ee1f", card: "#1a1a18", gain: "#6fcf97", act: "#b4b2ab", sh: "#00000099" };
  const Wd = tall ? 1080 : 1200, Ht = tall ? 1350 : 675, D = "Inter Tight", T = "Inter", m = tall ? 80 : 72;
  const cx = m, cw = Wd - 2 * m, cy = tall ? 560 : 300, ch = tall ? 520 : 270, pad = 28;
  const lo = Math.min(0, ...c.actual, ...c.without), hi = Math.max(1, ...c.actual, ...c.without);
  const X = (i) => cx + pad + i / (c.actual.length - 1) * (cw - 2 * pad), Y = (v) => cy + pad + (1 - (v - lo) / (hi - lo)) * (ch - 2 * pad - 40);
  const d = (v) => v.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(y).toFixed(1)}`).join(" ");
  const gain = c.delta >= 0, num2 = `${gain ? "+" : "\u2212"}$${Math.abs(c.delta).toLocaleString("en-US")}`;
  const hl = tall ? 132 : 104, hy = tall ? 330 : 196;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}" viewBox="0 0 ${Wd} ${Ht}">
<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="${P.sh}"/></filter><clipPath id="mk"><circle cx="${m + 14}" cy="${m + 14}" r="13"/></clipPath></defs>
<rect width="${Wd}" height="${Ht}" fill="${P.bg}"/>
<circle cx="${m + 14}" cy="${m + 14}" r="14" fill="none" stroke="${P.fg}" stroke-width="2.5"/><path d="M${m} ${m + 20} L${m + 28} ${m + 8} L${m + 28} ${m + 28} L${m} ${m + 28}Z" fill="#ffd23f" clip-path="url(#mk)"/>
<text x="${m + 40}" y="${m + 23}" font-family="${D}" font-weight="600" font-size="26" letter-spacing="-.5" fill="${P.fg}">Tilt</text>
<text x="${Wd - m}" y="${m + 23}" text-anchor="end" font-family="${T}" font-weight="500" font-size="20" fill="${P.dim}">What if \xB7 ${esc(RANGE_LABEL[s.range])}</text>
<text x="${m - 4}" y="${hy}" font-family="${D}" font-weight="600" font-size="${hl}" letter-spacing="${-hl * 0.045}" fill="${gain ? P.gain : P.fg}">${num2}</text>
<text x="${m}" y="${hy + (tall ? 64 : 50)}" font-family="${T}" font-weight="500" font-size="${tall ? 32 : 26}" fill="${P.fg}">without ${c.skipped} flagged trade${c.skipped === 1 ? "" : "s"}.</text>
${tall ? `<text x="${m}" y="${hy + 112}" font-family="${T}" font-weight="500" font-size="26" fill="${P.dim}">Same wallet. Same market. Minus the tilt.</text>` : ""}
<g filter="url(#sh)"><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="24" fill="${P.card}" stroke="${P.rule}"/></g>
<line x1="${cx + pad}" x2="${cx + cw - pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="${P.rule}" stroke-width="1.5" stroke-dasharray="4 6"/>
<path d="${d(c.actual)}" fill="none" stroke="${P.act}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${d(c.without)}" fill="none" stroke="${P.gain}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
<rect x="${cx + pad}" y="${cy + ch - 34}" width="18" height="4" rx="2" fill="${P.act}"/><text x="${cx + pad + 28}" y="${cy + ch - 26}" font-family="${T}" font-weight="500" font-size="18" fill="${P.dim}">Actual</text>
<rect x="${cx + pad + 120}" y="${cy + ch - 34}" width="18" height="4" rx="2" fill="${P.gain}"/><text x="${cx + pad + 148}" y="${cy + ch - 26}" font-family="${T}" font-weight="500" font-size="18" fill="${P.dim}">Without flagged trades</text>
<text x="${m}" y="${Ht - m + 10}" font-family="${T}" font-weight="600" font-size="${tall ? 30 : 24}" fill="${P.fg}">Run it on your wallet</text>
<text x="${Wd - m}" y="${Ht - m + 10}" text-anchor="end" font-family="${T}" font-weight="500" font-size="${tall ? 30 : 24}" fill="${P.dim}">${SOCIAL.url}</text>
</svg>`;
}
function ogSvgGallery(s, theme = "dark") {
  const L = theme === "light", ok = !isNaN(s.score);
  const P = L ? { bg: "#f5f5f3", fg: "#141413", dim: "#55534e", rule: "#14141320", win: "#ffffff", tile: "#f5f5f3", glass: "#ffffffeb", loss: "#b8342c", gain: "#1f7a4a", acc: "#7a5d00", shadow: "#14141326" } : { bg: "#121211", fg: "#f3f2ee", dim: "#b4b2ab", rule: "#f3f2ee1f", win: "#1a1a18", tile: "#121211", glass: "#262623eb", loss: "#ff6b6b", gain: "#6fcf97", acc: "#ffd23f", shadow: "#00000099" };
  const D = "Inter Tight", T = "Inter", tax = s.tax > 0 ? usd0(-s.tax) : "$0", score = ok ? String(Math.round(s.score)) : "N/A";
  const ramp = ["#ff5c5c", "#ff7a45", "#ff9f2e", "#ffb000", "#e0c341", "#b7c95a", "#8fcf72"];
  const tile = (x, y, w, k, v, c) => `<rect x="${x}" y="${y}" width="${w}" height="92" rx="14" fill="${P.tile}" stroke="${P.rule}"/><text x="${x + 18}" y="${y + 32}" font-family="${T}" font-weight="500" font-size="16" fill="${P.dim}">${k}</text><text x="${x + 18}" y="${y + 72}" font-family="${D}" font-weight="600" font-size="32" letter-spacing="-1" fill="${c}">${v}</text>`;
  const pts = [0, 6, 4, 14, 22, 19, 34, 48, 44, 58, 40, 36, 42, 30, 26, 32].map((v, i) => `${640 + i * 33},${468 - v * 2.4}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="${P.shadow}"/></filter>
<clipPath id="mk"><circle cx="86" cy="86" r="13"/></clipPath><clipPath id="win"><rect x="600" y="72" width="640" height="470" rx="20"/></clipPath></defs>
<rect width="1200" height="630" fill="${P.bg}"/>
<g font-family="${T}">
<circle cx="86" cy="86" r="14" fill="none" stroke="${P.fg}" stroke-width="2.5"/><path d="M73 92 L99 80 L99 100 L73 100Z" fill="${P.acc}" clip-path="url(#mk)"/>
<text x="112" y="95" font-family="${D}" font-weight="600" font-size="26" letter-spacing="-.5" fill="${P.fg}">Tilt</text>
<text x="72" y="196" font-weight="500" font-size="22" fill="${P.dim}">Tilt Score \xB7 ${esc(RANGE_LABEL[s.range])}</text>
<text x="66" y="350" font-family="${D}" font-weight="600" font-size="168" letter-spacing="-8" fill="${P.fg}">${score}<tspan dx="14" font-size="44" letter-spacing="-1" fill="${P.dim}">${ok ? "/100" : ""}</tspan></text>
<text x="72" y="404" font-family="${D}" font-weight="600" font-size="38" letter-spacing="-1.2" fill="${P.fg}">${esc(s.grade)}</text>
<text x="72" y="446" font-weight="500" font-size="22" fill="${P.dim}">${s.flagged} of ${s.closed} trades flagged</text>
<rect x="72" y="530" width="230" height="52" rx="26" fill="${P.fg}"/><text x="187" y="563" text-anchor="middle" font-weight="600" font-size="20" fill="${P.bg}">What\u2019s yours?</text>
<text x="322" y="564" font-weight="500" font-size="20" fill="${P.dim}">${SOCIAL.url}</text>
<g filter="url(#sh)"><rect x="600" y="72" width="640" height="470" rx="20" fill="${P.win}" stroke="${P.rule}"/></g>
<g clip-path="url(#win)">
<rect x="600" y="72" width="640" height="44" fill="${P.tile}"/><line x1="600" y1="116" x2="1240" y2="116" stroke="${P.rule}"/>
<circle cx="626" cy="94" r="6" fill="${P.rule}"/><circle cx="646" cy="94" r="6" fill="${P.rule}"/><circle cx="666" cy="94" r="6" fill="${P.rule}"/>
<rect x="760" y="84" width="300" height="20" rx="10" fill="${P.win}" stroke="${P.rule}"/><text x="910" y="99" text-anchor="middle" font-weight="500" font-size="12" fill="${P.dim}">${SOCIAL.url}</text>
${tile(624, 140, 168, "Tilt score", score, P.fg)}${tile(808, 140, 200, "Tilt tax", tax, P.loss)}${tile(1024, 140, 200, "Trades", String(s.closed), P.fg)}
${ramp.map((c, i) => `<rect x="${624 + i * 86}" y="256" width="78" height="8" rx="4" fill="${c}" opacity="${i < 3 ? 1 : 0.45}"/>`).join("")}
<polyline points="${pts}" fill="none" stroke="${P.fg}" stroke-width="3" stroke-linejoin="round" opacity=".85"/>
</g>
<g filter="url(#sh)"><rect x="520" y="400" width="360" height="150" rx="22" fill="${P.glass}" stroke="${P.rule}"/></g>
<text x="548" y="444" font-weight="500" font-size="18" fill="${P.dim}">Lost to tilt \xB7 ${esc(RANGE_LABEL[s.range])}</text>
<text x="546" y="512" font-family="${D}" font-weight="600" font-size="56" letter-spacing="-2" fill="${P.loss}">${tax}</text>
</g></svg>`;
}
var v2Pal = (L) => L ? { bg: "#f6f4ef", fg: "#141413", dim: "#5c5952", rule: "#1414131f", loss: "#b8342c", acc: "#f5c518", accInk: "#141413", card: "#ffffff", shadow: "#1414131f" } : { bg: "#121211", fg: "#f3f2ee", dim: "#a9a69e", rule: "#f3f2ee24", loss: "#ff6b6b", acc: "#ffd23f", accInk: "#121211", card: "#1c1c1a", shadow: "#00000099" };
var v2Wrap = (P, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><filter id="sh" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="${P.shadow}"/></filter></defs>
<rect width="1200" height="630" fill="${P.bg}"/><g font-family="Inter Tight" font-weight="600">${body}</g></svg>`;
var v2Mark = (P, x, y) => `<circle cx="${x + 12}" cy="${y - 9}" r="11" fill="none" stroke="${P.fg}" stroke-width="2.5"/><path d="M${x + 3} ${y - 4}L${x + 21} ${y - 13}V${y + 1}H${x + 3}Z" fill="${P.acc}"/><text x="${x + 32}" y="${y}" font-size="26" letter-spacing="-.5" fill="${P.fg}">Tilt</text>`;
var v2Smudge = (x, y, w, h, c) => [0, 1, 2, 3].map((i) => `<rect x="${x - i * 6}" y="${y - i * 5}" width="${w + i * 12}" height="${h + i * 10}" rx="${(h + i * 10) / 2}" fill="${c}" opacity="${[0.55, 0.22, 0.12, 0.07][i]}"/>`).join("");
var v2Scale = (P, y, at) => {
  const x0 = 100, w = 1e3, ramp = ["#ff5c5c", "#ff7a45", "#ff9f2e", "#ffb000", "#e0c341", "#b7c95a", "#8fcf72"];
  const seg = ramp.map((c, i) => `<rect x="${x0 + i * (w / 7) + 3}" y="${y}" width="${w / 7 - 6}" height="14" rx="7" fill="${c}" opacity="${at === null ? 0.5 : 0.9}"/>`).join("");
  const mx = at === null ? x0 + w / 2 : x0 + Math.max(0, Math.min(100, at)) / 100 * w;
  const m = `<g filter="url(#sh)"><circle cx="${mx}" cy="${y + 7}" r="30" fill="${P.card}" stroke="${P.rule}"/></g><text x="${mx}" y="${y + 19}" text-anchor="middle" font-size="34" fill="${P.fg}">${at === null ? "?" : Math.round(at)}</text>`;
  return `${seg}${m}<text x="${x0}" y="${y + 70}" font-family="Inter" font-weight="500" font-size="22" fill="${P.dim}">0 full tilt</text><text x="${x0 + w}" y="${y + 70}" text-anchor="end" font-family="Inter" font-weight="500" font-size="22" fill="${P.dim}">100 calm</text>`;
};
var V2_RAMP = ["#ff5c5c", "#ff7a45", "#ff9f2e", "#ffb000", "#e0c341", "#b7c95a", "#8fcf72"];
var v2RampAt = (v) => V2_RAMP[Math.min(6, Math.max(0, Math.floor(v / 100 * 7)))];
var v2Dial = (cx, cy, r, roll, arc) => {
  const ri = r * 0.74, rt = r * 0.88, f = (n2) => n2.toFixed(1);
  const pt = (v, rr) => {
    const a = (-135 + v * 2.7) * Math.PI / 180;
    return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
  };
  const arcD = (v0, v1) => {
    const [x0, y0] = pt(v0, rt), [x1, y1] = pt(v1, rt);
    return `M${f(x0)} ${f(y0)}A${f(rt)} ${f(rt)} 0 ${(v1 - v0) * 2.7 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
  };
  const ticks = [-60, -30, -15, 15, 30, 60].map((a) => {
    const q = a * Math.PI / 180, l = Math.abs(a) % 30 === 0 ? r * 0.07 : r * 0.045;
    return `<line x1="${f(cx + Math.sin(q) * ri)}" y1="${f(cy - Math.cos(q) * ri)}" x2="${f(cx + Math.sin(q) * (ri - l))}" y2="${f(cy - Math.cos(q) * (ri - l))}" stroke="#efece4" stroke-width="${f(r * 0.022)}" stroke-linecap="round"/>`;
  }).join("");
  const sw = r * 0.06, ww = r * 0.3, wg = r * 0.16, wh = r * 0.09, d = r * 0.05;
  const wing = (x, dir) => `<path d="M${f(x)} ${f(cy - wh / 2)}h${f(dir * ww)}v${f(wh * 1.9)}h${f(-dir * wh)}v${f(-wh * 0.9)}h${f(-dir * (ww - wh))}Z" fill="#0b0b0a" stroke="#efece4" stroke-width="${f(r * 0.018)}" stroke-linejoin="round"/>`;
  return `<defs><clipPath id="dlf"><circle cx="${cx}" cy="${cy}" r="${f(ri)}"/></clipPath>
<radialGradient id="dls" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#4a514b"/><stop offset="1" stop-color="#2b302c"/></radialGradient>
<radialGradient id="dlg" cx="50%" cy="80%" r="75%"><stop offset="0" stop-color="#ffd84f"/><stop offset="1" stop-color="#f0bf1e"/></radialGradient></defs>
<g filter="url(#sh)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b0b0a"/></g><circle cx="${cx}" cy="${cy}" r="${f(r - 1)}" fill="none" stroke="#f3f2ee" stroke-opacity=".14" stroke-width="2"/>
<path d="${arcD(0, 100)}" fill="none" stroke="#f3f2ee" stroke-opacity=".1" stroke-width="${f(sw)}" stroke-linecap="round"/>
${arc !== null && arc > 0 ? `<path d="${arcD(0, Math.min(100, arc))}" fill="none" stroke="${v2RampAt(arc)}" stroke-width="${f(sw)}" stroke-linecap="round"/>` : ""}
<g clip-path="url(#dlf)"><g transform="rotate(${f(roll)} ${cx} ${cy})"><rect x="${cx - r * 2}" y="${cy - r * 2}" width="${r * 4}" height="${r * 2}" fill="url(#dls)"/><rect x="${cx - r * 2}" y="${cy}" width="${r * 4}" height="${r * 2}" fill="url(#dlg)"/></g></g>
<circle cx="${cx}" cy="${cy}" r="${f(ri)}" fill="none" stroke="#efece4" stroke-width="${f(r * 0.03)}"/>${ticks}
<path d="M${f(cx - r * 0.06)} ${f(cy - ri - r * 5e-3)}L${cx} ${f(cy - ri + r * 0.09)}L${f(cx + r * 0.06)} ${f(cy - ri - r * 5e-3)}Z" fill="#ffd23f" stroke="#0b0b0a" stroke-width="${f(r * 0.012)}"/>
${wing(cx - wg - ww, 1)}${wing(cx + wg + ww, -1)}<rect x="${f(cx - d)}" y="${f(cy - d)}" width="${f(2 * d)}" height="${f(2 * d)}" fill="#0b0b0a" stroke="#efece4" stroke-width="${f(r * 0.018)}"/>`;
};
var v2Roll = (score) => score === null ? -24 : -(100 - Math.max(0, Math.min(100, score))) * 0.3;
var v2Url = (P) => `<text x="1100" y="560" text-anchor="end" font-family="Inter" font-weight="500" font-size="24" fill="${P.dim}">${SOCIAL.url}</text>`;
function ogSiteV2(concept, theme = "dark") {
  const P = v2Pal(theme === "light");
  if (concept === 1) return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="100" y="268" font-size="92" letter-spacing="-4" fill="${P.fg}">What did tilt</text><text x="100" y="370" font-size="92" letter-spacing="-4" fill="${P.fg}">cost you?</text>
<text x="100" y="510" font-size="96" letter-spacing="-4" fill="${P.loss}">\u2212$</text>${v2Smudge(212, 438, 360, 84, P.loss)}${v2Url(P)}`);
  if (concept === 2) return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="600" y="345" text-anchor="middle" font-size="190" letter-spacing="-10" fill="${P.loss}">\u2212$115,255</text>
<text x="600" y="430" text-anchor="middle" font-size="44" letter-spacing="-1.5" fill="${P.fg}">lost to 16 trades. <tspan fill="${P.dim}">Yours?</tspan></text>${v2Url(P)}`);
  return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="100" y="262" font-size="80" letter-spacing="-3.4" fill="${P.fg}">Where do you land?</text>
<text x="100" y="322" font-family="Inter" font-weight="500" font-size="30" fill="${P.dim}">Your Tilt Score, from your own trade history.</text>
${v2Dial(974, 222, 126, v2Roll(null), null)}${v2Scale(P, 420, null)}${v2Url(P)}`);
}
function ogShareV2(s, concept, theme = "dark") {
  const P = v2Pal(theme === "light"), ok = !isNaN(s.score), score = ok ? String(Math.round(s.score)) : "?";
  const tax = s.tax > 0 ? usd0(-s.tax) : "$0", rl = esc(RANGE_LABEL[s.range]).toLowerCase();
  const lossLine = s.tax > 0 ? `${tax} lost to ${s.flagged} tilt trade${s.flagged === 1 ? "" : "s"}` : ok ? "No money lost to tilt" : "Check any wallet";
  const pill = (x, y) => `<g filter="url(#sh)"><rect x="${x}" y="${y}" width="250" height="64" rx="32" fill="${P.acc}"/></g><text x="${x + 125}" y="${y + 42}" text-anchor="middle" font-size="27" fill="${P.accInk}">What\u2019s yours?</text>`;
  if (concept === 1) return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="100" y="236" font-family="Inter" font-weight="500" font-size="26" fill="${P.dim}">Tilt Score, ${rl}</text>
<text x="88" y="470" font-size="260" letter-spacing="-14" fill="${P.fg}">${score}</text>
<text x="640" y="350" font-size="62" letter-spacing="-2.5" fill="${P.loss}">${tax}</text>
<text x="640" y="400" font-family="Inter" font-weight="500" font-size="26" fill="${P.dim}">${esc(s.tax > 0 ? `lost to ${s.flagged} tilt trades` : lossLine)}</text>
${pill(640, 452)}`);
  if (concept === 2) return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="600" y="330" text-anchor="middle" font-size="210" letter-spacing="-11" fill="${P.fg}">${score}<tspan font-size="52" letter-spacing="-1" fill="${P.dim}">${ok ? " /100" : ""}</tspan></text>
<text x="600" y="410" text-anchor="middle" font-size="40" letter-spacing="-1.2" fill="${P.loss}">${esc(lossLine)}</text>
<text x="600" y="500" text-anchor="middle" font-size="40" letter-spacing="-1.2" fill="${P.fg}">What\u2019s yours?</text>${v2Url(P)}`);
  if (!ok) return ogSiteV2(3, theme);
  return v2Wrap(P, `${v2Mark(P, 100, 98)}
<text x="96" y="226" font-size="104" letter-spacing="-4.6" fill="${P.fg}">${tax}</text>
<text x="100" y="286" font-size="44" letter-spacing="-1.4" fill="${P.fg}">${esc(s.tax > 0 ? `lost to ${s.flagged} tilt trade${s.flagged === 1 ? "" : "s"}` : "lost to tilt")}</text>
<text x="100" y="338" font-family="Inter" font-weight="500" font-size="28" fill="${P.dim}">Tilt Score ${score}, ${rl}. What\u2019s yours?</text>
${v2Dial(974, 222, 126, v2Roll(s.score), s.score)}${v2Scale(P, 420, s.score)}${v2Url(P)}`);
}
export {
  RANGE_DAYS,
  RANGE_LABEL,
  computeShare,
  dialSvg,
  maskAddr,
  ogShareV2,
  ogSiteV2,
  ogSvg,
  ogSvgGallery,
  parseRange,
  scoreColor,
  usd0,
  whatIfCurves,
  whatIfSvg
};
