/**
 * App state: everything loaded from the device once, kept in React state, and written through to IndexedDB.
 * Screens call these actions; none of them touch the database directly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  emptySettings,
  monthOf,
  nextCategoryColor,
  SUGGESTED_CATEGORIES,
  type Bill,
  type BillPayment,
  type Category,
  type Data,
  type Month,
  type MonthKey,
  type Purchase,
  type Settings,
} from './calc';
import * as db from './db';
import { newId, todayLocal } from './money';

export interface Store {
  data: Data;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  putBill: (bill: Bill) => Promise<void>;
  /** Removes the bill; it stays on months where it was paid. */
  removeBill: (id: string) => Promise<void>;
  putCategory: (category: Category) => Promise<void>;
  addCategory: (name: string, budgetCents?: number) => Promise<Category>;
  /** Stops offering the category; past purchases keep it. */
  removeCategory: (id: string) => Promise<void>;
  setIncome: (month: MonthKey, incomeCents: number | undefined) => Promise<void>;
  setPayment: (month: MonthKey, billId: string, payment: BillPayment | undefined) => Promise<void>;
  putPurchase: (purchase: Purchase) => Promise<void>;
  removePurchase: (id: string) => Promise<void>;
  replaceAll: (data: Data) => Promise<void>;
  clearAll: () => Promise<void>;
}

export type AppState = { ready: false } | ({ ready: true } & Store);

export function useStore(): AppState {
  const [data, setData] = useState<Data>();

  useEffect(() => {
    void db.requestPersistence();
    void (async () => {
      const loaded = await db.loadData();
      // First launch: offer the suggested category names, with budgets left empty.
      if (!loaded.settings.setupDone && loaded.categories.length === 0) {
        loaded.categories = SUGGESTED_CATEGORIES.map((name, i) => ({ id: newId() + i, name, budgetCents: 0, color: `c${i + 1}` }));
        await Promise.all(loaded.categories.map(db.putCategory));
      }
      setData(loaded);
    })();
  }, []);

  const update = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), []);

  const actions = useMemo(() => {
    const monthRecord = (d: Data, month: MonthKey): Month => d.months.find((m) => m.month === month) ?? { month, payments: {} };
    const withMonth = (d: Data, m: Month): Data => ({ ...d, months: [...d.months.filter((x) => x.month !== m.month), m] });

    return {
      async saveSettings(patch: Partial<Settings>) {
        let next: Settings | undefined;
        update((d) => {
          next = { ...d.settings, ...patch };
          return { ...d, settings: next };
        });
        if (next) await db.saveSettings(next);
      },
      async putBill(bill: Bill) {
        update((d) => ({ ...d, bills: d.bills.some((b) => b.id === bill.id) ? d.bills.map((b) => (b.id === bill.id ? bill : b)) : [...d.bills, bill] }));
        await db.putBill(bill);
      },
      async removeBill(id: string) {
        let gone: Bill | undefined;
        update((d) => {
          const bill = d.bills.find((b) => b.id === id);
          if (!bill) return d;
          const paidSomewhere = d.months.some((m) => m.payments[id]);
          gone = paidSomewhere ? { ...bill, deleted: true } : undefined;
          return { ...d, bills: paidSomewhere ? d.bills.map((b) => (b.id === id ? gone! : b)) : d.bills.filter((b) => b.id !== id) };
        });
        if (gone) await db.putBill(gone);
        else await db.deleteBill(id);
      },
      async putCategory(category: Category) {
        update((d) => ({
          ...d,
          categories: d.categories.some((c) => c.id === category.id)
            ? d.categories.map((c) => (c.id === category.id ? category : c))
            : [...d.categories, category],
        }));
        await db.putCategory(category);
      },
      async addCategory(name: string, budgetCents = 0) {
        let made: Category | undefined;
        update((d) => {
          made = { id: newId(), name, budgetCents, color: nextCategoryColor(d.categories) };
          return { ...d, categories: [...d.categories, made] };
        });
        await db.putCategory(made!);
        return made!;
      },
      async removeCategory(id: string) {
        let changed: Category | undefined;
        let dropped = false;
        update((d) => {
          const cat = d.categories.find((c) => c.id === id);
          if (!cat) return d;
          if (d.purchases.some((p) => p.categoryId === id)) {
            changed = { ...cat, deleted: true };
            return { ...d, categories: d.categories.map((c) => (c.id === id ? changed! : c)) };
          }
          dropped = true;
          return { ...d, categories: d.categories.filter((c) => c.id !== id) };
        });
        if (changed) await db.putCategory(changed);
        else if (dropped) await db.deleteCategory(id);
      },
      async setIncome(month: MonthKey, incomeCents: number | undefined) {
        let rec: Month | undefined;
        update((d) => {
          rec = { ...monthRecord(d, month), incomeCents };
          if (incomeCents === undefined) delete rec.incomeCents;
          return withMonth(d, rec);
        });
        if (rec) await db.putMonth(rec);
      },
      async setPayment(month: MonthKey, billId: string, payment: BillPayment | undefined) {
        let rec: Month | undefined;
        update((d) => {
          const base = monthRecord(d, month);
          const payments = { ...base.payments };
          if (payment && (payment.datePaid !== undefined || payment.amountPaidCents !== undefined)) payments[billId] = payment;
          else delete payments[billId];
          rec = { ...base, payments };
          return withMonth(d, rec);
        });
        if (rec) await db.putMonth(rec);
      },
      async putPurchase(purchase: Purchase) {
        update((d) => ({
          ...d,
          purchases: d.purchases.some((p) => p.id === purchase.id)
            ? d.purchases.map((p) => (p.id === purchase.id ? purchase : p))
            : [...d.purchases, purchase],
        }));
        await db.putPurchase(purchase);
      },
      async removePurchase(id: string) {
        update((d) => ({ ...d, purchases: d.purchases.filter((p) => p.id !== id) }));
        await db.deletePurchase(id);
      },
      async replaceAll(next: Data) {
        await db.replaceAll(next);
        setData(next);
      },
      async clearAll() {
        await db.clearAll();
        const fresh: Data = {
          settings: emptySettings(monthOf(todayLocal())),
          bills: [],
          categories: SUGGESTED_CATEGORIES.map((name, i) => ({ id: newId() + i, name, budgetCents: 0, color: `c${i + 1}` })),
          months: [],
          purchases: [],
        };
        await Promise.all(fresh.categories.map(db.putCategory));
        setData(fresh);
      },
    };
  }, [update]);

  if (!data) return { ready: false };
  return { ready: true, data, ...actions };
}
