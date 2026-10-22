# MET Norway proxy (preview, not deployed)

Small Cloudflare Worker the Trip Planner can use for non-US forecasts from MET Norway Locationforecast 2.0 (`complete`).

Follows https://api.met.no/doc/TermsOfService: identifying User-Agent with contact, coordinates truncated to 4 decimals,
caching until `Expires` and revalidating with `If-Modified-Since`, backing off on 429 (serves the cached copy), logs 203
deprecation. Visitors' IP addresses are not passed to MET; MET sees the worker's request only.

Deploy (only after approval): `npx wrangler login`, optionally create the KV namespace in wrangler.toml, then
`npx wrangler deploy`. Then build the site with `METNO=https://yw-metno.<account>.workers.dev python3 _src/build.py`.
`METNO=direct` makes browsers call api.met.no directly instead (allowed for low-volume sites; identified by Origin).
Without `METNO` the planner keeps its current "open the trip in the app" message for non-US places.

Local test: `node _src/tests/metno-proxy.test.js` (mocked upstream).
