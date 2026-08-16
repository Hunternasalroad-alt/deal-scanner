import { describe, expect, it } from "vitest";
import { normalizeListing } from "@/lib/normalize";
import type { EbayItemSummary } from "@/lib/ebay/client";

const base = (title: string, price = "100.00"): EbayItemSummary => ({
  itemId: "v1|x|0", title, itemCreationDate: "2026-08-15T00:00:00Z",
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

describe("normalizeListing", () => {
  const cases: [string, string, string | null][] = [
    // title, expected kind or grader, expected grade
    ["Umbreon ex 161/131 PSA 10 Prismatic Evolutions", "PSA", "10"],
    ["2023 Bowman Chrome Jackson Holliday BGS 9.5 Gem Mint", "BGS", "9.5"],
    ["Beckett 9 Charizard Vmax", "BGS", "9"],
    ["SGC 10 1989 Ken Griffey Jr Upper Deck #1", "SGC", "10"],
  ];
  for (const [title, grader, grade] of cases)
    it(`accepts: ${title}`, () => {
      const n = normalizeListing(base(title));
      expect(n.kind).toBe("accepted");
      if (n.kind === "accepted") { expect(n.grader).toBe(grader); expect(n.grade).toBe(grade); }
    });

  const drops: [string, string][] = [
    ["Moonbreon Umbreon VMAX PSA 10 candidate!! sharp", "raw_candidate_phrasing"],
    ["Charizard base set potential PSA 10 worthy", "raw_candidate_phrasing"],
    ["Pikachu ex CGC 10 pristine", "unsupported_grader"],
    ["Mega Gengar ex SAR raw NM", "not_graded"],
  ];
  for (const [title, reason] of drops)
    it(`drops: ${title} (${reason})`, () => {
      const n = normalizeListing(base(title));
      expect(n.kind).toBe("dropped");
      if (n.kind === "dropped") expect(n.reason).toBe(reason);
    });

  it("aspect-named grader wins even when the title contains ACE SPEC", () => {
    const n = normalizeListing(base("Computer Search ACE SPEC Ultra Rare slab"), {
      ...base("Computer Search ACE SPEC Ultra Rare slab"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "Professional Sports Authenticator (PSA)" },
        { name: "Grade", value: "10" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "PSA", grade: "10" });
  });

  it("ACE SPEC without any grader is not_graded, not unsupported_grader", () => {
    const n = normalizeListing(base("Prime Catcher ACE SPEC raw NM"));
    expect(n).toMatchObject({ kind: "dropped", reason: "not_graded" });
  });

  it("BVG aspect value maps to BGS", () => {
    const n = normalizeListing(base("vintage slab"), {
      ...base("vintage slab"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "BVG" },
        { name: "Grade", value: "8" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "BGS", grade: "8" });
  });

  it("prefers structured aspects over title text", () => {
    const n = normalizeListing(base("nice slab lot"), {
      ...base("nice slab lot"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "Professional Sports Authenticator (PSA)" },
        { name: "Grade", value: "9" },
        { name: "Certification Number", value: "12345678" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "PSA", grade: "9", certNumber: "12345678" });
  });

  it("extracts title facts and money", () => {
    const n = normalizeListing({ ...base("2020 Prizm Justin Herbert #325 PSA 10", "250.00"), shippingOptions: [{ shippingCost: { value: "4.99" } }] });
    if (n.kind !== "accepted") throw new Error("expected accepted");
    expect(n.priceCents).toBe(25000);
    expect(n.shippingCents).toBe(499);
    expect(n.titleFacts.yearHint).toBe(2020);
    expect(n.titleFacts.cardNumberHint).toBe("325");
  });
});
