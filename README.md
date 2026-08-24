# Trading Card Deal Scanner

A graded trading card eBay deal scanner that monitors eBay for newly-listed slabbed cards from Pokémon and sports categories, normalizes listings, and matches them to a reference database.

**Status: M1 (Dry-run ingest only)**
- Actively ingests, normalizes, and matches listings
- Feed page accumulates results at `/feed`
- Alerts and scoring arrive in M3 (post-M2 comp engine)
- `DRY_RUN` is reserved to gate alert sending in M3; it has no effect in M1, and M1 ingest always writes listings — the whole point of the dry-run soak is a feed accumulating rows

## Environment Variables

Set these in `vercel → Settings → Environment Variables` (production) and `.env.local` (local dev).

| Variable | Purpose | How to Get It |
|----------|---------|---------------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Create a [Neon project](https://console.neon.tech), copy connection string from Settings → Connection string (include password) |
| `EBAY_CLIENT_ID` | eBay REST API client ID | Sign in at [eBay Developer Portal](https://developer.ebay.com), Your Account → Application Keys, create/copy Production keyset. App ID (Client ID) → `EBAY_CLIENT_ID` |
| `EBAY_CLIENT_SECRET` | eBay REST API client secret | Cert ID from same Production keyset → `EBAY_CLIENT_SECRET` (see [eBay keyset guide](https://developer.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html)) |
| `POKEMONTCG_API_KEY` | PokemonTCG.io free API key | Sign up at [dev.pokemontcg.io](https://dev.pokemontcg.io/) with Auth0, generate and copy API key from dashboard. (See also [API docs](https://docs.pokemontcg.io/)) |
| `SCAN_SECRET` | Bearer token for `/api/scan` heartbeat | Generate a random 32+ character string (e.g., `openssl rand -hex 32`) |
| `DRY_RUN` | Reserved to gate alert sending in M3 | Defaults to `1`; has no effect in M1 — M1 ingest always writes listings regardless of this value |

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

## M2: comps & scoring

**What the two sweeps record:** The comp engine ingests two types of real sales for building reference prices:
- `auction_close`: listings that ended in an actual sale (finalized transaction on eBay)
- `bin_disappeared`: listings that sold out within 48 hours of listing (a reliable proxy for a sale at the BIN price on fast-moving inventory)

**What a score means:** Each matched listing is scored against a reference price for its (card, grader, grade) combination. The score is a percentage difference from the reference:
- Negative score = the listing is *overpriced* (above the reference)
- Positive score = the listing is *underpriced* (below the reference; desirable)
- Score formula: `(price - reference) / reference × 100%`

**Reference eligibility:** A reference price appears once any (card, grader, grade) accumulates:
- **3+ comps in the last 30 days**, *or*
- **A raw-price floor** (the lowest recorded BIN from `bin_disappeared` sweeps) on grades 9, 9.5, or 10 only

**No alerts exist yet — M3 adds Telegram/email; this milestone only measures.** M2 records comps and scores; M3 will add alert rules and delivery channels (instant Telegram alerts + daily email digests).

**Weekly sync:** The reference card database (grades and images from PokemonTCG.io) must be kept current:

```bash
pnpm sync:pokemon
```

Run this manually once per week (M3 will automate it). It populates the reference database so new cards can be scored as soon as they appear in listings.

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
   - Repo must be **public**. A private repo's 2,000 free GitHub Actions minutes/month cover only ~1 week of the 5-minute cron (288 runs/day); a public repo gets unlimited Actions minutes, which is what keeps this $0.
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

6. **Know the cron's failure mode:**
   - GitHub auto-disables scheduled workflows after ~60 days with no repository activity. If `/feed` stops growing, check Actions → scan-heartbeat for a "workflow disabled" banner and re-enable it (any commit/push resets the clock).

## Deferred Work (M1 → M2 → M3)

### M2 (Live mode + comp engine)
- [ ] Run `pnpm db:push` to apply pending migrations
- [ ] Run `pnpm sync:pokemon` to populate reference card database from PokemonTCG API
- [ ] Verify eBay category IDs for baseball, basketball, and football (currently marked "TBV" in `src/lib/ebay/categories.ts`):
  - Use eBay Taxonomy API's `get_category_suggestions` endpoint with `EBAY_CLIENT_ID`/`SECRET`
  - Search for "trading cards" in each category
  - Replace string "TBV" with numeric category ID
- [ ] Set `DRY_RUN=0` in Vercel environment once M3 alert-sending exists (`DRY_RUN` has no effect before then — ingest is already live in M1)
- [ ] First live scan tick (manual or scheduled) begins accumulating real listings

### M3 (Scoring + alerts)
- AI classifier (reference prices → "price-interesting" signal)
- Scoring engine (match confidence, graded rarity, price anomalies)
- Alert generation (Telegram instant alerts + daily email digest via Resend)
- Dashboard (real-time monitoring)

## Architecture Notes

- **Cadence:** `/api/scan` runs every 5 minutes (GitHub Actions `scan-heartbeat`)
- **Timeout:** Each tick is capped at 60 seconds (eBay search + detail fetches)
- **Overlap:** 5-min schedule vs. 60-sec max runtime = no concurrent ticks (spec §8)
- **Retry:** Single 1.5s retry on 429/5xx; unfinished work resumes next tick via cursors
- **Budget:** eBay ingestion hard-stops at 4,800 calls/day; nominal ceiling is ≤11 calls per category per tick (3 search pages + 8 detail fetches) — ~3,200/day at the current Pokémon-only cadence (sports categories still "TBV")
- **Idempotency:** All DB writes use upserts; cursor-based pagination ensures no duplicate ingests

## Spec References

- Spec §3: Scanner heartbeat (5-min tick, Bearer token auth)
- Spec §8: Dry-run ingest with overlap prevention and retry logic (M1 partial; full backoff in M2)

## Support

For issues, check:
1. `.env.local` is present and has all six env vars
2. Database: `pnpm db:push` has been run
3. PokemonTCG reference data: `pnpm sync:pokemon` has been run
4. eBay keys: valid and in scope for Browse API
5. Tests: `pnpm test` passes
