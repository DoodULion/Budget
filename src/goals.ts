/**
 * Goals for the year, scored from what is already in the app. Pure: no UI.
 *
 * Monthly goals are checked month by month over the year's started months (as the Year view counts them):
 * save at least an amount, keep spending or one category at or under an amount, pay every bill.
 * Target goals have one finish line: save an amount this year, reach a checking balance by a month, pay off a debt by a month.
 * The savings goal and the spending budget from Setup are always scored; goals you add sit with them (`Settings.goals`).
 */
import { cardSummary, linkedBills } from './cards';
import {
  addMonths,
  checkingBalanceNowCents,
  monthRange,
  monthSummary,
  purchasesIn,
  roundDiv,
  spendingBudgetCents,
  thisMonth,
  type Cents,
  type Data,
  type DateKey,
  type MonthKey,
} from './calc';

export type Goal =
  | { id: string; kind: 'save-month'; amountCents: Cents }
  | { id: string; kind: 'spend-month'; amountCents: Cents }
  | { id: string; kind: 'category-month'; categoryId: string; amountCents: Cents }
  | { id: string; kind: 'bills-paid' }
  | { id: string; kind: 'save-year'; amountCents: Cents }
  | { id: string; kind: 'cash'; amountCents: Cents; by: MonthKey }
  | { id: string; kind: 'debt-off'; debtId: string; by: MonthKey };

export type GoalKind = Goal['kind'];
export const MONTHLY_KINDS: GoalKind[] = ['save-month', 'spend-month', 'category-month', 'bills-paid'];

/** met / missed are final; pending is the month in progress that hasn't met it yet (there's still time); future hasn't started. */
export type MonthState = 'met' | 'missed' | 'pending' | 'future';

export interface MonthlyResult {
  type: 'monthly';
  months: { month: MonthKey; state: MonthState }[];
  met: number;
  /** Months that count: met or missed. */
  of: number;
  /** Months met in a row, counting back from the latest month that counts. */
  streak: number;
}

export interface TargetResult {
  type: 'target';
  /** Where it stands now (saved this year, checking balance, or what is still owed). */
  nowCents: Cents;
  targetCents: Cents;
  /** 0 to 1. */
  progress: number;
  done: boolean;
  /** Months left to the finish line, this month included. */
  monthsLeft: number;
  /** What it takes a month from here (to save, or to pay). */
  neededPerMonthCents: Cents;
  /** On pace at what you've been doing (the average saved, or the debt's payments). */
  onTrack: boolean;
  by: MonthKey;
}

export type GoalResult = MonthlyResult | TargetResult;

const yearMonths = (data: Data, year: string): MonthKey[] => {
  const from = `${year}-01` < data.settings.firstMonth ? data.settings.firstMonth : `${year}-01`;
  return from > `${year}-12` ? [] : monthRange(from, `${year}-12`);
};

/** The year's started months (none in the future). */
function countedMonths(data: Data, year: string, today: DateKey): MonthKey[] {
  return yearMonths(data, year).filter((m) => !monthSummary(data, m, today).future);
}

function monthly(data: Data, year: string, today: DateKey, test: (m: MonthKey) => boolean, canRecover: boolean): MonthlyResult {
  const current = thisMonth(data.settings, today);
  const months = yearMonths(data, year).map((month) => {
    if (monthSummary(data, month, today).future) return { month, state: 'future' as const };
    const ok = test(month);
    const state: MonthState = ok ? 'met' : month === current && canRecover ? 'pending' : 'missed';
    return { month, state };
  });
  const scored = months.filter((m) => m.state === 'met' || m.state === 'missed');
  let streak = 0;
  for (let i = scored.length - 1; i >= 0 && scored[i].state === 'met'; i--) streak++;
  return { type: 'monthly', months, met: scored.filter((m) => m.state === 'met').length, of: scored.length, streak };
}

const monthsBetween = (from: MonthKey, to: MonthKey) => (to < from ? 0 : monthRange(from, to).length);

/** The average saved over the year's started months. */
export function averageSavedCents(data: Data, today: DateKey): Cents {
  const year = thisMonth(data.settings, today).slice(0, 4);
  const months = countedMonths(data, year, today);
  if (!months.length) return 0;
  return roundDiv(months.reduce((s, m) => s + (monthSummary(data, m, today).savedCents ?? 0), 0), months.length);
}

