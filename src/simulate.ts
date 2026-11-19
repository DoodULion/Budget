/**
 * Spend simulator: projects the months ahead from today's figures, as they stand (the baseline) and with changes I
 * try out (a scenario). Pure functions, no UI code.
 *
 * Each projected month: income (the baseline income), fixed bills active that month, spending (a monthly figure the
 * simulator is given: the category budgets or recent average), and any one-time amounts. Saved = income − bills −
 * spending; cash = last month's cash + saved − one-time expenses + one-time income − lump-sum payoffs.
 *
 * Debts with a payment (their minimum bill or other bills linked to them, plus any extra payment tried out) are paid
 * down month by month like the payoff estimate: the payment comes off, then a month of interest (APR ÷ 12) is added on
 * what is left. A bill that pays a debt costs only what the debt still needs, and nothing once it is gone, which frees
 * that money up. Cards paid in full every month are left out: their charges are already spending.
 */
import { addMonths, checkingBalanceNowCents, isBillActive, isFutureMonth, monthRange, roundDiv, startedMonths, monthSummary, spendingBudgetCents, thisMonth, type Cents, type Data, type DateKey, type MonthKey } from './calc';
import { cardSummary, isLoan, linkedBills, monthlyInterestCents } from './cards';

export type Change =
  /** Pay a debt down from cash at the start of `month`: `amountCents` of it, or the whole balance when that is left out. */
  | { id: string; kind: 'payoff'; debtId: string; month: MonthKey; amountCents?: Cents }
  /** Pay this much more on a debt each month from `from`. */
  | { id: string; kind: 'extra'; debtId: string; amountCents: Cents; from: MonthKey }
  /** A fixed bill costs `amountCents` from `from` on (0 removes it). */
  | { id: string; kind: 'bill'; billId: string; amountCents: Cents; from: MonthKey }
  /** A new fixed bill from `from`, through `to` when set. */
  | { id: string; kind: 'newBill'; name: string; amountCents: Cents; from: MonthKey; to?: MonthKey }
  /** Monthly income becomes `amountCents` from `from` on. */
  | { id: string; kind: 'income'; amountCents: Cents; from: MonthKey }
  /** Monthly spending becomes `amountCents` from `from` on. */
  | { id: string; kind: 'spending'; amountCents: Cents; from: MonthKey }
  /**
   * Take on a new debt in `month`: `amountCents` borrowed at `aprBps`, paid `paymentCents` a month from the next month.
   * With `cashIn` the money lands in checking (a personal loan); otherwise it pays for something directly (a car).
   */
  | { id: string; kind: 'newDebt'; name: string; amountCents: Cents; aprBps: number; paymentCents: Cents; month: MonthKey; cashIn?: boolean }
  /** A one-time expense (or money coming in, with `income`) in `month`. */
  | { id: string; kind: 'oneTime'; name: string; amountCents: Cents; month: MonthKey; income?: boolean };

export interface SimDebt {
  id: string;
  name: string;
  aprBps: number;
  balanceCents: Cents;
}

export interface SimMonth {
  month: MonthKey;
  incomeCents: Cents;
  billsCents: Cents;
  spendingCents: Cents;
  /** Income − bills − spending. */
  savedCents: Cents;
  /** One-time expenses less one-time income, plus lump-sum payoffs. */
  oneTimeCents: Cents;
  cashCents: Cents;
  /** Owed on the debts at the end of the month. */
  debtCents: Cents;
}

export interface DebtOutcome {
  id: string;
  name: string;
  /** The month the last payment clears it; undefined when it isn't cleared within the projection. */
  paidOffMonth?: MonthKey;
  interestCents: Cents;
  /** It has no payment at all, so its balance only grows. */
  noPayment: boolean;
  /** A new debt tried out in the simulator (`newDebt`). */
  isNew?: boolean;
  /** For a new debt: the interest added in its first month. */
  firstInterestCents?: Cents;
}

export interface Projection {
  months: SimMonth[];
  debts: DebtOutcome[];
  startCashCents: Cents;
  endCashCents: Cents;
  totalSavedCents: Cents;
  avgSavedCents: Cents;
  interestCents: Cents;
  /** Months whose savings reach the savings goal. */
  goalMet: number;
}

export interface SimInput {
  data: Data;
  today: DateKey;
  /** How many months to project. */
  horizon: number;
  /** Monthly spending before any change. */
  spendingCents: Cents;
}

/** The id a new debt tried out in the simulator goes by. */
export const newDebtId = (c: { id: string }) => `new:${c.id}`;

/** The first month projected: this month when it hasn't started yet, else the next one. */
export function firstSimMonth(data: Data, today: DateKey): MonthKey {
  const m = thisMonth(data.settings, today);
  return isFutureMonth(m, today) ? m : addMonths(m, 1);
}

/** Monthly spending as budgeted: the categories' budgets added up. */
export const budgetSpendingCents = (data: Data) => spendingBudgetCents(data.categories);

