import { useState } from 'react';
import { formatCents, monthLabel, purchasesIn, type MonthKey, type Purchase } from './calc';
import Icon from './icons';
import { centsToAmountInput, dayLabel, parseCents } from './money';
import PurchaseForm from './PurchaseForm';
import { applyFilter, byDay, filterCount, NO_FILTER, type PurchaseFilter } from './purchaseFilter';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { CatTile, MoneyInput } from './ui';

type Sheet = { step: 'menu' | 'confirm' | 'edit'; id: string } | { step: 'filter' } | null;

/** The month's purchases grouped by day, with search, filter, and ⋮ for Edit / Delete. */
export default function Purchases({ store, month, today }: { store: Store; month: MonthKey; today: string }) {
  const { data } = store;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PurchaseFilter>(NO_FILTER);
  const [sheet, setSheet] = useState<Sheet>(null);
  const { offer } = useUndo();

  const all = purchasesIn(data, month);
  const shown = applyFilter(all, data.categories, query, filter);
  const narrowed = query.trim() !== '' || filterCount(filter) > 0;
  const groups = byDay(shown);
  const catOf = (p: Purchase) => data.categories.find((c) => c.id === p.categoryId);
  const describe = (p: Purchase) => [catOf(p)?.name ?? 'Deleted category', formatCents(p.amountCents), p.description, dayLabel(p.date)].filter(Boolean).join(', ');
  const current = sheet && 'id' in sheet ? data.purchases.find((p) => p.id === sheet.id) : undefined;
  const close = () => setSheet(null);

  async function remove(p: Purchase) {
    await store.removePurchase(p.id);
    offer(`Deleted ${describe(p)}`, () => store.putPurchase(p));
    close();
  }

  return (
    <div className="screen">
      <h1 className="page-title">Purchases</h1>
      <div className="search-bar">
        <Icon name="search" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${monthLabel(month)}`} aria-label="Search purchases" enterKeyHint="search" />
        {query && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" />
          </button>
        )}
        <button
          type="button"
          className={`search-filter${filterCount(filter) ? ' on' : ''}`}
          aria-label={`Filter${filterCount(filter) ? `, ${filterCount(filter)} on` : ''}`}
          aria-haspopup="dialog"
          onClick={() => setSheet({ step: 'filter' })}
        >
          <Icon name="filter" />
          {filterCount(filter) > 0 && <span className="badge">{filterCount(filter)}</span>}
        </button>
      </div>
      {narrowed && (
        <p className="result-line">
          {shown.length} of {all.length} · {formatCents(shown.reduce((s, p) => s + p.amountCents, 0))}
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter(NO_FILTER);
            }}
          >
            Clear
          </button>
        </p>
      )}

      {all.length === 0 ? (
        <section className="card empty">
          <p className="muted">No purchases in {monthLabel(month)} yet. Log one from Add.</p>
        </section>
      ) : shown.length === 0 ? (
        <p className="muted">Nothing matches. Try fewer words or clear the filter.</p>
      ) : (
        <div className="day-groups">
          {groups.map((g) => (
            <section key={g.date} className="day-group" aria-label={dayLabel(g.date)}>
              <h2>
                {dayLabel(g.date)}
                {!narrowed && <span className="day-total">{formatCents(g.totalCents)}</span>}
              </h2>
              <ul className="list">
                {g.items.map((p) => {
                  const c = catOf(p);
                  return (
                    <li key={p.id} className="row">
                      <CatTile category={c} />
                      <span className="row-main">
                        <strong>{p.description || c?.name || 'Deleted category'}</strong>
                        <span className="row-sub">
                          {p.description && <span>{c?.name ?? 'Deleted category'}</span>}
                          {p.paidWith && <span>{p.description ? '· ' : ''}{p.paidWith}</span>}
                          {p.note && <span className="row-note">{p.description || p.paidWith ? '· ' : ''}{p.note}</span>}
                        </span>
                      </span>
                      <span className="row-amt">{formatCents(p.amountCents)}</span>
                      <button type="button" className="more" aria-label={`Options for ${describe(p)}`} aria-haspopup="dialog" onClick={() => setSheet({ step: 'menu', id: p.id })}>
                        <Icon name="dots" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {sheet?.step === 'menu' && current && (
        <SheetBackdrop onClose={close}>
          <div className="sheet menu" role="dialog" aria-modal="true" aria-label="Purchase options">
            <p className="menu-title">{describe(current)}</p>
            <button type="button" className="secondary" onClick={() => setSheet({ step: 'edit', id: current.id })}>
              Edit
            </button>
            <button type="button" className="danger" onClick={() => setSheet({ step: 'confirm', id: current.id })}>
              Delete
            </button>
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </SheetBackdrop>
      )}
      {sheet?.step === 'confirm' && current && (
        <SheetBackdrop onClose={close}>
          <div className="sheet menu" role="alertdialog" aria-modal="true" aria-label="Confirm delete">
            <h2>Delete this purchase?</h2>
            <p className="menu-title">{describe(current)}</p>
            <p className="muted small">You can undo it for a few seconds afterwards.</p>
            <button type="button" className="danger armed" onClick={() => void remove(current)}>
              Delete
            </button>
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </SheetBackdrop>
      )}
      {sheet?.step === 'edit' && current && (
        <SheetBackdrop onClose={close}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Edit purchase">
            <h2>Edit purchase</h2>
            <PurchaseForm
              store={store}
              today={today}
              initial={current}
              submitLabel="Save changes"
              onCancel={close}
              onSubmit={async (p) => {
                const before = current;
                await store.putPurchase(p);
                offer(`Saved changes to ${describe(p)}`, () => store.putPurchase(before));
                close();
              }}
            />
          </div>
        </SheetBackdrop>
      )}
      {sheet?.step === 'filter' && <FilterSheet store={store} filter={filter} onApply={(f) => { setFilter(f); close(); }} onClose={close} />}
    </div>
  );
}

function FilterSheet({ store, filter, onApply, onClose }: { store: Store; filter: PurchaseFilter; onApply: (f: PurchaseFilter) => void; onClose: () => void }) {
  const { data } = store;
  const [cats, setCats] = useState(filter.categoryIds);
  const [paid, setPaid] = useState(filter.paidWith);
  const [min, setMin] = useState(filter.minCents === undefined ? '' : centsToAmountInput(filter.minCents));
  const [max, setMax] = useState(filter.maxCents === undefined ? '' : centsToAmountInput(filter.maxCents));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const usedCats = data.categories.filter((c) => !c.deleted || data.purchases.some((p) => p.categoryId === c.id));

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flt-h"
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ categoryIds: cats, paidWith: paid, minCents: parseCents(min), maxCents: parseCents(max) });
        }}
      >
        <h2 id="flt-h">Filter purchases</h2>
        <div className="field">
          <span>Category</span>
          <div className="chips">
            {usedCats.map((c) => (
              <button key={c.id} type="button" aria-pressed={cats.includes(c.id)} className={cats.includes(c.id) ? 'on' : ''} onClick={() => setCats(toggle(cats, c.id))}>
                <CatTile category={c} small />
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {data.settings.paidWith.length > 0 && (
          <div className="field">
            <span>Paid with</span>
            <div className="chips">
              {data.settings.paidWith.map((m) => (
                <button key={m} type="button" aria-pressed={paid.includes(m)} className={paid.includes(m) ? 'on' : ''} onClick={() => setPaid(toggle(paid, m))}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid2">
          <label className="field">
            <span>Lowest $</span>
            <MoneyInput value={min} onValue={setMin} placeholder="Any" />
          </label>
          <label className="field">
            <span>Highest $</span>
            <MoneyInput value={max} onValue={setMax} placeholder="Any" />
          </label>
        </div>
        <div className="sheet-actions">
          <button type="submit" className="primary">
            Show purchases
          </button>
          <button type="button" className="secondary" onClick={() => onApply(NO_FILTER)}>
            Clear filter
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}
