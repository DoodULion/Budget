import { describe, expect, it } from 'vitest';
import type { Data } from './calc';
import { cashReaches, changeImpact, debtFreeMonth, firstSimMonth, monthsToReach, neededPerMonth, payoffImpact, project, recentSpendingCents, budgetSpendingCents, type Change } from './simulate';

// Made-up figures only (CLAUDE.md, "Test cases"), plus a made-up Car loan: 6% APR, $1,000.00 owed from 2027-02, $300.00 minimum.
const TODAY = '2027-02-15';

function data(): Data {
  return {
    settings: {
      incomeBaselineCents: 300_000,
      savingsGoalCents: 50_000,
      startingBalanceCents: 200_000,
      firstMonth: '2027-01',
      paidWith: ['Card A', 'Card B'],
      setupDone: true,
    },
    cards: [{ id: 'car', kind: 'auto-loan', name: 'Car loan', aprBps: 600, startBalanceCents: 100_000, startMonth: '2027-02', minPaymentCents: 30_000, payments: [] }],
    bills: [
      { id: 'rent', name: 'Rent', amountCents: 120_000 },
      { id: 'phone', name: 'Phone', amountCents: 5_000 },
      { id: 'gym', name: 'Gym', amountCents: 3_000, lastMonth: '2027-01' },
      { id: 'debt:car', name: 'Car loan payment', amountCents: 30_000, cardId: 'car' },
    ],
    categories: [
      { id: 'food', name: 'Food', budgetCents: 40_000, color: '#000' },
      { id: 'fun', name: 'Fun', budgetCents: 10_000, color: '#000' },
      { id: 'other', name: 'Other', budgetCents: 5_000, color: '#000' },
    ],
    months: [
      {
        month: '2027-01',
        payments: { rent: { datePaid: '2027-01-01' }, phone: { datePaid: '2027-01-05', amountPaidCents: 5_520 } },
      },
      { month: '2027-02', incomeCents: 180_000, payments: { rent: { datePaid: '2027-02-01' } } },
    ],
    purchases: [
      { id: 'p1', date: '2027-01-03', categoryId: 'food', amountCents: 12_050 },
      { id: 'p2', date: '2027-01-20', categoryId: 'food', amountCents: 6_025 },
      { id: 'p3', date: '2027-01-21', categoryId: 'fun', amountCents: 4_500 },
      { id: 'p4', date: '2027-01-31', categoryId: 'other', amountCents: 1_000 },
      { id: 'p5', date: '2027-02-02', categoryId: 'food', amountCents: 45_000 },
      { id: 'p6', date: '2027-02-10', categoryId: 'fun', amountCents: 2_000 },
    ],
  };
}

const input = (horizon = 6) => ({ data: data(), today: TODAY, horizon, spendingCents: budgetSpendingCents(data()) });

