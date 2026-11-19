/** Search and filter for the Purchases list. Pure, tested in purchaseFilter.test.ts. */
import { formatCents, type Category, type Purchase } from './calc';
import { dayLabel } from './money';

export interface PurchaseFilter {
  categoryIds: string[];
  paidWith: string[];
  minCents?: number;
  maxCents?: number;
}

export const NO_FILTER: PurchaseFilter = { categoryIds: [], paidWith: [] };

/** How many filter settings are on (for the badge on the filter button). */
export function filterCount(f: PurchaseFilter): number {
  return (f.categoryIds.length ? 1 : 0) + (f.paidWith.length ? 1 : 0) + (f.minCents !== undefined ? 1 : 0) + (f.maxCents !== undefined ? 1 : 0);
}

/** Text a purchase can be found by: category, description, note, paid with, amount and date. */
function haystack(p: Purchase, categories: Category[]): string {
  const cat = categories.find((c) => c.id === p.categoryId)?.name ?? '';
  const amt = formatCents(p.amountCents);
  return [cat, p.description, p.note, p.paidWith, amt, amt.replace(/[$,]/g, ''), p.date, dayLabel(p.date)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function applyFilter(purchases: Purchase[], categories: Category[], query: string, f: PurchaseFilter): Purchase[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return purchases.filter((p) => {
    if (f.categoryIds.length && !f.categoryIds.includes(p.categoryId)) return false;
    if (f.paidWith.length && !f.paidWith.includes(p.paidWith ?? '')) return false;
    if (f.minCents !== undefined && p.amountCents < f.minCents) return false;
    if (f.maxCents !== undefined && p.amountCents > f.maxCents) return false;
    if (words.length) {
      const h = haystack(p, categories);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

/** Purchases grouped by day, newest day first, newest entry first within a day. */
export function byDay(purchases: Purchase[]): { date: string; items: Purchase[]; totalCents: number }[] {
  const map = new Map<string, Purchase[]>();
  for (const p of purchases) map.set(p.date, [...(map.get(p.date) ?? []), p]);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, items]) => ({ date, items: items.slice().reverse(), totalCents: items.reduce((s, p) => s + p.amountCents, 0) }));
}
