/**
 * Numbers behind the Analytics tab. Pure functions over the data, no UI.
 * Money is integer cents; months are YYYY-MM and dates YYYY-MM-DD, compared as strings.
 */
import { addMonths, monthLabel, monthOf, monthRange, monthSummary, purchasesIn, roundDiv, startedMonths, type Bill, type Cents, type Data, type DateKey, type MonthKey, type Purchase } from './calc';
import { cardSummary, linkedBills } from './cards';

/* ---------- ranges ---------- */

export type Range = '3' | '6' | '12' | 'all';
export const RANGES: { id: Range; label: string }[] = [
  { id: '3', label: '3 months' },
  { id: '6', label: '6 months' },
  { id: '12', label: '12 months' },
  { id: 'all', label: 'All time' },
];

/** The started months in the range, ending with the current month (none before the first tracked month). */
export function rangeMonths(data: Data, today: DateKey, range: Range): MonthKey[] {
  const all = startedMonths(data.settings, today);
  return range === 'all' ? all : all.slice(-Number(range));
}

/* ---------- money flow ---------- */

export interface MonthFlow {
  month: MonthKey;
  incomeCents: Cents;
  billsCents: Cents;
  spentCents: Cents;
  savedCents: Cents;
  /** Checking balance at the end of the month (starting balance with every month up to it applied). */
  balanceCents: Cents;
  /** Saved − the savings goal. */
  vsGoalCents: Cents;
}

/** Income, bills paid, spending, saved and balance for each started month. The balance carries forward from the first month. */
export function monthFlows(data: Data, today: DateKey): MonthFlow[] {
  let balance = data.settings.startingBalanceCents;
  return startedMonths(data.settings, today).map((month) => {
    const s = monthSummary(data, month, today);
    const saved = s.savedCents ?? 0;
    balance += saved;
    return { month, incomeCents: s.incomeCents, billsCents: s.billsPaidCents, spentCents: s.spentCents, savedCents: saved, balanceCents: balance, vsGoalCents: saved - data.settings.savingsGoalCents };
  });
}

export interface FlowStats {
  months: number;
  avgIncomeCents: Cents;
  avgBillsCents: Cents;
  avgSpentCents: Cents;
  avgSavedCents: Cents;
  totalSavedCents: Cents;
  /** Saved ÷ income over the range, as a whole percent (0 when there was no income). */
  savingsRatePct: number;
  goalMet: number;
  best?: MonthFlow;
  worst?: MonthFlow;
}

export function flowStats(flows: MonthFlow[]): FlowStats {
  const n = flows.length;
  const sum = (f: (m: MonthFlow) => number) => flows.reduce((s, m) => s + f(m), 0);
  const income = sum((m) => m.incomeCents);
  const saved = sum((m) => m.savedCents);
  const avg = (total: number) => (n ? roundDiv(total, n) : 0);
  const sorted = [...flows].sort((a, b) => b.savedCents - a.savedCents);
  return {
    months: n,
    avgIncomeCents: avg(income),
    avgBillsCents: avg(sum((m) => m.billsCents)),
    avgSpentCents: avg(sum((m) => m.spentCents)),
    avgSavedCents: avg(saved),
    totalSavedCents: saved,
    savingsRatePct: income > 0 ? Math.round((saved / income) * 100) : 0,
    goalMet: flows.filter((m) => m.vsGoalCents >= 0).length,
    best: sorted[0],
    worst: n > 1 ? sorted[n - 1] : undefined,
  };
}

/* ---------- spending ---------- */

export interface Slice {
  key: string;
  label: string;
  cents: Cents;
  /** A category color token (c1…c8), when the slice is a category. */
  color?: string;
}

const inMonths = (months: MonthKey[]) => {
  const set = new Set(months);
  return (p: Purchase) => set.has(monthOf(p.date));
};

export function purchasesInMonths(data: Data, months: MonthKey[]): Purchase[] {
  return data.purchases.filter(inMonths(months));
}

/** Spending by category over the months, largest first. A deleted category keeps its past spending. */
export function spendByCategory(data: Data, months: MonthKey[]): Slice[] {
  const totals = new Map<string, Cents>();
  for (const p of purchasesInMonths(data, months)) totals.set(p.categoryId, (totals.get(p.categoryId) ?? 0) + p.amountCents);
  return [...totals.entries()]
    .map(([id, cents]) => {
      const c = data.categories.find((x) => x.id === id);
      return { key: id, label: c?.name ?? 'Deleted category', cents, color: c?.color ?? 'c8' };
    })
    .sort((a, b) => b.cents - a.cents);
}

