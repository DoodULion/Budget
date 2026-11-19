import { describe, expect, it } from 'vitest';
import type { Month, Purchase } from './calc';
import { autopayMonths, type Data } from './calc';
import { cardMonths, cardSummary, debtBill, debtBillChanges, groupDebtBills, interestSaved, isPaidOff, minimumFor, paidOffIds, debtLabel, formatApr, isLoan, linkedBills, parseApr, payoff, payoffForMonth, projection, totalSeries, type CreditCard } from './cards';

// Made-up figures only.
const card: CreditCard = {
  id: 'v',
  name: 'Test Visa',
  aprBps: 2400,
  startBalanceCents: 100_000,
  startMonth: '2027-01',
  limitCents: 500_000,
  plannedPaymentCents: 5_000,
  payments: [
    { id: 'p1', date: '2027-01-20', amountCents: 30_000 },
    { id: 'p2', date: '2027-02-10', amountCents: 96_400 },
  ],
};
const buy = (id: string, date: string, amountCents: number, paidWith = 'Test Visa', categoryId = 'food'): Purchase => ({ id, date, amountCents, paidWith, categoryId });
const purchases: Purchase[] = [
  buy('a', '2026-12-30', 99_999), // before the card's start month
  buy('b', '2027-01-05', 20_000),
  buy('c', '2027-01-09', 5_000, 'Test Visa', 'fun'),
  buy('d', '2027-01-09', 7_777, 'Cash'),
  buy('e', '2027-02-14', 10_000),
  buy('f', '2027-03-02', 4_000),
];
const today = '2027-03-15';

describe('cardMonths', () => {
  const rows = cardMonths(card, purchases, today);
  it('charges interest when the statement is not paid in full', () => {
    expect(rows[0]).toMatchObject({ month: '2027-01', openingCents: 100_000, chargesCents: 25_000, paymentsCents: 30_000, interestCents: 1_400, closingCents: 96_400, paidInFull: false });
  });
  it('charges nothing when the statement is paid in full', () => {
    expect(rows[1]).toMatchObject({ month: '2027-02', openingCents: 96_400, chargesCents: 10_000, paymentsCents: 96_400, interestCents: 0, closingCents: 10_000, paidInFull: true });
  });
  it('posts no interest in the month in progress', () => {
    expect(rows[2]).toMatchObject({ month: '2027-03', openingCents: 10_000, chargesCents: 4_000, interestCents: 0, closingCents: 14_000, current: true });
    expect(rows).toHaveLength(3);
  });
});

describe('cardSummary', () => {
  const s = cardSummary(card, purchases, today);
  it('adds up the card', () => {
    expect(s.balanceNowCents).toBe(14_000);
    expect(s.statementCents).toBe(10_000);
    expect(s.leftToAvoidInterestCents).toBe(10_000);
    expect(s.projectedInterestCents).toBe(200);
    expect(s.chargesThisMonthCents).toBe(4_000);
    expect(s.chargesAllCents).toBe(39_000);
    expect(s.interestAllCents).toBe(1_400);
    expect(s.paymentsAllCents).toBe(126_400);
    expect([s.paidInFull, s.statements]).toEqual([1, 2]);
    expect(s.avgPaymentCents).toBe(63_200);
    expect(s.utilization).toBeCloseTo(0.028);
    expect(s.byCategory).toEqual([
      { categoryId: 'food', cents: 34_000 },
      { categoryId: 'fun', cents: 5_000 },
    ]);
  });
  it('estimates the payoff with the planned payment', () => {
    expect(s.payoff).toEqual({ kind: 'months', months: 3, lastMonth: '2027-05', interestCents: 264 }); // $140 − $50 = $90 + $1.80; $91.80 − $50 = $41.80 + $0.84; then the last $42.64
  });
  it('falls back to the average payment', () => {
    const t = cardSummary({ ...card, plannedPaymentCents: undefined }, purchases, today);
    expect(t.payoffUsesAverage).toBe(true);
    expect(t.payoff).toMatchObject({ kind: 'months', months: 1, interestCents: 0 });
  });
});

