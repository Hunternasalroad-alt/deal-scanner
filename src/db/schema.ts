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
  raw: jsonb("raw").$type<unknown>(),
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