export const NO_METHOD = 'No method';

/** Spending by "Paid with", largest first. Purchases without one are grouped as "No method". */
export function spendByPaidWith(data: Data, months: MonthKey[]): Slice[] {
  const totals = new Map<string, Cents>();
  for (const p of purchasesInMonths(data, months)) {
    const k = p.paidWith || NO_METHOD;
    totals.set(k, (totals.get(k) ?? 0) + p.amountCents);
  }
  return [...totals.entries()].map(([key, cents]) => ({ key, label: key, cents })).sort((a, b) => b.cents - a.cents);
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** 0 = Monday … 6 = Sunday, from the date text alone (no time zones). */
export function weekdayIndex(date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Spending and purchase counts by day of the week, Monday first. */
export function spendByWeekday(data: Data, months: MonthKey[]): { label: string; cents: Cents; count: number }[] {
  const out = WEEKDAYS.map((label) => ({ label: label as string, cents: 0, count: 0 }));
  for (const p of purchasesInMonths(data, months)) {
    const w = out[weekdayIndex(p.date)];
    w.cents += p.amountCents;
    w.count += 1;
  }
  return out;
}

export interface SpendStats {
  totalCents: Cents;
  count: number;
  avgPerMonthCents: Cents;
  avgPerDayCents: Cents;
  avgPurchaseCents: Cents;
  biggest?: Purchase;
  topCategory?: Slice;
}

const daysIn = (month: MonthKey) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Days of the range that have started (the current month counts through today). */
export function daysCovered(months: MonthKey[], today: DateKey): number {
  return months.reduce((n, m) => n + (m === monthOf(today) ? Number(today.slice(8, 10)) : m < monthOf(today) ? daysIn(m) : 0), 0);
}

export function spendStats(data: Data, months: MonthKey[], today: DateKey): SpendStats {
  const ps = purchasesInMonths(data, months);
  const total = ps.reduce((s, p) => s + p.amountCents, 0);
  const days = daysCovered(months, today);
  return {
    totalCents: total,
    count: ps.length,
    avgPerMonthCents: months.length ? roundDiv(total, months.length) : 0,
    avgPerDayCents: days ? roundDiv(total, days) : 0,
    avgPurchaseCents: ps.length ? roundDiv(total, ps.length) : 0,
    biggest: [...ps].sort((a, b) => b.amountCents - a.amountCents || (a.date < b.date ? 1 : -1))[0],
    topCategory: spendByCategory(data, months)[0],
  };
}

export function topPurchases(data: Data, months: MonthKey[], n: number): Purchase[] {
  return [...purchasesInMonths(data, months)].sort((a, b) => b.amountCents - a.amountCents || (a.date < b.date ? 1 : -1)).slice(0, n);
}

/** Per month: what each category spent, for a stacked chart. Only categories with spending in the range. */
export function categoryByMonth(data: Data, months: MonthKey[]): { categories: Slice[]; rows: { month: MonthKey; byCategory: Cents[] }[] } {
  const categories = spendByCategory(data, months);
  const rows = months.map((month) => {
    const ps = purchasesIn(data, month);
    return { month, byCategory: categories.map((c) => ps.filter((p) => p.categoryId === c.key).reduce((s, p) => s + p.amountCents, 0)) };
  });
  return { categories, rows };
}

/** Running spending through a month, one point per day up to today (or the month's end), against an even pace of the spending budget. */
export function monthPace(data: Data, month: MonthKey, today: DateKey): { day: number; cents: Cents; paceCents: Cents }[] {
  const total = daysIn(month);
  const last = month === monthOf(today) ? Number(today.slice(8, 10)) : month < monthOf(today) ? total : 0;
  const budget = data.categories.filter((c) => !c.deleted).reduce((s, c) => s + c.budgetCents, 0);
  const byDay = new Map<number, Cents>();
  for (const p of purchasesIn(data, month)) byDay.set(Number(p.date.slice(8, 10)), (byDay.get(Number(p.date.slice(8, 10))) ?? 0) + p.amountCents);
  const out: { day: number; cents: Cents; paceCents: Cents }[] = [];
  let run = 0;
  for (let day = 1; day <= last; day++) {
    run += byDay.get(day) ?? 0;
    out.push({ day, cents: run, paceCents: roundDiv(budget * day, total) });
  }
  return out;
}

/* ---------- fixed bills ---------- */

export interface BillsOutlook {
  /** What the bills add up to in each of the next months (this month first), as they end. */
  monthly: { month: MonthKey; cents: Cents }[];
  /** Bills with a last month, soonest first. */
  ending: { bill: Bill; lastMonth: MonthKey }[];
  totalNowCents: Cents;
}

/** The fixed bills going forward: the monthly total each month for a year, and when bills end. */
export function billsOutlook(data: Data, from: MonthKey, months = 12): BillsOutlook {
  const live = data.bills.filter((b) => !b.deleted);
  const active = (b: Bill, m: MonthKey) => !b.lastMonth || b.lastMonth >= m;
  const monthly = monthRange(from, addMonths(from, months - 1)).map((month) => ({ month, cents: live.filter((b) => active(b, month)).reduce((s, b) => s + b.amountCents, 0) }));
  const ending = live.filter((b) => b.lastMonth && b.lastMonth >= from).map((b) => ({ bill: b, lastMonth: b.lastMonth! })).sort((a, b) => (a.lastMonth < b.lastMonth ? -1 : 1));
  return { monthly, ending, totalNowCents: monthly[0]?.cents ?? 0 };
}

/* ---------- debts ---------- */

export interface DebtMonth {
  month: MonthKey;
  balanceCents: Cents;
  interestCents: Cents;
  paymentsCents: Cents;
}

/** All debts together: what is owed at each month's end, the interest added and the payments made. */
export function debtByMonth(data: Data, today: DateKey): DebtMonth[] {
  if (data.cards.length === 0) return [];
  const summaries = data.cards.map((c) => cardSummary(c, data.purchases, today, linkedBills(c, data, today)));
  const first = summaries.map((s) => s.card.startMonth).sort()[0];
  return monthRange(first, monthOf(today)).map((month) => {
    const rows = summaries.map((s) => s.rows.find((r) => r.month === month));
    return {
      month,
      balanceCents: rows.reduce((s, r) => s + (r?.closingCents ?? 0), 0),
      interestCents: rows.reduce((s, r) => s + (r?.interestCents ?? 0), 0),
      paymentsCents: rows.reduce((s, r) => s + (r?.paymentsCents ?? 0), 0),
    };
  });
}

/* ---------- your own charts ---------- */

export type Metric = 'spent' | 'count' | 'income' | 'bills' | 'saved' | 'balance' | 'debt' | 'interest';
export type GroupBy = 'month' | 'category' | 'paidWith' | 'weekday';
export type ChartKind = 'bar' | 'line' | 'donut';

export interface CustomChart {
  id: string;
  title: string;
  metric: Metric;
  groupBy: GroupBy;
  kind: ChartKind;
  range: Range;
  /** Only this category (for spending and purchase counts). */
  categoryId?: string;
}

export const METRICS: { id: Metric; label: string; money: boolean; byAnything: boolean }[] = [
  { id: 'spent', label: 'Spending', money: true, byAnything: true },
  { id: 'count', label: 'Number of purchases', money: false, byAnything: true },
  { id: 'income', label: 'Income', money: true, byAnything: false },
  { id: 'bills', label: 'Bills paid', money: true, byAnything: false },
  { id: 'saved', label: 'Saved', money: true, byAnything: false },
  { id: 'balance', label: 'Checking balance', money: true, byAnything: false },
  { id: 'debt', label: 'Debt owed', money: true, byAnything: false },
  { id: 'interest', label: 'Debt interest', money: true, byAnything: false },
];
export const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'month', label: 'By month' },
  { id: 'category', label: 'By category' },
  { id: 'paidWith', label: 'By paid with' },
  { id: 'weekday', label: 'By weekday' },
];
export const KINDS: { id: ChartKind; label: string }[] = [
  { id: 'bar', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'donut', label: 'Share' },
];

