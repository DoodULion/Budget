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
 * A card set to pay in full every month has every finished month's statement paid automatically (on top of any payments entered), so it never carries interest.
 * The month in progress has no interest yet; it shows what would be added if the statement stays unpaid.
 */
import { todayLocal } from './money';
import { type BillRow, billRows, addMonths, type Bill, monthOf, monthRange, roundDiv, type Cents, type Data, type DateKey, type MonthKey, type Purchase } from './calc';

export interface CardPayment {
  id: string;
  date: DateKey;
  amountCents: Cents;
  /** Set on a payment that comes from a paid bill (not stored on the card): the bill's name. */
  billName?: string;
}

/** The kinds of debt. Only credit cards take purchases (through Paid with); loans are paid down by payments alone. */
export type DebtKind = 'credit-card' | 'personal-loan' | 'student-loan' | 'auto-loan' | 'other';
export const DEBT_KINDS: { id: DebtKind; label: string }[] = [
  { id: 'credit-card', label: 'Credit card' },
  { id: 'personal-loan', label: 'Personal loan' },
  { id: 'student-loan', label: 'Student loan' },
  { id: 'auto-loan', label: 'Auto loan' },
  { id: 'other', label: 'Other debt' },
];
export const debtLabel = (d: Pick<CreditCard, 'kind'>) => DEBT_KINDS.find((k) => k.id === (d.kind ?? 'credit-card'))?.label ?? 'Credit card';
export const isLoan = (d: Pick<CreditCard, 'kind'>) => (d.kind ?? 'credit-card') !== 'credit-card';

