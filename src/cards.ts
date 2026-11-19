/**
 * Credit cards: balances, interest and payoff estimates. Pure functions, no UI code.
 *
 * A card's statement is the calendar month. Each month:
 * - opening = last month's closing (the starting balance in the card's first month);
 * - charges = purchases tagged with the card's name under Paid with, dated in that month;
 * - payments = payments dated in that month;
 * - if the payments cover the opening balance (last statement paid in full), no interest;
 *   otherwise interest = (opening − payments) × APR ÷ 12, posted when the month ends;
 * - closing = opening + charges − payments + interest.
 * The month in progress has no interest yet; it shows what would be added if the statement stays unpaid.
 */
import { addMonths, monthOf, monthRange, roundDiv, type Cents, type DateKey, type MonthKey, type Purchase } from './calc';

export interface CardPayment {
  id: string;
  date: DateKey;
  amountCents: Cents;
}

export interface CreditCard {
  id: string;
  /** Also its name under Paid with, which links purchases to the card. */
  name: string;
  /** APR in hundredths of a percent: 24.99% is 2499. */
  aprBps: number;
  /** The balance at the start of `startMonth`. */
  startBalanceCents: Cents;
  startMonth: MonthKey;
  limitCents?: Cents;
  /** What I plan to pay each month; drives the payoff estimate. */
  plannedPaymentCents?: Cents;
  payments: CardPayment[];
}

export interface CardMonth {
  month: MonthKey;
  openingCents: Cents;
  chargesCents: Cents;
  paymentsCents: Cents;
  interestCents: Cents;
  closingCents: Cents;
  /** Last statement paid in full this month (undefined when there was nothing to pay). */
  paidInFull?: boolean;
  /** The month in progress: interest is not posted yet. */
  current: boolean;
}

/** Monthly interest on a balance: balance × APR ÷ 12, rounded to the cent. */
export function monthlyInterestCents(balanceCents: Cents, aprBps: number): Cents {
  return balanceCents > 0 ? roundDiv(balanceCents * aprBps, 120_000) : 0;
}

/** The purchases charged to this card (by its Paid with name). */
export function cardCharges(card: Pick<CreditCard, 'name'>, purchases: Purchase[]): Purchase[] {
  return purchases.filter((p) => p.paidWith === card.name);
}

/** The card month by month, from its start month through today's month. */
export function cardMonths(card: CreditCard, purchases: Purchase[], today: DateKey): CardMonth[] {
  const now = monthOf(today);
  const charges = new Map<MonthKey, Cents>();
  for (const p of cardCharges(card, purchases)) charges.set(monthOf(p.date), (charges.get(monthOf(p.date)) ?? 0) + p.amountCents);
  const paid = new Map<MonthKey, Cents>();
  for (const p of card.payments) paid.set(monthOf(p.date), (paid.get(monthOf(p.date)) ?? 0) + p.amountCents);

  const rows: CardMonth[] = [];
  let opening = card.startBalanceCents;
  for (const month of monthRange(card.startMonth, now)) {
    const c = charges.get(month) ?? 0;
    const p = paid.get(month) ?? 0;
    const current = month === now;
    const unpaid = opening - p;
    const paidInFull = opening > 0 ? unpaid <= 0 : undefined;
    const interestCents = current || paidInFull !== false ? 0 : monthlyInterestCents(unpaid, card.aprBps);
    const closingCents = opening + c - p + interestCents;
    rows.push({ month, openingCents: opening, chargesCents: c, paymentsCents: p, interestCents, closingCents, paidInFull, current });
    opening = closingCents;
  }
  return rows;
}

export type Payoff = { kind: 'clear' } | { kind: 'never' } | { kind: 'noPlan' } | { kind: 'months'; months: number; lastMonth: MonthKey; interestCents: Cents };

/**
 * How long paying `monthlyCents` a month takes to clear `balanceCents` with no new charges,
 * starting with this month's payment. Never when the payment doesn't beat the interest (or takes over 50 years).
 */
export function payoff(balanceCents: Cents, aprBps: number, monthlyCents: Cents | undefined, thisMonth: MonthKey): Payoff {
  if (balanceCents <= 0) return { kind: 'clear' };
  if (!monthlyCents || monthlyCents <= 0) return { kind: 'noPlan' };
  let b = balanceCents;
  let interest = 0;
  for (let months = 1; months <= 600; months++) {
    const pay = Math.min(monthlyCents, b);
    b -= pay;
    if (b <= 0) return { kind: 'months', months, lastMonth: addMonths(thisMonth, months - 1), interestCents: interest };
    const i = monthlyInterestCents(b, aprBps);
    if (i >= monthlyCents) return { kind: 'never' };
    b += i;
    interest += i;
  }
  return { kind: 'never' };
}

