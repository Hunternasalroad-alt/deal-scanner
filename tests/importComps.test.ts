import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { parseCsv, parseManualCompCsv, syntheticCompId, type ManualCompRow } from "@/lib/importComps";
import { importComps } from "@/lib/importCompsDb";
import { recomputeReferences } from "@/lib/reference";
import { cards, comps, referencePrices } from "@/db/schema";

// Builds a CSV row from field values, quoting only where RFC-4180 requires
// it — avoids hand-counting commas in a 12-column fixture row.
const csvRow = (fields: string[]) =>
  fields.map((f) => (/[,"\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(",");

describe("parseCsv", () => {
  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('a,"say ""hi""",c\n')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("accepts CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("skips a fully-blank line between rows", () => {
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

const HEADER_FIELDS = ["game", "set_name", "card_number", "name", "variant", "year", "grader", "grade", "sold_price", "sold_date", "venue", "note"];
const HEADER = csvRow(HEADER_FIELDS);
const NOW = new Date("2026-08-23T00:00:00Z");

const goodRow = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "PSA", "10", "850.00", "2026-06-15", "", ""]);

describe("parseManualCompCsv", () => {
  it("parses a happy row and applies defaults for omitted optional fields", () => {
    const { rows, errors } = parseManualCompCsv(`${HEADER}\n${goodRow}\n`, NOW);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      game: "pokemon", setName: "Prismatic Evolutions", cardNumber: "161", name: "Umbreon ex",
      variant: "", year: null, grader: "PSA", grade: "10", soldPriceCents: 85000,
      venue: "unknown", note: "",
    });
    expect(rows[0].soldAt.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("rejects an unsupported grader with the PSA/BGS/SGC message", () => {
    const row = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "CGC", "10", "850.00", "2026-06-15", "", ""]);
    const { rows, errors } = parseManualCompCsv(`${HEADER}\n${row}\n`, NOW);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 2 });
    expect(errors[0].message).toMatch(/PSA\/BGS\/SGC/);
  });

  it("rejects a malformed grade like 9.75", () => {
    const row = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "PSA", "9.75", "850.00", "2026-06-15", "", ""]);
    const { rows, errors } = parseManualCompCsv(`${HEADER}\n${row}\n`, NOW);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("rejects a zero price, and parses a $ + thousands-comma price to cents", () => {
    const zero = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "PSA", "10", "0", "2026-06-15", "", ""]);
    const { rows: zeroRows, errors: zeroErrors } = parseManualCompCsv(`${HEADER}\n${zero}\n`, NOW);
    expect(zeroRows).toHaveLength(0);
    expect(zeroErrors).toHaveLength(1);

    const big = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "PSA", "10", "$1,234.56", "2026-06-15", "", ""]);
    const { rows: bigRows, errors: bigErrors } = parseManualCompCsv(`${HEADER}\n${big}\n`, NOW);
    expect(bigErrors).toEqual([]);
    expect(bigRows[0].soldPriceCents).toBe(123456);
  });

  it("rejects a sold_date in the future", () => {
    const row = csvRow(["pokemon", "Prismatic Evolutions", "161", "Umbreon ex", "", "", "PSA", "10", "850.00", "2099-01-01", "", ""]);
    const { rows, errors } = parseManualCompCsv(`${HEADER}\n${row}\n`, NOW);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("still parses correctly with a shuffled header order", () => {
    const shuffledHeader = csvRow(["sold_date", "sold_price", "grade", "grader", "name", "card_number", "set_name", "game", "note", "venue", "year", "variant"]);
    const shuffledRow = csvRow(["2026-06-15", "850.00", "10", "PSA", "Umbreon ex", "161", "Prismatic Evolutions", "pokemon", "", "", "", ""]);
    const { rows, errors } = parseManualCompCsv(`${shuffledHeader}\n${shuffledRow}\n`, NOW);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ game: "pokemon", setName: "Prismatic Evolutions", cardNumber: "161", name: "Umbreon ex", soldPriceCents: 85000 });
  });
});