describe('payoff', () => {
  it('is clear with no balance, and needs a payment', () => {
    expect(payoff(0, 2400, 5_000, '2027-03')).toEqual({ kind: 'clear' });
    expect(payoff(14_000, 2400, undefined, '2027-03')).toEqual({ kind: 'noPlan' });
  });
  it('never ends when the payment does not beat the interest', () => {
    expect(payoff(14_000, 2400, 100, '2027-03')).toEqual({ kind: 'never' });
  });
});

describe('APR text', () => {
  it('reads and shows rates', () => {
    expect(parseApr('24.99')).toBe(2499);
    expect(parseApr('24.99%')).toBe(2499);
    expect(parseApr('7.5')).toBe(750);
    expect(parseApr('0')).toBe(0);
    expect(parseApr('abc')).toBeUndefined();
    expect(parseApr('101')).toBeUndefined();
    expect(formatApr(2499)).toBe('24.99%');
    expect(formatApr(750)).toBe('7.5%');
    expect(formatApr(2400)).toBe('24%');
  });
});

describe('projection', () => {
  it('lists month-end balances until paid off', () => {
    expect(projection(14_000, 2400, 5_000)).toEqual([9_180, 4_264, 0]);
  });
  it('is empty with nothing owed or no payment, and stops when not shrinking', () => {
    expect(projection(0, 2400, 5_000)).toEqual([]);
    expect(projection(14_000, 2400, undefined)).toEqual([]);
    expect(projection(1_000_000, 2400, 100).length).toBeLessThan(24);
  });
});