/** Average spending over the last (up to) three started months; the budget when none has started. */
export function recentSpendingCents(data: Data, today: DateKey): Cents {
  const months = startedMonths(data.settings, today).slice(-3);
  if (months.length === 0) return budgetSpendingCents(data);
  return roundDiv(months.reduce((s, m) => s + monthSummary(data, m, today).spentCents, 0), months.length);
}

/** The debts as they stand now (balance owed today), leaving out cards paid in full every month and anything not owing. */
export function simDebts(data: Data, today: DateKey): SimDebt[] {
  return data.cards
    .filter((c) => isLoan(c) || !c.payInFull)
    .map((c) => ({ id: c.id, name: c.name, aprBps: c.aprBps, balanceCents: cardSummary(c, data.purchases, today, linkedBills(c, data, today), data.settings.firstMonth).balanceNowCents }))
    .filter((d) => d.balanceCents > 0);
}

/** Change values that apply from a month on: the latest change starting on or before `month` wins. */
function latest<T extends { from: MonthKey }>(changes: T[], month: MonthKey): T | undefined {
  return changes.filter((c) => c.from <= month).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).at(-1);
}

export function project({ data, today, horizon, spendingCents }: SimInput, changes: Change[] = []): Projection {
  const start = firstSimMonth(data, today);
  const months = monthRange(start, addMonths(start, Math.max(1, horizon) - 1));
  const startCashCents = checkingBalanceNowCents(data, today);
  const of = <K extends Change['kind']>(k: K) => changes.filter((c): c is Extract<Change, { kind: K }> => c.kind === k);

  const newDebts = of('newDebt');
  const debts: (SimDebt & { isNew?: boolean })[] = [...simDebts(data, today), ...newDebts.map((c) => ({ id: newDebtId(c), name: c.name || 'New debt', aprBps: c.aprBps, balanceCents: 0, isNew: true }))];
  const firstInterest = new Map<string, Cents>();
  const owed = new Map(debts.map((d) => [d.id, d.balanceCents]));
  const interest = new Map(debts.map((d) => [d.id, 0]));
  const paidOff = new Map<string, MonthKey>();
  const bills = data.bills.filter((b) => !b.deleted);
  const paying = new Set<string>();

  const rows: SimMonth[] = [];
  let cash = startCashCents;
  for (const month of months) {
    const income = latest(of('income'), month)?.amountCents ?? data.settings.incomeBaselineCents;
    const spending = latest(of('spending'), month)?.amountCents ?? spendingCents;
    let oneTime = 0;
    for (const c of of('oneTime')) if (c.month === month) oneTime += c.income ? -c.amountCents : c.amountCents;
    // New debts start owing in their month (money in to checking when it comes as cash).
    for (const c of newDebts) {
      if (c.month !== month) continue;
      owed.set(newDebtId(c), c.amountCents);
      interest.set(newDebtId(c), 0);
      if (c.cashIn) oneTime -= c.amountCents;
    }

    // Lump-sum payoffs at the start of the month.
    for (const c of of('payoff')) {
      const b = owed.get(c.debtId) ?? 0;
      if (c.month === month && b > 0) {
        const pay = Math.min(b, c.amountCents ?? b);
        oneTime += pay;
        owed.set(c.debtId, b - pay);
        if (pay >= b) paidOff.set(c.debtId, month);
      }
    }

    // What each debt is paid this month: its bills, plus any extra payment.
    const due = new Map<string, Cents>();
    let billsCents = 0;
    for (const bill of bills) {
      if (!isBillActive(bill, month)) continue;
      const ch = latest(of('bill').filter((c) => c.billId === bill.id), month);
      const amount = ch ? ch.amountCents : bill.amountCents;
      if (amount <= 0) continue;
      if (bill.cardId && owed.has(bill.cardId)) due.set(bill.cardId, (due.get(bill.cardId) ?? 0) + amount);
      else billsCents += amount;
    }
    for (const c of of('newBill')) if (c.from <= month && (c.to === undefined || month <= c.to)) billsCents += c.amountCents;
    for (const c of newDebts) if (c.month < month) due.set(newDebtId(c), (due.get(newDebtId(c)) ?? 0) + c.paymentCents);
    for (const c of of('extra')) if (c.from <= month && owed.has(c.debtId)) due.set(c.debtId, (due.get(c.debtId) ?? 0) + c.amountCents);

    for (const d of debts) {
      let b = owed.get(d.id) ?? 0;
      const want = due.get(d.id) ?? 0;
      if (want > 0) paying.add(d.id);
      if (b <= 0) continue;
      const pay = Math.min(want, b);
      billsCents += pay;
      b -= pay;
      if (b <= 0) paidOff.set(d.id, month);
      else {
        const i = monthlyInterestCents(b, d.aprBps);
        if (!firstInterest.has(d.id)) firstInterest.set(d.id, i);
        b += i;
        interest.set(d.id, (interest.get(d.id) ?? 0) + i);
      }
      owed.set(d.id, b);
    }

    const saved = income - billsCents - spending;
    cash += saved - oneTime;
    rows.push({ month, incomeCents: income, billsCents, spendingCents: spending, savedCents: saved, oneTimeCents: oneTime, cashCents: cash, debtCents: [...owed.values()].reduce((s, v) => s + Math.max(0, v), 0) });
  }

  const totalSavedCents = rows.reduce((s, r) => s + r.savedCents, 0);
  const outcomes: DebtOutcome[] = debts.map((d) => ({ id: d.id, name: d.name, paidOffMonth: paidOff.get(d.id), interestCents: interest.get(d.id) ?? 0, noPayment: !paying.has(d.id) && !paidOff.has(d.id), ...(d.isNew ? { isNew: true, firstInterestCents: firstInterest.get(d.id) ?? 0 } : {}) }));
  return {
    months: rows,
    debts: outcomes,
    startCashCents,
    endCashCents: rows.at(-1)?.cashCents ?? startCashCents,
    totalSavedCents,
    avgSavedCents: rows.length ? roundDiv(totalSavedCents, rows.length) : 0,
    interestCents: outcomes.reduce((s, d) => s + d.interestCents, 0),
    goalMet: rows.filter((r) => r.savedCents >= data.settings.savingsGoalCents).length,
  };
}

