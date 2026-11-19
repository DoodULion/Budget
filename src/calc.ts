/**
 * All budget math, as pure functions with no UI code. CLAUDE.md is the behavior authority;
 * each rule here matches a formula in the original "Monthly Budget Tracker" spreadsheet.
 *
 * Money is integer cents. Dates are local `YYYY-MM-DD` strings and months `YYYY-MM`,
 * compared as strings, never through time zones.
 */

export type Cents = number;
/** `YYYY-MM` */
export type MonthKey = string;
/** `YYYY-MM-DD` */
export type DateKey = string;

export interface Settings {
  /** Monthly income the budget is planned on. A month with no income typed in uses this. */
  incomeBaselineCents: Cents;
  /** Minimum to save each month. */
  savingsGoalCents: Cents;
  /** Checking balance before the first month. */
  startingBalanceCents: Cents;
  /** First month tracked. */
  firstMonth: MonthKey;
  /** Payment methods offered on a purchase ("Paid with"). */
  paidWith: string[];
  /** False until the first-run setup is finished. */
  setupDone: boolean;
}

export interface Bill {
  id: string;
  name: string;
  amountCents: Cents;
  /** The bill ends after this month (e.g. a loan's final payment). */
  lastMonth?: MonthKey;
  note?: string;
  /** Removed from the list: hidden from months where it has no payment recorded. */
  deleted?: boolean;
}

export interface Category {
  id: string;
  name: string;
  budgetCents: Cents;
  color: string;
  /** No longer offered; stays on past purchases and in their totals. */
  deleted?: boolean;
}

export interface BillPayment {
  datePaid?: DateKey;
  amountPaidCents?: Cents;
}

export interface Month {
  month: MonthKey;
  /** Income actually received; blank means the baseline. */
  incomeCents?: Cents;
  /** Keyed by bill id. */
  payments: Record<string, BillPayment>;
}

export interface Purchase {
  id: string;
  date: DateKey;
  categoryId: string;
  amountCents: Cents;
  description?: string;
  paidWith?: string;
  note?: string;
}

export interface Data {
  settings: Settings;
  bills: Bill[];
  categories: Category[];
  months: Month[];
  purchases: Purchase[];
}

/** Suggested category names for the first-run setup. Names only: budgets start empty. */
export const SUGGESTED_CATEGORIES = ['Food', 'Shopping', 'Entertainment', 'Misc'];

/** Category tile colors, assigned in order (a fixed, distinguishable set). */
export const CATEGORY_COLORS = ['#d9480f', '#b83280', '#1f74c7', '#6b46c1', '#0f8a5f', '#b7791f', '#78716c', '#c2410c'];

export function emptySettings(firstMonth: MonthKey): Settings {
  return {
    incomeBaselineCents: 0,
    savingsGoalCents: 0,
    startingBalanceCents: 0,
    firstMonth,
    paidWith: [],
    setupDone: false,
  };
}

/* ---------- months and dates ---------- */

export function monthOf(date: DateKey): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Months from `from` through `to`, inclusive. Empty when `to` is before `from`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** A month is in the future when its first day is after today (spreadsheet: month > TODAY()). */
export function isFutureMonth(month: MonthKey, today: DateKey): boolean {
  return `${month}-01` > today;
}

/** The current month, or the first tracked month while today is before it. */
export function thisMonth(settings: Settings, today: DateKey): MonthKey {
  const m = monthOf(today);
  return m < settings.firstMonth ? settings.firstMonth : m;
}

/** Started months: from the first month through the current one. These count toward year figures. */
export function startedMonths(settings: Settings, today: DateKey): MonthKey[] {
  return monthRange(settings.firstMonth, monthOf(today));
}

/** Round a ÷ b to the nearest whole number, halves away from zero. */
export function roundDiv(a: number, b: number): number {
  const q = Math.round(Math.abs(a) / Math.abs(b));
  return Math.sign(a) * Math.sign(b) < 0 ? -q : q;
}

/* ---------- bills ---------- */

export type BillStatus = 'paid' | 'unpaid' | 'ended';

export function isBillActive(bill: Bill, month: MonthKey): boolean {
  return bill.lastMonth === undefined || bill.lastMonth >= month;
}

export function billStatus(bill: Bill, month: MonthKey, payment?: BillPayment): BillStatus {
  if (!isBillActive(bill, month)) return 'ended';
  return payment?.datePaid !== undefined || payment?.amountPaidCents !== undefined ? 'paid' : 'unpaid';
}

