import { useState } from 'react';
import { formatCents, monthLabel, monthOf, purchasesIn, type Purchase } from './calc';
import { cardSummary, linkedBills } from './cards';
import Icon from './icons';
import { centsToAmountInput, newId, parseCents } from './money';
import type { Store } from './store';
import { CategorySheet } from './Setup';
import { CatTile, MoneyInput } from './ui';

/**
 * The purchase form, used by Add (new) and by the edit sheet (existing).
 * Amount, category tiles, then date, description, paid with and note. Shows the category's left this month as you type.
 */
export default function PurchaseForm({
  store,
  today,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  store: Store;
  today: string;
  initial?: Purchase;
  submitLabel: string;
  onSubmit: (p: Purchase) => Promise<void>;
  onCancel?: () => void;
}) {
  const { data } = store;
  // The Add tab offers the categories chosen under Setup; an edited purchase always offers its own.
  const offered = data.categories.filter((c) => (!c.deleted && !c.hidden) || c.id === initial?.categoryId);
  const [newCat, setNewCat] = useState(false);
  const [amount, setAmount] = useState(initial ? centsToAmountInput(initial.amountCents) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [date, setDate] = useState(initial?.date ?? today);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [paidWith, setPaidWith] = useState(initial?.paidWith ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  const cents = parseCents(amount);
  // Paid with a credit card: its balance, counting this purchase (the balance follows purchases automatically).
  const linked = data.cards.find((c) => c.name === paidWith);
  let cardLive: number | undefined;
  if (linked && monthOf(date) >= linked.startMonth) {
    const others = initial ? data.purchases.filter((p) => p.id !== initial.id) : data.purchases;
    cardLive = cardSummary(linked, others, today, linkedBills(linked, data, today)).balanceNowCents + (monthOf(date) <= monthOf(today) ? (cents ?? 0) : 0);
  }
  const amountBad = cents === undefined || cents === 0;
  const category = data.categories.find((c) => c.id === categoryId);
  const errors: string[] = [];
  if (amountBad) errors.push(amount.trim() ? 'Enter an amount like 12.50' : 'Enter the amount');
  if (!category) errors.push('Pick a category');
  if (!date) errors.push('Pick a date');

  // Live: what this category has left in the purchase's month, counting this purchase.
  const month = monthOf(date || today);
  let live: { left: number; name: string } | undefined;
  if (category && !category.deleted) {
    const spent = purchasesIn(data, month)
      .filter((p) => p.categoryId === category.id && p.id !== initial?.id)
      .reduce((s, p) => s + p.amountCents, 0);
    live = { left: category.budgetCents - spent - (cents ?? 0), name: category.name };
  }

  async function submit() {
    setTried(true);
    if (errors.length || !category || cents === undefined) return;
    setSaving(true);
    try {
      const p: Purchase = { id: initial?.id ?? newId(), date, categoryId: category.id, amountCents: cents };
      if (description.trim()) p.description = description.trim();
      if (paidWith) p.paidWith = paidWith;
      if (note.trim()) p.note = note.trim();
      await onSubmit(p);
      if (!initial) {
        // Ready for the next purchase: keep the date and how it was paid, clear the rest.
        setAmount('');
        setCategoryId('');
        setDescription('');
        setNote('');
        setTried(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form
        className="add-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="add-col">
          <label className="field amount-field">
            <span>Amount</span>
            <span className="amount-wrap">
              <MoneyInput value={amount} onValue={setAmount} placeholder="0.00" aria-invalid={tried && amountBad} />
            </span>
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Category</span>
            <div className="chips" role="radiogroup" aria-label="Category">
              {offered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={c.id === categoryId}
                  className={c.id === categoryId ? 'on' : ''}
                  onClick={() => setCategoryId(c.id)}
                >
                  <CatTile category={c} small />
                  {c.name}
                </button>
              ))}
              {!initial && (
                <button type="button" className="chip-new" onClick={() => setNewCat(true)}>
                  <Icon name="add" />
                  New category
                </button>
              )}
            </div>
          </fieldset>
          {cardLive && (
          <p className="live-left" aria-live="polite">
            <span>
              {paidWith} balance {cents ? 'after this' : 'now'}
            </span>
            <b>{formatCents(cardLive)}</b>
          </p>
        )}
        {live && (
            <p className={`live-left${live.left < 0 ? ' over' : ''}`} aria-live="polite">
              <span>
                {live.left < 0 && <Icon name="alert" />}
                {live.name} {live.left < 0 ? 'over' : 'left'} in {monthLabel(month)}
              </span>
              <b>{formatCents(Math.abs(live.left))}</b>
            </p>
          )}
        </div>
        <div className="add-col">
          <div className="grid2">
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && !date} />
            </label>
            <label className="field">
              <span>Description</span>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" autoComplete="off" />
            </label>
          </div>
          {data.settings.paidWith.length > 0 && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Paid with</span>
              <div className="chips scroll-row" role="radiogroup" aria-label="Paid with">
                {data.settings.paidWith.filter((m) => m === initial?.paidWith || !data.cards.some((c) => c.name === m && c.closedMonth !== undefined)).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={m === paidWith} className={m === paidWith ? 'on' : ''} onClick={() => setPaidWith(m === paidWith ? '' : m)}>
                    {m}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label className="field">
            <span>Note</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" autoComplete="off" />
          </label>
          {tried && errors.length > 0 && <p className="error" role="alert">{errors.join(' · ')}</p>}
          <div className="sheet-actions">
            <button type="submit" className="primary" disabled={saving}>
              {submitLabel}
            </button>
            {onCancel && (
              <button type="button" className="secondary" onClick={onCancel}>
                Discard changes
              </button>
            )}
          </div>
        </div>
      </form>
      {newCat && <CategorySheet store={store} onClose={() => setNewCat(false)} onAdded={(c) => setCategoryId(c.id)} />}
    </>
  );
}