export interface CardSummary {
  card: CreditCard;
  rows: CardMonth[];
  balanceNowCents: Cents;
  /** Last month's closing balance: pay this in full this month to avoid interest. */
  statementCents: Cents;
  leftToAvoidInterestCents: Cents;
  /** Interest added at the end of this month if the rest of the statement stays unpaid. */
  projectedInterestCents: Cents;
  chargesThisMonthCents: Cents;
  chargesThisYearCents: Cents;
  chargesAllCents: Cents;
  interestThisYearCents: Cents;
  interestAllCents: Cents;
  paymentsThisYearCents: Cents;
  paymentsAllCents: Cents;
  /** Finished months with a statement to pay, and how many were paid in full. */
  statements: number;
  paidInFull: number;
  /** Average payment over finished months (0 when none). */
  avgPaymentCents: Cents;
  /** Balance ÷ limit, 0–1+ (undefined without a limit). */
  utilization?: number;
  /** The planned payment, else the average payment. */
  payoffPaymentCents?: Cents;
  payoffUsesAverage: boolean;
  payoff: Payoff;
  /** Charges this year by category id. */
  byCategory: { categoryId: string; cents: Cents }[];
}

export function cardSummary(card: CreditCard, purchases: Purchase[], today: DateKey): CardSummary {
  const now = monthOf(today);
  const year = now.slice(0, 4);
  const rows = cardMonths(card, purchases, today);
  const cur = rows[rows.length - 1];
  const balanceNowCents = cur ? cur.closingCents : card.startBalanceCents;
  const statementCents = Math.max(0, cur ? cur.openingCents : card.startBalanceCents);
  const leftToAvoidInterestCents = Math.max(0, statementCents - (cur?.paymentsCents ?? 0));
  const sum = (xs: CardMonth[], f: (r: CardMonth) => number) => xs.reduce((s, r) => s + f(r), 0);
  const thisYear = rows.filter((r) => r.month.startsWith(year));
  const finished = rows.filter((r) => !r.current);
  const statements = finished.filter((r) => r.paidInFull !== undefined);
  const avgPaymentCents = finished.length ? roundDiv(sum(finished, (r) => r.paymentsCents), finished.length) : 0;
  const payoffPaymentCents = card.plannedPaymentCents || avgPaymentCents || undefined;

  const cats = new Map<string, Cents>();
  for (const p of cardCharges(card, purchases)) {
    if (!p.date.startsWith(year) || monthOf(p.date) < card.startMonth || monthOf(p.date) > now) continue;
    cats.set(p.categoryId, (cats.get(p.categoryId) ?? 0) + p.amountCents);
  }

  return {
    card,
    rows,
    balanceNowCents,
    statementCents,
    leftToAvoidInterestCents,
    projectedInterestCents: monthlyInterestCents(leftToAvoidInterestCents, card.aprBps),
    chargesThisMonthCents: cur?.chargesCents ?? 0,
    chargesThisYearCents: sum(thisYear, (r) => r.chargesCents),
    chargesAllCents: sum(rows, (r) => r.chargesCents),
    interestThisYearCents: sum(thisYear, (r) => r.interestCents),
    interestAllCents: sum(rows, (r) => r.interestCents),
    paymentsThisYearCents: sum(thisYear, (r) => r.paymentsCents),
    paymentsAllCents: sum(rows, (r) => r.paymentsCents),
    statements: statements.length,
    paidInFull: statements.filter((r) => r.paidInFull).length,
    avgPaymentCents,
    utilization: card.limitCents ? balanceNowCents / card.limitCents : undefined,
    payoffPaymentCents,
    payoffUsesAverage: !card.plannedPaymentCents && !!avgPaymentCents,
    payoff: payoff(balanceNowCents, card.aprBps, payoffPaymentCents, now),
    byCategory: [...cats].map(([categoryId, cents]) => ({ categoryId, cents })).sort((a, b) => b.cents - a.cents),
  };
}

/** "24.99" → 2499. Undefined when it isn't a rate from 0 to 100 with at most two decimals. */
export function parseApr(text: string): number | undefined {
  const t = text.replace(/[%\s]/g, '');
  if (!/^\d{1,3}(\.\d{0,2})?$|^\.\d{1,2}$/.test(t)) return undefined;
  const [whole, frac = ''] = t.split('.');
  const bps = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return bps <= 10_000 ? bps : undefined;
}

/** 2499 → "24.99%". */
export function formatApr(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Month-end balances if `monthlyCents` is paid every month from `thisMonth` on and nothing new is charged:
 * element 0 is the end of `thisMonth`. Stops at zero, or after `maxMonths`. Empty when the balance is already clear.
 */
export function projection(balanceCents: Cents, aprBps: number, monthlyCents: Cents | undefined, maxMonths = 24): Cents[] {
  const out: Cents[] = [];
  if (balanceCents <= 0 || !monthlyCents || monthlyCents <= 0) return out;
  let b = balanceCents;
  for (let i = 0; i < maxMonths; i++) {
    b -= Math.min(monthlyCents, b);
    if (b > 0) b += monthlyInterestCents(b, aprBps);
    out.push(b);
    if (b <= 0) break;
    if (out.length > 1 && b >= out[out.length - 2]) break; // not shrinking
  }
  return out;
}

/** Total owed across cards at the end of each month, from the earliest start through today's month. */
export function totalSeries(summaries: CardSummary[], today: DateKey): { month: MonthKey; cents: Cents }[] {
  if (summaries.length === 0) return [];
  const first = summaries.map((s) => s.card.startMonth).sort()[0];
  return monthRange(first, monthOf(today)).map((month) => ({
    month,
    cents: summaries.reduce((sum, s) => sum + (s.rows.find((r) => r.month === month)?.closingCents ?? 0), 0),
  }));
}
