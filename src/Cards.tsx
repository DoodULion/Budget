import { Fragment, useState, type JSX } from 'react';
import { cardSummary, interestByMonth, minimumPlan, DEBT_KINDS, debtBillId, interestSaved, isPaidOff, minimumFor, debtLabel, formatApr, isLoan, linkedBills, type DebtKind, monthlyInterestCents, parseApr, resetDebt, debtStart, groupDebts, debtItemKey, debtOrderFromItems, debtOrderWithin, type DebtItem, type CardPayment, type CardSummary, type CreditCard } from './cards';
import { formatCents, monthLabel } from './calc';
import { monthTick, Stacked } from './charts';
import Icon from './icons';
import { centsToAmountInput, dayLabel, newId, ordinal, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { mergeOrder, useCardOrder } from './useCardOrder';
import { useHoldDrag } from './useHoldDrag';
import { CatTile, Fig, Meter, MoneyInput } from './ui';

const colorOf = (i: number) => `c${(i % 8) + 1}`;

/** The order the debts are shown in: rearranged by hold-and-drag, kept on this device (not in backups). New debts go last. */
function useDebtOrder(cards: CreditCard[]) {
  const ids = cards.map((c) => c.id);
  const [saved, setSaved] = useCardOrder('debt-order', ids);
  return [mergeOrder(saved, ids), setSaved] as const;
}

/** Summaries in the saved order, and a color for each debt that stays with it when the order changes. */
function arrange(cards: CreditCard[], summaries: CardSummary[], order: string[]) {
  const sorted = order.map((id) => summaries.find((s) => s.card.id === id)).filter((s): s is CardSummary => !!s);
  const colorFor = (id: string) => colorOf(Math.max(0, cards.findIndex((c) => c.id === id)));
  return { sorted, colorFor };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Debt: credit cards (balances follow the purchases tagged with the card) and loans, with interest, minimum payments and insights. */
export default function Cards({ store, today }: { store: Store; today: string }) {
  const { cards, purchases } = store.data;
  const [sel, setSel] = useState('all');
  const [editing, setEditing] = useState<CreditCard | 'new' | null>(null);
  const [paying, setPaying] = useState<{ card: CreditCard; payment?: CardPayment } | null>(null);
  const [menu, setMenu] = useState<CreditCard | null>(null);
  const [payingOff, setPayingOff] = useState<CardSummary | null>(null);
  const [resetting, setResetting] = useState(false);
  const [view, setView] = useState<'debts' | 'insights'>('debts');
  const [debtOrder, setDebtOrder] = useDebtOrder(cards);
  const { sorted: summaries, colorFor } = arrange(
    cards,
    cards.map((c) => cardSummary(c, purchases, today, linkedBills(c, store.data, today), store.data.settings.firstMonth)),
    debtOrder,
  );
  const one = summaries.length === 1 ? summaries[0] : summaries.find((s) => s.card.id === sel);

  return (
    <div className="screen">
      <h1>Debt</h1>
      {summaries.length === 0 ? (
        <section className="card">
          <h2>Track what you owe</h2>
          <p className="muted">
            Add credit cards and loans (personal, student, auto) with their APR and balance. Set a minimum payment and it joins your fixed bills; marking that bill paid records the payment here.
            Purchases tagged with a credit card under Paid with add to its balance automatically.
          </p>
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            Add a debt
          </button>
        </section>
      ) : (
        <>
          {summaries.length > 1 && (
            <DebtPicker summaries={summaries} value={one?.card.id ?? 'all'} colorFor={colorFor} onPick={setSel} />
          )}
          <div className="seg debt-view" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === 'debts'} className={view === 'debts' ? 'on' : ''} onClick={() => setView('debts')}>
              {one ? 'Balance' : 'Debts'}
            </button>
            <button type="button" role="radio" aria-checked={view === 'insights'} className={view === 'insights' ? 'on' : ''} onClick={() => setView('insights')}>
              Insights
            </button>
          </div>
          {view === 'insights' ? (
            <DebtInsights store={store} summaries={one ? [one] : summaries} all={summaries} colorFor={colorFor} today={today} />
          ) : one ? (
            <CardDetail key={one.card.id} s={one} today={today} onMenu={() => setMenu(one.card)} onPay={(payment) => setPaying({ card: one.card, payment })} />
          ) : (
            <DebtList summaries={summaries} colorFor={colorFor} onReorder={setDebtOrder} onOpen={(id) => setSel(id)} onMenu={setMenu} />
          )}
          <button type="button" className="add-row" onClick={() => setEditing('new')}>
            <Icon name="add" />
            Add a debt
          </button>
          <button type="button" className="reset-row" onClick={() => setResetting(true)}>
            Reset balances
          </button>
        </>
      )}
      {editing && <CardSheet store={store} card={editing === 'new' ? undefined : editing} today={today} onClose={() => setEditing(null)} onSaved={(c) => setSel(c.id)} />}
      {menu && (
        <SheetBackdrop onClose={() => setMenu(null)}>
          <div className="sheet menu" role="dialog" aria-modal="true" aria-label={`Options for ${menu.name}`}>
            <h2>{menu.name}</h2>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setEditing(menu);
                setMenu(null);
              }}
            >
              Edit {isLoan(menu) ? debtLabel(menu).toLowerCase() : 'card'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setPayingOff(summaries.find((x) => x.card.id === menu.id) ?? null);
                setMenu(null);
              }}
            >
              Pay off balance
            </button>
            <button type="button" className="secondary" onClick={() => setMenu(null)}>
              Cancel
            </button>
          </div>
        </SheetBackdrop>
      )}
      {resetting && <ResetSheet store={store} summaries={summaries} today={today} onClose={() => setResetting(false)} />}
      {payingOff && <PayoffSheet store={store} s={payingOff} today={today} onClose={() => setPayingOff(null)} />}
      {paying && <PaymentSheet store={store} card={paying.card} payment={paying.payment} today={today} onClose={() => setPaying(null)} />}
    </div>
  );
}

