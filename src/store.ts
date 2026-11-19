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
import { debtBill, debtBillId, isLoan, type CreditCard } from './cards';
import * as db from './db';
import { newId, todayLocal } from './money';

export interface Store {
  data: Data;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  putBill: (bill: Bill) => Promise<void>;
  /** Removes the bill; it stays on months where it was paid. */
  removeBill: (id: string) => Promise<void>;
  /**
   * Add or change a credit card. Its name is also a Paid with name: it is added to the list, and on a rename
   * (`oldName`) the list entry and every purchase tagged with the old name follow, so balances stay linked.
   */
  saveCard: (card: CreditCard, oldName?: string) => Promise<void>;
  /** Rename a Paid with name everywhere: the list, purchases tagged with it, and a card that uses it. */
  renamePaidWith: (oldName: string, newName: string) => Promise<void>;
  /** Removes the card's balance tracking; the Paid with name and tagged purchases stay. */
  removeCard: (id: string) => Promise<void>;
  putCategory: (category: Category) => Promise<void>;
  addCategory: (name: string, budgetCents?: number, color?: string) => Promise<Category>;
  /** Stops offering the category; past purchases keep it. */
  removeCategory: (id: string) => Promise<void>;
  setIncome: (month: MonthKey, incomeCents: number | undefined) => Promise<void>;
  setPayment: (month: MonthKey, billId: string, payment: BillPayment | undefined) => Promise<void>;
  /** Add or replace bills, and remove others (kept on months where they were paid). Used to keep debt minimum payments in step. */
  applyBillChanges: (put: Bill[], remove: string[]) => Promise<void>;
  /** Save whole month records (used by autopay). */
  putMonths: (months: Month[]) => Promise<void>;
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
      async saveCard(card: CreditCard, oldName?: string) {
        let settings: Settings | undefined;
        let bill: Bill | undefined;
        let dropBill: string | undefined;
        const retagged: Purchase[] = [];
        update((d) => {
          // Only credit cards are Paid with names; a loan has none.
          const tagged = !isLoan(card);
          const renamed = tagged && oldName !== undefined && oldName !== card.name;
          let paidWith = d.settings.paidWith;
          if (renamed) paidWith = paidWith.includes(card.name) ? paidWith.filter((m) => m !== oldName) : paidWith.map((m) => (m === oldName ? card.name : m));
          if (tagged && !paidWith.includes(card.name)) paidWith = [...paidWith, card.name];
          settings = paidWith === d.settings.paidWith ? undefined : { ...d.settings, paidWith };
          retagged.length = 0;
          const purchases = renamed
            ? d.purchases.map((p) => {
                if (p.paidWith !== oldName) return p;
                const q = { ...p, paidWith: card.name };
                retagged.push(q);
                return q;
              })
            : d.purchases;
          // The minimum payment is a fixed bill, kept in step with the debt.
          const existing = d.bills.find((b) => b.id === debtBillId(card.id));
          bill = debtBill(card, existing && !existing.deleted ? existing : undefined);
          dropBill = !bill && existing ? existing.id : undefined;
          const paidSomewhere = !!dropBill && d.months.some((m) => m.payments[dropBill!]);
          let bills = d.bills;
          if (bill) bills = existing ? bills.map((b) => (b.id === bill!.id ? bill! : b)) : [...bills, bill];
          else if (dropBill) bills = paidSomewhere ? bills.map((b) => (b.id === dropBill ? { ...b, deleted: true } : b)) : bills.filter((b) => b.id !== dropBill);
          if (dropBill && paidSomewhere) {
            bill = { ...existing!, deleted: true };
            dropBill = undefined;
          }
          return {
            ...d,
            settings: settings ?? d.settings,
            purchases,
            bills,
            cards: d.cards.some((c) => c.id === card.id) ? d.cards.map((c) => (c.id === card.id ? card : c)) : [...d.cards, card],
          };
        });
        await db.putCard(card);
        if (settings) await db.saveSettings(settings);
        if (bill) await db.putBill(bill);
        if (dropBill) await db.deleteBill(dropBill);
        await Promise.all(retagged.map(db.putPurchase));
      },
      async removeCard(id: string) {
        let bill: Bill | undefined;
        let dropBill: string | undefined;
        update((d) => {
          const existing = d.bills.find((b) => b.id === debtBillId(id));
          const paidSomewhere = !!existing && d.months.some((m) => m.payments[existing.id]);
          bill = existing && paidSomewhere ? { ...existing, deleted: true } : undefined;
          dropBill = existing && !paidSomewhere ? existing.id : undefined;
          return {
            ...d,
            cards: d.cards.filter((c) => c.id !== id),
            bills: bill ? d.bills.map((b) => (b.id === bill!.id ? bill! : b)) : dropBill ? d.bills.filter((b) => b.id !== dropBill) : d.bills,
          };
        });
        await db.deleteCard(id);
        if (bill) await db.putBill(bill);
        if (dropBill) await db.deleteBill(dropBill);
      },
      async renamePaidWith(oldName: string, newName: string) {
        if (oldName === newName) return;
        let settings: Settings | undefined;
        let card: CreditCard | undefined;
        let renamedBill: Bill | undefined;
        const retagged: Purchase[] = [];
        update((d) => {
          retagged.length = 0;
          card = undefined;
          renamedBill = undefined;
          settings = { ...d.settings, paidWith: d.settings.paidWith.map((m) => (m === oldName ? newName : m)) };
          const purchases = d.purchases.map((p) => {
            if (p.paidWith !== oldName) return p;
            const q = { ...p, paidWith: newName };
            retagged.push(q);
            return q;
          });
          const cards = d.cards.map((c) => {
            if (c.name !== oldName) return c;
            card = { ...c, name: newName };
            return card;
          });
          const bills = d.bills.map((b) => {
            if (!card || b.id !== debtBillId(card.id) || b.deleted) return b;
            const q = { ...b, name: `${newName} payment` };
            renamedBill = q;
            return q;
          });
          return { ...d, settings, purchases, cards, bills };
        });
        if (settings) await db.saveSettings(settings);
        if (card) await db.putCard(card);
        if (renamedBill) await db.putBill(renamedBill);
        await Promise.all(retagged.map(db.putPurchase));
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
      async addCategory(name: string, budgetCents = 0, color?: string) {
        let made: Category | undefined;
        update((d) => {
          made = { id: newId(), name, budgetCents, color: color ?? nextCategoryColor(d.categories) };
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
          if (payment && (payment.datePaid !== undefined || payment.amountPaidCents !== undefined || payment.skipped)) payments[billId] = payment;
          else delete payments[billId];
          rec = { ...base, payments };
          return withMonth(d, rec);
        });
        if (rec) await db.putMonth(rec);
      },
      async applyBillChanges(put: Bill[], remove: string[]) {
        if (put.length === 0 && remove.length === 0) return;
        const writes: Bill[] = [...put];
        const deletes: string[] = [];
        update((d) => {
          writes.length = put.length;
          deletes.length = 0;
          let bills = d.bills;
          for (const b of put) bills = bills.some((x) => x.id === b.id) ? bills.map((x) => (x.id === b.id ? b : x)) : [...bills, b];
          for (const id of remove) {
            const bill = bills.find((b) => b.id === id);
            if (!bill) continue;
            if (d.months.some((m) => m.payments[id])) {
              const gone = { ...bill, deleted: true };
              writes.push(gone);
              bills = bills.map((b) => (b.id === id ? gone : b));
            } else {
              deletes.push(id);
              bills = bills.filter((b) => b.id !== id);
            }
          }
          return { ...d, bills };
        });
        await Promise.all([...writes.map(db.putBill), ...deletes.map(db.deleteBill)]);
      },
      async putMonths(months: Month[]) {
        if (months.length === 0) return;
        update((d) => ({ ...d, months: [...d.months.filter((m) => !months.some((x) => x.month === m.month)), ...months] }));
        await Promise.all(months.map(db.putMonth));
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
          cards: [],
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
