import { describe, expect, it } from 'vitest';
import type { Data } from './calc';
import { builtInGoals, scoreGoal, yearInsights, type MonthlyResult, type TargetResult } from './goals';

// Made-up figures only (CLAUDE.md, "Privacy rule" and "Test cases").
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
    cards: [],
    bills: [
      { id: 'rent', name: 'Rent', amountCents: 120_000 },
      { id: 'phone', name: 'Phone', amountCents: 5_000 },
      { id: 'gym', name: 'Gym', amountCents: 3_000, lastMonth: '2027-01' },
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


const monthly = (r: ReturnType<typeof scoreGoal>) => r as MonthlyResult;
const target = (r: ReturnType<typeof scoreGoal>) => r as TargetResult;

describe('goals for the year', () => {
  it('scores the built-in savings goal and spending budget', () => {
    const [save, spend] = builtInGoals(data()).map((g) => monthly(scoreGoal(data(), g, TODAY)));
    // Jan saved $1,509.05 (met); Feb so far $130.00 is still in progress, not missed yet
    expect([save.met, save.of, save.streak]).toEqual([1, 1, 1]);
    expect(save.months.slice(0, 3).map((m) => m.state)).toEqual(['met', 'pending', 'future']);
    expect(save.months).toHaveLength(12);
    expect([spend.met, spend.of, spend.streak]).toEqual([2, 2, 2]);
  });

  it('a category cap is missed for good once a month goes over', () => {
    const food = monthly(scoreGoal(data(), { id: 'g', kind: 'category-month', categoryId: 'food', amountCents: 40_000 }, TODAY));
    expect([food.met, food.of, food.streak]).toEqual([1, 2, 0]);
    expect(food.months[1].state).toBe('missed');
  });

  it('every bill paid: a month with an unpaid bill misses it, this month waits', () => {
    const bills = monthly(scoreGoal(data(), { id: 'g', kind: 'bills-paid' }, TODAY));
    expect([bills.met, bills.of]).toEqual([0, 1]);
    expect(bills.months[1].state).toBe('pending');
  });

  it('target goals: save for the year and reach a cash balance', () => {
    const year = target(scoreGoal(data(), { id: 'g', kind: 'save-year', amountCents: 600_000 }, TODAY));
    expect(year.nowCents).toBe(163_905);
    expect(year.monthsLeft).toBe(11);
    expect(year.neededPerMonthCents).toBe(39_645);
    expect(year.onTrack).toBe(true);
    const cash = target(scoreGoal(data(), { id: 'g', kind: 'cash', amountCents: 1_000_000, by: '2027-12' }, TODAY));
    expect(cash.nowCents).toBe(363_905);
    expect(cash.neededPerMonthCents).toBe(57_827);
    expect(cash.onTrack).toBe(true);
    expect(target(scoreGoal(data(), { id: 'g', kind: 'cash', amountCents: 300_000, by: '2027-12' }, TODAY)).done).toBe(true);
  });

  it('pay off a debt by a month', () => {
    const d = data();
    d.cards = [{ id: 'car', kind: 'auto-loan', name: 'Car loan', aprBps: 600, startBalanceCents: 1_000_000, startMonth: '2027-01', minPaymentCents: 30_000, payments: [{ id: 'x', date: '2027-01-10', amountCents: 30_000 }] }];
    const r = target(scoreGoal(d, { id: 'g', kind: 'debt-off', debtId: 'car', by: '2027-12' }, '2027-03-15'));
    expect(r.nowCents).toBe(979_724);
    expect(r.monthsLeft).toBe(10);
    expect(r.neededPerMonthCents).toBe(97_972);
    expect(r.onTrack).toBe(false); // the $300.00 minimum isn't enough
    expect(r.done).toBe(false);
  });

  it('year insights', () => {
    const y = yearInsights(data(), TODAY);
    expect(y.monthsCounted).toBe(2);
    expect(y.savedCents).toBe(163_905);
    expect(y.goalToDateCents).toBe(100_000);
    expect(y.avgSavedCents).toBe(81_953);
    expect(y.best).toEqual({ month: '2027-01', savedCents: 150_905 });
    expect(y.worst).toEqual({ month: '2027-02', savedCents: 13_000 });
    expect([y.categoryKept, y.categoryOf]).toEqual([5, 6]);
    expect(y.mostOver).toEqual({ categoryId: 'food', months: 1, overCents: 5_000 });
    expect(y.yearGoalCents).toBe(600_000);
    expect(y.monthsLeft).toBe(10);
    expect(y.neededPerMonthCents).toBe(43_610);
  });
});
