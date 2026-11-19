import { describe, expect, it } from 'vitest';
import type { Purchase } from './calc';
import { cardMonths, cardSummary, formatApr, parseApr, payoff, payoffForMonth, projection, totalSeries, type CreditCard } from './cards';

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