describe("syntheticCompId", () => {
  const row: ManualCompRow = {
    game: "pokemon", setName: "Prismatic Evolutions", cardNumber: "161", name: "Umbreon ex", variant: "",
    year: 2025, grader: "PSA", grade: "10", soldPriceCents: 85000, soldAt: new Date("2026-06-15T12:00:00Z"),
    venue: "fanatics", note: "",
  };

  it("is deterministic for the same row and cardId", () => {
    expect(syntheticCompId(row, 42)).toBe(syntheticCompId(row, 42));
  });

  it("differs for a different cardId", () => {
    expect(syntheticCompId(row, 42)).not.toBe(syntheticCompId(row, 43));
  });

  it("appends a slugified note when one is present", () => {
    const withNote: ManualCompRow = { ...row, note: "Fanatics Weekly Auction #42!" };
    expect(syntheticCompId(withNote, 42)).toBe(`${syntheticCompId(row, 42)}:fanatics-weekly-auction-42`);
  });
});

const pokemonRow = (over: Partial<ManualCompRow> = {}): ManualCompRow => ({
  game: "pokemon", setName: "Prismatic Evolutions", cardNumber: "161", name: "Umbreon ex", variant: "",
  year: null, grader: "PSA", grade: "10", soldPriceCents: 85000, soldAt: new Date("2026-06-15T12:00:00Z"),
  venue: "fanatics", note: "",
  ...over,
});

describe("importComps (PGlite integration)", () => {
  it("imports a manual comp for an existing pokemon card", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" }).returning();

    const row = pokemonRow();
    const result = await importComps(db, [row]);
    expect(result).toEqual({ inserted: 1, duplicates: 0, rejected: [] });

    const [c] = await db.select().from(comps);
    expect(c).toMatchObject({ cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 85000, source: "manual" });
    expect(c.ebayItemId).toBe(syntheticCompId(row, card.id));
  });

  it("re-importing the same rows counts duplicates and writes no new comps", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" });

    const row = pokemonRow();
    expect(await importComps(db, [row])).toEqual({ inserted: 1, duplicates: 0, rejected: [] });
    expect(await importComps(db, [row])).toEqual({ inserted: 0, duplicates: 1, rejected: [] });
    expect(await db.select().from(comps)).toHaveLength(1);
  });

  it("a pokemon row with an unknown set is rejected with candidate suggestions, and creates no card", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" });

    // Wrong set AND wrong name (right card_number) so neither lookup can
    // succeed — a wrong set alone would still match via the name fallback.
    const row = pokemonRow({ setName: "Some Bogus Set", name: "Not A Real Name" });
    const result = await importComps(db, [row]);
    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/Prismatic Evolutions/);
    expect(result.rejected[0].reason).toMatch(/Umbreon ex/);

    expect(await db.select().from(cards)).toHaveLength(1); // no new card created
    expect(await db.select().from(comps)).toHaveLength(0);
  });

  it("a baseball row creates a manual card, then a second identical row reuses it", async () => {
    const { db } = await makeTestDb();
    const row: ManualCompRow = {
      game: "baseball", setName: "Upper Deck", cardNumber: "1", name: "Ken Griffey Jr", variant: "",
      year: 1989, grader: "SGC", grade: "10", soldPriceCents: 120000, soldAt: new Date("2026-07-01T12:00:00Z"),
      venue: "fanatics", note: "",
    };
    expect(await importComps(db, [row])).toEqual({ inserted: 1, duplicates: 0, rejected: [] });
    const createdCards = await db.select().from(cards);
    expect(createdCards).toHaveLength(1);
    expect(createdCards[0]).toMatchObject({ game: "baseball", name: "Ken Griffey Jr", createdFrom: "manual", year: 1989 });

    const row2: ManualCompRow = { ...row, soldAt: new Date("2026-07-08T12:00:00Z"), soldPriceCents: 130000 };
    expect(await importComps(db, [row2])).toEqual({ inserted: 1, duplicates: 0, rejected: [] });
    expect(await db.select().from(cards)).toHaveLength(1); // no duplicate card
    expect(await db.select().from(comps)).toHaveLength(2);
  });
});

describe("manual comps feed recomputeReferences", () => {
  it("3 manual comps for one (card, grader, grade) within 30d produce a reference price", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" }).returning();
    const day = (n: number) => new Date(Date.now() - n * 86400_000);

    await importComps(db, [
      pokemonRow({ soldAt: day(1), soldPriceCents: 500000 }),
      pokemonRow({ soldAt: day(5), soldPriceCents: 520000 }),
      pokemonRow({ soldAt: day(9), soldPriceCents: 610000 }),
    ]);

    const r = await recomputeReferences(db);
    expect(r.upserted).toBe(1);
    const [ref] = await db.select().from(referencePrices);
    expect(ref).toMatchObject({ cardId: card.id, grader: "PSA", grade: "10", basis: "comp_median", compCount30d: 3 });
  });
});