/**
 * What one change does on top of the others: the projection with all the changes against the one without it.
 * This is what the results popup shows after a change is run.
 */
export function changeImpact(input: SimInput, changes: Change[], change: Change): { before: Projection; after: Projection } {
  const others = changes.filter((c) => c.id !== change.id);
  return { before: project(input, others), after: project(input, [...others, change]) };
}

/** The month all debts with a payment are cleared, when they all are within the projection. */
export function debtFreeMonth(p: Projection): MonthKey | undefined {
  const owing = p.debts.filter((d) => !d.noPayment);
  if (owing.length === 0 || owing.some((d) => !d.paidOffMonth)) return undefined;
  return owing.map((d) => d.paidOffMonth!).sort().at(-1);
}

export type Reach = { kind: 'already' } | { kind: 'never' } | { kind: 'months'; months: number; month: MonthKey };

/**
 * How long saving `monthlyCents` a month takes to grow `fromCents` to `targetCents`, counting from `firstMonth`
 * (the first month's savings are the first step). Never when nothing is saved.
 */
export function monthsToReach(fromCents: Cents, targetCents: Cents, monthlyCents: Cents, firstMonth: MonthKey): Reach {
  if (fromCents >= targetCents) return { kind: 'already' };
  if (monthlyCents <= 0) return { kind: 'never' };
  const months = Math.ceil((targetCents - fromCents) / monthlyCents);
  return { kind: 'months', months, month: addMonths(firstMonth, months - 1) };
}

/** What has to be saved each month to grow `fromCents` to `targetCents` by the end of `byMonth`, counting from `firstMonth`. */
export function neededPerMonth(fromCents: Cents, targetCents: Cents, firstMonth: MonthKey, byMonth: MonthKey): Cents | undefined {
  const n = monthRange(firstMonth, byMonth).length;
  if (n === 0) return undefined;
  return Math.max(0, Math.ceil((targetCents - fromCents) / n));
}

/** The first projected month the cash balance reaches `targetCents` (undefined when it doesn't within the projection). */
export function cashReaches(p: Projection, targetCents: Cents): MonthKey | undefined {
  return p.months.find((m) => m.cashCents >= targetCents)?.month;
}

/**
 * Paying a debt down (or off) from cash: how much it costs then, what it frees up each month after, the interest it saves,
 * and the month the scenario's cash catches up with the baseline's (undefined when it doesn't within the projection).
 */
export function payoffImpact(base: Projection, scen: Projection, change: Extract<Change, { kind: 'payoff' }>) {
  const at = scen.months.findIndex((m) => m.month === change.month);
  const lumpCents = at >= 0 ? scen.months[at].oneTimeCents - (base.months[at]?.oneTimeCents ?? 0) : 0;
  const after = at >= 0 && at + 1 < scen.months.length ? at + 1 : -1;
  const freedCents = after >= 0 ? scen.months[after].savedCents - base.months[after].savedCents : 0;
  const b = base.debts.find((d) => d.id === change.debtId);
  const s = scen.debts.find((d) => d.id === change.debtId);
  const interestSavedCents = Math.max(0, (b?.interestCents ?? 0) - (s?.interestCents ?? 0));
  const caughtUp = at >= 0 ? scen.months.slice(at).find((m, i) => m.cashCents >= base.months[at + i].cashCents)?.month : undefined;
  return { lumpCents, freedCents, interestSavedCents, caughtUp };
}
