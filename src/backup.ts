/**
 * JSON backup (everything) and CSV export (purchases). Pure functions; saving the file is in download.ts.
 * Backups hold personal figures: they are exported to the phone, never committed to the repo.
 */
import type { CreditCard } from './cards';
import { formatCents, monthOf, type Bill, type Category, type Data, type Month, type Purchase, type Settings } from './calc';

export const BACKUP_APP = 'budget-tracker';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Data;
}

export function toBackup(data: Data, now = new Date()): string {
  const backup: Backup = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
  return JSON.stringify(backup, null, 2);
}

export class BackupError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);
const optInt = (v: unknown) => v === undefined || isInt(v);
const isMonth = (v: unknown): v is string => isStr(v) && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDate = (v: unknown): v is string => isStr(v) && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);

function fail(what: string): never {
  throw new BackupError(`This backup file can't be read (${what}).`);
}

function checkSettings(s: unknown): Settings {
  if (
    !isObj(s) ||
    !isInt(s.incomeBaselineCents) ||
    !isInt(s.savingsGoalCents) ||
    !isInt(s.startingBalanceCents) ||
    !isMonth(s.firstMonth) ||
    !Array.isArray(s.paidWith) ||
    !s.paidWith.every(isStr) ||
    typeof s.setupDone !== 'boolean'
  )
    fail('settings');
  return s as unknown as Settings;
}

function checkList<T>(v: unknown, what: string, ok: (x: Record<string, unknown>) => boolean): T[] {
  if (!Array.isArray(v) || !v.every((x) => isObj(x) && ok(x))) fail(what);
  return v as T[];
}

/** Read a backup file's text. Throws BackupError when it is not a Budget Tracker backup or is damaged. */
export function parseBackup(text: string): Data {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('not JSON');
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) fail('not a Budget Tracker backup');
  if (!isInt(raw.version) || raw.version > BACKUP_VERSION) fail('made by a newer version of the app');
  const d = raw.data;
  if (!isObj(d)) fail('no data');
  return {
    settings: checkSettings(d.settings),
    bills: checkList<Bill>(
      d.bills,
      'bills',
      (b) => isStr(b.id) && isStr(b.name) && isInt(b.amountCents) && (b.lastMonth === undefined || isMonth(b.lastMonth)) && optStr(b.note) && optStr(b.cardId) && (b.autoPay === undefined || (isObj(b.autoPay) && Number.isInteger(b.autoPay.day) && (b.autoPay.day as number) >= 1 && (b.autoPay.day as number) <= 31 && isMonth(b.autoPay.since))),
    ),
    // Backups made before the Cards tab have no cards.
    cards: d.cards === undefined ? [] : checkList<CreditCard>(
      d.cards,
      'cards',
      (c) =>
        isStr(c.id) &&
        isStr(c.name) &&
        isInt(c.aprBps) &&
        isInt(c.startBalanceCents) &&
        isMonth(c.startMonth) &&
        optInt(c.limitCents) &&
        optInt(c.plannedPaymentCents) &&
        (c.payInFull === undefined || typeof c.payInFull === 'boolean') &&
        (c.closedMonth === undefined || isMonth(c.closedMonth)) &&
        (c.kind === undefined || ['credit-card', 'personal-loan', 'student-loan', 'auto-loan', 'other'].includes(c.kind as string)) &&
        optInt(c.minPaymentCents) &&
        (c.dueDay === undefined || (Number.isInteger(c.dueDay) && (c.dueDay as number) >= 1 && (c.dueDay as number) <= 31)) &&
        (c.paidOffDate === undefined || isDate(c.paidOffDate)) &&
        optInt(c.interestSavedCents) &&
        (c.resetDate === undefined || isDate(c.resetDate)) &&
        Array.isArray(c.payments) &&
        c.payments.every((p) => isObj(p) && isStr(p.id) && isDate(p.date) && isInt(p.amountCents)),
    ),
    categories: checkList<Category>(
      d.categories,
      'categories',
      (c) => isStr(c.id) && isStr(c.name) && isInt(c.budgetCents) && isStr(c.color),
    ),
    months: checkList<Month>(
      d.months,
      'months',
      (m) =>
        isMonth(m.month) &&
        optInt(m.incomeCents) &&
        isObj(m.payments) &&
        Object.values(m.payments).every(
          (p) => isObj(p) && (p.datePaid === undefined || isDate(p.datePaid)) && optInt(p.amountPaidCents) && (p.auto === undefined || typeof p.auto === 'boolean') && (p.skipped === undefined || typeof p.skipped === 'boolean'),
        ),
    ),
    purchases: checkList<Purchase>(
      d.purchases,
      'purchases',
      (p) =>
        isStr(p.id) &&
        isDate(p.date) &&
        isStr(p.categoryId) &&
        isInt(p.amountCents) &&
        optStr(p.description) &&
        optStr(p.paidWith) &&
        optStr(p.note),
    ),
  };
}

function cell(v: string | number | undefined): string {
  if (v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet apps from running text that starts with = + - @ as a formula.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ['Date', 'Month', 'Category', 'Description', 'Amount', 'Paid with', 'Note'];

/** Every purchase as CSV text (with a leading BOM so Excel reads UTF-8), oldest first. Amount is plain dollars. */
export function toCsv(data: Data): string {
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const rows = [...data.purchases]
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1))
    .map((p) =>
      [
        p.date,
        monthOf(p.date),
        names.get(p.categoryId) ?? '(deleted)',
        p.description,
        formatCents(p.amountCents).replace(/[$,]/g, '').replace('−', '-'),
        p.paidWith,
        p.note,
      ]
        .map(cell)
        .join(','),
    );
  return '﻿' + [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

export function backupFileName(today: string): string {
  return `budget-tracker-backup-${today}.json`;
}

export function csvFileName(today: string): string {
  return `budget-tracker-purchases-${today}.csv`;
}
