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
    cards: [],
    bills: [{ id: 'rent', name: 'Rent', amountCents: 120_000, lastMonth: '2027-06', cardId: 'v', autoPay: { day: 5, since: '2027-01' } }],
    categories: [
      { id: 'food', name: 'Food', budgetCents: 40_000, color: '#000' },
      { id: 'old', name: 'Old', budgetCents: 0, color: '#000', deleted: true },
    ],
    months: [{ month: '2027-01', incomeCents: 290_000, payments: { rent: { datePaid: '2027-01-05', auto: true } } }, { month: '2027-02', payments: { rent: { skipped: true } } }],
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

  it('round-trips credit cards and payments', () => {
    const d = data();
    d.cards = [
      { id: 'v', name: 'Card A', aprBps: 2499, startBalanceCents: 100_000, startMonth: '2027-01', limitCents: 500_000, plannedPaymentCents: 5_000, payments: [{ id: 'p', date: '2027-02-01', amountCents: 2_500 }] },
    ];
    d.cards.push({ id: 'car', kind: 'auto-loan', name: 'Car loan', aprBps: 600, startBalanceCents: 1_000_000, startMonth: '2027-01', minPaymentCents: 30_000, payments: [] });
    expect(parseBackup(toBackup(d))).toEqual(d);
  });

  it('reads a backup made before the Cards tab (no cards)', () => {
    const { cards: _cards, ...old } = data();
    expect(parseBackup(JSON.stringify({ app: 'budget-tracker', version: 1, data: old })).cards).toEqual([]);
  });

  it('rejects damaged autopay settings', () => {
    const d = data() as unknown as { bills: { autoPay: unknown }[] };
    d.bills[0].autoPay = { day: 32, since: '2027-01' };
    expect(() => parseBackup(JSON.stringify({ app: 'budget-tracker', version: 1, data: d }))).toThrow(/bills/);
  });

  it('rejects damaged cards', () => {
    const d = data() as unknown as { cards: unknown[] };
    d.cards = [{ id: 'v', name: 'Card A', aprBps: 24.99, startBalanceCents: 0, startMonth: '2027-01', payments: [] }];
    expect(() => parseBackup(JSON.stringify({ app: 'budget-tracker', version: 1, data: d }))).toThrow(/cards/);
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
