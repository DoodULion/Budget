/**
 * On-device storage (IndexedDB). Nothing leaves the phone.
 * One record per bill, category, month and purchase; the settings live under `meta`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { emptySettings, monthOf, type Bill, type Category, type Data, type Month, type Purchase, type Settings } from './calc';
import { todayLocal } from './money';

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  bills: { key: string; value: Bill };
  categories: { key: string; value: Category };
  months: { key: string; value: Month };
  purchases: { key: string; value: Purchase; indexes: { date: string } };
}

const DB_NAME = 'budget-tracker';
const DB_VERSION = 1;
const STORES = ['meta', 'bills', 'categories', 'months', 'purchases'] as const;

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('meta');
        d.createObjectStore('bills', { keyPath: 'id' });
        d.createObjectStore('categories', { keyPath: 'id' });
        d.createObjectStore('months', { keyPath: 'month' });
        d.createObjectStore('purchases', { keyPath: 'id' }).createIndex('date', 'date');
      }
    },
  });
  return dbPromise;
}

/** Ask the browser to keep our data. Safe to call every launch. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* not supported; ignore */
  }
}

/** Everything on the device. Before the first-run setup, the settings are empty with `setupDone: false`. */
export async function loadData(): Promise<Data> {
  const d = await db();
  const tx = d.transaction(STORES, 'readonly');
  const [settings, bills, categories, months, purchases] = await Promise.all([
    tx.objectStore('meta').get('settings') as Promise<Settings | undefined>,
    tx.objectStore('bills').getAll(),
    tx.objectStore('categories').getAll(),
    tx.objectStore('months').getAll(),
    tx.objectStore('purchases').getAll(),
  ]);
  await tx.done;
  return { settings: settings ?? emptySettings(monthOf(todayLocal())), bills, categories, months, purchases };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('meta', settings, 'settings');
}

export async function putBill(bill: Bill): Promise<void> {
  await (await db()).put('bills', bill);
}

export async function deleteBill(id: string): Promise<void> {
  await (await db()).delete('bills', id);
}

export async function putCategory(category: Category): Promise<void> {
  await (await db()).put('categories', category);
}

export async function deleteCategory(id: string): Promise<void> {
  await (await db()).delete('categories', id);
}

export async function putMonth(month: Month): Promise<void> {
  await (await db()).put('months', month);
}

export async function putPurchase(purchase: Purchase): Promise<void> {
  await (await db()).put('purchases', purchase);
}

export async function deletePurchase(id: string): Promise<void> {
  await (await db()).delete('purchases', id);
}

/** Replace everything (restoring a backup). All or nothing. */
export async function replaceAll(data: Data): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORES, 'readwrite');
  await Promise.all(STORES.map((s) => tx.objectStore(s).clear()));
  await Promise.all([
    tx.objectStore('meta').put(data.settings, 'settings'),
    ...data.bills.map((b) => tx.objectStore('bills').put(b)),
    ...data.categories.map((c) => tx.objectStore('categories').put(c)),
    ...data.months.map((m) => tx.objectStore('months').put(m)),
    ...data.purchases.map((p) => tx.objectStore('purchases').put(p)),
  ]);
  await tx.done;
}

/** Delete all data on this device (App settings > Delete all data). */
export async function clearAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORES, 'readwrite');
  await Promise.all(STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
