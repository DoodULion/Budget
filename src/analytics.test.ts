import { describe, expect, it } from 'vitest';
import {
  billsOutlook,
  categoryByMonth,
  chartData,
  chartProblem,
  daysCovered,
  debtByMonth,
  flowStats,
  isCustomChart,
  monthFlows,
  monthPace,
  rangeMonths,
  spendByCategory,
  spendByPaidWith,
  spendByWeekday,
  spendStats,
  topPurchases,
  weekdayIndex,
  type CustomChart,
} from './analytics';
import type { Data } from './calc';

// Made-up figures only (CLAUDE.md, "Test cases"). Today is 2027-02-15.
const TODAY = '2027-02-15';

function data(): Data {
  return {
    settings: { incomeBaselineCents: 300_000, savingsGoalCents: 50_000, startingBalanceCents: 200_000, firstMonth: '2027-01', paidWith: ['Card A', 'Card B'], setupDone: true },
    cards: [],
    bills: [
      { id: 'rent', name: 'Rent', amountCents: 120_000 },
      { id: 'phone', name: 'Phone', amountCents: 5_000 },
      { id: 'gym', name: 'Gym', amountCents: 3_000, lastMonth: '2027-01' },
    ],
    categories: [
      { id: 'food', name: 'Food', budgetCents: 40_000, color: 'c1' },
      { id: 'fun', name: 'Fun', budgetCents: 10_000, color: 'c2' },
      { id: 'other', name: 'Other', budgetCents: 5_000, color: 'c3' },
    ],
    months: [
      { month: '2027-01', payments: { rent: { datePaid: '2027-01-01' }, phone: { datePaid: '2027-01-05', amountPaidCents: 5_520 } } },
      { month: '2027-02', incomeCents: 180_000, payments: { rent: { datePaid: '2027-02-01' } } },
    ],
    purchases: [
      { id: 'p1', date: '2027-01-03', categoryId: 'food', amountCents: 12_050, paidWith: 'Card A' },
      { id: 'p2', date: '2027-01-20', categoryId: 'food', amountCents: 6_025, paidWith: 'Card A' },
      { id: 'p3', date: '2027-01-21', categoryId: 'fun', amountCents: 4_500 },
      { id: 'p4', date: '2027-01-31', categoryId: 'other', amountCents: 1_000, paidWith: 'Card B' },
      { id: 'p5', date: '2027-02-02', categoryId: 'food', amountCents: 45_000, paidWith: 'Card B' },
      { id: 'p6', date: '2027-02-10', categoryId: 'fun', amountCents: 2_000, paidWith: 'Card A' },
    ],
  };
}

describe('ranges', () => {
  it('ends with the current month and never starts before the first tracked month', () => {
    expect(rangeMonths(data(), TODAY, 'all')).toEqual(['2027-01', '2027-02']);
    expect(rangeMonths(data(), TODAY, '3')).toEqual(['2027-01', '2027-02']);
    expect(rangeMonths(data(), TODAY, '12')).toEqual(['2027-01', '2027-02']);
    expect(rangeMonths({ ...data(), settings: { ...data().settings, firstMonth: '2026-06' } }, TODAY, '3')).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(rangeMonths(data(), '2026-12-10', 'all')).toEqual([]);
  });
});

describe('money flow', () => {
  const flows = monthFlows(data(), TODAY);
  it('matches the Summary: saved, vs goal and the balance carried forward', () => {
    expect(flows.map((f) => [f.month, f.incomeCents, f.billsCents, f.spentCents, f.savedCents, f.vsGoalCents, f.balanceCents])).toEqual([
      ['2027-01', 300_000, 125_520, 23_575, 150_905, 100_905, 350_905],
      ['2027-02', 180_000, 120_000, 47_000, 13_000, -37_000, 363_905],
    ]);
  });
  it('sums up the range', () => {
    const s = flowStats(flows);
    expect(s).toMatchObject({ months: 2, totalSavedCents: 163_905, avgIncomeCents: 240_000, avgSpentCents: 35_288, goalMet: 1, savingsRatePct: 34 });
    expect(s.avgSavedCents).toBe(81_953); // $819.525 rounds up (halves away from zero)
    expect(s.best?.month).toBe('2027-01');
    expect(s.worst?.month).toBe('2027-02');
  });
  it('is empty before the first month', () => {
    expect(flowStats(monthFlows(data(), '2026-12-10'))).toMatchObject({ months: 0, avgSavedCents: 0, savingsRatePct: 0, goalMet: 0 });
  });
});

