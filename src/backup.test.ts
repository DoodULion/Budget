import { describe, expect, it } from 'vitest';
import { BackupError, CSV_HEADER, parseBackup, toBackup, toCsv } from './backup';
import type { Data } from './calc';

// Made-up figures only.
function data(): Data {
  return {
    settings: {
      incomeBaselineCents: 300_000,
      savingsGoalCents: 50_000,
      startingBalanceCents: 200_000,
      firstMonth: '2027-01',
      paidWith: ['Card A'],
      setupDone: true,
    },
    bills: [{ id: 'rent', name: 'Rent', amountCents: 120_000, lastMonth: '2027-06' }],
    categories: [
      { id: 'food', name: 'Food', budgetCents: 40_000, color: '#000' },
      { id: 'old', name: 'Old', budgetCents: 0, color: '#000', deleted: true },
    ],
    months: [{ month: '2027-01', incomeCents: 290_000, payments: { rent: { datePaid: '2027-01-01' } } }],
    purchases: [
      { id: 'b', date: '2027-01-05', categoryId: 'food', amountCents: 1_250, description: 'Lunch, "deli"', paidWith: 'Card A' },
      { id: 'a', date: '2027-01-02', categoryId: 'gone', amountCents: 99, note: '=SUM(A1)' },
    ],
  };
}

describe('JSON backup', () => {
  it('round-trips everything', () => {
    const d = data();
    expect(parseBackup(toBackup(d))).toEqual(d);
  });

  it('rejects files that are not a backup', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: 'japan-trip', version: 2 }))).toThrow(/not a Budget Tracker backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'budget-tracker', version: 99, data: {} }))).toThrow(/newer version/);
  });

  it('rejects damaged data', () => {
    const d = data() as unknown as { purchases: { amountCents: unknown }[] };
    d.purchases[0].amountCents = 12.5;
    expect(() => parseBackup(JSON.stringify({ app: 'budget-tracker', version: 1, data: d }))).toThrow(/purchases/);
  });
});

describe('CSV export', () => {
  it('lists purchases oldest first with safe cells', () => {
    const lines = toCsv(data()).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines[1]).toBe("2027-01-02,2027-01,(deleted),,0.99,,'=SUM(A1)");
    expect(lines[2]).toBe('2027-01-05,2027-01,Food,"Lunch, ""deli""",12.50,Card A,');
  });

  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv(data()).startsWith('﻿')).toBe(true);
  });
});