describe('totalSeries', () => {
  it('adds the cards up month by month', () => {
    const other: CreditCard = { ...card, id: 'm', name: 'Test MC', startBalanceCents: 20_000, startMonth: '2027-02', payments: [] };
    const series = totalSeries([cardSummary(card, purchases, today), cardSummary(other, purchases, today)], today);
    expect(series.map((x) => x.month)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(series[0].cents).toBe(96_400);
    expect(series[1].cents).toBe(10_000 + 20_400); // the second card starts at $200 and owes a month of interest by month end
  });
});

describe('paid in full every month', () => {
  const full: CreditCard = { ...card, payInFull: true, payments: [] };
  const rows = cardMonths(full, purchases, today);
  it('pays each finished statement automatically, with no interest', () => {
    expect(rows[0]).toMatchObject({ openingCents: 100_000, chargesCents: 25_000, paymentsCents: 100_000, interestCents: 0, closingCents: 25_000, paidInFull: true });
    expect(rows[1]).toMatchObject({ openingCents: 25_000, chargesCents: 10_000, paymentsCents: 25_000, interestCents: 0, closingCents: 10_000 });
  });
  it('leaves the month in progress alone and has no payoff date', () => {
    expect(rows[2]).toMatchObject({ openingCents: 10_000, paymentsCents: 0, closingCents: 14_000, current: true });
    expect(cardSummary(full, purchases, today).payoff).toEqual({ kind: 'full' });
  });
  it('lists what pay-in-full cards charged in a month as the Credit Card payoff', () => {
    const other: CreditCard = { ...card, id: 'o', name: 'Other', payInFull: false, payments: [] };
    expect(payoffForMonth([full, other], purchases, '2027-01')).toMatchObject({ totalCents: 25_000, byCard: [{ cents: 25_000 }] });
    expect(payoffForMonth([full], purchases, '2027-03').totalCents).toBe(4_000);
    expect(payoffForMonth([other], purchases, '2027-01')).toEqual({ totalCents: 0, byCard: [] });
  });
});

describe('bills linked to a card', () => {
  // A closed card: nothing new is charged, and a $200.00 monthly bill pays it down.
  const closed: CreditCard = { id: 'old', name: 'Old Card', aprBps: 2400, startBalanceCents: 100_000, startMonth: '2027-01', payments: [] };
  const bills = [
    { id: 'b1', name: 'Old Card payment', amountCents: 20_000, cardId: 'old' },
    { id: 'b2', name: 'Phone', amountCents: 5_000 },
  ];
  const months: Month[] = [
    { month: '2027-01', payments: { b1: { datePaid: '2027-01-05' }, b2: { datePaid: '2027-01-06' } } },
    { month: '2027-02', payments: { b1: { datePaid: '2027-02-06', amountPaidCents: 25_000 } } },
    { month: '2027-03', payments: {} },
  ];
  const linked = linkedBills(closed, { bills, months }, today);

  it('turns paid months of the linked bill into card payments', () => {
    expect(linked.payments).toEqual([
      { id: 'bill:b1:2027-01', date: '2027-01-05', amountCents: 20_000, billName: 'Old Card payment' },
      { id: 'bill:b1:2027-02', date: '2027-02-06', amountCents: 25_000, billName: 'Old Card payment' },
    ]);
    expect(linked.billAmountCents).toBe(20_000);
  });
  it('updates the balance and interest from those payments', () => {
    const rows = cardMonths(closed, [], today, linked.payments);
    expect(rows[0]).toMatchObject({ paymentsCents: 20_000, interestCents: 1_600, closingCents: 81_600 });
    expect(rows[1]).toMatchObject({ paymentsCents: 25_000, interestCents: 1_132, closingCents: 57_732 });
    expect(rows[2]).toMatchObject({ paymentsCents: 0, closingCents: 57_732, current: true });
  });
  it('unmarking a bill takes its payment away', () => {
    const unmarked = linkedBills(closed, { bills, months: [{ month: '2027-01', payments: {} }] }, today);
    expect(unmarked.payments).toEqual([]);
  });
  it('estimates the payoff from the bill amount', () => {
    const s = cardSummary(closed, [], today, linked);
    expect(s.balanceNowCents).toBe(57_732);
    expect(s.payoffUsesBill).toBe(true);
    expect(s.payoff).toEqual({ kind: 'months', months: 3, lastMonth: '2027-05', interestCents: 755 + 370 });
  });
  it('ignores bills for other cards and unlinked cards', () => {
    expect(linkedBills({ ...closed, id: 'other' }, { bills, months }, today).payments).toEqual([]);
  });
});

describe('closed card', () => {
  const closed: CreditCard = {
    id: 'cl',
    name: 'Closed Card',
    aprBps: 2400,
    startBalanceCents: 100_000,
    startMonth: '2027-01',
    closedMonth: '2027-01',
    payments: [{ id: 'p', date: '2027-01-20', amountCents: 30_000 }],
  };
  it('charges interest every month on the ending balance', () => {
    const rows = cardMonths(closed, [], today);
    expect(rows[0]).toMatchObject({ openingCents: 100_000, paymentsCents: 30_000, interestCents: 1_400, closingCents: 71_400, paidInFull: undefined });
    expect(rows[1]).toMatchObject({ paymentsCents: 0, interestCents: 1_428, closingCents: 72_828 }); // nothing paid: interest on the whole balance
    expect(rows[2]).toMatchObject({ closingCents: 72_828, interestCents: 0, current: true });
  });
  it('counts charges from before it closed in the ending balance', () => {
    const rows = cardMonths(closed, [buy('x', '2027-01-03', 10_000, 'Closed Card')], today);
    expect(rows[0]).toMatchObject({ chargesCents: 10_000, interestCents: 1_600, closingCents: 81_600 }); // $1,000 + $100 − $300 = $800 × 2%
  });
  it('is flagged, projects interest on the balance, and ignores pay in full', () => {
    const s = cardSummary({ ...closed, payInFull: true }, [], today);
    expect(s.closed).toBe(true);
    expect(s.projectedInterestCents).toBe(1_457); // 728.28 × 2%
    expect(s.payoff.kind).not.toBe('full');
  });
  it('only starts on its closed month', () => {
    const later = cardMonths({ ...closed, closedMonth: '2027-02' }, [], today);
    expect(later[0].interestCents).toBe(1_400); // January still works like an open card: $700 left of the statement
    expect(later[1].interestCents).toBe(1_428);
  });
});

describe('loans and minimum payments', () => {
  const loan: CreditCard = {
    id: 'car',
    kind: 'auto-loan',
    name: 'Car loan',
    aprBps: 600,
    startBalanceCents: 1_000_000,
    startMonth: '2027-01',
    minPaymentCents: 30_000,
    payments: [{ id: 'a', date: '2027-01-10', amountCents: 30_000 }],
  };
  it('knows its type', () => {
    expect(isLoan(loan)).toBe(true);
    expect(isLoan(card)).toBe(false);
    expect(debtLabel(loan)).toBe('Auto loan');
    expect(debtLabel(card)).toBe('Credit card');
  });
  it('takes no purchases, and charges interest on each month\'s ending balance', () => {
    const rows = cardMonths(loan, [buy('x', '2027-01-04', 9_999, 'Car loan')], today);
    expect(rows[0]).toMatchObject({ chargesCents: 0, openingCents: 1_000_000, paymentsCents: 30_000, interestCents: 4_850, closingCents: 974_850 }); // $9,700 × 0.5%
    expect(rows[1]).toMatchObject({ paymentsCents: 0, interestCents: 4_874, closingCents: 979_724 }); // nothing paid: $9,748.50 × 0.5%
  });
  it('is a loan in the summary, with the minimum as the payoff payment through its bill', () => {
    const bill = debtBill(loan)!;
    const linked = linkedBills(loan, { bills: [bill], months: [] }, today);
    const s = cardSummary(loan, [], today, linked);
    expect([s.loan, s.closed]).toEqual([true, true]);
    expect(s.payoffPaymentCents).toBe(30_000);
    expect(s.payoff.kind).toBe('months');
  });
  it('makes a fixed bill from the minimum payment', () => {
    expect(debtBill(loan)).toEqual({ id: 'debt:car', name: 'Car loan payment', amountCents: 30_000, cardId: 'car' });
  });
  it('keeps last month and note the bill already has, and autopay while the due day is the same', () => {
    const existing = { id: 'debt:car', name: 'old', amountCents: 1, lastMonth: '2030-01', note: 'n', autoPay: { day: 3, since: '2027-01' } };
    expect(debtBill({ ...loan, minPaymentCents: 35_000, dueDay: 3 }, existing, '2027-06-01')).toEqual({ id: 'debt:car', name: 'Car loan payment', amountCents: 35_000, cardId: 'car', lastMonth: '2030-01', note: 'n', autoPay: { day: 3, since: '2027-01' } });
  });
  it('makes no bill without a minimum, or for a card paid in full', () => {
    expect(debtBill({ ...loan, minPaymentCents: undefined })).toBeUndefined();
    expect(debtBill({ ...card, minPaymentCents: 2_500, payInFull: true })).toBeUndefined();
    expect(debtBill({ ...card, minPaymentCents: 2_500 })).toMatchObject({ name: 'Test Visa payment', amountCents: 2_500 });
  });
});

describe('paying off a debt', () => {
  const loan: CreditCard = {
    id: 'car',
    kind: 'auto-loan',
    name: 'Car loan',
    aprBps: 600,
    startBalanceCents: 100_000,
    startMonth: '2027-01',
    minPaymentCents: 30_000,
    payments: [],
  };
  const dataOf = (debt: CreditCard, bills = [debtBill(debt)!]): Data => ({ settings: {} as Data['settings'], bills, cards: [debt], categories: [], months: [], purchases: [] });
  const paidOff: CreditCard = { ...loan, paidOffDate: '2027-01-20', payments: [{ id: 'x', date: '2027-01-20', amountCents: 100_000 }] };

  it('is paid off once the balance is cleared on purpose, or a loan is cleared by payments', () => {
    expect(paidOffIds(dataOf(paidOff), today).has('car')).toBe(true);
    expect(paidOffIds(dataOf({ ...paidOff, paidOffDate: undefined }), today).has('car')).toBe(true); // a loan: cleared by payments
    expect(paidOffIds(dataOf(loan), today).size).toBe(0); // still owes
  });
  it('does not treat an open credit card at $0 as paid off unless it was paid off on purpose', () => {
    const open: CreditCard = { ...card, payments: [{ id: 'z', date: '2027-01-20', amountCents: 100_000 }], plannedPaymentCents: undefined };
    const s = cardSummary(open, [], '2027-01-25', linkedBills(open, { bills: [], months: [] }, '2027-01-25'));
    expect(s.balanceNowCents).toBe(0);
    expect(isPaidOff(open, s)).toBe(false);
    expect(isPaidOff({ ...open, paidOffDate: '2027-01-20' }, s)).toBe(true);
  });
  it('removes the minimum payment bill of a paid-off debt, and brings it back when it owes again', () => {
    const d = dataOf(paidOff);
    expect(debtBillChanges(d, today)).toEqual({ put: [], remove: ['debt:car'] });
    const gone = dataOf(paidOff, []);
    expect(debtBillChanges(gone, today)).toEqual({ put: [], remove: [] });
    // owes again (the payment was deleted): the bill returns, keeping what it had
    expect(debtBillChanges(dataOf({ ...paidOff, payments: [] }, []), today).put.map((b) => b.id)).toEqual(['debt:car']);
    // a bill marked deleted (kept for months it was paid) is restored too
    const deleted = { ...debtBill(loan)!, deleted: true };
    expect(debtBillChanges(dataOf(loan, [deleted]), today).put).toHaveLength(1);
  });
});

describe('interest saved by paying off early', () => {
  it('is the interest the minimums would still have added', () => {
    // $1,000 at 24%, $50 a month: 3 payments... the same schedule as the payoff estimate (the minimum is the payment)
    const p = payoff(100_000, 2400, 50_000, '2027-03');
    const saved = interestSaved(100_000, 2400, 50_000, '2027-03');
    expect(p.kind).toBe('months');
    expect(saved).toEqual({ kind: 'saved', cents: p.kind === 'months' ? p.interestCents : -1, months: p.kind === 'months' ? p.months : -1, minimumCents: 50_000 });
  });
  it('matches the spec example: $50 a month on $140.00 is 3 payments and $2.64', () => {
    expect(interestSaved(14_000, 2400, 5_000, '2027-03')).toEqual({ kind: 'saved', cents: 264, months: 3, minimumCents: 5_000 });
  });
  it('says never when the minimum does not beat the interest, and nothing without a minimum', () => {
    expect(interestSaved(1_000_000, 2400, 5_000, '2027-03')).toEqual({ kind: 'never', minimumCents: 5_000 });
    expect(interestSaved(14_000, 2400, undefined, '2027-03')).toBeUndefined();
    expect(interestSaved(0, 2400, 5_000, '2027-03')).toBeUndefined();
  });
  it('takes the minimum from the debt, else from its linked bills', () => {
    expect(minimumFor({ ...card, minPaymentCents: 2_500 }, { payments: [], billAmountCents: 9_000 })).toBe(2_500);
    expect(minimumFor(card, { payments: [], billAmountCents: 9_000 })).toBe(9_000);
    expect(minimumFor(card, { payments: [], billAmountCents: 0 })).toBeUndefined();
  });
});

describe('due date', () => {
  const loan: CreditCard = { id: 'car', kind: 'auto-loan', name: 'Car loan', aprBps: 600, startBalanceCents: 1_000_000, startMonth: '2026-06', minPaymentCents: 30_000, dueDay: 15, payments: [] };
  it('makes the minimum bill autopay on the due day, starting this month', () => {
    expect(debtBill(loan, undefined, '2027-02-20')!.autoPay).toEqual({ day: 15, since: '2027-02' });
    expect(debtBill({ ...loan, startMonth: '2027-04' }, undefined, '2027-02-20')!.autoPay).toEqual({ day: 15, since: '2027-04' });
  });
  it('keeps the start month while the day is unchanged, restarts it when the day changes', () => {
    const existing = debtBill(loan, undefined, '2027-02-20')!;
    expect(debtBill(loan, existing, '2027-06-01')!.autoPay).toEqual({ day: 15, since: '2027-02' });
    expect(debtBill({ ...loan, dueDay: 20 }, existing, '2027-06-01')!.autoPay).toEqual({ day: 20, since: '2027-06' });
  });
  it('has no autopay without a due date', () => {
    expect(debtBill({ ...loan, dueDay: undefined }, debtBill(loan, undefined, '2027-02-20'), '2027-06-01')!.autoPay).toBeUndefined();
  });
  it('records the payment on the due date each month and lowers the balance', () => {
    const bill = debtBill({ ...loan, startMonth: '2027-01' }, undefined, '2027-01-02')!;
    const d: Data = { settings: { firstMonth: '2027-01' } as Data['settings'], bills: [bill], cards: [{ ...loan, startMonth: '2027-01' }], categories: [], months: [], purchases: [] };
    expect(autopayMonths(d, '2027-02-14').map((m) => m.month)).toEqual(['2027-01']); // Feb's 15th hasn't come
    const months = autopayMonths(d, '2027-02-15');
    expect(months.map((m) => m.payments['debt:car'])).toEqual([{ datePaid: '2027-01-15', auto: true }, { datePaid: '2027-02-15', auto: true }]);
    const linked = linkedBills({ ...loan, startMonth: '2027-01' }, { bills: [bill], months }, '2027-02-15');
    expect(linked.payments.map((p) => [p.date, p.amountCents])).toEqual([['2027-01-15', 30_000], ['2027-02-15', 30_000]]);
    const s = cardSummary({ ...loan, startMonth: '2027-01' }, [], '2027-02-15', linked);
    expect(s.balanceNowCents).toBeLessThan(1_000_000 - 60_000 + 10_000); // two payments off, a little interest on
    expect(s.balanceNowCents).toBeGreaterThan(1_000_000 - 60_000);
  });
});

describe('combining debt bills of the same type', () => {
  const debt = (id: string, kind?: CreditCard['kind']): CreditCard => ({ id, kind, name: id, aprBps: 0, startBalanceCents: 0, startMonth: '2027-01', payments: [] });
  const row = (id: string, cardId: string | undefined, status: 'paid' | 'unpaid' | 'ended', amount = 10_000, counted = status === 'paid' ? amount : 0) => ({
    bill: { id, name: id, amountCents: amount, cardId },
    amountCents: amount,
    status,
    countedCents: counted,
  });
  const debts = [debt('a'), debt('b'), debt('c', 'auto-loan'), debt('d', 'student-loan'), debt('e')];

  it('groups bills that pay the same type of debt, where the first one was', () => {
    const rows = [row('rent', undefined, 'paid'), row('pa', 'a', 'paid', 5_000, 5_500), row('car', 'c', 'unpaid'), row('pb', 'b', 'unpaid', 2_000), row('pe', 'e', 'ended')];
    const items = groupDebtBills(rows, debts);
    expect(items.map((i) => (i.kind === 'bill' ? i.row.bill.id : `group:${i.id}`))).toEqual(['rent', 'group:credit-card', 'car']);
    const g = items[1];
    if (g.kind !== 'group') throw new Error('expected a group');
    expect(g.label).toBe('Credit cards');
    expect(g.rows.map((r) => r.bill.id)).toEqual(['pa', 'pb', 'pe']);
    expect([g.paid, g.amountCents]).toEqual([1, 5_500 + 2_000]); // the paid one counts what was paid, the unpaid its amount, the ended none
  });
  it('leaves a lone debt bill, and bills that pay nothing, as plain rows', () => {
    const items = groupDebtBills([row('pa', 'a', 'paid'), row('car', 'c', 'paid'), row('x', 'gone', 'unpaid')], debts);
    expect(items.every((i) => i.kind === 'bill')).toBe(true);
  });
});