describe('spending', () => {
  const months = ['2027-01', '2027-02'];
  it('groups by category, largest first', () => {
    expect(spendByCategory(data(), months).map((s) => [s.label, s.cents])).toEqual([['Food', 63_075], ['Fun', 6_500], ['Other', 1_000]]);
  });
  it('keeps a deleted category', () => {
    const d = data();
    d.categories = d.categories.filter((c) => c.id !== 'fun');
    expect(spendByCategory(d, months).map((s) => s.label)).toContain('Deleted category');
  });
  it('groups by paid with, with the rest as No method', () => {
    expect(spendByPaidWith(data(), months).map((s) => [s.label, s.cents])).toEqual([['Card B', 46_000], ['Card A', 20_075], ['No method', 4_500]]);
  });
  it('groups by weekday, Monday first', () => {
    expect(weekdayIndex('2027-02-15')).toBe(0); // a Monday
    expect(weekdayIndex('2027-02-21')).toBe(6);
    const w = spendByWeekday(data(), months);
    expect(w.reduce((s, x) => s + x.cents, 0)).toBe(70_575);
    expect(w.reduce((s, x) => s + x.count, 0)).toBe(6);
    expect(w[1]).toMatchObject({ label: 'Tue', cents: 45_000 }); // 2027-02-02
  });
  it('works out the averages and the biggest purchase', () => {
    const s = spendStats(data(), months, TODAY);
    expect(daysCovered(months, TODAY)).toBe(31 + 15);
    expect(s).toMatchObject({ totalCents: 70_575, count: 6, avgPerMonthCents: 35_288, avgPerDayCents: 1_534, avgPurchaseCents: 11_763 });
    expect(s.biggest?.id).toBe('p5');
    expect(s.topCategory?.label).toBe('Food');
    expect(topPurchases(data(), months, 2).map((p) => p.id)).toEqual(['p5', 'p1']);
  });
  it('splits each month by category', () => {
    const c = categoryByMonth(data(), months);
    expect(c.categories.map((x) => x.label)).toEqual(['Food', 'Fun', 'Other']);
    expect(c.rows).toEqual([{ month: '2027-01', byCategory: [18_075, 4_500, 1_000] }, { month: '2027-02', byCategory: [45_000, 2_000, 0] }]);
  });
  it('tracks the pace through the month against the spending budget', () => {
    const p = monthPace(data(), '2027-02', TODAY);
    expect(p).toHaveLength(15);
    expect(p[0]).toEqual({ day: 1, cents: 0, paceCents: 1_964 }); // $550 ÷ 28 days
    expect(p[14]).toEqual({ day: 15, cents: 47_000, paceCents: 29_464 });
    expect(monthPace(data(), '2027-03', TODAY)).toEqual([]);
    expect(monthPace(data(), '2027-01', TODAY)).toHaveLength(31);
  });
});

describe('fixed bills outlook', () => {
  it('drops a bill when it ends and lists the ones that end', () => {
    const o = billsOutlook(data(), '2027-01', 3);
    expect(o.monthly.map((m) => m.cents)).toEqual([128_000, 125_000, 125_000]);
    expect(o.totalNowCents).toBe(128_000);
    expect(o.ending.map((e) => [e.bill.name, e.lastMonth])).toEqual([['Gym', '2027-01']]);
    expect(billsOutlook(data(), '2027-02', 2).ending).toEqual([]);
  });
});

