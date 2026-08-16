import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { cards, listings } from "@/db/schema";

describe("schema", () => {
  it("round-trips a card and a listing", async () => {
    const { db } = await makeTestDb();
    const [card] = await db
      .insert(cards)
      .values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" })
      .returning();
    await db.insert(listings).values({
      ebayItemId: "v1|123|0", cardId: card.id, priceCents: 419900, listingType: "bin",
      categoryId: "183454", title: "PSA 10 Umbreon ex 161/131",
    });
    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(1);
    expect(rows[0].cardId).toBe(card.id);
    expect(rows[0].status).toBe("active");
  });
});
