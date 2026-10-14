// Minimal Upstash REST client. Credentials come only from the environment (GitHub repository secrets KV_REST_API_URL / KV_REST_API_TOKEN).
export function store(env = process.env) {
  const url = env.KV_REST_API_URL, token = env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const call = async (cmd) => { const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`store ${r.status}`); return (await r.json()).result; };
  return { call };
}
/** Same compact format the site reads: [score, grade, tax, flagged, closed, net, lowConfidence, computedAt]. */
export const pack = (s) => JSON.stringify([Number.isNaN(s.score) ? -1 : Math.round(s.score * 10) / 10, s.grade, Math.round(s.tax * 100) / 100, s.flagged, s.closed, Math.round(s.net * 100) / 100, s.lowConfidence ? 1 : 0, s.computedAt]);
export const hashKey = (r) => `tilt:sc:${r}`;
export const VISITS_KEY = 'tilt:visits';