export function scoreGoal(data: Data, goal: Goal, today: DateKey): GoalResult {
  const current = thisMonth(data.settings, today);
  const year = current.slice(0, 4);
  const saved = (m: MonthKey) => monthSummary(data, m, today).savedCents ?? 0;
  switch (goal.kind) {
    case 'save-month':
      return monthly(data, year, today, (m) => saved(m) >= goal.amountCents, true);
    case 'spend-month':
      return monthly(data, year, today, (m) => monthSummary(data, m, today).spentCents <= goal.amountCents, false);
    case 'category-month':
      return monthly(data, year, today, (m) => purchasesIn(data, m).filter((p) => p.categoryId === goal.categoryId).reduce((s, p) => s + p.amountCents, 0) <= goal.amountCents, false);
    case 'bills-paid':
      return monthly(data, year, today, (m) => monthSummary(data, m, today).unpaidCount === 0, true);
    case 'save-year': {
      const nowCents = countedMonths(data, year, today).reduce((s, m) => s + saved(m), 0);
      return target(nowCents, goal.amountCents, `${year}-12`, current, averageSavedCents(data, today));
    }
    case 'cash':
      return target(checkingBalanceNowCents(data, today), goal.amountCents, goal.by, current, averageSavedCents(data, today));
    case 'debt-off': {
      const card = data.cards.find((c) => c.id === goal.debtId);
      if (!card) return { type: 'target', nowCents: 0, targetCents: 0, progress: 1, done: true, monthsLeft: 0, neededPerMonthCents: 0, onTrack: true, by: goal.by };
      const s = cardSummary(card, data.purchases, today, linkedBills(card, data, today), data.settings.firstMonth);
      const owed = Math.max(0, s.balanceNowCents);
      const start = Math.max(owed, card.startBalanceCents);
      const left = Math.max(1, monthsBetween(current, goal.by));
      // what goes to it a month now: the planned payment, else its minimum or linked bills
      const bills = data.bills.filter((b) => !b.deleted && b.cardId === card.id).reduce((t, b) => t + b.amountCents, 0);
      const paying = card.plannedPaymentCents ?? (bills || card.minPaymentCents || 0);
      const needed = roundDiv(owed, left);
      return { type: 'target', nowCents: owed, targetCents: 0, progress: start > 0 ? (start - owed) / start : 1, done: owed === 0, monthsLeft: monthsBetween(current, goal.by), neededPerMonthCents: needed, onTrack: owed === 0 || paying >= needed, by: goal.by };
    }
  }
}

function target(nowCents: Cents, targetCents: Cents, by: MonthKey, current: MonthKey, avgCents: Cents): TargetResult {
  const done = nowCents >= targetCents;
  const monthsLeft = monthsBetween(current, by);
  const neededPerMonthCents = done ? 0 : roundDiv(targetCents - nowCents, Math.max(1, monthsLeft));
  return { type: 'target', nowCents, targetCents, progress: targetCents > 0 ? Math.max(0, Math.min(1, nowCents / targetCents)) : 1, done, monthsLeft, neededPerMonthCents, onTrack: done || (monthsLeft > 0 && avgCents >= neededPerMonthCents), by };
}

/** The goals always scored, from Setup: the savings goal and the spending budget. */
export function builtInGoals(data: Data): Goal[] {
  const out: Goal[] = [];
  if (data.settings.savingsGoalCents > 0) out.push({ id: 'builtin:save', kind: 'save-month', amountCents: data.settings.savingsGoalCents });
  const budget = spendingBudgetCents(data.categories);
  if (budget > 0) out.push({ id: 'builtin:spend', kind: 'spend-month', amountCents: budget });
  return out;
}

export interface YearInsights {
  year: string;
  monthsCounted: number;
  savedCents: Cents;
  /** Savings goal × months counted. */
  goalToDateCents: Cents;
  avgSavedCents: Cents;
  best?: { month: MonthKey; savedCents: Cents };
  worst?: { month: MonthKey; savedCents: Cents };
  /** Category budgets kept: months a category stayed at or under its budget, out of category-months. */
  categoryKept: number;
  categoryOf: number;
  /** The category over its budget most often (by total over) this year. */
  mostOver?: { categoryId: string; months: number; overCents: Cents };
  /** To save the savings goal × 12 this year, what each month left needs. */
  yearGoalCents: Cents;
  neededPerMonthCents: Cents;
  monthsLeft: number;
}

export function yearInsights(data: Data, today: DateKey): YearInsights {
  const current = thisMonth(data.settings, today);
  const year = current.slice(0, 4);
  const months = countedMonths(data, year, today);
  const rows = months.map((m) => monthSummary(data, m, today));
  const savedCents = rows.reduce((s, r) => s + (r.savedCents ?? 0), 0);
  let best: YearInsights['best'];
  let worst: YearInsights['worst'];
  for (const r of rows) {
    const v = r.savedCents ?? 0;
    if (!best || v > best.savedCents) best = { month: r.month, savedCents: v };
    if (!worst || v < worst.savedCents) worst = { month: r.month, savedCents: v };
  }
  let categoryKept = 0;
  let categoryOf = 0;
  const over = new Map<string, { months: number; overCents: Cents }>();
  for (const r of rows)
    for (const c of r.byCategory) {
      if (c.category.deleted || c.budgetCents <= 0) continue;
      categoryOf++;
      if (c.leftCents >= 0) categoryKept++;
      else {
        const o = over.get(c.category.id) ?? { months: 0, overCents: 0 };
        over.set(c.category.id, { months: o.months + 1, overCents: o.overCents - c.leftCents });
      }
    }
  const mostOver = [...over.entries()].sort((a, b) => b[1].months - a[1].months || b[1].overCents - a[1].overCents)[0];
  const yearGoalCents = data.settings.savingsGoalCents * yearMonths(data, year).length;
  // months still to come this year, after the latest started month
  const last = months[months.length - 1];
  const monthsLeft = last ? monthsBetween(addMonths(last, 1), `${year}-12`) : yearMonths(data, year).length;
  return {
    year,
    monthsCounted: months.length,
    savedCents,
    goalToDateCents: data.settings.savingsGoalCents * months.length,
    avgSavedCents: months.length ? roundDiv(savedCents, months.length) : 0,
    best: rows.length > 1 ? best : undefined,
    worst: rows.length > 1 ? worst : undefined,
    categoryKept,
    categoryOf,
    mostOver: mostOver ? { categoryId: mostOver[0], ...mostOver[1] } : undefined,
    yearGoalCents,
    neededPerMonthCents: monthsLeft > 0 && savedCents < yearGoalCents ? roundDiv(yearGoalCents - savedCents, monthsLeft) : 0,
    monthsLeft,
  };
}