describe('spend simulator', () => {
  const base = project(input());
  it('starts with next month from the checking balance now', () => {
    expect(firstSimMonth(data(), TODAY)).toBe('2027-03');
    expect(firstSimMonth(data(), '2026-12-10')).toBe('2027-01');
    expect(base.startCashCents).toBe(363_905);
    expect(base.months.map((m) => m.month)).toEqual(['2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08']);
  });
  it('pays debts down with their bills and frees the bill up once they are gone', () => {
    expect(base.months.map((m) => m.billsCents)).toEqual([155_000, 155_000, 155_000, 135_605, 125_000, 125_000]);
    expect(base.months.map((m) => m.savedCents)).toEqual([90_000, 90_000, 90_000, 109_395, 120_000, 120_000]);
    expect(base.months.map((m) => m.debtCents)).toEqual([70_350, 40_552, 10_605, 0, 0, 0]);
    expect(base.debts[0]).toMatchObject({ name: 'Car loan', paidOffMonth: '2027-06', interestCents: 605, noPayment: false });
    expect(debtFreeMonth(base)).toBe('2027-06');
    expect(base).toMatchObject({ totalSavedCents: 619_395, endCashCents: 983_300, avgSavedCents: 103_233, goalMet: 6 });
  });
  it('paying a debt off from cash: the lump, what it frees up, interest saved and when cash catches up', () => {
    const payoff: Change = { id: 'a', kind: 'payoff', debtId: 'car', month: '2027-03' };
    const scen = project(input(), [payoff]);
    expect(scen.months.map((m) => m.cashCents)).toEqual([383_905, 503_905, 623_905, 743_905, 863_905, 983_905]);
    expect(payoffImpact(base, scen, payoff)).toEqual({ lumpCents: 100_000, freedCents: 30_000, interestSavedCents: 605, caughtUp: '2027-06' });
  });
  it('changes, removes and adds fixed bills, income, spending and one-time amounts', () => {
    const scen = project(input(), [
      { id: '1', kind: 'bill', billId: 'phone', amountCents: 0, from: '2027-04' },
      { id: '2', kind: 'newBill', name: 'Streaming', amountCents: 2_000, from: '2027-03', to: '2027-04' },
      { id: '3', kind: 'oneTime', name: 'Trip', amountCents: 50_000, month: '2027-05' },
      { id: '4', kind: 'oneTime', name: 'Bonus', amountCents: 20_000, month: '2027-08', income: true },
      { id: '5', kind: 'income', amountCents: 310_000, from: '2027-07' },
      { id: '6', kind: 'spending', amountCents: 45_000, from: '2027-08' },
    ]);
    expect(scen.months.map((m) => m.billsCents)).toEqual([157_000, 152_000, 150_000, 130_605, 120_000, 120_000]);
    expect(scen.months.map((m) => m.savedCents)).toEqual([88_000, 93_000, 95_000, 114_395, 135_000, 145_000]);
    expect(scen.months.map((m) => m.oneTimeCents)).toEqual([0, 0, 50_000, 0, 0, -20_000]);
    expect(scen.endCashCents).toBe(363_905 + 670_395 - 30_000);
  });
  it('an extra payment clears a debt sooner', () => {
    const scen = project(input(), [{ id: 'x', kind: 'extra', debtId: 'car', amountCents: 20_000, from: '2027-03' }]);
    expect(scen.debts[0].paidOffMonth).toBe('2027-05');
    expect(scen.debts[0].interestCents).toBeLessThan(605);
  });
  it('how long a monthly saving takes to reach a cash balance, and what reaching it by a month needs', () => {
    expect(monthsToReach(363_905, 1_000_000, 90_000, '2027-03')).toEqual({ kind: 'months', months: 8, month: '2027-10' });
    expect(monthsToReach(363_905, 300_000, 90_000, '2027-03')).toEqual({ kind: 'already' });
    expect(monthsToReach(363_905, 1_000_000, 0, '2027-03')).toEqual({ kind: 'never' });
    expect(neededPerMonth(363_905, 1_000_000, '2027-03', '2027-12')).toBe(63_610);
    expect(cashReaches(base, 700_000)).toBe('2027-06');
    expect(cashReaches(base, 2_000_000)).toBeUndefined();
  });
  it('spending as budgeted or as the recent average', () => {
    expect(budgetSpendingCents(data())).toBe(55_000);
    expect(recentSpendingCents(data(), TODAY)).toBe(35_288);
  });
});

describe('paying a debt down part of the way', () => {
  it('takes the amount from cash, lowers the balance and saves interest, without clearing it early', () => {
    const base = project(input());
    const down: Change = { id: 'd', kind: 'payoff', debtId: 'car', month: '2027-03', amountCents: 40_000 };
    const scen = project(input(), [down]);
    expect(scen.months[0]).toMatchObject({ oneTimeCents: 40_000, debtCents: 30_150 }); // (1,000 − 400 − 300) + 1.50 interest
    expect(scen.debts[0].paidOffMonth).toBe('2027-05'); // $1.50 and 1¢ of interest are left for May
    const impact = payoffImpact(base, scen, down);
    expect(impact.lumpCents).toBe(40_000);
    expect(impact.interestSavedCents).toBe(605 - 151);
  });
});

describe('taking on a new debt', () => {
  // Made-up: a $1,200.00 personal loan at 12% in 2027-04, paid $400.00 a month from May, the money landing in checking.
  const loan: Change = { id: 'n', kind: 'newDebt', name: 'Personal loan', amountCents: 120_000, aprBps: 1200, paymentCents: 40_000, month: '2027-04', cashIn: true };
  const { before, after } = changeImpact(input(), [], loan);
  it('adds its payment to the bills until it is paid off, with its interest', () => {
    expect(after.months.map((m, i) => m.billsCents - before.months[i].billsCents)).toEqual([0, 0, 40_000, 40_000, 40_000, 2_456]);
    expect(after.debts.find((d) => d.isNew)).toMatchObject({ name: 'Personal loan', paidOffMonth: '2027-08', interestCents: 2_456, firstInterestCents: 1_200 });
  });
  it('puts the money in checking when it comes as cash', () => {
    expect(after.months[1].oneTimeCents).toBe(-120_000);
    expect(after.endCashCents - before.endCashCents).toBe(-2_456); // borrowed 1,200, paid back 1,200 plus the interest
  });
});
