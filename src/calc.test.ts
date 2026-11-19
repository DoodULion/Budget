import { describe, expect, it } from 'vitest';
import {
  addMonths,
  autopayDate,
  autopayMonths,
  billRows,
  budgetTooHigh,
  checkingBalanceNowCents,
  formatCents,
  freedUpCents,
  leftForSpendingCents,
  leftoverCents,
  autoSavingsGoal,
  monthLabel,
  monthRange,
  monthSummary,
  roundDiv,
  thisMonth,
  yearSummary,
  type Data,
} from './calc';

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

const cat = (rows: { category: { id: string }; spentCents: number; leftCents: number }[], id: string) =>
  rows.find((r) => r.category.id === id)!;

describe('January 2027', () => {
  const jan = monthSummary(data(), '2027-01', TODAY);

  it('uses the baseline when no income is typed in', () => {
    expect(jan.incomeCents).toBe(300_000);
    expect(jan.incomeIsBaseline).toBe(true);
  });

  it('works out bill statuses and bills paid', () => {
    expect(jan.bills.map((b) => b.status)).toEqual(['paid', 'paid', 'unpaid']);
    expect(jan.unpaidCount).toBe(1);
    expect(jan.billsPaidCents).toBe(125_520);
  });

  it('totals spending overall and by category', () => {
    expect(jan.spentCents).toBe(23_575);
    expect(cat(jan.byCategory, 'food')).toMatchObject({ spentCents: 18_075, leftCents: 21_925 });
    expect(cat(jan.byCategory, 'fun')).toMatchObject({ spentCents: 4_500, leftCents: 5_500 });
    expect(cat(jan.byCategory, 'other')).toMatchObject({ spentCents: 1_000, leftCents: 4_000 });
    expect(jan.budgetLeftCents).toBe(31_425);
  });

  it('works out saved and vs goal', () => {
    expect(jan.savedCents).toBe(150_905);
    expect(jan.vsGoalCents).toBe(100_905);
  });
});

describe('February 2027', () => {
  const feb = monthSummary(data(), '2027-02', TODAY);

  it('uses the income typed in', () => {
    expect(feb.incomeCents).toBe(180_000);
    expect(feb.incomeIsBaseline).toBe(false);
  });

  it('marks an ended bill and counts only paid ones', () => {
    expect(feb.bills.map((b) => b.status)).toEqual(['paid', 'unpaid', 'ended']);
    expect(feb.bills[2].amountCents).toBe(0);
    expect(feb.unpaidCount).toBe(1);
    expect(feb.billsPaidCents).toBe(120_000);
  });

  it('shows a category over budget as negative left', () => {
    expect(feb.spentCents).toBe(47_000);
    expect(cat(feb.byCategory, 'food')).toMatchObject({ spentCents: 45_000, leftCents: -5_000 });
    expect(feb.budgetLeftCents).toBe(8_000);
  });

  it('works out saved below the goal', () => {
    expect(feb.savedCents).toBe(13_000);
    expect(feb.vsGoalCents).toBe(-37_000);
  });
});

describe('future months', () => {
  it('leave saved and vs goal blank', () => {
    const mar = monthSummary(data(), '2027-03', TODAY);
    expect(mar.future).toBe(true);
    expect(mar.savedCents).toBeUndefined();
    expect(mar.vsGoalCents).toBeUndefined();
  });
});

describe('bills', () => {
  it('counts a bill as paid when only an amount paid is entered', () => {
    const d = data();
    d.months[1].payments.phone = { amountPaidCents: 4_000 };
    expect(billRows(d, '2027-02')[1]).toMatchObject({ status: 'paid', countedCents: 4_000 });
  });

  it('keeps a deleted bill only where it was paid', () => {
    const d = data();
    d.bills[1].deleted = true;
    expect(billRows(d, '2027-01').map((r) => r.bill.id)).toEqual(['rent', 'phone', 'gym']);
    expect(billRows(d, '2027-02').map((r) => r.bill.id)).toEqual(['rent', 'gym']);
  });
});

