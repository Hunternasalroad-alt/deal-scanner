import {
  boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const cards = pgTable(
  "cards",
  {
    id: serial("id").primaryKey(),
    game: text("game", { enum: ["pokemon", "baseball", "basketball", "football"] }).notNull(),
    name: text("name").notNull(),
    // Same NULLS-DISTINCT reasoning as `variant` below: this column sits in the
    // identity unique index, and sports rows have no set name — a NULL here would
    // make the index a no-op for them and let duplicate cards accumulate.
    setName: text("set_name").notNull().default(""),
    year: integer("year"),
    // Same NULLS-DISTINCT reasoning as `setName`/`variant`: this column sits in the
    // identity unique index, and cards can lack a number (promos, malformed API
    // rows) — a NULL here would exempt them from dedup and let duplicates accumulate.
    cardNumber: text("card_number").notNull().default(""),
    // NOT NULL with '' default: this column sits in the identity unique index, and
    // Postgres treats NULLs as distinct — nullable here would break upsert idempotency.
    variant: text("variant").notNull().default(""),
    externalIds: jsonb("external_ids").$type<Record<string, string>>().default({}),
    createdFrom: text("created_from", { enum: ["catalog", "firehose", "manual"] }).notNull(),
  },
  (t) => [uniqueIndex("cards_identity").on(t.game, t.setName, t.cardNumber, t.name, t.variant)],
);

export const rawPrices = pgTable(
  "raw_prices",
  {
    cardId: integer("card_id").notNull().references(() => cards.id),
    marketCents: integer("market_cents").notNull(),
    source: text("source").notNull().default("pokemontcgio"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.source] })],
);

export const listings = pgTable("listings", {
  ebayItemId: text("ebay_item_id").primaryKey(),
  cardId: integer("card_id").references(() => cards.id),
  matchConfidence: text("match_confidence", { enum: ["high", "medium", "low"] }),
  grader: text("grader", { enum: ["PSA", "BGS", "SGC"] }),
  grade: text("grade"),
  certNumber: text("cert_number"),
  priceCents: integer("price_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  listingType: text("listing_type", { enum: ["auction", "bin"] }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  sellerFeedbackPct: integer("seller_feedback_pct"),
  sellerFeedbackCount: integer("seller_feedback_count"),
  status: text("status", { enum: ["active", "ended", "sold_probable"] }).notNull().default("active"),
  categoryId: text("category_id").notNull(),
  title: text("title").notNull(),
  detailFetched: boolean("detail_fetched").notNull().default(false),
  dropReason: text("drop_reason"),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  // Last time the BIN-disappearance sweep (M2 Task 4) probed this listing's detail
  // endpoint; null means never probed. Nullable, no default — most listings (all
  // auctions, and BINs not yet reached by that sweep) never get a value.
  lastProbedAt: timestamp("last_probed_at", { withTimezone: true }),
  // spec §15 hierarchy score (comp median when present, else the live peer-ask
  // floor) — see reference.ts's scoreListing. Written at ingest for
  // high/medium-confidence matched listings, then kept current by the nightly
  // re-score (rescoreActiveListings) as comps and peer floors move. Nullable:
  // most listings (low confidence, unmatched, or no usable reference basis)
  // never get a value.
  scoreBps: integer("score_bps"),
  // "raw_floor" is legacy (M2, retired by spec §15): never written after M2.5,
  // still readable on rows the nightly re-score hasn't reached yet.
  scoreBasis: text("score_basis", { enum: ["comp_median", "peer_floor", "raw_floor"] }),
  raw: jsonb("raw").$type<unknown>(),
});

export const comps = pgTable(
  "comps",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id").references(() => cards.id),
    grader: text("grader", { enum: ["PSA", "BGS", "SGC"] }).notNull(),
    grade: text("grade").notNull().default(""),
    soldPriceCents: integer("sold_price_cents").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    source: text("source", { enum: ["auction_close", "bin_disappeared", "manual"] }).notNull(),
    ebayItemId: text("ebay_item_id").notNull(),
  },
  (t) => [uniqueIndex("comps_item").on(t.ebayItemId)],
);

export const referencePrices = pgTable(
  "reference_prices",
  {
    cardId: integer("card_id").notNull().references(() => cards.id),
    grader: text("grader", { enum: ["PSA", "BGS", "SGC"] }).notNull(),
    // Same NOT-NULL-DEFAULT-'' reasoning as comps.grade: this column sits in the
    // primary key, and Postgres treats NULLs as distinct — nullable here would
    // break upsert idempotency for listings graded without a specific number.
    grade: text("grade").notNull().default(""),
    valueCents: integer("value_cents").notNull(),
    basis: text("basis", { enum: ["comp_median"] }).notNull(),
    compCount30d: integer("comp_count_30d").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.grader, t.grade] })],
);

// Small durable key/value table for cross-tick scan state that isn't per-category
// (cursorState) or per-budget-day (apiBudget). First user: the nightly reference
// recompute gate's "have we already run today" marker (M2 Task 5).
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
});

export const cursorState = pgTable("cursor_state", {
  categoryId: text("category_id").primaryKey(),
  lastItemTs: timestamp("last_item_ts", { withTimezone: true }).notNull(),
});

export const apiBudget = pgTable(
  "api_budget",
  {
    day: text("day").notNull(), // YYYY-MM-DD UTC
    kind: text("kind").notNull(), // search | detail
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind] })],
);

export const deadLetters = pgTable("dead_letters", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<unknown>(),
  error: text("error").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
