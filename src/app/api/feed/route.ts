import { NextRequest, NextResponse } from "next/server";
import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings } from "@/db/schema";

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 200);
  const db = getDb();
  const rows = await db
    .select({
      ebayItemId: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade,
      priceCents: listings.priceCents, confidence: listings.matchConfidence, cardName: cards.name, firstSeen: listings.firstSeen,
    })
    .from(listings)
    .leftJoin(cards, eq(listings.cardId, cards.id))
    .where(isNull(listings.dropReason))
    .orderBy(desc(listings.firstSeen))
    .limit(limit);
  return NextResponse.json(rows);
}