export interface BillRow {
  bill: Bill;
  /** The bill's amount this month (0 once ended). */
  amountCents: Cents;
  status: BillStatus;
  payment?: BillPayment;
  /** What counts toward Bills paid: amount paid if entered, else the amount; 0 unless paid. */
  countedCents: Cents;
}

export function findMonth(data: Data, month: MonthKey): Month | undefined {
  return data.months.find((m) => m.month === month);
}

export function billRows(data: Data, month: MonthKey): BillRow[] {
  const rec = findMonth(data, month);
  const rows: BillRow[] = [];
  for (const bill of data.bills) {
    const payment = rec?.payments[bill.id];
    const status = billStatus(bill, month, payment);
    if (bill.deleted && status !== 'paid') continue;
    const amountCents = status === 'ended' ? 0 : bill.amountCents;
    const countedCents = status === 'paid' ? (payment?.amountPaidCents ?? bill.amountCents) : 0;
    rows.push({ bill, amountCents, status, payment, countedCents });
  }
  return rows;
}

/* ---------- categories and purchases ---------- */

export function spendingBudgetCents(categories: Category[]): Cents {
  return categories.filter((c) => !c.deleted).reduce((s, c) => s + c.budgetCents, 0);
}

export function purchasesIn(data: Data, month: MonthKey): Purchase[] {
  return data.purchases.filter((p) => monthOf(p.date) === month);
}

export interface CategoryRow {
  category: Category;
  budgetCents: Cents;
  spentCents: Cents;
  leftCents: Cents;
}

/** Each offered category, plus any deleted one that has spending in these purchases. */
export function categoryRows(categories: Category[], purchases: Purchase[]): CategoryRow[] {
  const spent = new Map<string, Cents>();
  for (const p of purchases) spent.set(p.categoryId, (spent.get(p.categoryId) ?? 0) + p.amountCents);
  return categories
    .filter((c) => !c.deleted || (spent.get(c.id) ?? 0) !== 0)
    .map((category) => {
      const budgetCents = category.deleted ? 0 : category.budgetCents;
      const spentCents = spent.get(category.id) ?? 0;
      return { category, budgetCents, spentCents, leftCents: budgetCents - spentCents };
    });
}

/* ---------- one month ---------- */

export interface MonthSummary {
  month: MonthKey;
  incomeCents: Cents;
  /** True when no income was typed in and the baseline is used. */
  incomeIsBaseline: boolean;
  bills: BillRow[];
  billsPaidCents: Cents;
  unpaidCount: number;
  spendingBudgetCents: Cents;
  spentCents: Cents;
  budgetLeftCents: Cents;
  byCategory: CategoryRow[];
  future: boolean;
  /** Income − bills paid − spent. Undefined for a future month. */
  savedCents?: Cents;
  /** Saved − savings goal. Undefined for a future month. */
  vsGoalCents?: Cents;
}

export function monthSummary(data: Data, month: MonthKey, today: DateKey): MonthSummary {
  const { settings } = data;
  const rec = findMonth(data, month);
  const incomeIsBaseline = rec?.incomeCents === undefined;
  const incomeCents = rec?.incomeCents ?? settings.incomeBaselineCents;
  const bills = billRows(data, month);
  const billsPaidCents = bills.reduce((s, r) => s + r.countedCents, 0);
  const unpaidCount = bills.filter((r) => r.status === 'unpaid').length;
  const purchases = purchasesIn(data, month);
  const spentCents = purchases.reduce((s, p) => s + p.amountCents, 0);
  const budget = spendingBudgetCents(data.categories);
  const future = isFutureMonth(month, today);
  const savedCents = future ? undefined : incomeCents - billsPaidCents - spentCents;
  return {
    month,
    incomeCents,
    incomeIsBaseline,
    bills,
    billsPaidCents,
    unpaidCount,
    spendingBudgetCents: budget,
    spentCents,
    budgetLeftCents: budget - spentCents,
    byCategory: categoryRows(data.categories, purchases),
    future,
    savedCents,
    vsGoalCents: savedCents === undefined ? undefined : savedCents - settings.savingsGoalCents,
  };
}

/* ---------- planning (Setup) ---------- */

/** Income baseline − bills active that month − savings goal. */
export function leftForSpendingCents(data: Data, month: MonthKey): Cents {
  const bills = data.bills.filter((b) => !b.deleted && isBillActive(b, month)).reduce((s, b) => s + b.amountCents, 0);
  return data.settings.incomeBaselineCents - bills - data.settings.savingsGoalCents;
}

