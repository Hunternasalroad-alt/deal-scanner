import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import { getDb } from "@/db/client";
import { runScanTick } from "@/lib/scan";
import { getItemDetail, searchNewlyListed } from "@/lib/ebay/client";
import { deadLetters } from "@/db/schema";

// keep in sync with TICK_MAX_DURATION_S in src/lib/scan.ts
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.SCAN_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  try {
    const report = await runScanTick(db, { search: searchNewlyListed, detail: getItemDetail });
    return NextResponse.json(report);
  } catch (e) {
    await db.insert(deadLetters).values({ kind: "scan_tick", payload: null, error: String(e) });
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
