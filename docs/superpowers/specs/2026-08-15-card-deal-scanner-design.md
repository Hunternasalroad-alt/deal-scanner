# Card Deal Scanner — Design Spec

Date: 2026-08-15 · Status: approved-pending-user-review · Owner: enasalroad

## 1. Goal

A personal web app that watches eBay for **graded cards (PSA, Beckett/BGS, SGC only)** in **Pokémon, baseball, basketball, and football**, compares each new listing against a reference value, and notifies the user when a listing is meaningfully underpriced. The app **only notifies — it never bids, buys, or messages sellers.** Total running cost target: $0/month in subscriptions (small AI-classification spend, single-digit dollars/month, is acceptable).

Context: built after an EV study (see `box-ev-report.md`) concluded sealed boxes are −EV gambling; this tool instead hunts mispriced graded singles, where the buyer can be on the profitable side of market inefficiency.

## 2. Scope

**In scope (v1):**
- Marketplace: eBay via the official Browse API (sanctioned, free). Source layer is a pluggable interface so legal extras can be added later.
- Cards: graded singles only — grader ∈ {PSA, BGS/Beckett, SGC} — in Pokémon (EN + JP as encountered) and baseball/basketball/football.
- Free reference-price sources only: pokemontcg.io (raw EN Pokémon prices, used for the floor rule) + a self-built eBay sold-comp engine. No paid data subscriptions.
- Alerts: Telegram (instant), email digest (daily, via Resend), web dashboard.
- Runtime: $0 serverless — Vercel free tier (Next.js app + API routes), Neon free Postgres, GitHub Actions cron (every 5 min) as the scheduler.

**Non-goals (v1):**
- Raw/ungraded cards. Auto-bidding or purchasing of any kind (permanent non-goal, not just v1). TCGplayer/Mercari/Facebook/Whatnot monitoring (no sanctioned APIs; no scraping/bot evasion will ever be built). Japanese marketplaces (Buyee/Yahoo JP — candidate future "legal extra"). Other TCGs (MTG, Yu-Gi-Oh, One Piece, Lorcana). Native mobile app (Telegram is the mobile surface; dashboard is responsive). Sports Card Investor / Market Movers data (paid product, no API).

## 3. Architecture

- **App:** Next.js (App Router) on Vercel free tier. Server routes: `POST /api/scan` (the tick), `POST /api/digest` (daily email), `GET /api/health`. All mutation routes require `Authorization: Bearer ${SCAN_SECRET}`.
- **Scheduler:** GitHub Actions workflow, cron `*/5 * * * *`, curls `/api/scan`. A second workflow (daily) hits `/api/digest`. Actions jitter is tolerated by design (see §8).
- **DB:** Neon Postgres via `DATABASE_URL`. Drizzle ORM (lightweight, serverless-friendly).
- **Notifications:** Telegram Bot API `sendMessage`/`sendPhoto` to the user's chat ID; Resend for the digest email.
- **AI assist:** Claude Haiku (latest) via the Anthropic API, used ONLY for ambiguous-but-price-interesting listing classification (see §6). Implementation must consult the `claude-api` skill for current model IDs/params.
- **Cert verification:** PSA public API (free tier ~100 calls/day) for PSA cert lookups on alert candidates only; BGS/SGC get deep links in the alert for manual verification (no sanctioned APIs).

## 4. Data flow — one 5-minute tick (`/api/scan`)

1. **Ingest.** For each configured eBay category (Pokémon singles; Baseball; Basketball; Football singles), Browse API search sorted by `newlyListed`, aspect-filtered to Graded=Yes and grader ∈ {PSA, BGS, SGC} where category aspects allow, paginated back to the stored cursor (overlap window 10 min for idempotency). Typical volume: low hundreds/tick.
2. **Normalize.** Extract structured item specifics (grader, grade, cert number, card number, set, year, player/character, parallel/variant) + title parse. Listings whose grader claim exists only in free text with "candidate/potential/worthy" phrasing are classified RAW and dropped (scam pattern). Non-target graders (CGC, ACE, TAG, etc.) are dropped.
3. **Match.** Deterministic match against `cards` catalog (exact/near on set + card number + name for Pokémon; year + brand/set + player + card number + parallel for sports). Outcomes: HIGH confidence → continue; MEDIUM confidence AND price-interesting (listing total below ~1.5× best-guess reference) → AI classifier queue; LOW/irrelevant → store minimal row for comp observation only.
4. **Price & score.** Compute listing total (price + shipping). Fetch reference value for (card, grader, grade) per §5. Score per §7.
5. **Act.** Score ≥ alert bar → Telegram immediately (respecting quiet hours; quiet-hours deals still go to the feed and digest). All scored deals → dashboard feed. Near-misses → digest queue.
6. **Comp engine maintenance.** (a) Auctions discovered earlier whose `end_time` has passed → fetch final state; record final bid as a comp when sold signals are present. (b) Tracked BINs that become unavailable within 48h of `first_seen` → record as `bin_disappeared` probable-sold comp at listed price (fast disappearance ≈ sale; slow-vanishing listings are treated as ended-unsold and produce no comp). (c) Priority-list lane: run targeted queries (including stored misspelling variants) for priority items every tick.

