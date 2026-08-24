import { describe, expect, it } from "vitest";
import { saleMetrics, type CompPoint } from "@/lib/valuation";

const NOW = new Date("2026-08-24T00:00:00Z");
const cp = (cents: number, daysAgo: number): CompPoint => ({ soldPriceCents: cents, soldAt: new Date(NOW.getTime() - daysAgo * 86400_000) });

describe("saleMetrics", () => {
  it("returns null with no sales", () => expect(saleMetrics([], NOW)).toBeNull());

  it("two sales: last + 90d avg only — avg3/avg5 stay null", () => {
    const m = saleMetrics([cp(10000, 5), cp(20000, 1)], NOW)!;
    expect(m).toMatchObject({ lastSaleCents: 20000, avg3Cents: null, avg5Cents: null, avg90dCents: 15000, count90d: 2 });
  });

  it("five sales: all metrics; averages use newest-first windows", () => {
    const m = saleMetrics([cp(100, 50), cp(200, 40), cp(300, 30), cp(400, 20), cp(500, 10)], NOW)!;
    expect(m.lastSaleCents).toBe(500);
    expect(m.avg3Cents).toBe(400);  // (500+400+300)/3
    expect(m.avg5Cents).toBe(300);  // mean of all five
  });

  it("90d window excludes older sales but fixed-count averages do not", () => {
    const m = saleMetrics([cp(1000, 120), cp(2000, 100), cp(3000, 10)], NOW)!;
    expect(m.avg90dCents).toBe(3000);
    expect(m.count90d).toBe(1);
    expect(m.avg3Cents).toBe(2000); // last-3 spans beyond 90d by design
  });

  it("input order does not matter", () => {
    const shuffled = [cp(300, 30), cp(500, 10), cp(400, 20)];
    expect(saleMetrics(shuffled, NOW)!.lastSaleCents).toBe(500);
  });
});
