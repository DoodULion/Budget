import { Fragment, useState, type JSX } from 'react';
import { mergeOrder, useCardOrder } from './useCardOrder';
import { useHoldDrag } from './useHoldDrag';
import { BILL_SORTS, groupDebtBills, sortBillItems, payoffForMonth, PAYOFF_NAME, type BillSort } from './cards';
import { autopayDate, balances, formatCents, monthLabel, monthSummary, roundDiv, type BillRow, type MonthKey } from './calc';
import Icon from './icons';
import { centsToAmountInput, dayLabel, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { CatTile, Fig, Meter, MoneyInput, signed } from './ui';
const MONTH_CARDS = ['left', 'saved', 'balance', 'categories', 'bills'] as const;

/** The month at a glance: budget left, saved against the goal, each category, and the bills checklist. */
export default function Month({ store, month, today }: { store: Store; month: MonthKey; today: string }) {
  const s = monthSummary(store.data, month, today);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [billSheet, setBillSheet] = useState<BillRow | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [sortOpen, setSortOpen] = useState(false);
  // How the bills are ordered is a per-device preference (like the card order), not budget data.
  const [billSort, setBillSortState] = useState<BillSort>(() => {
    try {
      const v = localStorage.getItem('budget-tracker-bill-sort');
      return BILL_SORTS.some((s) => s.id === v) ? (v as BillSort) : 'setup';
    } catch {
      return 'setup';
    }
  });
  const setBillSort = (v: BillSort) => {
    setBillSortState(v);
    try {
      localStorage.setItem('budget-tracker-bill-sort', v);
    } catch {
      /* storage unavailable: the choice lasts until the app closes */
    }
  };
  const { offer } = useUndo();
  const over = s.spentCents > s.spendingBudgetCents;
  const isThisMonth = month === today.slice(0, 7);
  const leftText = formatCents(s.budgetLeftCents);
  // Days left in the month, today included (calendar math only).
  const [yy, mm] = month.split('-').map(Number);
  const daysLeft = new Date(Date.UTC(yy, mm, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1;
  const payoff = payoffForMonth(store.data.cards, store.data.purchases, month);
  // Checking balance: the starting balance with every started month's income, bills paid and spending applied.
  const bal = balances(store.data, today);
  const earlier = [...bal.keys()].filter((m) => m < month).pop();
  const balanceStart = earlier ? bal.get(earlier)! : store.data.settings.startingBalanceCents;
  const balanceEnd = s.savedCents === undefined ? balanceStart : balanceStart + s.savedCents;
  const perDay = roundDiv(Math.max(0, s.budgetLeftCents), Math.max(1, daysLeft));

  /** What to keep when a bill is unmarked: for an autopay bill, a marker so autopay doesn't record the month again. */
  const unpaidMark = (row: BillRow) => (row.bill.autoPay ? { skipped: true } : undefined);

  async function tick(row: BillRow) {
    if (row.status === 'ended') return;
    const before = row.payment;
    if (row.status === 'paid') {
      await store.setPayment(month, row.bill.id, unpaidMark(row));
      offer(`${row.bill.name} marked unpaid`, () => store.setPayment(month, row.bill.id, before), 'warn');
    } else {
      const date = isThisMonth ? today : `${month}-01`;
      await store.setPayment(month, row.bill.id, { datePaid: date });
      offer(`${row.bill.name} paid`, () => store.setPayment(month, row.bill.id, before));
    }
  }

  // Hold a card and drag it to rearrange the screen; the order is kept on this device.
  const [cardOrder, setCardOrder] = useCardOrder('month', MONTH_CARDS);
  // A press on a category row belongs to the row: the categories rearrange among themselves the same way.
  const { order, dragId, listRef, bind, justDragged } = useHoldDrag(cardOrder, setCardOrder, ':scope > [data-id]', '.more, .cat-row');
  const catIds = s.byCategory.map((r) => r.category.id);
  const [catOrder, setCatOrder] = useCardOrder('month-categories', catIds);
  const cats = useHoldDrag(mergeOrder(catOrder, catIds), setCatOrder, ':scope > [data-id]');
  const drag = (id: string, cls: string) => ({ ...bind(id), className: `${cls} sum-card${dragId === id ? ' lifted' : ''}` });

  const renderBill = (r: BillRow, nested = false) => (
              <li key={r.bill.id} className={`bill ${r.status}`}>
                <button
                  type="button"
                  className="bill-tick"
                  disabled={r.status === 'ended'}
                  aria-pressed={r.status === 'paid'}
                  onClick={() => void tick(r)}
                >
                  <span className="box">
                    <Icon name="check" />
                  </span>
                  <span className="bill-main">
                    <b>{r.bill.name}</b>
                    <span>
                      {r.status === 'paid'
                        ? r.payment?.datePaid
                          ? `${r.payment.auto ? 'Autopaid' : 'Paid'} ${dayLabel(r.payment.datePaid)}`
                          : 'Paid'
                        : r.status === 'ended'
                          ? 'Ended'
                          : r.bill.autoPay && !r.payment?.skipped && month >= r.bill.autoPay.since
                            ? `Autopay ${dayLabel(autopayDate(month, r.bill.autoPay.day))}`
                            : 'Unpaid · tap when paid'}
                      {!nested && r.status !== 'ended' && store.data.cards.some((c) => c.id === r.bill.cardId) && ` · pays ${store.data.cards.find((c) => c.id === r.bill.cardId)?.name}`}
                    </span>
                  </span>
                  <span className="bill-amt">
                    {formatCents(r.status === 'paid' ? r.countedCents : r.bill.amountCents)}
                    {r.status === 'paid' && r.countedCents !== r.bill.amountCents && <small>of {formatCents(r.bill.amountCents)}</small>}
                  </span>
                </button>
                {r.status !== 'ended' && (
                  <button type="button" className="more" aria-label={`Options for ${r.bill.name}`} aria-haspopup="dialog" onClick={() => setBillSheet(r)}>
                    <Icon name="dots" />
                  </button>
                )}
              </li>
  );

  const cards: Record<string, JSX.Element> = {
    left: (
      <section {...drag('left', `card hero${over ? ' over' : ''}`)} aria-labelledby="left-h">
        <div className="card-head">
          <h2 id="left-h">
            {over && <Icon name="alert" />}
            {over ? 'Over budget by' : 'Budget left'}
          </h2>
        </div>
        <p className="big fit" style={{ ['--chars' as string]: Math.max(leftText.length, 4) }}>
          {over ? formatCents(-s.budgetLeftCents) : leftText}
        </p>
        <Meter spent={s.spentCents} budget={s.spendingBudgetCents} label="Spent of this month's spending budget" />
        <div className="rule">
          <div>
            <Fig cents={s.spentCents} />
            <span className="muted">Spent</span>
          </div>
          <div>
            <Fig cents={s.spendingBudgetCents} />
            <span className="muted">Budget</span>
          </div>
          {isThisMonth && !over ? (
            <div>
              <Fig cents={perDay} />
              <span className="muted">Left per day</span>
            </div>
          ) : (
            <div>
              <Fig text={String(s.unpaidCount)} />
              <span className="muted">Bills unpaid</span>
            </div>
          )}
        </div>
      </section>

    ),
    saved: (
      <section {...drag('saved', 'card')} aria-labelledby="saved-h">
        <div className="card-head">
          <h2 id="saved-h">Saved</h2>
          {s.vsGoalCents !== undefined && (
            <span className={`pill${s.vsGoalCents < 0 ? ' red' : ''}`}>{s.vsGoalCents < 0 ? 'Under goal' : 'Goal met'}</span>
          )}
          {s.future && <span className="pill idle">Not started</span>}
        </div>
        <dl className="kv">
          <dt>Income</dt>
          <dd>
            <button type="button" className="link" onClick={() => setIncomeOpen(true)} aria-label={`Income ${formatCents(s.incomeCents)}, change`}>
              {formatCents(s.incomeCents)}
            </button>
            {s.incomeIsBaseline && <small>planned · tap to enter actual</small>}
          </dd>
          <dt>Bills paid</dt>
          <dd>−{formatCents(s.billsPaidCents)}</dd>
          <dt>Spent</dt>
          <dd>−{formatCents(s.spentCents)}</dd>
          <dt className="sum-line">Saved</dt>
          <dd className="sum-line">{s.savedCents === undefined ? '—' : formatCents(s.savedCents)}</dd>
          <dt>vs goal</dt>
          <dd className={s.vsGoalCents === undefined ? '' : s.vsGoalCents < 0 ? 'fig-neg' : 'fig-pos'}>
            {s.vsGoalCents === undefined ? '—' : signed(s.vsGoalCents)}
          </dd>
        </dl>
        {s.future && <p className="muted small">Saved counts once the month starts.</p>}
      </section>

    ),
    balance: (
      <section {...drag('balance', 'card')} aria-labelledby="bal-h">
        <div className="card-head">
          <h2 id="bal-h">Checking balance</h2>
          {s.future && <span className="pill idle">Not started</span>}
        </div>
        <p className="big-sm">{formatCents(balanceEnd)}</p>
        <dl className="kv">
          <dt>Start of {monthLabel(month)}</dt>
          <dd>{formatCents(balanceStart)}</dd>
          {!s.future && (
            <>
              <dt>Income</dt>
              <dd>+{formatCents(s.incomeCents)}</dd>
              <dt>Bills paid</dt>
              <dd>−{formatCents(s.billsPaidCents)}</dd>
              <dt>Spent</dt>
              <dd>−{formatCents(s.spentCents)}</dd>
              <dt className="sum-line">{isThisMonth ? 'Now' : 'End of month'}</dt>
              <dd className="sum-line">{formatCents(balanceEnd)}</dd>
            </>
          )}
        </dl>
        <p className="muted small">Your starting balance, plus the income, bills paid and spending of every month so far.</p>
      </section>
    ),
    categories: (
      <section {...drag('categories', 'card')} aria-labelledby="cat-h">
        <h2 id="cat-h">By category</h2>
        {s.byCategory.length === 0 && payoff.byCard.length === 0 ? (
          <p className="empty-line">Add categories under Setup.</p>
        ) : (
          <ul
            className={`cat-rows${cats.dragId ? ' dragging' : ''}`}
            ref={(el) => {
              cats.listRef.current = el;
            }}
            onClickCapture={(e) => {
              if (cats.justDragged()) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {cats.order.map((id) => s.byCategory.find((r) => r.category.id === id)).filter((r): r is (typeof s.byCategory)[number] => !!r).map((r) => {
              const catOver = r.leftCents < 0;
              return (
                <li key={r.category.id} {...cats.bind(r.category.id)} className={`cat-row sum-card${cats.dragId === r.category.id ? ' lifted' : ''}`}>
                  <CatTile category={r.category} />
                  <div className="cat-name">
                    <b>{r.category.name}</b>
                    <span>
                      {formatCents(r.spentCents)} of {formatCents(r.budgetCents)}
                    </span>
                  </div>
                  <div className={`cat-left${catOver ? ' over' : ''}`}>
                    {formatCents(Math.abs(r.leftCents))}
                    <small>{catOver ? 'over' : 'left'}</small>
                  </div>
                  <Meter spent={r.spentCents} budget={r.budgetCents} label={`${r.category.name} spent of budget`} />
                </li>
              );
            })}
          </ul>
        )}
        {payoff.byCard.length > 0 && (
          <div className="payoff-block" role="group" aria-label={PAYOFF_NAME}>
            <CatTile category={{ name: PAYOFF_NAME, color: 'c8' }} />
            <div className="cat-name">
              <b>{PAYOFF_NAME}</b>
              <span>{payoff.byCard.map((c) => c.card.name).join(', ')}</span>
            </div>
            <div className="cat-left">
              {formatCents(payoff.totalCents)}
              <small>this month</small>
            </div>
          </div>
        )}
      </section>
    ),
    bills: (
      <section {...drag('bills', 'card')} aria-labelledby="bills-h">
        <div className="card-head">
          <h2 id="bills-h">Bills</h2>
          {s.bills.length > 0 && (
            <span className={`pill${s.unpaidCount ? ' idle' : ''}`}>{s.unpaidCount ? `${s.unpaidCount} unpaid` : 'All paid'}</span>
          )}
        </div>
        {s.bills.length > 1 && (
          <button type="button" className="sort-btn" aria-haspopup="dialog" onClick={() => setSortOpen(true)}>
            Sort: {BILL_SORTS.find((x) => x.id === billSort)?.label}
            <Icon name="down" />
          </button>
        )}
        {s.bills.length === 0 ? (
          <p className="empty-line">Add your fixed bills under Setup.</p>
        ) : (
          <ul className="bills">
            {sortBillItems(groupDebtBills(s.bills, store.data.cards), billSort).map((it) => {
              if (it.kind === 'bill') return renderBill(it.row);
              const open = openGroups.has(it.id);
              const live = it.rows.filter((r) => r.status !== 'ended').length;
              const allPaid = live > 0 && it.paid === live;
              return (
                <li key={`group-${it.id}`} className={`bill-group ${allPaid ? 'paid' : 'unpaid'}`}>
                  <button
                    type="button"
                    className="group-head"
                    aria-expanded={open}
                    onClick={() => setOpenGroups((g) => {
                      const next = new Set(g);
                      if (next.has(it.id)) next.delete(it.id);
                      else next.add(it.id);
                      return next;
                    })}
                  >
                    <span className="box">{allPaid && <Icon name="check" />}</span>
                    <span className="bill-main">
                      <b>{it.label}</b>
                      <span>
                        {it.paid} of {live} paid · {live} {live === 1 ? 'debt' : 'debts'}
                      </span>
                    </span>
                    <span className="bill-amt">{formatCents(it.amountCents)}</span>
                    <span className={`chev${open ? ' open' : ''}`} aria-hidden="true">
                      <Icon name="down" />
                    </span>
                  </button>
                  {open && <ul className="bills nested">{it.rows.map((r) => renderBill(r, true))}</ul>}
                </li>
              );
            })}
          </ul>
        )}
        {s.bills.length > 0 && <p className="muted small">An unpaid bill counts toward this month's savings.</p>}
      </section>
    ),
  };

  return (
    <div className="screen">
      <h1>{monthLabel(month)}</h1>
      <div className={`cols${dragId ? ' dragging' : ''}`} ref={(el) => { listRef.current = el; }} onClickCapture={(e) => {
        if (justDragged()) { e.preventDefault(); e.stopPropagation(); }
      }}>
        {order.map((id) => <Fragment key={id}>{cards[id]}</Fragment>)}
      </div>

      {incomeOpen && <IncomeSheet store={store} month={month} onClose={() => setIncomeOpen(false)} />}
      {sortOpen && (
        <SheetBackdrop onClose={() => setSortOpen(false)}>
          <div className="sheet menu" role="dialog" aria-modal="true" aria-label="Sort bills">
            <h2>Sort bills</h2>
            <div className="chips" role="radiogroup" aria-label="Sort bills by">
              {BILL_SORTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={billSort === o.id}
                  className={billSort === o.id ? 'on' : ''}
                  onClick={() => {
                    setBillSort(o.id);
                    setSortOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button type="button" className="secondary" onClick={() => setSortOpen(false)}>
              Cancel
            </button>
          </div>
        </SheetBackdrop>
      )}
      {billSheet && <BillSheet store={store} month={month} row={billSheet} today={today} onClose={() => setBillSheet(null)} />}
    </div>
  );
}

function IncomeSheet({ store, month, onClose }: { store: Store; month: MonthKey; onClose: () => void }) {
  const rec = store.data.months.find((m) => m.month === month);
  const [text, setText] = useState(rec?.incomeCents === undefined ? '' : centsToAmountInput(rec.incomeCents));
  const parsed = parseCents(text);
  const bad = text.trim() !== '' && parsed === undefined;
  const { offer } = useUndo();

  async function save(value: number | undefined) {
    const before = rec?.incomeCents;
    await store.setIncome(month, value);
    offer(`Income for ${monthLabel(month)} saved`, () => store.setIncome(month, before));
    onClose();
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inc-h"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad) void save(parsed);
        }}
      >
        <h2 id="inc-h">Income for {monthLabel(month)}</h2>
        <label className="field">
          <span>Income received</span>
          <MoneyInput value={text} onValue={setText} placeholder={formatCents(store.data.settings.incomeBaselineCents).slice(1)} />
        </label>
        <p className="muted small">Leave it blank to use your planned income of {formatCents(store.data.settings.incomeBaselineCents)}.</p>
        {bad && <p className="error">Enter an amount like 3,250.00</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={bad}>
            Save changes
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Discard changes
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

function BillSheet({ store, month, row, today, onClose }: { store: Store; month: MonthKey; row: BillRow; today: string; onClose: () => void }) {
  const [date, setDate] = useState(row.payment?.datePaid ?? (today.slice(0, 7) === month ? today : `${month}-01`));
  const [amount, setAmount] = useState(row.payment?.amountPaidCents === undefined ? '' : centsToAmountInput(row.payment.amountPaidCents));
  const parsed = parseCents(amount);
  const bad = amount.trim() !== '' && parsed === undefined;
  // Nothing is recorded before the first tracked month.
  const firstDay = `${store.data.settings.firstMonth}-01`;
  const early = !!date && date < firstDay && date !== row.payment?.datePaid;
  const { offer } = useUndo();

  async function save() {
    const before = row.payment;
    await store.setPayment(month, row.bill.id, { datePaid: date || undefined, amountPaidCents: parsed });
    offer(`${row.bill.name} saved`, () => store.setPayment(month, row.bill.id, before));
    onClose();
  }

  async function unmark() {
    const before = row.payment;
    await store.setPayment(month, row.bill.id, row.bill.autoPay ? { skipped: true } : undefined);
    offer(`${row.bill.name} marked unpaid`, () => store.setPayment(month, row.bill.id, before), 'warn');
    onClose();
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-h"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad && !early) void save();
        }}
      >
        <h2 id="bill-h">
          {row.bill.name} · {monthLabel(month)}
        </h2>
        <div className="grid2">
          <label className="field">
            <span>Date paid</span>
            <input type="date" min={firstDay} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Amount paid</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder={formatCents(row.bill.amountCents).slice(1)} />
          </label>
        </div>
        <p className="muted small">Leave Amount paid blank when you paid the usual {formatCents(row.bill.amountCents)}.</p>
        {bad && <p className="error">Enter an amount like 55.20</p>}
        {early && <p className="error">Pick a date in {monthLabel(store.data.settings.firstMonth)} or later, your first tracked month</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={bad || early}>
            {row.status === 'paid' ? 'Save changes' : 'Mark paid'}
          </button>
          {row.status === 'paid' && (
            <button type="button" className="danger" onClick={() => void unmark()}>
              Mark unpaid
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