describe('planning', () => {
  it('works out left for spending from the bills active that month', () => {
    const d = data();
    expect(leftForSpendingCents(d, '2027-01')).toBe(122_000);
    expect(leftForSpendingCents(d, '2027-02')).toBe(125_000);
    // Left over after bills and budgets: what "Use what's left" puts in the savings goal.
    expect(leftoverCents(d, '2027-01')).toBe(117_000);
    expect(leftoverCents(d, '2027-02')).toBe(120_000);
    // "Save all that's left": the goal follows the left-over amount, never below 0.
    expect(autoSavingsGoal(d, '2027-02-15')).toBeUndefined();
    const on = { ...d, settings: { ...d.settings, saveAllLeft: true } };
    expect(autoSavingsGoal(on, '2027-02-15')).toBe(120_000);
    expect(autoSavingsGoal(on, '2027-01-15')).toBe(117_000);
    expect(autoSavingsGoal({ ...on, categories: on.categories.map((c) => ({ ...c, budgetCents: 200_000 })) }, '2027-02-15')).toBe(0);
    expect(budgetTooHigh(d, '2027-01')).toBe(false);
    expect(budgetTooHigh(d, '2027-02')).toBe(false);
  });

  it('warns when the budgets add up to more', () => {
    const d = data();
    d.categories[0].budgetCents = 200_000;
    expect(budgetTooHigh(d, '2027-01')).toBe(true);
  });

  it('totals the bills that end', () => {
    expect(freedUpCents(data().bills)).toBe(3_000);
  });
});

describe('year 2027', () => {
  const year = yearSummary(data(), 2027, TODAY);

  it('picks this month', () => {
    expect(year.thisMonth).toBe('2027-02');
    const feb = year.rows.find((r) => r.summary.month === '2027-02')!.summary;
    expect(feb.spentCents).toBe(47_000);
    expect(feb.budgetLeftCents).toBe(8_000);
  });

  it('totals saved, goal months and balance', () => {
    expect(year.savedToDateCents).toBe(163_905);
    expect(year.monthsGoalMetLabel).toBe('1 of 2');
    expect(year.checkingBalanceNowCents).toBe(363_905);
  });

  it('carries the checking balance forward month by month', () => {
    expect(year.rows.map((r) => r.balanceCents).slice(0, 3)).toEqual([350_905, 363_905, undefined]);
    expect(year.rows).toHaveLength(12);
  });

  it('averages each category over the started months', () => {
    const food = year.categories.find((c) => c.category.id === 'food')!;
    expect(food.totalCents).toBe(63_075);
    expect(food.avgPerMonthCents).toBe(31_538);
    expect(food.thisMonthCents).toBe(45_000);
    expect(food.leftThisMonthCents).toBe(-5_000);
    expect(year.categories.find((c) => c.category.id === 'fun')!.avgPerMonthCents).toBe(3_250);
    expect(year.categories.find((c) => c.category.id === 'other')!.avgPerMonthCents).toBe(500);
  });
});

describe('before the first month', () => {
  const today = '2026-12-10';

  it('shows the first month with nothing counted yet', () => {
    const d = data();
    expect(thisMonth(d.settings, today)).toBe('2027-01');
    const year = yearSummary(d, 2027, today);
    expect(year.monthsGoalMetLabel).toBe('0 of 0');
    expect(year.savedToDateCents).toBe(0);
    expect(year.checkingBalanceNowCents).toBe(200_000);
    expect(checkingBalanceNowCents(d, today)).toBe(200_000);
  });
});

