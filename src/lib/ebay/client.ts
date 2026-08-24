import { eq, sql } from "drizzle-orm";
import { apiBudget } from "@/db/schema";
import type { Db } from "@/db/client";
import { env } from "@/lib/config";

export class BudgetExceededError extends Error {}

// Typed alternative to the plain Error thrown on non-retryable HTTP failures,
// so callers (e.g. the ended-auction sweep) can branch on status without
// parsing the message string.
export class EbayHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type EbayItemSummary = {
  itemId: string; title: string; itemCreationDate: string;
  price?: { value: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  buyingOptions: string[]; itemEndDate?: string;
  seller?: { feedbackPercentage?: string; feedbackScore?: number };
  categories?: { categoryId: string }[];
};
export type EbaySearchPage = { items: EbayItemSummary[]; total: number };
export type EbayItemDetail = EbayItemSummary & {
  localizedAspects?: { name: string; value: string }[];
  currentBidPrice?: { value: string };
  bidCount?: number;
};

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE = "https://api.ebay.com/buy/browse/v1";
const DAILY_HARD_STOP = 4800;

let cached: { token: string; expiresAt: number } | null = null;

export async function getAppToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 5 * 60_000) return cached.token;
  const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`ebay token ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

// The token cache is module-level state; tests reset it so each test's mock
// sequence starts from a cold cache.
export function resetEbayAuthCache(): void {
  cached = null;
}

// Sum of every kind's count for today (UTC day, matching apiBudget.day's
// format). Extracted out of checkAndCount so callers that only need to read
// the running total — e.g. scan.ts's sweep soft ceiling — don't have to
// duplicate the query or pay for a write.
export async function getTodaySpend(db: Db): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(apiBudget).where(eq(apiBudget.day, day));
  return rows.reduce((s, r) => s + r.count, 0);
}

export async function checkAndCount(db: Db, kind: "search" | "detail"): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const total = await getTodaySpend(db);
  if (total >= DAILY_HARD_STOP) throw new BudgetExceededError(`daily budget ${total}/${DAILY_HARD_STOP}`);
  await db
    .insert(apiBudget)
    .values({ day, kind, count: 1 })
    .onConflictDoUpdate({ target: [apiBudget.day, apiBudget.kind], set: { count: sql`${apiBudget.count} + 1` } });
}

async function browseGet(db: Db, kind: "search" | "detail", url: string, fetchImpl: typeof fetch) {
  const token = await getAppToken(fetchImpl);
  for (let attempt = 0; ; attempt++) {
    // Budget is charged per real HTTP attempt — retries included — because eBay
    // meters 429/5xx responses against the free-tier quota too.
    await checkAndCount(db, kind);
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new EbayHttpError(res.status, `ebay ${kind} ${res.status}: ${await res.text()}`);
  }
}

export async function searchNewlyListed(
  db: Db,
  opts: { categoryId: string; sinceIso: string; offset: number },
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySearchPage> {
  const params = new URLSearchParams({
    category_ids: opts.categoryId,
    sort: "newlyListed",
    limit: "200",
    offset: String(opts.offset),
    filter: `itemStartDate:[${opts.sinceIso}..]`, // ".." = open-ended range; a bare [ts] is not eBay's documented filter form
  });
  const body = (await browseGet(db, "search", `${BROWSE}/item_summary/search?${params}`, fetchImpl)) as {
    total?: number; itemSummaries?: EbayItemSummary[];
  };
  return { items: body.itemSummaries ?? [], total: body.total ?? 0 };
}

export async function getItemDetail(db: Db, itemId: string, fetchImpl: typeof fetch = fetch): Promise<EbayItemDetail> {
  return (await browseGet(db, "detail", `${BROWSE}/item/${encodeURIComponent(itemId)}`, fetchImpl)) as EbayItemDetail;
}
