import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/testDb";
import { matchListing } from "@/lib/match";
import { cards } from "@/db/schema";
import { normalizeListing } from "@/lib/normalize";
import type { Accepted } from "@/lib/normalize";
import type { EbayItemSummary } from "@/lib/ebay/client";

const acc = (over: Partial<Accepted["titleFacts"]>): Accepted => ({
  kind: "accepted", grader: "PSA", grade: "10", certNumber: null,
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

  it("sports: creates on first sight (MEDIUM), re-finds on second (HIGH)", async () => {
    const { db } = await makeTestDb();
    const facts = { yearHint: 2020, cardNumberHint: "325", nameTokens: ["Prizm", "Justin", "Herbert"] };
    const first = await matchListing(db, "football", acc(facts));
    expect(first).toMatchObject({ confidence: "medium", createdCard: true });
    const second = await matchListing(db, "football", acc(facts));
    expect(second).toMatchObject({ confidence: "high", createdCard: false });
    expect(second.cardId).toBe(first.cardId);
  });

  it("sports: LOW without year+number", async () => {
    const { db } = await makeTestDb();
    const r = await matchListing(db, "baseball", acc({ nameTokens: ["Griffey"] }));
    expect(r).toMatchObject({ confidence: "low", cardId: null, createdCard: false });
  });

  it("sports: two-letter player-name tokens survive (CJ Stroud, Bo Nix)", async () => {
    const { db } = await makeTestDb();
    const n = acc({ nameTokens: ["CJ", "Stroud", "PSA"], cardNumberHint: "150", yearHint: 2023 });
    const r = await matchListing(db, "football", n);
    expect(r.createdCard).toBe(true);
    const [card] = await db.select().from(cards).where(eq(cards.game, "football"));
    expect(card.name).toBe("Cj Stroud"); // titleCase of both tokens — 2-letter token kept
    // I1 (final review): setName carries the year so a second year of the same
    // player+number gets its own identity-index row instead of colliding.
    expect(card.setName).toBe("2023");
  });

  it("sports: a fraction-derived cardNumberHint (serial print-run, not a card number) never matches or creates", async () => {
    const { db } = await makeTestDb();
    // Absent the I2 fraction gate this would otherwise create a card — proves
    // the gate, not just the pre-existing yearHint/nameTokens requirement, is
    // what's blocking it.
    const n = acc({ cardNumberHint: "23", cardNumberFromFraction: true, yearHint: 2023, nameTokens: ["Justin", "Stroud"] });
    const r = await matchListing(db, "football", n);
    expect(r).toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await db.select().from(cards)).toEqual([]);
  });

  it("sports: strips #-prefixed and serial-fraction tokens, and the cardNumberHint itself, from name material", async () => {
    const { db } = await makeTestDb();
    const n = acc({ cardNumberHint: "339", cardNumberFromFraction: false, yearHint: 2023, nameTokens: ["#339", "23/99", "Stroud"] });
    const r = await matchListing(db, "football", n);
    expect(r.createdCard).toBe(true);
    const [card] = await db.select().from(cards).where(eq(cards.game, "football"));
    expect(card.name).toBe("Stroud"); // both junk tokens ("#339", "23/99") excluded
  });

  it("sports: never creates a card with an empty name", async () => {
    const { db } = await makeTestDb();
    // every token is stoplisted or numeric → no usable name material
    const n = acc({ nameTokens: ["PSA", "2023", "Graded", "Mint"], cardNumberHint: "77", yearHint: 2023 });
    const r = await matchListing(db, "baseball", n);
    expect(r).toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await db.select().from(cards)).toEqual([]);
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
