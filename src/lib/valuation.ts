export type CompPoint = { soldPriceCents: number; soldAt: Date };

export type SaleMetrics = {
  lastSaleCents: number;
  lastSaleAt: Date;
  avg3Cents: number | null;   // strictly requires >= 3 sales — never a partial average
  avg5Cents: number | null;   // strictly requires >= 5 sales
  avg90dCents: number | null; // mean over trailing 90 days, any count >= 1
  count90d: number;
};

// Metrics over a card+grader+grade's observed sales, newest-first.
// Integrity rule: fixed-count averages (3/5) return null until that many real
// sales exist — a two-sale "average of three" would be a lie in a column header.
export function saleMetrics(comps: CompPoint[], now: Date = new Date()): SaleMetrics | null {
  if (comps.length === 0) return null;
  const sorted = [...comps].sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime());
  const avg = (xs: CompPoint[]) => Math.round(xs.reduce((s, c) => s + c.soldPriceCents, 0) / xs.length);
  const win = sorted.filter((c) => now.getTime() - c.soldAt.getTime() <= 90 * 86400_000);
  return {
    lastSaleCents: sorted[0].soldPriceCents,
    lastSaleAt: sorted[0].soldAt,
    avg3Cents: sorted.length >= 3 ? avg(sorted.slice(0, 3)) : null,
    avg5Cents: sorted.length >= 5 ? avg(sorted.slice(0, 5)) : null,
    avg90dCents: win.length > 0 ? avg(win) : null,
    count90d: win.length,
  };
}
