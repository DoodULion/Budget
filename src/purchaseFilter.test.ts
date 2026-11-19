import { describe, expect, it } from 'vitest';
import type { Category, Purchase } from './calc';
import { applyFilter, byDay, filterCount, NO_FILTER } from './purchaseFilter';

// Made-up figures only.
const cats: Category[] = [
  { id: 'food', name: 'Food', budgetCents: 0, color: 'c1' },
  { id: 'fun', name: 'Fun', budgetCents: 0, color: 'c2' },
];
const ps: Purchase[] = [
  { id: '1', date: '2027-01-03', categoryId: 'food', amountCents: 1_250, description: 'Lunch', paidWith: 'Card A' },
  { id: '2', date: '2027-01-03', categoryId: 'fun', amountCents: 4_500, note: 'movie night' },
  { id: '3', date: '2027-01-05', categoryId: 'food', amountCents: 120_000, paidWith: 'Card B' },
];
const ids = (list: Purchase[]) => list.map((p) => p.id);

describe('purchase search and filter', () => {
  it('matches every word against category, text, amount and date', () => {
    expect(ids(applyFilter(ps, cats, 'food', NO_FILTER))).toEqual(['1', '3']);
    expect(ids(applyFilter(ps, cats, 'movie', NO_FILTER))).toEqual(['2']);
    expect(ids(applyFilter(ps, cats, '1,200', NO_FILTER))).toEqual(['3']);
    expect(ids(applyFilter(ps, cats, '12.50 lunch', NO_FILTER))).toEqual(['1']);
    expect(ids(applyFilter(ps, cats, '1/5', NO_FILTER))).toEqual(['3']);
  });

  it('filters by category, paid with and amount range', () => {
    expect(ids(applyFilter(ps, cats, '', { ...NO_FILTER, categoryIds: ['fun'] }))).toEqual(['2']);
    expect(ids(applyFilter(ps, cats, '', { ...NO_FILTER, paidWith: ['Card B'] }))).toEqual(['3']);
    expect(ids(applyFilter(ps, cats, '', { ...NO_FILTER, minCents: 2_000, maxCents: 50_000 }))).toEqual(['2']);
  });

  it('counts the filters that are on', () => {
    expect(filterCount(NO_FILTER)).toBe(0);
    expect(filterCount({ categoryIds: ['a', 'b'], paidWith: [], minCents: 0 })).toBe(2);
  });

  it('groups by day, newest first, with day totals', () => {
    const groups = byDay(ps);
    expect(groups.map((g) => g.date)).toEqual(['2027-01-05', '2027-01-03']);
    expect(groups[1].totalCents).toBe(5_750);
    expect(ids(groups[1].items)).toEqual(['2', '1']);
  });
});