Nightly (first tick after 09:00 UTC): sync pokemontcg.io raw prices; recompute `reference_prices` rolling medians; prune cursors/dead listings.

## 5. Reference values

- **Comp median (authoritative):** median of `comps` for (card, grader, grade) over trailing 30d (fallback 90d at half weight). A card+grade is **auto-alertable** only when it has ≥3 comps in the window. Basis recorded as `comp_median`.
- **Raw-price floor rule (day-one Pokémon):** for EN Pokémon cards with a pokemontcg.io raw market price, alert regardless of comp coverage when: PSA/BGS/SGC 10 listed ≤ 1.0× raw market; grade 9/9.5 listed ≤ 0.8× raw. Basis `raw_floor`. Rationale: graded 10s historically clear 1.5–4.4× raw (documented in the EV study), so ≤1.0× raw is near-certain mispricing.
- **Manual targets (day-one sports):** `priority_items.target_price_cents` set by the user; alert when listing total ≤ target. Basis `manual`.
- Cold-start expectation (stated in UI): sports auto-alerts mature over ~2–4 weeks as comps accumulate; Pokémon floor-rule alerts and priority-list alerts work from day one.

## 6. Matching & AI assist

- Sports catalog self-grows: unmatched listings with well-formed specifics create/enrich `cards` rows (year, brand, set, player, number, parallel). Pokémon catalog is seeded once from pokemontcg.io (all EN sets) and refreshed weekly.
- AI classifier (Claude Haiku): input = title + item specifics + candidate catalog matches; output = JSON {card_id | new_card fields | reject, grader, grade, confidence, red_flags[]}. Called only for MEDIUM-confidence + price-interesting listings (expected ≪ 500/day → single-digit $/month). Hard output-schema validation; failures → dead letter, listing kept unmatched.
- PSA cert verification on alert candidates: cert → card/grade confirmation. Mismatch → alert suppressed, listing flagged `cert_mismatch` in feed.

## 7. Deal scoring & risk

Score starts from discount = 1 − (listing total ÷ reference). Modifiers:
- Seller feedback < 98% or count < 50 → −penalty flag `seller_risk`.
- No cert number provided → flag `no_cert`.
- PSA cert verified → confidence boost; mismatch → suppress (see §6).
- Listing total < 50% of reference → `too_good` banner: alert is worded "assume fake/scam until verified in person," never celebratory.
- Auction logic: alert when ending ≤ 2h AND (current bid + shipping) ≤ 75% of reference (tick cadence means ~±5 min precision; stated in UI).
- Every alert path — BIN, auction, and digest — requires a valid reference basis (`comp_median` with the n≥3 gate, `raw_floor`, or `manual`). Cards with no valid basis never alert; their listings still appear in the feed unscored.
- Defaults (all editable in settings): min card value $50; BIN alert at ≥ 25% under reference; digest collects 10–25% under; quiet hours off by default.

## 8. API budget, errors, idempotency

- eBay free tier 5,000 calls/day. Budget: firehose ≈ 2,900 (≈10 calls/tick × 288), auction-close checks ≈ 1,000, priority lane ≈ 800, leaving ≈ 300 headroom. Budget counter surfaced on health page; scanning hard-stops at 4,800 calls/day (a Telegram ops warning fires), so the plan never reaches the 5,000 cap even on retry-heavy days.
- eBay OAuth client-credentials token cached and auto-refreshed. 429/5xx → exponential backoff within the tick; leftover work resumes next tick via cursors.
- Idempotency: upserts keyed on `ebay_item_id`; 10-minute cursor overlap absorbs GH Actions jitter/skips; a tick that finds a lock (previous tick still running) exits cleanly.
- Vercel function limits respected by chunking (each `/api/scan` processes bounded batches; unfinished work carries over).
- Telegram/Resend failures: 3 retries then `dead_letters` row; dead letters visible on dashboard health page.