/** True when the category budgets add up to more than Left for spending that month. */
export function budgetTooHigh(data: Data, month: MonthKey): boolean {
  return spendingBudgetCents(data.categories) > leftForSpendingCents(data, month);
}

/** Total of bills that have a last month: money that becomes savings once they end. */
export function freedUpCents(bills: Bill[]): Cents {
  return bills.filter((b) => !b.deleted && b.lastMonth !== undefined).reduce((s, b) => s + b.amountCents, 0);
}

/* ---------- year ---------- */

export interface YearMonthRow {
  summary: MonthSummary;
  /** Checking balance after this month. Undefined for a future month. */
  balanceCents?: Cents;
}

export interface YearCategoryRow {
  category: Category;
  budgetCents: Cents;
  thisMonthCents: Cents;
  leftThisMonthCents: Cents;
  totalCents: Cents;
  avgPerMonthCents: Cents;
  /** Spent per month of the year, in the order of `YearSummary.rows`. */
  perMonthCents: Cents[];
}

export interface YearSummary {
  year: number;
  /** Tracked months of that calendar year (none before the first month). */
  rows: YearMonthRow[];
  thisMonth: MonthKey;
  savedToDateCents: Cents;
  monthsGoalMet: number;
  monthsCounted: number;
  /** "x of y" */
  monthsGoalMetLabel: string;
  checkingBalanceNowCents: Cents;
  categories: YearCategoryRow[];
}

/** Checking balance after each started month, carried forward from the starting balance. */
export function balances(data: Data, today: DateKey): Map<MonthKey, Cents> {
  const out = new Map<MonthKey, Cents>();
  let bal = data.settings.startingBalanceCents;
  for (const m of startedMonths(data.settings, today)) {
    bal += monthSummary(data, m, today).savedCents ?? 0;
    out.set(m, bal);
  }
  return out;
}

export function checkingBalanceNowCents(data: Data, today: DateKey): Cents {
  const all = [...balances(data, today).values()];
  return all.length ? all[all.length - 1] : data.settings.startingBalanceCents;
}

export function yearSummary(data: Data, year: number, today: DateKey): YearSummary {
  const { settings } = data;
  const from = `${year}-01` < settings.firstMonth ? settings.firstMonth : `${year}-01`;
  const months = monthRange(from, `${year}-12`);
  const bal = balances(data, today);
  const rows: YearMonthRow[] = months.map((m) => ({ summary: monthSummary(data, m, today), balanceCents: bal.get(m) }));
  const counted = rows.filter((r) => !r.summary.future);
  const monthsGoalMet = counted.filter((r) => (r.summary.vsGoalCents ?? -1) >= 0).length;
  const savedToDateCents = counted.reduce((s, r) => s + (r.summary.savedCents ?? 0), 0);
  const current = thisMonth(settings, today);

  const yearPurchases = data.purchases.filter((p) => monthOf(p.date) >= from && monthOf(p.date) <= `${year}-12`);
  const currentPurchases = purchasesIn(data, current);
  const divisor = Math.max(1, counted.length);
  const categories = categoryRows(data.categories, yearPurchases).map((row): YearCategoryRow => {
    const now = currentPurchases.filter((p) => p.categoryId === row.category.id).reduce((s, p) => s + p.amountCents, 0);
    const perMonthCents = rows.map((r) =>
      purchasesIn(data, r.summary.month)
        .filter((p) => p.categoryId === row.category.id)
        .reduce((s, p) => s + p.amountCents, 0),
    );
    return {
      category: row.category,
      budgetCents: row.budgetCents,
      thisMonthCents: now,
      leftThisMonthCents: row.budgetCents - now,
      totalCents: row.spentCents,
      avgPerMonthCents: roundDiv(row.spentCents, divisor),
      perMonthCents,
    };
  });

  return {
    year,
    rows,
    thisMonth: current,
    savedToDateCents,
    monthsGoalMet,
    monthsCounted: counted.length,
    monthsGoalMetLabel: `${monthsGoalMet} of ${counted.length}`,
    checkingBalanceNowCents: checkingBalanceNowCents(data, today),
    categories,
  };
}

/* ---------- display ---------- */

/** 123456 -> "$1,234.56"; negatives as "−$50.00". */
export function formatCents(cents: Cents): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '−' : ''}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** "2027-02" -> "Feb 2027" */
export function monthLabel(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