describe('helpers', () => {
  it('steps through months across years', () => {
    expect(addMonths('2027-12', 1)).toBe('2028-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2027-02', '2027-01')).toEqual([]);
  });

  it('rounds halves away from zero', () => {
    expect(roundDiv(63_075, 2)).toBe(31_538);
    expect(roundDiv(-63_075, 2)).toBe(-31_538);
    expect(roundDiv(10, 3)).toBe(3);
  });

  it('formats money and months', () => {
    expect(formatCents(163_905)).toBe('$1,639.05');
    expect(formatCents(-5_000)).toBe('−$50.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(monthLabel('2027-02')).toBe('Feb 2027');
  });
});

describe('autopay', () => {
  const base = (): Data => ({
    ...data(),
    bills: [{ id: 'rent', name: 'Rent', amountCents: 120_000, autoPay: { day: 5, since: '2027-01' } }],
    months: [],
  });

  it('records a payment on the autopay day of every month that has reached it', () => {
    const got = autopayMonths(base(), '2027-02-15');
    expect(got.map((m) => [m.month, m.payments.rent])).toEqual([
      ['2027-01', { datePaid: '2027-01-05', auto: true }],
      ['2027-02', { datePaid: '2027-02-05', auto: true }],
    ]);
  });

  it('waits for the day, and uses the last day of a short month', () => {
    expect(autopayMonths(base(), '2027-02-04').map((m) => m.month)).toEqual(['2027-01']);
    expect(autopayDate('2027-02', 31)).toBe('2027-02-28');
    expect(autopayDate('2028-02', 31)).toBe('2028-02-29');
  });

  it('starts at the since month and never before the first tracked month', () => {
    const d = base();
    d.bills[0].autoPay = { day: 5, since: '2027-02' };
    expect(autopayMonths(d, '2027-02-15').map((m) => m.month)).toEqual(['2027-02']);
    d.bills[0].autoPay = { day: 5, since: '2026-06' };
    expect(autopayMonths(d, '2027-02-15').map((m) => m.month)).toEqual(['2027-01', '2027-02']);
  });

  it('leaves months with a payment entry alone, including a skipped one', () => {
    const d = base();
    d.months = [
      { month: '2027-01', payments: { rent: { datePaid: '2027-01-09', amountPaidCents: 100_000 } } },
      { month: '2027-02', payments: { rent: { skipped: true } } },
    ];
    expect(autopayMonths(d, '2027-02-15')).toEqual([]);
    expect(billRows(d, '2027-02')[0].status).toBe('unpaid');
  });

  it('skips bills that pay a paid-off debt', () => {
    const d = base();
    d.bills[0].cardId = 'car';
    expect(autopayMonths(d, '2027-02-15', new Set(['car']))).toEqual([]);
    expect(autopayMonths(d, '2027-02-15', new Set(['other'])).map((m) => m.month)).toEqual(['2027-01', '2027-02']);
  });

  it('keeps the other bills and records of a month it fills in', () => {
    const d = base();
    d.bills.push({ id: 'phone', name: 'Phone', amountCents: 5_000 });
    d.months = [{ month: '2027-01', incomeCents: 290_000, payments: { phone: { datePaid: '2027-01-02' } } }];
    const jan = autopayMonths(d, '2027-01-20')[0];
    expect(jan).toEqual({ month: '2027-01', incomeCents: 290_000, payments: { phone: { datePaid: '2027-01-02' }, rent: { datePaid: '2027-01-05', auto: true } } });
  });

  it('skips ended and removed bills', () => {
    const d = base();
    d.bills[0].lastMonth = '2027-01';
    expect(autopayMonths(d, '2027-02-15').map((m) => m.month)).toEqual(['2027-01']);
    d.bills[0].deleted = true;
    expect(autopayMonths(d, '2027-02-15')).toEqual([]);
  });

  it('counts an autopaid bill as paid in Bills paid', () => {
    const d = base();
    d.months = autopayMonths(d, '2027-01-20');
    expect(billRows(d, '2027-01')[0]).toMatchObject({ status: 'paid', countedCents: 120_000 });
  });
});