## 9. Data model (Postgres)

- `cards` — id, game (pokemon|baseball|basketball|football), name, set_name, year, card_number, variant/parallel, external_ids jsonb, created_from (catalog|firehose|manual)
- `raw_prices` — card_id, market_cents, source (pokemontcgio), as_of
- `reference_prices` — card_id, grader, grade, value_cents, basis (comp_median|raw_floor|manual), comp_count_30d, as_of
- `listings` — ebay_item_id PK, card_id nullable, match_confidence, grader, grade, cert_number, price_cents, shipping_cents, listing_type (auction|bin), end_time, seller_feedback_pct, seller_feedback_count, status (active|ended|sold_probable), first_seen, last_seen, raw jsonb
- `comps` — card_id, grader, grade, sold_price_cents, sold_at, source (auction_close|bin_disappeared|manual), ebay_item_id
- `priority_items` — card_id, grader, grade, target_price_cents, query_terms[], misspellings[], enabled
- `alerts` — listing_id, score, basis, reasons jsonb, channel, sent_at
- `settings` — singleton jsonb (thresholds, quiet hours, categories)
- `cursor_state` — category_id, last_item_ts, last_item_id
- `dead_letters` — kind, payload jsonb, error, created_at

## 10. Dashboard (pages)

1. **Deal feed** — scored listings, filters (game/sport, grader, grade, score, basis), links out to eBay; too-good and suppressed items shown with their flags.
2. **Card detail** — comp history chart, current reference by grade, active listings.
3. **Priority list** — CRUD for targets, misspelling terms, enable/disable.
4. **Settings & health** — thresholds, quiet hours, categories; API budget, comps/day chart, dead letters, last-tick status.

Auth: single-user; dashboard behind a simple password (env `DASHBOARD_PASSWORD`) — this is a personal tool, not multi-tenant.

## 11. Security & config

Env vars (user-provisioned; user pastes values into Vercel env / `.env.local` themselves): `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `DATABASE_URL`, `SCAN_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `POKEMONTCG_API_KEY`, `PSA_API_TOKEN` (optional), `DASHBOARD_PASSWORD`.
User-created accounts (all free): eBay developer program (production keyset), Telegram bot (BotFather), Resend, Neon, GitHub repo (Actions enabled), Vercel project link; optional PSA API token. Opportunistic: apply for eBay Marketplace Insights API (proper 90-day solds); comp engine sits behind an interface so Insights can replace self-observed comps if ever granted.
The app never stores payment data, never authenticates to eBay as the user (app tokens only), never automates purchases.

## 12. Testing

- Fixture tests: normalizer/matcher against a corpus of real listing titles + item specifics, including scam phrasings ("PSA 10 candidate", "gem mint?"), wrong-grader cases, JP cards, parallels.
- Golden tests: scorer produces expected score/flags for a fixed fixture set.
- Unit tests: comp median math, n≥3 gate, floor rule, budget accounting, cursor overlap idempotency.
- Integration: `/api/scan` dry-run mode (`DRY_RUN=1`) — full pipeline, no Telegram/email; used for a 1–2 week threshold-tuning soak before alerts go live.
- Manual QA checklist: one real Telegram alert end-to-end, digest render, dashboard filters, quiet hours.

## 13. Milestones (for the implementation plan)

M1 ingest+normalize+match with dry-run feed → M2 comp engine + reference values + floor rule → M3 Telegram alerts + scoring + cert verification → M4 dashboard pages → M5 priority lane + digest + polish. Each milestone independently testable.

## 14. M2 amendments (2026-08-23, post-soak — supersede conflicting text above)

Five days of production soak (292 runs, 151k listings seen, 8.9k graded accepted, 980 catalog-matched) produced these binding design changes:

1. **Lossless cursor pagination replaces the fixed 3-page fetch (§4.1).** GitHub's free cron delivered ~24-minute effective cadence, not 5 — and newest-first fetching with a fixed page cap silently skipped ~80% of each gap. M2 ingestion pages backward (newest-first) until the page's oldest `itemCreationDate` is at or before the cursor-with-overlap, up to a hard cap of 20 pages per category per tick. If the cap is hit before reaching the cursor, the tick records a `sampling_gap` dead-letter (observable loss, never silent) and advances the cursor regardless. Budget stays governed by the per-attempt counter and the 4,800/day hard stop; measured headroom (~4,300/day unused) funds the added depth. Cadence stays on GitHub Actions unchanged — depth now adapts to however late the scheduler runs.
2. **Sports categories are one category (§2, §4.1).** eBay's taxonomy resolves baseball, basketball, and football singles to a single category, 261328, with the sport carried as a listing aspect. Sports enablement (still gated on its own re-budget decision) will map game from the Sport aspect, not the category. Category 183454 similarly carries all CCGs; non-Pokémon CCG listings remain unmatched by design.
3. **Matcher upgrades (§6), from real-title evidence:** name matching moves from substring-includes to whole-token comparison with a junk-token stoplist (graders, language markers, years, hobby boilerplate); card-number extraction adds gallery/promo formats (e.g. `GG40`, `TG12`, `SWSH250`). Both changes fail toward LOW, preserving the no-false-alert posture.
4. **Comp capture details (§4.6, §5):** auction-close sweeps use item detail on ended auctions — bid activity present → a real comp at the final bid; no bids → ended-unsold, no comp. BIN-disappearance checks probe active BINs on a rolling schedule; unavailable within 48h of first_seen → `sold_probable` comp at listed price, later disappearance → ended-unsold. Both sweeps draw from the "detail" budget with per-tick caps.
5. **Scoring lands in M2, alerting stays M3.** Matched listings get a stored deal score (floor-rule and comp-median bases per §5/§7) surfaced in the feed; no notification path of any kind exists until M3, and `DRY_RUN` semantics are unchanged.
6. **Deferred from M2 explicitly:** automated nightly pokemontcg.io re-sync (manual weekly `pnpm sync:pokemon` documented instead — raw prices drift slowly; automating it inside a 60-second tick is the wrong shape), sports enablement, PSA cert verification (M3 with alerts), JP reference completeness (accumulates naturally from comps).

## 15. M2.5 amendments (2026-08-30): eBay-only valuation — supersede conflicting text above

User direction: pokemontcg.io PRICES are retired; every valuation input must be an eBay observation. The pokemontcg.io CATALOG (cards/sets/numbers) remains the identification backbone. These changes supersede the floor-rule text in §5/§7, the `raw_prices` role in §9, and the "floor rule" unit-test line in §12.

1. **Peer-floor reference replaces the raw-price floor rule.** For a listing with (card_id, grader, grade) at high/medium match confidence, its peer set is the OTHER active Buy-It-Now listings sharing all three keys at high/medium confidence. The peer-floor reference is the minimum peer ask including shipping (`price_cents + shipping_cents`), and exists only when the listing has ≥2 peers — one lone ask never defines a market. Auctions are never references (a mid-auction bid is not an ask) but auction listings are scored against the BIN peer floor. Peer floors are computed from our own database: zero eBay API cost.
2. **Scoring hierarchy (§5/§7):** comp median (real observed sales, unchanged n≥3/30d machinery) when present → else peer floor → else unscored. `score_basis` gains `peer_floor`; `raw_floor` is never written again but remains a legible legacy value on old rows until the nightly re-score replaces them. `GRADE_FLOOR_MULTIPLIER` and all `raw_prices` reads leave the scoring path and the feed.
3. **Nightly re-score.** In the existing nightly slot, immediately after reference recompute: every active, matched (high/medium), graded listing has its score recomputed against current comp references and peer floors, including clearing scores whose basis has evaporated. Budget/time-guarded like sibling phases; own-database work only. This is what flushes legacy raw_floor scores within one day.
4. **Feed Value column:** comp reference → else peer floor (labeled as the cheapest live copy) → else em-dash. The `raw_prices` join is removed.
5. **Catalog-only sync.** `pnpm sync:pokemon` stops writing `raw_prices` entirely; it continues upserting cards (new sets/cards) on the same manual weekly cadence. The `raw_prices` table stays in the schema, dormant, for reversibility; no destructive migration.
6. **Explicitly out of scope for M2.5:** matcher lift + comp card_id backfill (next wave; multiplies coverage of both bases), alert thresholds (M3 — peer_floor-based alerts should demand a stricter threshold than comp-backed ones), raw/ungraded-listing ingestion (rejected: budget explosion for the crudest heuristic), score-at-view-time.
7. **Accepted day-one impact:** scored coverage shifts from 810 raw_floor listings to ≈660 peer-floor + comp-based few (measured 2026-08-30: 96 card+grade groups with ≥3 live copies among 2,191 matched actives); top-of-feed composition changes after the first nightly pass.
