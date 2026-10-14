# tilt-jobs

Scheduled jobs for [Tilt](https://amiontilt.com). They're public so GitHub Actions minutes are free.

**precompute-scores** refreshes the 30-day Tilt Score of about 10,000 public Hyperliquid wallets every day. It runs 4 times a day, and each run takes one quarter of the list. That lets the site show a last-known score instantly while live data loads.

Priority order:
1. wallets that Tilt users linked;
2. the top of the public leaderboard;
3. the most viewed wallets;
4. the rest of the top 10K by 30-day volume.

The logs print counts only, never the wallet lists.

- `lib/score.mjs`: the scoring code the site uses, bundled. It only calls the public Hyperliquid API.
- `precompute/`: the plan and the runner. Run `node precompute/test.mjs` for the offline tests, or `node precompute/run.mjs --dry --shard 0` for a dry run (needs no secrets).
- Secrets: the `KV_REST_API_URL` and `KV_REST_API_TOKEN` repository secrets. Nothing else is needed.

Educational tool, not financial advice.
