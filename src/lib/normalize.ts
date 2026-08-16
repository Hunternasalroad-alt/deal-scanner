import type { EbayItemDetail, EbayItemSummary } from "@/lib/ebay/client";

export type Accepted = {
  kind: "accepted";
  grader: "PSA" | "BGS" | "SGC";
  grade: string | null;
  certNumber: string | null;
  priceCents: number; shippingCents: number;
  listingType: "auction" | "bin";
  titleFacts: { setHint: string | null; cardNumberHint: string | null; yearHint: number | null; nameTokens: string[] };
};
export type Dropped = { kind: "dropped"; reason: "raw_candidate_phrasing" | "unsupported_grader" | "not_graded" | "no_price" };
export type Normalized = Accepted | Dropped;

const CANDIDATE_RX = /\b(candidate|potential|worthy|pre[- ]?grade|regrade\??|psa\s*ready)\b/i;
const GRADER_RX = /\b(PSA|BGS|SGC|Beckett|BVG)\s*[-:]?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5)?\b/i;
// "ACE" the grading company must not fire on "ACE SPEC", a printed Pokémon card
// mechanic that appears constantly in legitimate titles in our main category.
const OTHER_GRADER_RX = /\b(CGC|TAG|HGA|GMA|MNT)\b|\bACE\b(?![\s-]*SPEC)/i;

function toCents(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function normalizeListing(item: EbayItemSummary, detail?: EbayItemDetail): Normalized {
  const title = item.title;
  const aspects = new Map((detail?.localizedAspects ?? []).map((a) => [a.name.toLowerCase(), a.value]));

  // 1. Scam phrasing: "PSA 10 candidate" etc. is a RAW card.
  if (CANDIDATE_RX.test(title)) return { kind: "dropped", reason: "raw_candidate_phrasing" };

  // 2. Grader from structured aspects first, then title.
  let grader: Accepted["grader"] | null = null;
  let grade: string | null = null;
  const aspectGrader = aspects.get("professional grader") ?? "";
  if (/PSA/i.test(aspectGrader)) grader = "PSA";
  else if (/(BGS|Beckett|BVG)/i.test(aspectGrader)) grader = "BGS";
  else if (/SGC/i.test(aspectGrader)) grader = "SGC";
  if (grader) grade = aspects.get("grade") ?? null;
  // Structured aspects beat title text absolutely: once an aspect names a
  // supported grader, no title token can override it. Title parsing is only a
  // fallback for listings with no usable aspects.
  if (!grader) {
    const m = GRADER_RX.exec(title);
    if (m) {
      grader = m[1].toUpperCase() === "BECKETT" || m[1].toUpperCase() === "BVG" ? "BGS" : (m[1].toUpperCase() as Accepted["grader"]);
      grade = m[2] ?? null;
    }
  }
  if (!grader) {
    if (OTHER_GRADER_RX.test(title) || /grader/i.test(aspectGrader)) return { kind: "dropped", reason: "unsupported_grader" };
    return { kind: "dropped", reason: "not_graded" };
  }

  // 3. Money.
  const priceCents = toCents(item.price?.value);
  if (priceCents === null) return { kind: "dropped", reason: "no_price" };
  const shippingCents = toCents(item.shippingOptions?.[0]?.shippingCost?.value) ?? 0;

  // 4. Title facts for the matcher.
  const yearM = /\b(19[5-9]\d|20[0-2]\d)\b/.exec(title);
  const numM = /#\s?(\w{1,6})\b/.exec(title) ?? /\b(\d{1,3})\s*\/\s*\d{1,3}\b/.exec(title);
  const nameTokens = title
    .replace(GRADER_RX, " ")
    .replace(/[^a-zA-Z0-9\s/#]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 12);

  return {
    kind: "accepted",
    grader, grade: grade ? grade.replace(/[^\d.]/g, "") || null : null,
    certNumber: aspects.get("certification number") ?? null,
    priceCents, shippingCents,
    listingType: item.buyingOptions.includes("AUCTION") ? "auction" : "bin",
    titleFacts: {
      setHint: null,
      cardNumberHint: numM ? numM[1] : null,
      yearHint: yearM ? Number(yearM[1]) : null,
      nameTokens,
    },
  };
}