/** A debt: a credit card (the default) or a loan. The type keeps its old name from when only cards were tracked. */
export interface CreditCard {
  id: string;
  /** Credit card when missing. */
  kind?: DebtKind;
  /** Also its name under Paid with, which links purchases to a credit card. */
  name: string;
  /** APR in hundredths of a percent: 24.99% is 2499. */
  aprBps: number;
  /** The balance at the start of `startMonth`. */
  startBalanceCents: Cents;
  startMonth: MonthKey;
  limitCents?: Cents;
  /** What I plan to pay each month; drives the payoff estimate. */
  plannedPaymentCents?: Cents;
  /** Paid off in full every month: each earlier month's statement counts as paid, so there is no interest. */
  payInFull?: boolean;
  /**
   * The card is closed from this month: no new purchases can be added to it, and each month's interest is
   * the APR ÷ 12 on that month's ending balance.
   */
  closedMonth?: MonthKey;
  /** The minimum monthly payment. It appears in the fixed bills as "<name> payment" and is kept in step (see debtBill). */
  minPaymentCents?: Cents;
  /**
   * The day of the month the minimum payment is due (1–31). On that day each month the payment is recorded automatically:
   * the debt's minimum-payment bill is marked paid (autopay), which lowers the balance. Needs a minimum payment.
   */
  dueDay?: number;
  /** The day the balance was paid off with "Pay off balance". Once the balance is zero, the minimum payment bill and autopay stop (see isPaidOff). */
  paidOffDate?: DateKey;
  /** Interest saved by paying off early instead of making only the minimum, worked out when "Pay off balance" was recorded. */
  interestSavedCents?: Cents;
  /**
   * The day the balance was reset to a new amount ("Reset balances"): `startBalanceCents` is what was owed that day and
   * `startMonth` is its month. Purchases and payments dated on or before it are already in that amount, so they are left out.
   */
  resetDate?: DateKey;
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
/** After the reset (if any): purchases and payments dated on or before the reset day are already in the reset balance. */
const afterReset = (card: Pick<CreditCard, 'resetDate'>) => (x: { date: DateKey }) => card.resetDate === undefined || x.date > card.resetDate;

export function cardCharges(card: Pick<CreditCard, 'name' | 'kind'>, purchases: Purchase[]): Purchase[] {
  if (isLoan(card)) return [];
  return purchases.filter((p) => p.paidWith === card.name);
}

/** The month a debt's figures start: its start month, but never before the first tracked month. */
export const debtStart = (card: Pick<CreditCard, 'startMonth'>, firstMonth?: MonthKey): MonthKey => (firstMonth && card.startMonth < firstMonth ? firstMonth : card.startMonth);

/**
 * The card month by month, from its start month through today's month. Nothing before the first tracked month
 * (`firstMonth`) is counted: a debt that starts earlier opens at its starting balance in the first month.
 */
export function cardMonths(card: CreditCard, purchases: Purchase[], today: DateKey, extraPayments: CardPayment[] = [], firstMonth?: MonthKey): CardMonth[] {
  const now = monthOf(today);
  const charges = new Map<MonthKey, Cents>();
  for (const p of cardCharges(card, purchases).filter(afterReset(card))) charges.set(monthOf(p.date), (charges.get(monthOf(p.date)) ?? 0) + p.amountCents);
  const paid = new Map<MonthKey, Cents>();
  for (const p of [...card.payments, ...extraPayments].filter(afterReset(card))) paid.set(monthOf(p.date), (paid.get(monthOf(p.date)) ?? 0) + p.amountCents);

  const rows: CardMonth[] = [];
  let opening = card.startBalanceCents;
  for (const month of monthRange(debtStart(card, firstMonth), now)) {
    const c = charges.get(month) ?? 0;
    const current = month === now;
    const entered = paid.get(month) ?? 0;
    // Pay-in-full cards: the statement coming in is paid during the month (once the month is over).
    const closed = isLoan(card) || (card.closedMonth !== undefined && month >= card.closedMonth);
    const p = card.payInFull && !closed && !current && opening > entered ? opening : entered;
    // A closed card charges interest on the month's ending balance. Otherwise interest is on what is left
    // of last statement after payments, and none when that statement was paid in full.
    const unpaid = opening - p;
    const paidInFull = closed ? undefined : opening > 0 ? unpaid <= 0 : undefined;
    const interestCents = current ? 0 : closed ? monthlyInterestCents(opening + c - p, card.aprBps) : paidInFull !== false ? 0 : monthlyInterestCents(unpaid, card.aprBps);
    const closingCents = opening + c - p + interestCents;
    rows.push({ month, openingCents: opening, chargesCents: c, paymentsCents: p, interestCents, closingCents, paidInFull, current });
    opening = closingCents;
  }
  return rows;
}

export type Payoff = { kind: 'full' } | { kind: 'clear' } | { kind: 'never' } | { kind: 'noPlan' } | { kind: 'months'; months: number; lastMonth: MonthKey; interestCents: Cents };

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

export type InterestSaved = { kind: 'saved'; cents: Cents; months: number; minimumCents: Cents } | { kind: 'never'; minimumCents: Cents };

/**
 * What paying off now saves compared with paying only the minimum every month from this month until it is gone
 * (the interest those minimums would still have added). Undefined when there is no minimum to compare with.
 */
export function interestSaved(balanceCents: Cents, aprBps: number, minimumCents: Cents | undefined, thisMonth: MonthKey): InterestSaved | undefined {
  if (balanceCents <= 0 || !minimumCents || minimumCents <= 0) return undefined;
  const p = payoff(balanceCents, aprBps, minimumCents, thisMonth);
  if (p.kind === 'months') return { kind: 'saved', cents: p.interestCents, months: p.months, minimumCents };
  if (p.kind === 'never') return { kind: 'never', minimumCents };
  return undefined;
}

/** The minimum payment to compare with: the debt's own, else what its linked bills add up to. */
export const minimumFor = (card: CreditCard, linked: LinkedBills): Cents | undefined => card.minPaymentCents || linked.billAmountCents || undefined;

export interface CardSummary {
  card: CreditCard;
  /** The month its figures start (see debtStart). */
  startMonth: MonthKey;
  rows: CardMonth[];
  balanceNowCents: Cents;
  /** Last month's closing balance: pay this in full this month to avoid interest. */
  statementCents: Cents;
  leftToAvoidInterestCents: Cents;
  /** Closed account (see `closedMonth`). */
  closed: boolean;
  /** A loan (not a credit card). */
  loan: boolean;
  /** Interest added at the end of this month: if the rest of the statement stays unpaid, or on the ending balance of a closed card. */
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
  /** The payoff estimate uses the linked bill's amount. */
  payoffUsesBill: boolean;
  /** Payments from linked bills (already counted in the figures above). */
  billPayments: CardPayment[];
  payoff: Payoff;
  /** Charges this year by category id. */
  byCategory: { categoryId: string; cents: Cents }[];
}

export function cardSummary(card: CreditCard, purchases: Purchase[], today: DateKey, linked: LinkedBills = NO_LINKS, firstMonth?: MonthKey): CardSummary {
  const now = monthOf(today);
  const year = now.slice(0, 4);
  const startMonth = debtStart(card, firstMonth);
  const rows = cardMonths(card, purchases, today, linked.payments, firstMonth);
  const cur = rows[rows.length - 1];
  const balanceNowCents = cur ? cur.closingCents : card.startBalanceCents;
  const statementCents = Math.max(0, cur ? cur.openingCents : card.startBalanceCents);
  const leftToAvoidInterestCents = Math.max(0, statementCents - (cur?.paymentsCents ?? 0));
  const sum = (xs: CardMonth[], f: (r: CardMonth) => number) => xs.reduce((s, r) => s + f(r), 0);
  const thisYear = rows.filter((r) => r.month.startsWith(year));
  const finished = rows.filter((r) => !r.current);
  const statements = finished.filter((r) => r.paidInFull !== undefined);
  const avgPaymentCents = finished.length ? roundDiv(sum(finished, (r) => r.paymentsCents), finished.length) : 0;
  const closed = isLoan(card) || (card.closedMonth !== undefined && card.closedMonth <= now);
  const payoffPaymentCents = card.plannedPaymentCents || linked.billAmountCents || avgPaymentCents || undefined;

  const cats = new Map<string, Cents>();
  for (const p of cardCharges(card, purchases).filter(afterReset(card))) {
    if (!p.date.startsWith(year) || monthOf(p.date) < startMonth || monthOf(p.date) > now) continue;
    cats.set(p.categoryId, (cats.get(p.categoryId) ?? 0) + p.amountCents);
  }

  return {
    card,
    startMonth,
    rows,
    balanceNowCents,
    statementCents,
    leftToAvoidInterestCents,
    projectedInterestCents: closed ? monthlyInterestCents(balanceNowCents, card.aprBps) : monthlyInterestCents(leftToAvoidInterestCents, card.aprBps),
    closed,
    loan: isLoan(card),
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
    payoffUsesAverage: !card.plannedPaymentCents && !linked.billAmountCents && !!avgPaymentCents,
    payoffUsesBill: !card.plannedPaymentCents && !!linked.billAmountCents,
    billPayments: linked.payments.filter(afterReset(card)).filter((p) => monthOf(p.date) >= startMonth),
    payoff: card.payInFull && !closed && !isLoan(card) ? { kind: 'full' } : payoff(balanceNowCents, card.aprBps, payoffPaymentCents, now),
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

/** What the bills linked to a card contribute. */
export interface LinkedBills {
  payments: CardPayment[];
  /** The linked bills' monthly amounts added up (0 when none, or all have ended). */
  billAmountCents: Cents;
}
const NO_LINKS: LinkedBills = { payments: [], billAmountCents: 0 };

/**
 * Bills linked to this card (`Bill.cardId`): every month such a bill is marked paid counts as a payment on the card,
 * for the amount paid (else the bill's amount), dated the day it was paid (else the 1st). Unmarking it removes the payment.
 */
export function linkedBills(card: CreditCard, data: Pick<Data, 'bills' | 'months'>, today: DateKey): LinkedBills {
  const bills = data.bills.filter((b) => b.cardId === card.id);
  if (bills.length === 0) return NO_LINKS;
  const now = monthOf(today);
  const payments: CardPayment[] = [];
  for (const m of data.months) {
    if (m.month > now) continue;
    for (const row of billRows({ ...data, bills } as Data, m.month)) {
      if (row.status !== 'paid') continue;
      payments.push({ id: `bill:${row.bill.id}:${m.month}`, date: row.payment?.datePaid ?? `${m.month}-01`, amountCents: row.countedCents, billName: row.bill.name });
    }
  }
  const billAmountCents = bills.filter((b) => !b.deleted && (b.lastMonth === undefined || b.lastMonth >= now)).reduce((sum, b) => sum + b.amountCents, 0);
  return { payments, billAmountCents };
}

/** Total owed across cards at the end of each month, from the earliest start through today's month. */
export function totalSeries(summaries: CardSummary[], today: DateKey): { month: MonthKey; cents: Cents }[] {
  if (summaries.length === 0) return [];
  const first = summaries.map((s) => s.startMonth).sort()[0];
  return monthRange(first, monthOf(today)).map((month) => ({
    month,
    cents: summaries.reduce((sum, s) => sum + (s.rows.find((r) => r.month === month)?.closingCents ?? 0), 0),
  }));
}

/** What pay-in-full cards charged in a month: that month's balance, paid off in full ("Credit Card payoff"). */
export function payoffForMonth(cards: CreditCard[], purchases: Purchase[], month: MonthKey): { totalCents: Cents; byCard: { card: CreditCard; cents: Cents }[] } {
  const byCard = cards
    .filter((c) => c.payInFull)
    .map((card) => ({ card, cents: cardCharges(card, purchases).filter((p) => monthOf(p.date) === month).reduce((s, p) => s + p.amountCents, 0) }));
  return { totalCents: byCard.reduce((s, c) => s + c.cents, 0), byCard };
}

/**
 * Paid off: nothing owed and either paid off on purpose ("Pay off balance") or a loan / closed card whose payments have cleared it.
 * A credit card that is still open and merely at $0 (say, between charges) is not paid off unless it was paid off on purpose.
 */
export function isPaidOff(card: CreditCard, s: Pick<CardSummary, 'balanceNowCents' | 'paymentsAllCents' | 'closed'>): boolean {
  return s.balanceNowCents <= 0 && (card.paidOffDate !== undefined || (s.closed && s.paymentsAllCents > 0));
}

/** The ids of the debts that are paid off. */
export function paidOffIds(data: Data, today: DateKey): Set<string> {
  return new Set(data.cards.filter((c) => isPaidOff(c, cardSummary(c, data.purchases, today, linkedBills(c, data, today), data.settings.firstMonth))).map((c) => c.id));
}

/**
 * Keeps the minimum payment bills in step with how the debts stand: a paid-off debt's bill is removed, and an open
 * debt that has a minimum but no bill (a bill removed because it was paid off, then a new balance) gets it back.
 */
export function debtBillChanges(data: Data, today: DateKey): { put: Bill[]; remove: string[] } {
  const paidOff = paidOffIds(data, today);
  const put: Bill[] = [];
  const remove: string[] = [];
  for (const card of data.cards) {
    const existing = data.bills.find((b) => b.id === debtBillId(card.id));
    const live = existing && !existing.deleted ? existing : undefined;
    if (paidOff.has(card.id)) {
      if (live) remove.push(live.id);
    } else if (!live) {
      const bill = debtBill(card, existing, today);
      if (bill) put.push(bill);
    }
  }
  return { put, remove };
}

export type BillItem = { kind: 'bill'; row: BillRow } | { kind: 'group'; id: DebtKind; label: string; rows: BillRow[]; paid: number; amountCents: Cents };

/**
 * The month's bills with those that pay debts of the same type (credit cards, auto loans …) combined into one group.
 * A type with a single bill stays a plain row. A group sits where its first bill was.
 */
export function groupDebtBills(rows: BillRow[], debts: CreditCard[]): BillItem[] {
  const kindOf = (r: BillRow): DebtKind | undefined => {
    const d = r.bill.cardId ? debts.find((c) => c.id === r.bill.cardId) : undefined;
    return d ? (d.kind ?? 'credit-card') : undefined;
  };
  const counts = new Map<DebtKind, number>();
  for (const r of rows) {
    const k = kindOf(r);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const items: BillItem[] = [];
  const groups = new Map<DebtKind, Extract<BillItem, { kind: 'group' }>>();
  for (const r of rows) {
    const k = kindOf(r);
    if (!k || (counts.get(k) ?? 0) < 2) {
      items.push({ kind: 'bill', row: r });
      continue;
    }
    let g = groups.get(k);
    if (!g) {
      g = { kind: 'group', id: k, label: `${debtLabel({ kind: k })}s`, rows: [], paid: 0, amountCents: 0 };
      groups.set(k, g);
      items.push(g);
    }
    g.rows.push(r);
    if (r.status === 'paid') g.paid += 1;
    if (r.status !== 'ended') g.amountCents += r.status === 'paid' ? r.countedCents : r.bill.amountCents;
  }
  return items;
}

export type DebtItem = { kind: 'debt'; s: CardSummary } | { kind: 'group'; id: DebtKind; label: string; debts: CardSummary[]; balanceCents: Cents; minimumsCents: Cents };

/** The key a debt list item is dragged by: the debt's id, or `group:<type>` for a group. */
export const debtItemKey = (it: DebtItem) => (it.kind === 'debt' ? it.s.card.id : `group:${it.id}`);

/**
 * The Debt tab's list with debts of the same type (credit cards, auto loans …) combined into one group that opens to
 * the debts in it. A type with a single debt stays a plain row. A group sits where its first debt was, and keeps the
 * debts' order. Its balance is what its debts owe; its minimums leave out paid-off debts.
 */
export function groupDebts(summaries: CardSummary[]): DebtItem[] {
  const kindOf = (s: CardSummary) => s.card.kind ?? 'credit-card';
  const counts = new Map<DebtKind, number>();
  for (const s of summaries) counts.set(kindOf(s), (counts.get(kindOf(s)) ?? 0) + 1);
  const items: DebtItem[] = [];
  const groups = new Map<DebtKind, Extract<DebtItem, { kind: 'group' }>>();
  for (const s of summaries) {
    const k = kindOf(s);
    if ((counts.get(k) ?? 0) < 2) {
      items.push({ kind: 'debt', s });
      continue;
    }
    let g = groups.get(k);
    if (!g) {
      g = { kind: 'group', id: k, label: `${debtLabel({ kind: k })}s`, debts: [], balanceCents: 0, minimumsCents: 0 };
      groups.set(k, g);
      items.push(g);
    }
    g.debts.push(s);
    g.balanceCents += Math.max(0, s.balanceNowCents);
    if (!isPaidOff(s.card, s)) g.minimumsCents += s.card.minPaymentCents ?? 0;
  }
  return items;
}

/** The debt order after the list's top-level items were rearranged: each group's debts move together. */
export function debtOrderFromItems(keys: string[], items: DebtItem[]): string[] {
  return keys.flatMap((key) => {
    const it = items.find((x) => debtItemKey(x) === key);
    return !it ? [] : it.kind === 'debt' ? [it.s.card.id] : it.debts.map((s) => s.card.id);
  });
}

/** The debt order after the debts inside a group were rearranged: the group's debts take their new order in the same slots. */
export function debtOrderWithin(order: string[], groupIds: string[]): string[] {
  const inGroup = new Set(groupIds);
  let i = 0;
  return order.map((id) => (inGroup.has(id) ? groupIds[i++] : id));
}

export type BillSort = 'setup' | 'name' | 'amount' | 'status';
export const BILL_SORTS: { id: BillSort; label: string }[] = [
  { id: 'setup', label: 'Setup order' },
  { id: 'name', label: 'Name (A to Z)' },
  { id: 'amount', label: 'Amount (largest first)' },
  { id: 'status', label: 'Unpaid first' },
];

const rank = (r: BillRow) => (r.status === 'unpaid' ? 0 : r.status === 'paid' ? 1 : 2);
const shown = (r: BillRow) => (r.status === 'paid' ? r.countedCents : r.status === 'ended' ? 0 : r.bill.amountCents);

/**
 * The month's bill rows and groups in the chosen order. A group sorts by its label, its total, or (unpaid first)
 * whether any of its bills is unpaid, and its bills are sorted the same way inside. Ties keep the setup order.
 */
export function sortBillItems(items: BillItem[], by: BillSort): BillItem[] {
  if (by === 'setup') return items;
  const cmpRows = (a: BillRow, b: BillRow) => {
    if (by === 'name') return a.bill.name.localeCompare(b.bill.name, undefined, { sensitivity: 'base' });
    if (by === 'amount') return shown(b) - shown(a);
    return rank(a) - rank(b);
  };
  const groupRank = (g: Extract<BillItem, { kind: 'group' }>) => Math.min(...g.rows.map(rank));
  const cmp = (a: BillItem, b: BillItem) => {
    if (a.kind === 'bill' && b.kind === 'bill') return cmpRows(a.row, b.row);
    if (by === 'name') return (a.kind === 'bill' ? a.row.bill.name : a.label).localeCompare(b.kind === 'bill' ? b.row.bill.name : b.label, undefined, { sensitivity: 'base' });
    if (by === 'amount') return (b.kind === 'bill' ? shown(b.row) : b.amountCents) - (a.kind === 'bill' ? shown(a.row) : a.amountCents);
    return (a.kind === 'bill' ? rank(a.row) : groupRank(a)) - (b.kind === 'bill' ? rank(b.row) : groupRank(b));
  };
  const inner = items.map((it) => (it.kind === 'group' ? { ...it, rows: [...it.rows].sort(cmpRows) } : it));
  return inner.map((it, i) => ({ it, i })).sort((a, b) => cmp(a.it, b.it) || a.i - b.i).map((x) => x.it);
}

/**
 * Start a debt over at the balance owed today ("Reset balances"). Everything else about it (APR, minimum, due date,
 * limit, switches) stays. Its months now start with today's month, opening at that balance; purchases and payments dated
 * today or earlier are part of it and no longer counted, and payments entered on the debt up to today are cleared.
 * A loan or closed account reset to zero counts as paid off (as does a debt already paid off); a reset to an amount owed clears an earlier payoff.
 */
export function resetDebt(card: CreditCard, balanceCents: Cents, today: DateKey, firstMonth?: MonthKey): CreditCard {
  const next: CreditCard = { ...card, startBalanceCents: balanceCents, startMonth: debtStart({ startMonth: monthOf(today) }, firstMonth), resetDate: today, payments: card.payments.filter((p) => p.date > today) };
  if (balanceCents > 0) {
    delete next.paidOffDate;
    delete next.interestSavedCents;
  } else if (!next.paidOffDate && (isLoan(card) || (card.closedMonth !== undefined && card.closedMonth <= monthOf(today)))) {
    next.paidOffDate = today;
  }
  return next;
}

/** The id of the fixed bill that carries a debt's minimum payment. */
export const debtBillId = (debtId: string) => `debt:${debtId}`;
export const isDebtBill = (b: Pick<Bill, 'id'>) => b.id.startsWith('debt:');

/**
 * The fixed bill for a debt's minimum payment ("<name> payment", the minimum as its amount, linked to the debt),
 * or undefined when the debt has no minimum (or is a card paid in full each month). Keeps what the bill already has
 * that the debt doesn't decide (autopay, last month, note) from `existing`.
 */
export function debtBill(debt: CreditCard, existing?: Bill, today: DateKey = todayLocal()): Bill | undefined {
  if (!debt.minPaymentCents || (debt.payInFull && !isLoan(debt))) return undefined;
  const bill: Bill = { id: debtBillId(debt.id), name: `${debt.name} payment`, amountCents: debt.minPaymentCents, cardId: debt.id };
  if (existing?.lastMonth) bill.lastMonth = existing.lastMonth;
  if (existing?.note) bill.note = existing.note;
  // The due date owns the bill's autopay: it starts this month (earlier months were tracked by hand), unless the day is unchanged.
  if (debt.dueDay) {
    const since = existing?.autoPay?.day === debt.dueDay ? existing.autoPay.since : monthOf(today) < debt.startMonth ? debt.startMonth : monthOf(today);
    bill.autoPay = { day: debt.dueDay, since };
  }
  return bill;
}

/** The name of this line on Month. */
export const PAYOFF_NAME = 'Credit Card payoff';
