import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/testDb";
import { matchListing } from "@/lib/match";
import { cards } from "@/db/schema";
import { normalizeListing } from "@/lib/normalize";
import type { Accepted } from "@/lib/normalize";
import type { EbayItemSummary } from "@/lib/ebay/client";

const acc = (over: Partial<Accepted["titleFacts"]>, title = ""): Accepted => ({
  kind: "accepted", title, grader: "PSA", grade: "10", certNumber: null,
  priceCents: 10000, shippingCents: 0, listingType: "bin",
  titleFacts: { setHint: null, cardNumberHint: null, yearHint: null, nameTokens: [], ...over },
});

const base = (title: string, price = "100.00"): EbayItemSummary => ({
  itemId: "v1|x|0", title, itemCreationDate: "2026-08-15T00:00:00Z",
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

describe("matchListing", () => {
  it("pokemon: HIGH on unique number+name hit", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" });
    const r = await matchListing(db, "pokemon", acc({ cardNumberHint: "161", nameTokens: ["Umbreon", "ex"] }));
    expect(r.confidence).toBe("high");
    expect(r.cardId).not.toBeNull();
    expect(r.createdCard).toBe(false);
  });

  it("pokemon: LOW when ambiguous, never creates", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values([
      { game: "pokemon", name: "Pikachu", setName: "A", cardNumber: "25", createdFrom: "catalog" },
      { game: "pokemon", name: "Pikachu", setName: "B", cardNumber: "25", createdFrom: "catalog" },
    ]);
    const r = await matchListing(db, "pokemon", acc({ cardNumberHint: "25", nameTokens: ["Pikachu"] }));
    expect(r.confidence).toBe("low");
    expect(r.createdCard).toBe(false);
  });

  it("sports: creates a canonical card on first sight (MEDIUM), re-finds it from a differently-worded title (HIGH)", async () => {
    const { db } = await makeTestDb();
    const a = await matchListing(db, "basketball", acc({}, "2019-20 Panini Select Concourse Silver Prizm Shai Gilgeous-Alexander #81 PSA 9"));
    expect(a.confidence).toBe("medium"); expect(a.createdCard).toBe(true);
    const b = await matchListing(db, "basketball", acc({}, "Shai Gilgeous-Alexander 2019 Select #81 Silver Prizm Concourse Thunder PSA 10 RC"));
    expect(b.confidence).toBe("high"); expect(b.cardId).toBe(a.cardId); expect(b.createdCard).toBe(false);
    const [card] = await db.select().from(cards).where(eq(cards.id, a.cardId!));
    expect(card).toMatchObject({ game: "basketball", setName: "2019 Panini Select", cardNumber: "81", name: "Shai Gilgeous-Alexander", variant: "Concourse Prizm Silver", year: 2019 });
  });

  it("sports: base and parallel are different cards", async () => {
    const { db } = await makeTestDb();
    const base = await matchListing(db, "basketball", acc({}, "2019 Panini Prizm Ja Morant #249 PSA 10"));
    const silver = await matchListing(db, "basketball", acc({}, "2019 Panini Prizm Ja Morant #249 Silver Prizm PSA 10"));
    expect(base.cardId).not.toBe(silver.cardId);
    expect((await db.select().from(cards)).length).toBe(2);
  });

  it("sports: two-letter player-name tokens survive (CJ Stroud)", async () => {
    const { db } = await makeTestDb();
    const r = await matchListing(db, "football", acc({}, "2023 Panini Prizm CJ Stroud #150 PSA 10 Texans RC"));
    expect(r.createdCard).toBe(true);
    const [card] = await db.select().from(cards);
    expect(card.name).toBe("Cj Stroud");
  });

  it("sports: LOW and no card when the title has no card number or no player", async () => {
    const { db } = await makeTestDb();
    expect(await matchListing(db, "basketball", acc({}, "2020 Panini Mosaic Lamelo Ball Rookie Auto Mosaic PSA 10")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await matchListing(db, "baseball", acc({}, "2024 Panini Prizm #22 PSA 10 RC Rookie Card")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await db.select().from(cards)).toEqual([]);
  });

  it("sports: a serial print-run is never a card number", async () => {
    const { db } = await makeTestDb();
    expect(await matchListing(db, "basketball", acc({}, "2022 Panini Prizm Keegan Murray Rookie Purple Prizm /99 PSA 10")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
  });

  it("matches the real Sawsbuck soak title despite junk tokens", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values([
      { game: "pokemon", name: "Sawsbuck", setName: "Temporal Forces", cardNumber: "166", createdFrom: "catalog" },
      { game: "pokemon", name: "Venusaur", setName: "Temporal Forces", cardNumber: "166x", createdFrom: "catalog" },
    ]);
    const n = normalizeListing(base("2024 POKEMON TEF EN-TEMPORAL FORCES ILLUSTRATION RARE #166 SAWSBUCK PSA 10"));
    if (n.kind !== "accepted") throw new Error("expected accepted");
    const r = await matchListing(db, "pokemon", n);
    expect(r.confidence).toBe("high");
  });
  it("matches the real Glaceon GG40 soak title", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Glaceon VSTAR", setName: "Crown Zenith: Galarian Gallery", cardNumber: "GG40", createdFrom: "catalog" });
    const n = normalizeListing(base("PSA 10 Glaceon VSTAR GG40 Ultra Rare 2023 Pokemon Crown Zenith Galarian Gallery"));
    if (n.kind !== "accepted") throw new Error("expected accepted");
    const r = await matchListing(db, "pokemon", n);
    expect(["high", "medium"]).toContain(r.confidence);
  });
  it("disambiguates via whole-token nameHits when a decoy name contains a junk token as a substring", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values([
      { game: "pokemon", name: "Sawsbuck", setName: "Temporal Forces", cardNumber: "50", createdFrom: "catalog" },
      { game: "pokemon", name: "Venusaur", setName: "Temporal Forces", cardNumber: "50", createdFrom: "catalog" },
    ]);
    const n = normalizeListing(base("2024 POKEMON TEF EN-TEMPORAL FORCES RARE #50 SAWSBUCK PSA 10"));
    if (n.kind !== "accepted") throw new Error("expected accepted");
    const r = await matchListing(db, "pokemon", n);
    expect(r.confidence).toBe("high");
    expect(r.cardId).not.toBeNull();
  });
});
