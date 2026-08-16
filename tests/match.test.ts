import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { matchListing } from "@/lib/match";
import { cards } from "@/db/schema";
import type { Accepted } from "@/lib/normalize";

const acc = (over: Partial<Accepted["titleFacts"]>): Accepted => ({
  kind: "accepted", grader: "PSA", grade: "10", certNumber: null,
  priceCents: 10000, shippingCents: 0, listingType: "bin",
  titleFacts: { setHint: null, cardNumberHint: null, yearHint: null, nameTokens: [], ...over },
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
});
