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
function reconcileOpen(trades, liveCoins) {
  for (const t of trades) if (t.closeTime == null && !liveCoins.has(t.coin)) t.offFills = true;
  return trades;
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
async function info(body, retries = 3) {
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
  makerBps: 1.5
  // fee drag compares taker fills to this maker rate (Hyperliquid base tier); other venues use MAKER_BPS
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
  { id: "blowup", label: "Blowups", color: "#ed7088", rule: `Liquidated, or a loss more than ${TH.blowupX}\xD7 your median loss` },
  { id: "revenge", label: "Revenge trades", color: "#f5a15a", rule: `Opened within ${TH.revengeMin} min of closing a losing trade` },
  { id: "oversize", label: "Oversizing", color: "#c79bff", rule: `Sizing up after a loss: entry above ${TH.oversizeX}\xD7 your median trade size, opened within ${TH.oversizeAfterLossMin / 60} h of a losing trade and over ${TH.oversizeVsLossX}\xD7 its size` },
  { id: "overtrade", label: "Overtrading", color: "#6fb7ff", rule: `Trades beyond ${TH.overtradeX}\xD7 your median daily count on a day with ${TH.overtradeMin}+ trades` },
  { id: "holdloser", label: "Holding losers", color: "#f5d76e", rule: `Losing trade held more than ${TH.holdLoserX}\xD7 your median winning hold time` },
  { id: "badhours", label: "Worst hours", color: "#8fa6ff", rule: `Trades opened in your ${TH.badHours} worst hours (your local time) (min ${TH.badHourMinTrades} trades, net negative)` },
  { id: "feelings", label: "Felt tilt (logged)", color: "#ff8fd0", rule: "You logged a negative mood (FOMO, anger, revenge, fear\u2026) at intensity 3+ on the trade, and automatic patterns did not already charge it" },
  { id: "fees", label: "Fee drag", color: "#7d8c93", rule: "Taker fees above what the same volume would cost at the venue\u2019s base maker rate (Hyperliquid 1.5 bps, most CEX perps 2 bps, Coinbase 50 bps)" }
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
  if (isNaN(score)) return { label: "Too few trades to judge", caption: "Not enough closed trades to roast you yet. Feed me more fills." };
  if (score >= 90) return { label: "Zen master", caption: "The market tried. You did not blink." };
  if (score >= 80) return { label: "Cool as a cucumber", caption: "Ice in the veins, receipts in the fills." };
  if (score >= 70) return { label: "Mostly chill", caption: "Mostly chill, with the occasional plot twist." };
  if (score >= 60) return { label: "Slightly spicy", caption: "Slightly spicy. Keyboards remain unthrown." };
  if (score >= 50) return { label: "Tilt-adjacent", caption: "The revenge trades have entered the chat." };
  if (score >= 35) return { label: "Tilting", caption: "Your future self sent a strongly worded memo." };
  if (score >= 20) return { label: "Full tilt", caption: "The chart is fine. It is the vibes." };
  return { label: "Pinball mode", caption: "Pinball mode engaged. Step away from the keyboard (lovingly)." };
}
function analyzeTilt(trades, fills, feelings = {}, opts = {}) {
  const closed = trades.filter((t) => t.closeTime != null && !t.offFills).sort((a, b) => a.openTime - b.openTime);
  const tags = /* @__PURE__ */ new Map();
  const add = (t, p) => {
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
  const perp = fills.filter((f) => !isSpot(f.coin));
  let takerFees = 0, takerNotional = 0, benchFees = 0;
  const benchVenues = /* @__PURE__ */ new Set();
  for (const f of perp) if (f.crossed) {
    const bps = makerBpsFor(venueOfFill(f));
    const notional = (Number(f.px) || 0) * (Number(f.sz) || 0);
    takerFees += Number(f.fee) || 0;
    takerNotional += notional;
    benchFees += bps == null ? Number(f.fee) || 0 : notional * bps / 1e4;
    if (bps != null) benchVenues.add(venueOfFill(f));
  }
  const excess = Math.max(0, takerFees - benchFees);
  const benchLabel = benchVenues.size === 1 && benchVenues.has("hl") ? `${TH.makerBps} bps maker rate` : "each venue\u2019s base maker rate";
  const fp = patterns.find((p) => p.id === "fees");
  fp.tax = excess;
  fp.net = -takerFees;
  fp.trades = perp.filter((f) => f.crossed).length;
  fp.extra = `${perp.filter((f) => f.crossed).length} taker fills paid $${Math.round(takerFees).toLocaleString()} in fees on $${Math.round(takerNotional).toLocaleString()} notional`;
  const behaviorTax = patterns.filter((p) => p.id !== "fees").reduce((a, p) => a + p.tax, 0);
  const tax = behaviorTax + excess;
  const lossTotal = losses.reduce((a, t) => a + Math.max(0, -t.net), 0);
  const taxShare = lossTotal > 0 ? Math.min(1, behaviorTax / lossTotal) : 0;
  const costly = flagged.filter((x) => x.trade.net < 0).length;
  const costlyShare = closed.length ? costly / closed.length : 0;
  const lossCount = closed.filter((t) => t.net < 0).length;
  const conf = Math.min(1, lossCount / TH.fullConfLosses);
  const taxPts = 60 * taxShare * conf, flagPts = 40 * Math.min(1, costlyShare / 0.5);
  const score = closed.length < TH.minTrades ? NaN : Math.max(0, Math.min(100, Math.round(100 - taxPts - flagPts)));
  const parts = { acct, medLoss, limitUsd, exempt: { n: exemptList.length, sum: exemptList.reduce((a, t) => a + t.net, 0) }, losses: lossCount, conf, behaviorTax, taxShare, taxPts, costly, costlyShare, flagPts };
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
    if (excess > 0) lines.push(`Fee drag: ${money(excess)} over ${benchLabel === "each venue\u2019s base maker rate" ? benchLabel : `a ${benchLabel}`} across the period. More resting orders cut this.`);
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
    fix
  };
}

// src/lib/share-core.ts
var RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, all: null };
var parseRange = (r) => {
  const x = (r ?? "").toLowerCase();
  return x === "7d" || x === "30d" || x === "90d" || x === "all" ? x : "30d";
};
async function computeShare(address, range, now = Date.now()) {
  const days = RANGE_DAYS[range];
  const to = now, from = days == null ? to - 5 * 365 * 864e5 : to - days * 864e5;
  const role = await fetchRole(address);
  if (role.role === "agent") throw new Error("agent wallet");
  const dexs = await fetchPerpDexs().catch(() => [""]);
  const [fills, funding, spotUsd, states] = await Promise.all([
    fetchFills(address, from, to),
    fetchFunding(address, from, to),
    fetchSpotUsd(address),
    Promise.all(dexs.map(async (dex) => ({ dex, state: await fetchClearinghouse(address, dex) })))
  ]);
  const { trades } = buildTrades(fills.items, funding.items, {});
  reconcileOpen(trades, new Set(states.flatMap((s) => s.state.assetPositions.filter((p) => Number(p.position.szi) !== 0).map((p) => p.position.coin))));
  const winFrom = days == null ? Math.min(fills.items[0]?.time ?? to, funding.items[0]?.time ?? to) : from;
  const closed = trades.filter((x) => x.closeTime != null && !x.offFills && x.closeTime >= winFrom);
  const acct = states.reduce((a, s) => a + Number(s.state.marginSummary.accountValue), 0) + spotUsd;
  const t = analyzeTilt(closed, fills.items, {}, { accountValue: acct });
  const net = totals(fills.items, funding.items, trades).net;
  return { address, range, score: t.score, grade: gradeOf(t.score).label, tax: t.tax, flagged: t.flaggedTrades, closed: t.closed, net, lowConfidence: t.lowConfidence, computedAt: now };
}
export {
  computeShare,
  parseRange
};
