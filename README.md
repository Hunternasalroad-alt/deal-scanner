# Trading Card Deal Scanner

A graded trading card eBay deal scanner that monitors eBay for newly-listed slabbed cards from Pokémon and sports categories, normalizes listings, and matches them to a reference database.

**Status: M1 (Dry-run ingest only)**
- Actively ingrests, normalizes, and matches listings
- Feed page accumulates results at `/feed`
- Alerts and scoring arrive in M3 (post-M2 comp engine)
- Dry-run mode (`DRY_RUN=1`) prevents live data mutation and alerts

## Environment Variables

Set these in `vercel → Settings → Environment Variables` (production) and `.env.local` (local dev).

| Variable | Purpose | How to Get It |
|----------|---------|---------------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Create a [Neon project](https://console.neon.tech), copy connection string from Settings → Connection string (include password) |
| `EBAY_CLIENT_ID` | eBay REST API client ID | Register app at [eBay Developer Portal](https://developer.ebay.com/my/applications), copy Client ID from Keyset |
| `EBAY_CLIENT_SECRET` | eBay REST API client secret | Same eBay app, copy Secret from Keyset |
| `POKEMONTCG_API_KEY` | PokemonTCG.io free API key | Register at [pokemontcg.io](https://pokemontcg.io/api-docs), copy API key from account settings |
| `SCAN_SECRET` | Bearer token for `/api/scan` heartbeat | Generate a random 32+ character string (e.g., `openssl rand -hex 32`) |
| `DRY_RUN` | Dry-run mode (1 = enabled, 0 = live) | Set to `1` for M1 (prevents data writes); set to `0` when ready for M2 live mode |

## Running Tests

All tests are green and cover ingest, normalization, matching, and config:

```bash
pnpm test
```

Linting and build must also pass:

```bash
pnpm lint
pnpm build
```

## Feed Page

View accumulated listings (dry-run only):

```
https://<prod-domain>/feed
```

Shows last 100 matched listings with card name, title, slab details, price, and match confidence. Order: newest first. Only listings with no `dropReason` are shown (i.e., successfully matched).

## Manual Scan Tick

### Local

Trigger a scan tick manually against a local or remote instance:

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Authorization: Bearer <SCAN_SECRET>" \
  -H "Content-Type: application/json"
```

Replace `<SCAN_SECRET>` with the value in `.env.local` and the URL with your Vercel preview/prod domain if testing a deployed version.

### Production

Trigger the scheduled workflow manually:

1. Go to GitHub → your repo → **Actions**
2. Click **scan-heartbeat** workflow
3. Click **Run workflow** → **Run workflow**
4. Wait ~30s for the workflow to complete
5. Check `/feed` for new listings (should grow tick-to-tick)

The workflow runs automatically every 5 minutes on a schedule; manual run overrides the schedule.

## Deploy Checklist

1. **Push to GitHub:**
   ```bash
   git push origin m1-ingest
   ```

2. **Import to Vercel:**
   - Log into [Vercel Dashboard](https://vercel.com/dashboard)
   - **Add New → Project → Import Git Repository** → select this repo
   - Framework: auto-detect (Next.js)
   - Deploy (watch for build success)

3. **Set environment variables (Vercel):**
   - Vercel → Project → Settings → Environment Variables
   - Paste the five env vars from `.env.local` plus `DRY_RUN=1`
   - Redeploy

4. **Add GitHub Actions secrets:**
   - GitHub → repo → Settings → Secrets and variables → Actions
   - Add `SCAN_URL` = `https://<prod-domain>/api/scan`
   - Add `SCAN_SECRET` = (same value as in Vercel)

5. **Test the workflow:**
   - GitHub → Actions → scan-heartbeat → Run workflow
   - Wait for green check
   - Visit `/feed` and verify listings are accumulating

## Deferred Work (M1 → M2 → M3)

### M2 (Live mode + comp engine)
- [ ] Run `pnpm db:push` to apply pending migrations (dry-run: noop in dev; live: creates tables in prod)
- [ ] Run `pnpm sync:pokemon` to populate reference card database from PokemonTCG API
- [ ] Verify eBay category IDs for baseball, basketball, and football (currently marked "TBV" in `src/lib/ebay/categories.ts`):
  - Use eBay Taxonomy API's `get_category_suggestions` endpoint with `EBAY_CLIENT_ID`/`SECRET`
  - Search for "trading cards" in each category
  - Replace string "TBV" with numeric category ID
- [ ] Set `DRY_RUN=0` in Vercel environment (live ingest begins)
- [ ] First live scan tick (manual or scheduled) begins accumulating real listings

### M3 (Scoring + alerts)
- AI classifier (reference prices → "price-interesting" signal)
- Scoring engine (match confidence, graded rarity, price anomalies)
- Alert generation (Slack, email, webhook)
- Dashboard (real-time monitoring)

## Architecture Notes

- **Cadence:** `/api/scan` runs every 5 minutes (GitHub Actions `scan-heartbeat`)
- **Timeout:** Each tick is capped at 60 seconds (eBay search + detail fetches)
- **Overlap:** 5-min schedule vs. 60-sec max runtime = no concurrent ticks (spec §8)
- **Retry:** Single 1.5s retry on 429/5xx; unfinished work resumes next tick via cursors
- **Budget:** eBay quota ~4,800 calls/day; current searches use ~200 calls/tick (well under limit)
- **Idempotency:** All DB writes use upserts; cursor-based pagination ensures no duplicate ingests

## Spec References

- Spec §7: Scanner heartbeat (5-min tick, bear-token auth)
- Spec §8: Dry-run ingest with overlap prevention and retry logic (M1 partial; full backoff in M2)

## Support

For issues, check:
1. `.env.local` is present and has all six env vars
2. Database: `pnpm db:push` has been run
3. PokemonTCG reference data: `pnpm sync:pokemon` has been run
4. eBay keys: valid and in scope for Browse API
5. Tests: `pnpm test` passes