export const metricInfo = (m: Metric) => METRICS.find((x) => x.id === m) ?? METRICS[0];

/** Whether the chart makes sense: only spending and purchase counts can be grouped by anything but month; a share needs groups, not months. */
export function chartProblem(c: Pick<CustomChart, 'metric' | 'groupBy' | 'kind'>): string | undefined {
  if (c.groupBy !== 'month' && !metricInfo(c.metric).byAnything) return `${metricInfo(c.metric).label} can only be shown by month.`;
  if (c.kind === 'donut' && c.groupBy === 'month') return 'A share chart needs a grouping other than month.';
  if (c.kind === 'line' && c.groupBy !== 'month' && c.groupBy !== 'weekday') return 'A line follows time: use By month or By weekday, or pick Bars.';
  return undefined;
}

export interface ChartData {
  points: { key: string; label: string; value: number; color?: string }[];
  money: boolean;
  /** One line describing what is charted. */
  summary: string;
}

/** The points of one custom chart. Balance and debt are month-end figures; the other metrics add up within each group. */
export function chartData(def: CustomChart, data: Data, today: DateKey): ChartData {
  const info = metricInfo(def.metric);
  const months = rangeMonths(data, today, def.range);
  const catName = def.categoryId ? data.categories.find((c) => c.id === def.categoryId)?.name ?? 'Deleted category' : undefined;
  const scope = `${def.range === 'all' ? 'all time' : `last ${def.range} months`}${catName ? `, ${catName}` : ''}`;
  const summary = `${info.label} ${GROUPS.find((g) => g.id === def.groupBy)?.label.toLowerCase()}, ${scope}`;

  if (def.groupBy === 'month') {
    const flows = new Map(monthFlows(data, today).map((f) => [f.month, f]));
    const debt = new Map(debtByMonth(data, today).map((d) => [d.month, d]));
    const points = months.map((m) => {
      const f = flows.get(m);
      const ps = purchasesIn(data, m).filter((p) => !def.categoryId || p.categoryId === def.categoryId);
      let value = 0;
      switch (def.metric) {
        case 'spent':
          value = ps.reduce((s, p) => s + p.amountCents, 0);
          break;
        case 'count':
          value = ps.length;
          break;
        case 'income':
          value = f?.incomeCents ?? 0;
          break;
        case 'bills':
          value = f?.billsCents ?? 0;
          break;
        case 'saved':
          value = f?.savedCents ?? 0;
          break;
        case 'balance':
          value = f?.balanceCents ?? 0;
          break;
        case 'debt':
          value = debt.get(m)?.balanceCents ?? 0;
          break;
        case 'interest':
          value = debt.get(m)?.interestCents ?? 0;
          break;
      }
      return { key: m, label: monthLabel(m), value };
    });
    return { points, money: info.money, summary };
  }

  const ps = purchasesInMonths(data, months).filter((p) => !def.categoryId || p.categoryId === def.categoryId);
  const val = (list: Purchase[]) => (def.metric === 'count' ? list.length : list.reduce((s, p) => s + p.amountCents, 0));
  if (def.groupBy === 'weekday') {
    const points = WEEKDAYS.map((label, i) => ({ key: label, label: label as string, value: val(ps.filter((p) => weekdayIndex(p.date) === i)) }));
    return { points, money: info.money, summary };
  }
  const groups = new Map<string, { label: string; color?: string; list: Purchase[] }>();
  for (const p of ps) {
    const key = def.groupBy === 'category' ? p.categoryId : p.paidWith || NO_METHOD;
    let g = groups.get(key);
    if (!g) {
      const c = def.groupBy === 'category' ? data.categories.find((x) => x.id === key) : undefined;
      g = { label: def.groupBy === 'category' ? c?.name ?? 'Deleted category' : key, color: def.groupBy === 'category' ? c?.color ?? 'c8' : undefined, list: [] };
      groups.set(key, g);
    }
    g.list.push(p);
  }
  const points = [...groups.entries()].map(([key, g]) => ({ key, label: g.label, value: val(g.list), color: g.color })).sort((a, b) => b.value - a.value);
  return { points, money: info.money, summary };
}

/** A starting point for a new chart. */
export const newChart = (id: string): CustomChart => ({ id, title: '', metric: 'spent', groupBy: 'category', kind: 'donut', range: '6' });

/** Checks a chart read from a backup. */
export function isCustomChart(v: unknown): v is CustomChart {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    METRICS.some((m) => m.id === c.metric) &&
    GROUPS.some((g) => g.id === c.groupBy) &&
    KINDS.some((k) => k.id === c.kind) &&
    RANGES.some((r) => r.id === c.range) &&
    (c.categoryId === undefined || typeof c.categoryId === 'string')
  );
}