/* ---------- drag-to-rearrange plumbing shared by the two views ---------- */

function useArrange(screen: string, ids: readonly string[], ignore?: string) {
  const [saved, setSaved] = useCardOrder(screen, ids);
  const { order, dragId, listRef, bind, justDragged } = useHoldDrag(saved, setSaved, ':scope > [data-id]', ignore);
  const drag = (id: string, cls: string) => ({ ...bind(id), className: `${cls} sum-card${dragId === id ? ' lifted' : ''}` });
  const grid = (cards: Record<string, JSX.Element>) => (
    <div
      className={`cols${dragId ? ' dragging' : ''}`}
      ref={(el) => {
        listRef.current = el;
      }}
      onClickCapture={(e) => {
        if (justDragged()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {order.map((id) => (cards[id] ? <Fragment key={id}>{cards[id]}</Fragment> : null))}
    </div>
  );
  return { drag, grid };
}

/**
 * Which debt the tab shows: a dropdown with All debts and each debt, grouped by type (Credit cards, Auto loans …),
 * in the debts' own order. The chosen debt's color tile sits beside it.
 */
function DebtPicker({ summaries, value, colorFor, onPick }: { summaries: CardSummary[]; value: string; colorFor: (id: string) => string; onPick: (id: string) => void }) {
  const groups = DEBT_KINDS.map((k) => ({ ...k, debts: summaries.filter((s) => (s.card.kind ?? 'credit-card') === k.id) })).filter((g) => g.debts.length > 0);
  const picked = summaries.find((s) => s.card.id === value);
  return (
    <label className="debt-pick">
      <span className="sr-only">Show</span>
      {picked ? <CatTile category={{ name: picked.card.name, color: colorFor(picked.card.id) }} small /> : <span className="group-count sm">{summaries.length}</span>}
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="all">All debts ({formatCents(summaries.reduce((t, s) => t + Math.max(0, s.balanceNowCents), 0))})</option>
        {groups.map((g) => (
          <optgroup key={g.id} label={`${g.label}s`}>
            {g.debts.map((s) => (
              <option key={s.card.id} value={s.card.id}>
                {s.card.name} · {formatCents(s.balanceNowCents)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Icon name="down" />
    </label>
  );
}

/**
 * Debt insights: interest paid month by month (by debt, or for the one picked), and when each debt is paid off
 * paying only its minimum, with a couple of figures worth knowing.
 */
function DebtInsights({ store, summaries, all, colorFor, today }: { store: Store; summaries: CardSummary[]; all: CardSummary[]; colorFor: (id: string) => string; today: string }) {
  const [range, setRange] = useState<6 | 12 | 0>(12);
  const year = today.slice(0, 4);
  const ibm = interestByMonth(summaries, today);
  const shown = range ? ibm.months.slice(-range) : ibm.months;
  const off = ibm.months.length - shown.length;
  const labels = shown.map((m, i) => monthTick(m, i === 0));
  const finished = ibm.months.slice(0, -1);
  const lastMonth = finished.length ? ibm.totals[finished.length - 1] : 0;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const thisYear = sum(ibm.totals.filter((_, i) => ibm.months[i].startsWith(year)));
  const allTime = sum(ibm.totals);
  const one = summaries.length === 1 && all.length > 1 ? summaries[0] : undefined;
  const plan = minimumPlan(summaries.map((s) => ({ summary: s, minimumCents: minimumFor(s.card, linkedBills(s.card, store.data, today)) })), today);
  const maxMonths = Math.max(1, ...plan.rows.map((r) => (r.payoff.kind === 'months' ? r.payoff.months : 0)));
  const owing = summaries.filter((s) => s.balanceNowCents > 0 && !(s.card.payInFull && !s.closed));
  const steepest = [...owing].sort((a, b) => b.card.aprBps - a.card.aprBps)[0];
  const monthlyNow = owing.reduce((t, s) => t + monthlyInterestCents(s.balanceNowCents, s.card.aprBps), 0);
  const limited = summaries.filter((s) => !s.loan && s.card.limitCents);
  const used = limited.reduce((t, s) => t + Math.max(0, s.balanceNowCents), 0);
  const limits = limited.reduce((t, s) => t + (s.card.limitCents ?? 0), 0);
  const series = (one ? [ibm.byDebt[0]] : ibm.byDebt).map((d) => ({ name: d.name, values: d.values.slice(off), cls: `cat-${colorFor(d.id)}` }));

  return (
    <div className="cols">
      <section className="card" aria-labelledby="int-h">
        <h2 id="int-h">Interest paid{one ? ` on ${one.card.name}` : ''}</h2>
        <div className="stat-grid three">
          <div>
            <Fig cents={lastMonth} />
            <span>Last month</span>
          </div>
          <div>
            <Fig cents={thisYear} />
            <span>This year</span>
          </div>
          <div>
            <Fig cents={allTime} />
            <span>Since tracking</span>
          </div>
        </div>
        <div className="seg small-seg" role="radiogroup" aria-label="Months shown">
          {([6, 12, 0] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r ? `${r} months` : 'All'}
            </button>
          ))}
        </div>
        {allTime === 0 ? (
          <p className="empty-line">No interest charged yet. It is added when a month ends with a balance left over.</p>
        ) : (
          <>
            <Stacked labels={labels} series={series} label="Interest paid each month" />
            {!one && ibm.byDebt.length > 1 && (
              <ul className="int-legend">
                {ibm.byDebt
                  .map((d) => ({ d, total: sum(d.values.slice(off)) }))
                  .filter((x) => x.total > 0)
                  .sort((a, b) => b.total - a.total)
                  .map(({ d, total }) => (
                    <li key={d.id}>
                      <i style={{ ['--c' as string]: `var(--cat-${colorFor(d.id)})` }} aria-hidden="true" />
                      <span>{d.name}</span>
                      <b>{formatCents(total)}</b>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
        <p className="muted small">Interest is added when a month ends. This month's shows once it is over.</p>
      </section>

      <section className="card" aria-labelledby="min-h">
        <h2 id="min-h">Paying only the minimums</h2>
        {plan.rows.length === 0 ? (
          <p className="empty-line">Nothing owed.</p>
        ) : (
          <>
            <dl className="kv">
              <dt>{one ? 'Paid off' : 'Debt-free'}</dt>
              <dd>{plan.debtFree ? monthLabel(plan.debtFree) : 'Not at these minimums'}</dd>
              <dt>Interest still to pay</dt>
              <dd className="fig-neg">
                {formatCents(plan.interestCents)}
                {plan.stuck > 0 && <small>for the debts that get paid off</small>}
              </dd>
            </dl>
            <ul className="min-plan">
              {plan.rows.map((r) => (
                <li key={r.id}>
                  <div className="mp-top">
                    <b>{r.name}</b>
                    <span>{r.payoff.kind === 'months' ? monthLabel(r.payoff.lastMonth) : r.minimumCents ? 'Never' : 'No minimum'}</span>
                  </div>
                  <div className="mp-bar" aria-hidden="true">
                    <i style={{ ['--p' as string]: r.payoff.kind === 'months' ? r.payoff.months / maxMonths : 1, ['--c' as string]: `var(--cat-${colorFor(r.id)})` }} className={r.payoff.kind === 'months' ? '' : 'stuck'} />
                  </div>
                  <small>
                    {formatCents(r.balanceCents)} at {formatApr(r.aprBps)}
                    {r.minimumCents ? `, ${formatCents(r.minimumCents)} a month` : ''}
                    {r.payoff.kind === 'months'
                      ? ` · ${r.payoff.months} ${r.payoff.months === 1 ? 'payment' : 'payments'}, ${formatCents(r.payoff.interestCents)} interest`
                      : r.minimumCents
                        ? " · the minimum doesn't cover the interest"
                        : ' · set a minimum to see a date'}
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {owing.length > 0 && (
        <section className="card" aria-labelledby="know-h">
          <h2 id="know-h">Good to know</h2>
          <dl className="kv">
            <dt>Monthly interest at today's balances</dt>
            <dd>{formatCents(monthlyNow)}</dd>
            {!one && steepest && owing.length > 1 && (
              <>
                <dt>Extra money goes furthest on</dt>
                <dd>
                  {steepest.card.name}
                  <small>{formatApr(steepest.card.aprBps)} APR, the highest</small>
                </dd>
              </>
            )}
            {limits > 0 && (
              <>
                <dt>Credit limit used</dt>
                <dd className={used / limits > 0.3 ? 'fig-neg' : ''}>
                  {Math.round((used / limits) * 100)}%<small>{formatCents(used)} of {formatCents(limits)}</small>
                </dd>
              </>
            )}
          </dl>
          <p className="muted small">Try paying a debt down or more each month in the Simulator to see the interest you'd save.</p>
        </section>
      )}
    </div>
  );
}

/** One debt in the Debt tab's list: balance, minimum, APR and due date, opening on tap, with a ⋮. */
function DebtRow({ s, colorFor, onOpen, onMenu, li, inGroup }: { inGroup?: boolean; s: CardSummary; colorFor: (id: string) => string; onOpen: (id: string) => void; onMenu: (card: CreditCard) => void; li: Record<string, unknown> }) {
  return (
    <li {...li}>
      <CatTile category={{ name: s.card.name, color: colorFor(s.card.id) }} />
      <button type="button" className="main" onClick={() => onOpen(s.card.id)} aria-label={`Open ${s.card.name}`}>
        <span className="dn">{s.card.name}</span>
        <span className="db">{formatCents(s.balanceNowCents)}</span>
        <span className="ds">
          {[
            isPaidOff(s.card, s) ? 'Paid off' : s.card.minPaymentCents ? `Min ${formatCents(s.card.minPaymentCents)}` : 'No minimum set',
            `${formatApr(s.card.aprBps)} APR`,
            s.card.dueDay && !isPaidOff(s.card, s) ? `Due the ${s.card.dueDay}${ordinal(s.card.dueDay)}` : undefined,
            inGroup ? undefined : debtLabel(s.card),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <button type="button" className="more" onClick={() => onMenu(s.card)} aria-label={`Options for ${s.card.name}`} aria-haspopup="dialog">
        <Icon name="dots" />
      </button>
    </li>
  );
}

/** The debts inside an open group, rearranged by hold-and-drag among themselves. */
function GroupDebts({ debts, order, colorFor, onReorder, onOpen, onMenu }: { debts: CardSummary[]; order: string[]; colorFor: (id: string) => string; onReorder: (ids: string[]) => void; onOpen: (id: string) => void; onMenu: (card: CreditCard) => void }) {
  const rows = useHoldDrag(
    debts.map((s) => s.card.id),
    (ids) => onReorder(debtOrderWithin(order, ids)),
    ':scope > [data-id]',
  );
  return (
    <ul
      className={`debt-list nested${rows.dragId ? ' dragging' : ''}`}
      ref={(el) => {
        rows.listRef.current = el;
      }}
      onClickCapture={(e) => {
        if (rows.justDragged()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {rows.order.map((id) => debts.find((x) => x.card.id === id)).filter((s): s is CardSummary => !!s).map((s) => (
        <DebtRow key={s.card.id} inGroup s={s} colorFor={colorFor} onOpen={onOpen} onMenu={onMenu} li={{ ...rows.bind(s.card.id), className: `debt-row sum-card${rows.dragId === s.card.id ? ' lifted' : ''}` }} />
      ))}
    </ul>
  );
}

/** The Debt tab's list: what is owed on each debt with its minimum payment and interest rate. Debts of the same type are combined into a group that opens to them. */
function DebtList({ summaries, colorFor, onReorder, onOpen, onMenu }: { summaries: CardSummary[]; colorFor: (id: string) => string; onReorder: (ids: string[]) => void; onOpen: (id: string) => void; onMenu: (card: CreditCard) => void }) {
  // The cards rearrange by hold-and-drag, and so do the rows inside the list (a press on a row belongs to the row).
  const { drag, grid } = useArrange('debt-list', ['total', 'list'], '.more, .debt-row, .debt-group');
  const items = groupDebts(summaries);
  const order = summaries.map((s) => s.card.id);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const rows = useHoldDrag(
    items.map(debtItemKey),
    (keys) => onReorder(debtOrderFromItems(keys, items)),
    ':scope > [data-id]',
    '.more, .nested',
  );
  const itemFor = (key: string): DebtItem | undefined => items.find((x) => debtItemKey(x) === key);
  const live = summaries.filter((s) => !isPaidOff(s.card, s));
  const owed = summaries.reduce((t, s) => t + Math.max(0, s.balanceNowCents), 0);
  const minimums = live.reduce((t, s) => t + (s.card.minPaymentCents ?? 0), 0);
  const monthlyInterest = summaries.reduce((t, s) => t + monthlyInterestCents(Math.max(0, s.balanceNowCents), s.card.aprBps), 0);
  const cards: Record<string, JSX.Element> = {
    total: (
      <section {...drag('total', 'card hero')} aria-labelledby="owed-h">
        <h2 id="owed-h">Owed on all debts</h2>
        <p className="big fit" style={{ ['--chars' as string]: Math.max(formatCents(owed).length, 4) }}>
          {formatCents(owed)}
        </p>
        <div className="rule">
          <div>
            <Fig cents={minimums} />
            <span className="muted">Monthly minimums</span>
          </div>
          <div>
            <Fig cents={monthlyInterest} />
            <span className="muted">Monthly interest</span>
          </div>
          <div>
            <Fig text={String(live.length)} />
            <span className="muted">{live.length === 1 ? 'Debt owed' : 'Debts owed'}</span>
          </div>
        </div>
      </section>
    ),
    list: (
      <section {...drag('list', 'card')} aria-labelledby="list-h">
        <h2 id="list-h">Your debts</h2>
        <ul
          className={`debt-list${rows.dragId ? ' dragging' : ''}`}
          ref={(el) => {
            rows.listRef.current = el;
          }}
          onClickCapture={(e) => {
            if (rows.justDragged()) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {rows.order.map(itemFor).filter((it): it is DebtItem => !!it).map((it) => {
            const key = debtItemKey(it);
            const lifted = rows.dragId === key ? ' lifted' : '';
            if (it.kind === 'debt') return <DebtRow key={key} s={it.s} colorFor={colorFor} onOpen={onOpen} onMenu={onMenu} li={{ ...rows.bind(key), className: `debt-row sum-card${lifted}` }} />;
            const open = openGroups.has(it.id);
            const owing = it.debts.filter((s) => !isPaidOff(s.card, s)).length;
            return (
              <li key={key} {...rows.bind(key)} className={`debt-group sum-card${lifted}`}>
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenGroups((g) => {
                      const next = new Set(g);
                      if (next.has(it.id)) next.delete(it.id);
                      else next.add(it.id);
                      return next;
                    })
                  }
                >
                  <span className="group-count" aria-hidden="true">{it.debts.length}</span>
                  <span className="bill-main">
                    <b>{it.label}</b>
                    <span>
                      {it.debts.length} {it.id === 'credit-card' ? 'cards' : it.id === 'other' ? 'debts' : 'loans'}{owing < it.debts.length ? ` · ${owing} owed` : ''}
                      {it.minimumsCents ? ` · Min ${formatCents(it.minimumsCents)}` : ''}
                    </span>
                  </span>
                  <span className="bill-amt">{formatCents(it.balanceCents)}</span>
                  <span className={`chev${open ? ' open' : ''}`} aria-hidden="true">
                    <Icon name="down" />
                  </span>
                </button>
                {open && <GroupDebts debts={it.debts} order={order} colorFor={colorFor} onReorder={onReorder} onOpen={onOpen} onMenu={onMenu} />}
              </li>
            );
          })}
        </ul>
      </section>
    ),
  };
  return grid(cards);
}

/* ---------- one card ---------- */

/** On the Debt tab a debt shows its balance, statement and payments. */
const MANAGE = ['balance', 'statement', 'payments'] as const;

function CardDetail({
  s,
  today,
  onMenu,
  onPay,
}: {
  s: CardSummary;
  today: string;
  onMenu?: () => void;
  onPay?: (payment?: CardPayment) => void;
}) {
  const { drag, grid } = useArrange('card-detail', MANAGE);
  const { card } = s;
  const owedNow = Math.max(0, s.balanceNowCents);
  const nowMonth = today.slice(0, 7);
  const payments = [...card.payments, ...s.billPayments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const monthlyCost = monthlyInterestCents(owedNow, card.aprBps);


  const cards: Record<string, JSX.Element> = {
    balance: (
      <section {...drag('balance', 'card hero')} aria-labelledby="bal-h">
        <div className="card-head">
          <h2 id="bal-h">
            {card.name} balance{' '}
            {isPaidOff(card, s) ? <span className="pill">Paid off</span> : s.loan ? <span className="pill idle">{debtLabel(card)}</span> : s.closed && <span className="pill idle">Closed</span>}
          </h2>
          {onMenu && (
            <button type="button" className="more" onClick={onMenu} aria-label={`Options for ${card.name}`} aria-haspopup="dialog">
              <Icon name="dots" />
            </button>
          )}
        </div>
        <p className={`big fit${s.balanceNowCents < 0 ? ' bad-text' : ''}`} style={{ ['--chars' as string]: Math.max(formatCents(s.balanceNowCents).length, 4) }}>
          {formatCents(s.balanceNowCents)}
        </p>
        {!s.loan && card.limitCents ? <Meter spent={owedNow} budget={card.limitCents} label={`${card.name} balance of its limit`} /> : null}
        {s.loan ? (
          <div className="rule">
            <div>
              <Fig text={formatApr(card.aprBps)} />
              <span className="muted">APR</span>
            </div>
            <div>
              <Fig cents={card.minPaymentCents} />
              <span className="muted">Minimum</span>
            </div>
            <div>
              <Fig cents={monthlyCost} />
              <span className="muted">Monthly interest</span>
            </div>
          </div>
        ) : (
          <div className="rule">
            <div>
              <Fig text={formatApr(card.aprBps)} />
              <span className="muted">APR</span>
            </div>
            <div>{card.limitCents ? <Fig cents={Math.max(0, card.limitCents - owedNow)} /> : <Fig text="—" />}<span className="muted">Available</span></div>
            <div>
              <Fig text={s.utilization === undefined ? '—' : pct(s.utilization)} />
              <span className="muted">Limit used</span>
            </div>
          </div>
        )}
        {s.utilization !== undefined && s.utilization > 0.3 && <p className="muted small">Keeping the balance under 30% of the limit is easier on a credit score.</p>}
      </section>
    ),
    statement: (
      <section {...drag('statement', 'card')} aria-labelledby="st-h">
        <div className="card-head">
          <h2 id="st-h">{s.closed ? 'This month' : "This month's statement"}</h2>
          {!s.closed && s.rows.length > 0 && s.statementCents > 0 && <span className={`pill${s.leftToAvoidInterestCents > 0 ? ' idle' : ''}`}>{s.leftToAvoidInterestCents > 0 ? (card.payInFull ? 'Due' : 'Unpaid') : 'Paid'}</span>}
        </div>
        {s.rows.length === 0 ? (
          <p className="muted small">Tracking starts in {monthLabel(s.startMonth)}. This month's statement, interest and payments show from then.</p>
        ) : (
        <>
        {card.dueDay && !isPaidOff(card, s) && (
          <p className="muted small due-line">
            Due on the {card.dueDay}
            {ordinal(card.dueDay)} · {card.minPaymentCents ? `${formatCents(card.minPaymentCents)} is recorded automatically that day` : 'set a minimum payment to record it automatically'}
          </p>
        )}
        {s.closed ? (
          <>
            <dl className="kv">
              <dt>Balance so far</dt>
              <dd>{formatCents(s.balanceNowCents)}</dd>
              <dt>Interest added at the end of {monthLabel(nowMonth)}</dt>
              <dd>about {formatCents(s.projectedInterestCents)}</dd>
            </dl>
            <p className="muted small">
              {s.loan ? 'Interest is added every month: ' : 'This account is closed, so nothing new is charged. Each month '}
              {formatApr(card.aprBps)} ÷ 12 is added to that month's ending balance.
            </p>
          </>
        ) : s.statementCents === 0 ? (
          <p className="muted">Nothing was owed at the start of {monthLabel(nowMonth)}, so no interest this month.</p>
        ) : (
          <>
            <dl className="kv">
              <dt>Statement balance</dt>
              <dd>{formatCents(s.statementCents)}</dd>
              <dt>Paid so far this month</dt>
              <dd>{formatCents(Math.min(s.statementCents, s.rows[s.rows.length - 1]?.paymentsCents ?? 0))}</dd>
              <dt className="sum-line">Left to avoid interest</dt>
              <dd className="sum-line">{formatCents(s.leftToAvoidInterestCents)}</dd>
            </dl>
            {s.leftToAvoidInterestCents > 0 && card.payInFull ? (
              <p className="muted small">This card is paid in full every month. Pay the statement by the end of {monthLabel(nowMonth)} and no interest is charged.</p>
            ) : s.leftToAvoidInterestCents > 0 ? (
              <p className="muted small">
                Leave it unpaid and about {formatCents(s.projectedInterestCents)} of interest ({formatApr(card.aprBps)} ÷ 12) is added at the end of {monthLabel(nowMonth)}.
              </p>
            ) : (
              <p className="muted small">Paid in full. No interest this month.</p>
            )}
          </>
        )}
        <button type="button" className="primary" onClick={() => onPay?.()}>
          Add a payment
        </button>
        </>
        )}
      </section>
    ),
    payments: (
      <section {...drag('payments', 'card')} aria-labelledby="pm-h">
        <h2 id="pm-h">Payments</h2>
        {payments.length === 0 ? (
          <p className="empty-line">No payments yet. Mark a linked bill paid on Overview, or add one here.</p>
        ) : (
          <ul className="list-edit">
            {payments.slice(0, 8).map((p) => (
              <li key={p.id}>
                {p.billName ? (
                  <span className="li-main">
                    <b>{dayLabel(p.date)}</b>
                    <span>From the bill {p.billName}</span>
                  </span>
                ) : (
                  <button type="button" className="li-main li-tap" onClick={() => onPay?.(p)} aria-label={`Edit payment on ${dayLabel(p.date)}`}>
                    <b>{dayLabel(p.date)}</b>
                  </button>
                )}
                <span className="li-amt">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {payments.length > 8 && <p className="muted small">Showing the latest 8 of {payments.length}.</p>}
      </section>
    ),
  };
  return grid(cards);
}

function CardSheet({
  store,
  card,
  today,
  onClose,
  onSaved,
}: {
  store: Store;
  card?: CreditCard;
  today: string;
  onClose: () => void;
  onSaved: (c: CreditCard) => void;
}) {
  const { cards, settings } = store.data;
  const { offer } = useUndo();
  const [kind, setKind] = useState<DebtKind>(card?.kind ?? 'credit-card');
  const loan = isLoan({ kind });
  const [name, setName] = useState(card?.name ?? '');
  const [min, setMin] = useState(card?.minPaymentCents ? centsToAmountInput(card.minPaymentCents) : '');
  const legacyDay = card ? store.data.bills.find((b) => b.id === debtBillId(card.id) && !b.deleted)?.autoPay?.day : undefined;
  const [due, setDue] = useState(String(card?.dueDay ?? legacyDay ?? ''));
  const [apr, setApr] = useState(card ? String(card.aprBps / 100) : '');
  const [balance, setBalance] = useState(card ? centsToAmountInput(card.startBalanceCents) : '');
  const firstMonth = store.data.settings.firstMonth;
  const [start, setStart] = useState(card?.startMonth ?? (today.slice(0, 7) < firstMonth ? firstMonth : today.slice(0, 7)));
  const [limit, setLimit] = useState(card?.limitCents ? centsToAmountInput(card.limitCents) : '');
  const [plan, setPlan] = useState(card?.plannedPaymentCents ? centsToAmountInput(card.plannedPaymentCents) : '');
  const [full, setFull] = useState(card?.payInFull ?? false);
  const [closed, setClosed] = useState(card?.closedMonth !== undefined);
  const [closedMonth, setClosedMonth] = useState(card?.closedMonth ?? today.slice(0, 7));
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);

  // An existing Paid with name keeps its spelling, so purchases already tagged with it link up.
  const typed = name.trim();
  const existing = settings.paidWith.find((m) => m.toLowerCase() === typed.toLowerCase());
  const finalName = loan ? typed : (existing ?? typed);
  const taken = cards.some((c) => c.id !== card?.id && c.name.toLowerCase() === typed.toLowerCase());
  const linkable = settings.paidWith.filter((m) => !cards.some((c) => c.name === m) || m === card?.name);
  const aprBps = parseApr(apr);
  const bal = balance.trim() === '' ? 0 : parseCents(balance);
  const lim = limit.trim() === '' ? undefined : parseCents(limit);
  const pl = plan.trim() === '' ? undefined : parseCents(plan);
  const dueNum = Number(due);
  const mn = min.trim() === '' ? undefined : parseCents(min);
  const errors = [
    !typed && 'Enter a name',
    taken && 'You already have a debt with that name',
    aprBps === undefined && 'Enter the APR, like 24.99',
    bal === undefined && 'Enter the balance, like 1,250.00',
    limit.trim() !== '' && lim === undefined && 'Enter the limit as an amount',
    due.trim() !== '' && !(Number.isInteger(dueNum) && dueNum >= 1 && dueNum <= 31) && 'Enter the due day as a day of the month, 1 to 31',
    due.trim() !== '' && !mn && 'Set a minimum payment so it can be recorded on the due date',
    min.trim() !== '' && mn === undefined && 'Enter the minimum payment as an amount',
    plan.trim() !== '' && pl === undefined && 'Enter the monthly payment as an amount',
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(start) && 'Pick the month you start tracking',
    start !== card?.startMonth && start < firstMonth && `Start in ${monthLabel(firstMonth)} or later, your first tracked month`,
    closed && !/^\d{4}-(0[1-9]|1[0-2])$/.test(closedMonth) && 'Pick the month the account closed',
  ].filter(Boolean) as string[];

  async function save() {
    setTried(true);
    if (errors.length || aprBps === undefined || bal === undefined) return;
    const next: CreditCard = {
      id: card?.id ?? newId(),
      ...(loan ? { kind } : {}),
      name: finalName,
      aprBps,
      startBalanceCents: bal,
      startMonth: start,
      payments: card?.payments ?? [],
    };
    if (lim && !loan) next.limitCents = lim;
    if (pl) next.plannedPaymentCents = pl;
    if (mn) next.minPaymentCents = mn;
    if (due.trim() !== '' && !(full && !loan)) next.dueDay = dueNum;
    if (card?.paidOffDate) next.paidOffDate = card.paidOffDate;
    if (card?.resetDate && start === card.startMonth) next.resetDate = card.resetDate;
    if (card?.interestSavedCents !== undefined) next.interestSavedCents = card.interestSavedCents;
    if (full && !closed && !loan) next.payInFull = true;
    if (closed && !loan) next.closedMonth = closedMonth < start ? start : closedMonth;
    await store.saveCard(next, card?.name);
    if (card) offer(`Saved ${next.name}`, () => store.saveCard(card, next.name));
    else offer(`Added ${next.name}`, () => store.removeCard(next.id));
    onSaved(next);
    onClose();
  }

  async function remove() {
    if (!card) return;
    await store.removeCard(card.id);
    offer(`Removed ${card.name}`, () => store.saveCard(card));
    onClose();
  }

  if (confirm && card) {
    return (
      <SheetBackdrop onClose={onClose}>
        <div className="sheet menu" role="alertdialog" aria-modal="true" aria-label="Confirm remove debt">
          <h2>Remove {card.name}?</h2>
          <p className="muted small">
            Its balance, interest and payments are deleted{card.minPaymentCents ? ', and so is its minimum payment under your fixed bills (months where it was paid keep it)' : ''}.
            {!isLoan(card) && ' The name stays under Paid with, and past purchases keep it.'}
          </p>
          <button type="button" className="danger armed" onClick={() => void remove()}>
            Remove debt
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
        aria-labelledby="cd-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="cd-h">{card ? `Edit ${debtLabel(card).toLowerCase()}` : 'Add a debt'}</h2>
        {!card && (
          <div className="chips scroll-row" role="radiogroup" aria-label="Type of debt">
            {DEBT_KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span>{loan ? 'Name' : 'Name (also shown under Paid with)'}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={loan ? 'e.g. Car loan' : 'e.g. Blue Visa'} autoComplete="off" />
        </label>
        {!card && !loan && linkable.length > 0 && (
          <div className="field">
          <span id="debt-pw-h">Or use a Paid with name</span>
          <div className="chips scroll-row" role="group" aria-labelledby="debt-pw-h">
            {linkable.map((m) => (
              <button key={m} type="button" className={m === typed ? 'on' : ''} aria-pressed={m === typed} onClick={() => setName(m)}>
                {m}
              </button>
            ))}
          </div>
          </div>
        )}
        <div className="grid2">
          <label className="field">
            <span>APR (%)</span>
            <input type="text" inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="24.99" autoComplete="off" />
          </label>
          <label className="field">
            <span>Balance owed at start</span>
            <MoneyInput value={balance} onValue={setBalance} placeholder="0.00" />
          </label>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Minimum payment</span>
            <MoneyInput value={min} onValue={setMin} placeholder="0.00" />
          </label>
          <label className="field">
            <span>You plan to pay (optional)</span>
            <MoneyInput value={plan} onValue={setPlan} placeholder="0.00" />
          </label>
        </div>
        {(loan || !full) && (
          <label className="field">
            <span>Due date (day of the month, optional)</span>
            <input type="text" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="1 to 31" autoComplete="off" />
          </label>
        )}
        {(loan || !full) && <p className="muted small">On the due date each month the minimum payment is recorded automatically and lowers the balance.</p>}
        {!loan && (
          <label className="field">
            <span>Credit limit (optional)</span>
            <MoneyInput value={limit} onValue={setLimit} placeholder="0.00" />
          </label>
        )}
        <label className="field">
          <span>Tracking since</span>
          <input type="month" min={firstMonth} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        {!loan && (
          <button type="button" role="switch" aria-checked={closed} className={`switch-row${closed ? ' on' : ''}`} onClick={() => setClosed(!closed)}>
            <span>
              <b>Closed account</b>
              <small>No new purchases can be added. Interest is charged every month on the month's ending balance.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        )}
        {!loan && closed && (
          <label className="field">
            <span>Closed since</span>
            <input type="month" value={closedMonth} onChange={(e) => setClosedMonth(e.target.value)} />
          </label>
        )}
        {!loan && !closed && (
          <button type="button" role="switch" aria-checked={full} className={`switch-row${full ? ' on' : ''}`} onClick={() => setFull(!full)}>
            <span>
              <b>Paid in full every month</b>
              <small>No interest. Each month's balance shows as "Credit Card payoff" on Overview.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        )}
        <p className="muted small">
          The minimum payment is added to your fixed bills as "{typed || '<debt name>'} payment". Mark that bill paid on Overview (or turn on autopay) and the payment is recorded here.
          {loan
            ? ' Enter what you owed at the start of the tracking month. Interest is charged every month on the ending balance.'
            : ` Purchases tagged with this card under Paid with, dated ${monthLabel(start)} or later, add to the balance. Enter what you owed at the start of that month.`}{' '}
          The amount you plan to pay drives the payoff date; without it the minimum, then the average of your payments, is used.
        </p>
        {tried && errors.length > 0 && (
          <p className="error" role="alert">
            {errors.join(' · ')}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {card ? 'Save changes' : 'Add debt'}
          </button>
          {card && (
            <button type="button" className="danger" onClick={() => setConfirm(true)}>
              Remove debt
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

function PayoffSheet({ store, s, today, onClose }: { store: Store; s: CardSummary; today: string; onClose: () => void }) {
  const { card } = s;
  const { offer } = useUndo();
  const [amount, setAmount] = useState(s.balanceNowCents > 0 ? centsToAmountInput(s.balanceNowCents) : '');
  const [date, setDate] = useState(today);
  const [tried, setTried] = useState(false);
  const cents = parseCents(amount);
  const billsToStop = store.data.bills.filter((b) => b.cardId === card.id && !b.deleted);
  const saved = interestSaved(s.balanceNowCents, card.aprBps, minimumFor(card, linkedBills(card, store.data, today)), today.slice(0, 7));
  const errors = [
    s.balanceNowCents <= 0 && 'Nothing is owed on this debt',
    (cents === undefined || cents === 0) && 'Enter the amount you are paying',
    !date && 'Pick the date',
    date && date.slice(0, 7) < debtStart(card, store.data.settings.firstMonth) && `That is before you started tracking (${monthLabel(debtStart(card, store.data.settings.firstMonth))})`,
  ].filter(Boolean) as string[];

  async function save() {
    setTried(true);
    if (errors.length || cents === undefined) return;
    const clears = cents >= s.balanceNowCents;
    const next: CreditCard = { ...card, payments: [...card.payments, { id: newId(), date, amountCents: cents }] };
    if (clears) {
      next.paidOffDate = date;
      if (saved?.kind === 'saved') next.interestSavedCents = saved.cents;
      else delete next.interestSavedCents;
    }
    await store.saveCard(next);
    offer(cents >= s.balanceNowCents ? `${card.name} paid off` : `Payment recorded on ${card.name}`, () => store.saveCard(card));
    onClose();
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-sheet-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="po-sheet-h">Pay off {card.name}</h2>
        <dl className="kv">
          <dt>Balance now</dt>
          <dd>{formatCents(s.balanceNowCents)}</dd>
        </dl>
        <div className="grid2">
          <label className="field">
            <span>Amount paid</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder="0.00" />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {saved?.kind === 'saved' && (
          <p className="saved-line" role="status">
            <Icon name="check" />
            <span>
              Paying it off now saves about <b>{formatCents(saved.cents)}</b> in interest. With only the {formatCents(saved.minimumCents)} minimum it would take {saved.months} more payment{saved.months === 1 ? '' : 's'}.
            </span>
          </p>
        )}
        {saved?.kind === 'never' && (
          <p className="saved-line" role="status">
            <Icon name="check" />
            <span>The {formatCents(saved.minimumCents)} minimum would never clear this balance, so paying it off now saves all the interest it would keep adding.</span>
          </p>
        )}
        <p className="muted small">
          This records the payment on {card.name} and lowers its balance.
          {billsToStop.length > 0 && ` Once the balance is zero, ${billsToStop.map((b) => `"${b.name}"`).join(', ')} comes off your fixed bills and its autopay stops.`}
        </p>
        {tried && errors.length > 0 && (
          <p className="error" role="alert">
            {errors.join(' · ')}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={s.balanceNowCents <= 0}>
            Record payoff
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

/**
 * Reset balances: after a confirm, every debt is listed with what the app has it owing now, and the amounts typed in
 * become each debt's balance as of today. APRs, minimums, due dates and the rest stay as they are.
 */
function ResetSheet({ store, summaries, today, onClose }: { store: Store; summaries: CardSummary[]; today: string; onClose: () => void }) {
  const { offer } = useUndo();
  const [confirmed, setConfirmed] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(summaries.map((s) => [s.card.id, centsToAmountInput(Math.max(0, s.balanceNowCents))])));
  const [tried, setTried] = useState(false);
  const parsed = summaries.map((s) => ({ s, cents: parseCents(amounts[s.card.id] ?? '') }));
  const missing = parsed.filter((x) => x.cents === undefined).map((x) => x.s.card.name);

  async function save() {
    setTried(true);
    if (missing.length) return;
    const before = summaries.map((s) => s.card);
    for (const { s, cents } of parsed) await store.saveCard(resetDebt(s.card, cents ?? 0, today, store.data.settings.firstMonth));
    offer(`Balances reset for ${dayLabel(today)}`, async () => {
      for (const c of before) await store.saveCard(c);
    });
    onClose();
  }

  if (!confirmed) {
    return (
      <SheetBackdrop onClose={onClose}>
        <div className="sheet menu" role="alertdialog" aria-modal="true" aria-label="Confirm reset balances">
          <h2>Reset all balances?</h2>
          <p className="muted small">
            You'll enter what you owe on each debt today, and each one starts fresh from that amount. Its earlier months, interest and payments are cleared. APRs, minimum payments, due dates,
            limits and your fixed bills stay as they are.
          </p>
          <button type="button" className="danger armed" onClick={() => setConfirmed(true)}>
            Reset balances
          </button>
          <button type="button" className="secondary" onClick={onClose}>
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
        aria-labelledby="reset-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="reset-h">Balances as of {dayLabel(today)}</h2>
        <p className="muted small">Each amount starts filled in with what the app has now. Change any that differ from your statements or lender.</p>
        <div className="reset-list">
          {parsed.map(({ s, cents }) => (
            <label key={s.card.id} className="field reset-item">
              <span>
                {s.card.name}
                <small className="muted">{debtLabel(s.card)}{s.card.aprBps ? ` · ${formatApr(s.card.aprBps)} APR` : ''}</small>
              </span>
              <MoneyInput value={amounts[s.card.id] ?? ''} onValue={(v) => setAmounts((a) => ({ ...a, [s.card.id]: v }))} placeholder="0.00" />
              {tried && cents === undefined && <small className="error" role="alert">Enter an amount (0 if nothing is owed)</small>}
            </label>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="submit" className="primary">
            Start fresh
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

function PaymentSheet({ store, card, payment, today, onClose }: { store: Store; card: CreditCard; payment?: CardPayment; today: string; onClose: () => void }) {
  const { offer } = useUndo();
  const [amount, setAmount] = useState(payment ? centsToAmountInput(payment.amountCents) : '');
  const [date, setDate] = useState(payment?.date ?? today);
  const [tried, setTried] = useState(false);
  const cents = parseCents(amount);
  const errors = [(cents === undefined || cents === 0) && 'Enter the amount paid', !date && 'Pick the date', date && date.slice(0, 7) < debtStart(card, store.data.settings.firstMonth) && `That is before you started tracking (${monthLabel(debtStart(card, store.data.settings.firstMonth))})`].filter(Boolean) as string[];

  async function put(payments: CardPayment[], text: string, undo: CardPayment[]) {
    await store.saveCard({ ...card, payments });
    offer(text, () => store.saveCard({ ...card, payments: undo }));
  }

  async function save() {
    setTried(true);
    if (errors.length || cents === undefined) return;
    const made: CardPayment = { id: payment?.id ?? newId(), date, amountCents: cents };
    const next = payment ? card.payments.map((p) => (p.id === payment.id ? made : p)) : [...card.payments, made];
    await put(next, `Payment of ${formatCents(cents)} saved`, card.payments);
    onClose();
  }

  async function remove() {
    if (!payment) return;
    await put(card.payments.filter((p) => p.id !== payment.id), 'Payment removed', card.payments);
    onClose();
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="pay-h">{payment ? 'Edit payment' : 'Add a payment'} · {card.name}</h2>
        <div className="grid2">
          <label className="field">
            <span>Amount paid</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder="0.00" />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {tried && errors.length > 0 && (
          <p className="error" role="alert">
            {errors.join(' · ')}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {payment ? 'Save changes' : 'Add payment'}
          </button>
          {payment && (
            <button type="button" className="danger" onClick={() => void remove()}>
              Remove payment
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
