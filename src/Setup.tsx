import { useRef, useState } from 'react';
import { BackupError, backupFileName, csvFileName, parseBackup, toBackup, toCsv } from './backup';
import {
  budgetTooHigh,
  formatCents,
  freedUpCents,
  leftForSpendingCents,
  monthLabel,
  spendingBudgetCents,
  thisMonth,
  type Bill,
  type Category,
  type Data,
  type Settings,
} from './calc';
import { saveFile } from './download';
import Icon from './icons';
import { centsToAmountInput, newId, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from './theme';
import { useUndo } from './undo';
import { CatTile, MoneyInput } from './ui';

/**
 * Setup: your plan, bills, categories and payment methods, plus app settings.
 * The first-run setup shows the same cards (without app settings) and a Start button.
 */
export default function Setup({ store, today, firstRun, onStart }: { store: Store; today: string; firstRun?: boolean; onStart?: () => void }) {
  return (
    <div className="screen">
      {firstRun ? (
        <header className="first-run-intro">
          <h1>Set up your budget</h1>
          <p>Enter your own numbers. They stay on this phone and never leave it. You can change any of this later under Setup.</p>
        </header>
      ) : (
        <h1 className="page-title">Setup</h1>
      )}
      <div className="setup-grid">
        <PlanCard store={store} today={today} step={firstRun ? 1 : undefined} />
        <BillsCard store={store} step={firstRun ? 2 : undefined} />
        <CategoriesCard store={store} today={today} step={firstRun ? 3 : undefined} />
        <PaidWithCard store={store} step={firstRun ? 4 : undefined} />
        {!firstRun && <AppCard store={store} today={today} />}
      </div>
      {firstRun && onStart && <StartBar store={store} today={today} onStart={onStart} />}
    </div>
  );
}

function Step({ n }: { n?: number }) {
  return n ? <span className="step-num" aria-hidden="true">{n}</span> : null;
}

/* ---------- plan ---------- */

function PlanMoney({ label, value, onSave, hint }: { label: string; value: number; onSave: (cents: number) => Promise<void>; hint?: string }) {
  const [text, setText] = useState(value ? centsToAmountInput(value) : '');
  const parsed = parseCents(text);
  const bad = text.trim() !== '' && parsed === undefined;
  return (
    <label className="field">
      <span>{label}</span>
      <MoneyInput
        value={text}
        onValue={setText}
        placeholder="0"
        aria-invalid={bad}
        onBlur={() => {
          const cents = text.trim() === '' ? 0 : parsed;
          if (cents !== undefined && cents !== value) void onSave(cents);
        }}
      />
      {bad ? <small className="error">Enter an amount like 4,000</small> : hint ? <small className="muted small">{hint}</small> : null}
    </label>
  );
}

function PlanCard({ store, today, step }: { store: Store; today: string; step?: number }) {
  const { settings } = store.data;
  const save = (patch: Partial<Settings>) => store.saveSettings(patch);
  const month = thisMonth(settings, today);
  const left = leftForSpendingCents(store.data, month);
  const budget = spendingBudgetCents(store.data.categories);
  const tooHigh = budgetTooHigh(store.data, month);
  const freed = freedUpCents(store.data.bills);

  return (
    <section className="card" aria-labelledby="plan-h">
      <h2 id="plan-h">
        <Step n={step} />
        Your plan
      </h2>
      <div className="tripform">
        <PlanMoney label="Monthly income" value={settings.incomeBaselineCents} onSave={(c) => save({ incomeBaselineCents: c })} hint="What you plan on. A month you don't enter income for uses this." />
        <div className="grid2">
          <PlanMoney label="Save each month" value={settings.savingsGoalCents} onSave={(c) => save({ savingsGoalCents: c })} />
          <PlanMoney label="Checking balance now" value={settings.startingBalanceCents} onSave={(c) => save({ startingBalanceCents: c })} />
        </div>
        <label className="field">
          <span>First month to track</span>
          <input type="month" value={settings.firstMonth} onChange={(e) => e.target.value && void save({ firstMonth: e.target.value })} />
        </label>
      </div>
      <div className={`plan-figure${tooHigh ? ' over' : ''}`} aria-live="polite">
        <dl className="kv">
          <dt>Left for spending in {monthLabel(month)}</dt>
          <dd>{formatCents(left)}</dd>
          <dt>Category budgets</dt>
          <dd>{formatCents(budget)}</dd>
          {freed > 0 && (
            <>
              <dt>Freed up once bills end</dt>
              <dd>{formatCents(freed)}</dd>
            </>
          )}
        </dl>
        {tooHigh && (
          <p className="plan-warn">
            <Icon name="alert" />
            Your category budgets are {formatCents(budget - left)} more than you have left for spending.
          </p>
        )}
      </div>
      <p className="muted small">Left for spending is income minus bills still running that month minus your savings goal.</p>
    </section>
  );
}

/* ---------- bills ---------- */

function BillsCard({ store, step }: { store: Store; step?: number }) {
  const bills = store.data.bills.filter((b) => !b.deleted);
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const total = bills.reduce((s, b) => s + b.amountCents, 0);
  return (
    <section className="card" aria-labelledby="bills-set-h">
      <div className="card-head">
        <h2 id="bills-set-h">
          <Step n={step} />
          Fixed bills
        </h2>
        {bills.length > 0 && <span className="band-note">{formatCents(total)} a month</span>}
      </div>
      {bills.length === 0 ? (
        <p className="empty-line">Rent, loans, insurance, phone: anything you pay every month.</p>
      ) : (
        <ul className="list-edit">
          {bills.map((b) => (
            <li key={b.id}>
              <span className="li-main">
                <b>{b.name}</b>
                <span>{b.lastMonth ? `Last payment ${monthLabel(b.lastMonth)}` : 'Every month'}</span>
              </span>
              <span className="li-amt">{formatCents(b.amountCents)}</span>
              <button type="button" className="more" aria-label={`Edit ${b.name}`} aria-haspopup="dialog" onClick={() => setEditing(b)}>
                <Icon name="dots" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="add-row" onClick={() => setEditing('new')}>
        <Icon name="add" />
        Add a bill
      </button>
      {editing && <BillEditSheet store={store} bill={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function BillEditSheet({ store, bill, onClose }: { store: Store; bill?: Bill; onClose: () => void }) {
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(bill ? centsToAmountInput(bill.amountCents) : '');
  const [ends, setEnds] = useState(bill?.lastMonth ?? '');
  const [confirm, setConfirm] = useState(false);
  const [tried, setTried] = useState(false);
  const { offer } = useUndo();
  const cents = parseCents(amount);
  const errors = [!name.trim() && 'Enter a name', (cents === undefined || cents === 0) && 'Enter the monthly amount'].filter(Boolean) as string[];

  async function save() {
    setTried(true);
    if (errors.length || cents === undefined) return;
    const next: Bill = { id: bill?.id ?? newId(), name: name.trim(), amountCents: cents };
    if (ends) next.lastMonth = ends;
    if (bill?.note) next.note = bill.note;
    await store.putBill(next);
    if (bill) offer(`Saved ${next.name}`, () => store.putBill(bill));
    else offer(`Added ${next.name}`, () => store.removeBill(next.id));
    onClose();
  }

  async function remove() {
    if (!bill) return;
    await store.removeBill(bill.id);
    offer(`Removed ${bill.name}`, () => store.putBill({ ...bill, deleted: undefined }));
    onClose();
  }

  if (confirm && bill) {
    return (
      <SheetBackdrop onClose={onClose}>
        <div className="sheet menu" role="alertdialog" aria-modal="true" aria-label="Confirm remove bill">
          <h2>Remove {bill.name}?</h2>
          <p className="muted small">Months where it was already paid keep it. You can undo this for a few seconds.</p>
          <button type="button" className="danger armed" onClick={() => void remove()}>
            Remove bill
          </button>
          <button type="button" className="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      </SheetBackdrop>
    );
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-edit-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="bill-edit-h">{bill ? 'Edit bill' : 'Add a bill'}</h2>
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent" autoComplete="off" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Each month</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder="0.00" />
          </label>
          <label className="field">
            <span>Last payment (optional)</span>
            <input type="month" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Set a last payment for a bill that ends, like a car loan. After that month it shows as Ended and its money counts toward savings.</p>
        {tried && errors.length > 0 && <p className="error" role="alert">{errors.join(' · ')}</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {bill ? 'Save changes' : 'Add bill'}
          </button>
          {bill && (
            <button type="button" className="danger" onClick={() => setConfirm(true)}>
              Remove bill
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Discard changes
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

/* ---------- categories ---------- */

function BudgetInput({ category, onSave }: { category: Category; onSave: (cents: number) => Promise<void> }) {
  const [text, setText] = useState(category.budgetCents ? centsToAmountInput(category.budgetCents) : '');
  const parsed = parseCents(text);
  return (
    <span className="budget-in">
      <MoneyInput
        value={text}
        onValue={setText}
        placeholder="0"
        aria-label={`${category.name} monthly budget`}
        aria-invalid={text.trim() !== '' && parsed === undefined}
        onBlur={() => {
          const cents = text.trim() === '' ? 0 : parsed;
          if (cents !== undefined && cents !== category.budgetCents) void onSave(cents);
        }}
      />
    </span>
  );
}

function CategoriesCard({ store, today, step }: { store: Store; today: string; step?: number }) {
  const cats = store.data.categories.filter((c) => !c.deleted);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const month = thisMonth(store.data.settings, today);
  return (
    <section className="card" aria-labelledby="cats-set-h">
      <div className="card-head">
        <h2 id="cats-set-h">
          <Step n={step} />
          Spending budget
        </h2>
        <span className="band-note">{formatCents(spendingBudgetCents(store.data.categories))} a month</span>
      </div>
      <p className="muted small">A monthly budget for each category. Keep the total at or under {formatCents(leftForSpendingCents(store.data, month))}.</p>
      {cats.length === 0 ? (
        <p className="empty-line">Add at least one category to log purchases.</p>
      ) : (
        <ul className="list-edit">
          {cats.map((c) => (
            <li key={c.id}>
              <CatTile category={c} />
              <span className="li-main">
                <b>{c.name}</b>
                {c.hidden && <span>Not on Add</span>}
              </span>
              <BudgetInput key={c.id + c.budgetCents} category={c} onSave={(cents) => store.putCategory({ ...c, budgetCents: cents })} />
              <button type="button" className="more" aria-label={`Rename or remove ${c.name}`} aria-haspopup="dialog" onClick={() => setEditing(c)}>
                <Icon name="dots" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="add-row" onClick={() => setEditing('new')}>
        <Icon name="add" />
        Add a category
      </button>
      {cats.length > 1 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Show on the Add tab</span>
          <div className="chips" role="group" aria-label="Categories shown on the Add tab">
            {cats.map((c) => {
              const shown = !c.hidden;
              const lastShown = shown && cats.filter((x) => !x.hidden).length === 1;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={shown}
                  className={shown ? 'on' : ''}
                  aria-disabled={lastShown}
                  onClick={() => {
                    if (lastShown) return;
                    void store.putCategory({ ...c, hidden: shown ? true : undefined });
                  }}
                >
                  <CatTile category={c} small />
                  {c.name}
                </button>
              );
            })}
          </div>
          <p className="muted small">A hidden category keeps its budget and still shows on Summary. At least one stays on Add.</p>
        </fieldset>
      )}
      {editing && <CategorySheet store={store} category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Add a category (from Setup or the Add tab) or rename, rebudget or remove one. */
export function CategorySheet({
  store,
  category,
  onClose,
  onAdded,
}: {
  store: Store;
  category?: Category;
  onClose: () => void;
  onAdded?: (made: Category) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [budget, setBudget] = useState(category?.budgetCents ? centsToAmountInput(category.budgetCents) : '');
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { offer } = useUndo();
  const cents = budget.trim() === '' ? 0 : parseCents(budget);
  const taken = store.data.categories.some((c) => !c.deleted && c.id !== category?.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const errors = [!name.trim() && 'Enter a name', taken && 'You already have a category with that name', cents === undefined && 'Enter a budget like 300'].filter(Boolean) as string[];

  async function save() {
    setTried(true);
    if (errors.length || cents === undefined) return;
    if (category) {
      await store.putCategory({ ...category, name: name.trim(), budgetCents: cents });
      offer(`Saved ${name.trim()}`, () => store.putCategory(category));
    } else {
      const made = await store.addCategory(name.trim(), cents);
      offer(`Added ${made.name}`, () => store.removeCategory(made.id));
      onAdded?.(made);
    }
    onClose();
  }

  async function remove() {
    if (!category) return;
    await store.removeCategory(category.id);
    offer(`Removed ${category.name}`, () => store.putCategory(category));
    onClose();
  }

  if (confirm && category) {
    return (
      <SheetBackdrop onClose={onClose}>
        <div className="sheet menu" role="alertdialog" aria-modal="true" aria-label="Confirm remove category">
          <h2>Remove {category.name}?</h2>
          <p className="muted small">It won't be offered for new purchases. Purchases already in it keep it and still count.</p>
          <button type="button" className="danger armed" onClick={() => void remove()}>
            Remove category
          </button>
          <button type="button" className="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      </SheetBackdrop>
    );
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-edit-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="cat-edit-h">{category ? 'Edit category' : 'Add a category'}</h2>
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries" autoComplete="off" />
          </label>
          <label className="field">
            <span>Monthly budget</span>
            <MoneyInput value={budget} onValue={setBudget} placeholder="0" />
          </label>
        </div>
        {tried && errors.length > 0 && <p className="error" role="alert">{errors.join(' · ')}</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {category ? 'Save changes' : 'Add category'}
          </button>
          {category && (
            <button type="button" className="danger" onClick={() => setConfirm(true)}>
              Remove category
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Discard changes
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

/* ---------- payment methods ---------- */

function PaidWithCard({ store, step }: { store: Store; step?: number }) {
  const list = store.data.settings.paidWith;
  const [text, setText] = useState('');
  const { offer } = useUndo();
  const name = text.trim();
  const dupe = list.some((m) => m.toLowerCase() === name.toLowerCase());

  async function add() {
    if (!name || dupe) return;
    await store.saveSettings({ paidWith: [...list, name] });
    setText('');
  }

  return (
    <section className="card" aria-labelledby="paid-h">
      <h2 id="paid-h">
        <Step n={step} />
        Paid with
      </h2>
      <p className="muted small">Your cards and accounts, to tag purchases with. Optional.</p>
      {list.length > 0 && (
        <ul className="list-edit">
          {list.map((m) => (
            <li key={m}>
              <span className="li-main">
                <b>{m}</b>
              </span>
              <button
                type="button"
                className="more"
                aria-label={`Remove ${m}`}
                onClick={async () => {
                  await store.saveSettings({ paidWith: list.filter((x) => x !== m) });
                  offer(`Removed ${m}`, () => store.saveSettings({ paidWith: list }));
                }}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="card-edit"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Debit card" aria-label="New payment method" autoComplete="off" enterKeyHint="done" />
        <button type="submit" className="secondary" disabled={!name || dupe}>
          Add
        </button>
      </form>
      {dupe && name && <p className="muted small">Already on the list.</p>}
    </section>
  );
}

/* ---------- app settings ---------- */

function AppCard({ store, today }: { store: Store; today: string }) {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [wipe, setWipe] = useState(false);
  const [pending, setPending] = useState<{ data: Data; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function read(file: File) {
    setMsg(null);
    try {
      setPending({ data: parseBackup(await file.text()), name: file.name });
    } catch (e) {
      setMsg({ text: e instanceof BackupError ? e.message : "That file couldn't be read.", bad: true });
    }
  }

  async function restore() {
    if (!pending) return;
    await store.replaceAll(pending.data);
    setMsg({ text: `Restored ${pending.data.purchases.length} purchases from ${pending.name}.` });
    setPending(null);
  }

  return (
    <section className="card span-all" aria-labelledby="app-h">
      <h2 id="app-h">App settings</h2>
      <div className="field">
        <span>Appearance</span>
        <div className="seg theme-pick" role="radiogroup" aria-label="Appearance">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? 'on' : ''}
              onClick={() => {
                setTheme(t);
                setThemeChoice(t);
              }}
            >
              {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
            </button>
          ))}
        </div>
      </div>
      <div className="part">
        <h3>Backup</h3>
        <p className="muted small">Your data lives only on this phone. Save a backup to Files now and then.</p>
        <div className="menu-pair" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={() => void saveFile(backupFileName(today), toBackup(store.data), 'application/json')}>
            Save backup
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            Restore
          </button>
        </div>
        <button type="button" className="secondary" onClick={() => void saveFile(csvFileName(today), toCsv(store.data), 'text/csv')}>
          Export purchases (CSV)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void read(f);
          }}
        />
        {pending && (
          <div className="confirm">
            <p>
              Replace everything on this phone with {pending.name}? It holds {pending.data.purchases.length} purchases, {pending.data.bills.length} bills and{' '}
              {pending.data.categories.length} categories.
            </p>
            <button type="button" className="danger armed" onClick={() => void restore()}>
              Replace with backup
            </button>
            <button type="button" className="secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        )}
        {msg && <p className={msg.bad ? 'error' : 'muted small'} role="status">{msg.text}</p>}
      </div>
      <div className="part">
        <h3>Delete all data</h3>
        {!wipe ? (
          <button type="button" className="danger" onClick={() => setWipe(true)}>
            Delete all data…
          </button>
        ) : (
          <WipeConfirm store={store} onDone={() => setWipe(false)} />
        )}
      </div>
    </section>
  );
}

function WipeConfirm({ store, onDone }: { store: Store; onDone: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="confirm">
      <p>This erases your plan, bills, categories and every purchase on this phone. Save a backup first if you might want them back.</p>
      <label className="field">
        <span>Type DELETE to confirm</span>
        <input className="confirm-input" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" autoCapitalize="characters" autoComplete="off" />
      </label>
      <button
        type="button"
        className="danger armed"
        disabled={text.trim().toUpperCase() !== 'DELETE'}
        onClick={async () => {
          await store.clearAll();
          onDone();
        }}
      >
        Delete everything
      </button>
      <button type="button" className="secondary" onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}

/* ---------- first run ---------- */

function StartBar({ store, today, onStart }: { store: Store; today: string; onStart: () => void }) {
  const { settings, categories } = store.data;
  const missing: string[] = [];
  if (!settings.incomeBaselineCents) missing.push('your monthly income');
  if (!categories.some((c) => !c.deleted && c.budgetCents > 0)) missing.push('a budget for at least one category');
  return (
    <div className="start-bar">
      <button
        type="button"
        className="primary"
        disabled={missing.length > 0}
        onClick={async () => {
          await store.saveSettings({ setupDone: true, firstMonth: settings.firstMonth || today.slice(0, 7) });
          onStart();
        }}
      >
        Start tracking
      </button>
      <p>{missing.length ? `Add ${missing.join(' and ')} to start.` : 'Bills and payment methods can wait. Add them any time.'}</p>
    </div>
  );
}
