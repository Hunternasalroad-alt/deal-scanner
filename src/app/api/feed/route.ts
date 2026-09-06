import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings } from "@/db/schema";

const GAMES = ["pokemon", "baseball", "basketball", "football"] as const;

export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), 200) : 50;
  const gameParam = req.nextUrl.searchParams.get("game");
  const game = GAMES.find((g) => g === gameParam) ?? null;
  const db = getDb();
  const feedWhere = [isNull(listings.dropReason), eq(listings.status, "active")];
  if (game) feedWhere.push(eq(listings.game, game));
  const rows = await db
    .select({
      ebayItemId: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade,
      priceCents: listings.priceCents, confidence: listings.matchConfidence, cardName: cards.name, firstSeen: listings.firstSeen,
      scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis,
    })
    .from(listings)
    .leftJoin(cards, eq(listings.cardId, cards.id))
    .where(and(...feedWhere))
    .orderBy(sql`${listings.scoreBps} desc nulls last`, desc(listings.firstSeen))
    .limit(limit);
  return NextResponse.json(rows);
}