describe('debt by month', () => {
  it('adds up balances, interest and payments across debts', () => {
    const d = data();
    d.cards = [
      { id: 'v', name: 'Test Visa', aprBps: 2400, startBalanceCents: 100_000, startMonth: '2027-01', payments: [{ id: 'a', date: '2027-01-20', amountCents: 30_000 }] },
    ];
    const rows = debtByMonth(d, TODAY);
    expect(rows.map((r) => [r.month, r.balanceCents, r.interestCents, r.paymentsCents])).toEqual([
      ['2027-01', 71_400, 1_400, 30_000],
      ['2027-02', 71_400, 0, 0], // the current month: interest is not posted yet
    ]);
    expect(debtByMonth(data(), TODAY)).toEqual([]);
  });
});

describe('your own charts', () => {
  const chart = (patch: Partial<CustomChart>): CustomChart => ({ id: 'c', title: 't', metric: 'spent', groupBy: 'month', kind: 'bar', range: 'all', ...patch });
  it('charts spending by month, optionally for one category', () => {
    expect(chartData(chart({}), data(), TODAY).points.map((p) => p.value)).toEqual([23_575, 47_000]);
    expect(chartData(chart({ categoryId: 'food' }), data(), TODAY).points.map((p) => p.value)).toEqual([18_075, 45_000]);
    expect(chartData(chart({ metric: 'count' }), data(), TODAY)).toMatchObject({ money: false, points: [{ value: 4 }, { value: 2 }] });
  });
  it('charts the month figures', () => {
    const v = (metric: CustomChart['metric']) => chartData(chart({ metric }), data(), TODAY).points.map((p) => p.value);
    expect(v('income')).toEqual([300_000, 180_000]);
    expect(v('bills')).toEqual([125_520, 120_000]);
    expect(v('saved')).toEqual([150_905, 13_000]);
    expect(v('balance')).toEqual([350_905, 363_905]);
    expect(v('debt')).toEqual([0, 0]);
  });
  it('groups by category, paid with and weekday', () => {
    const cats = chartData(chart({ groupBy: 'category', kind: 'donut' }), data(), TODAY);
    expect(cats.points.map((p) => [p.label, p.value, p.color])).toEqual([['Food', 63_075, 'c1'], ['Fun', 6_500, 'c2'], ['Other', 1_000, 'c3']]);
    expect(chartData(chart({ groupBy: 'paidWith', kind: 'donut' }), data(), TODAY).points.map((p) => p.label)).toEqual(['Card B', 'Card A', 'No method']);
    expect(chartData(chart({ groupBy: 'weekday' }), data(), TODAY).points).toHaveLength(7);
  });
  it('limits the range', () => {
    expect(chartData(chart({ range: '3' }), data(), TODAY).points).toHaveLength(2);
    expect(chartData(chart({}), data(), '2026-12-10').points).toEqual([]);
  });
  it('explains combinations that do not make sense', () => {
    expect(chartProblem(chart({}))).toBeUndefined();
    expect(chartProblem(chart({ metric: 'income', groupBy: 'category', kind: 'bar' }))).toMatch(/only be shown by month/);
    expect(chartProblem(chart({ groupBy: 'month', kind: 'donut' }))).toMatch(/share chart/);
    expect(chartProblem(chart({ groupBy: 'category', kind: 'line' }))).toMatch(/line follows time/);
    expect(chartProblem(chart({ groupBy: 'weekday', kind: 'line' }))).toBeUndefined();
  });
  it('checks a chart read from a backup', () => {
    expect(isCustomChart(chart({}))).toBe(true);
    expect(isCustomChart(chart({ categoryId: 'food' }))).toBe(true);
    expect(isCustomChart({ ...chart({}), metric: 'nope' })).toBe(false);
    expect(isCustomChart(null)).toBe(false);
  });
});
