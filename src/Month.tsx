import { useState } from 'react';
import { formatCents, monthLabel, monthSummary, roundDiv, type BillRow, type MonthKey } from './calc';
import Icon from './icons';
import { centsToAmountInput, dayLabel, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { CatTile, Fig, Meter, MoneyInput, signed } from './ui';

/** The month at a glance: budget left, saved against the goal, each category, and the bills checklist. */
export default function Month({ store, month, today }: { store: Store; month: MonthKey; today: string }) {
  const s = monthSummary(store.data, month, today);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [billSheet, setBillSheet] = useState<BillRow | null>(null);
  const { offer } = useUndo();
  const over = s.spentCents > s.spendingBudgetCents;
  const isThisMonth = month === today.slice(0, 7);
  const leftText = formatCents(s.budgetLeftCents);
  // Days left in the month, today included (calendar math only).
  const [yy, mm] = month.split('-').map(Number);
  const daysLeft = new Date(Date.UTC(yy, mm, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1;
  const perDay = roundDiv(Math.max(0, s.budgetLeftCents), Math.max(1, daysLeft));

  async function tick(row: BillRow) {
    if (row.status === 'ended') return;
    const before = row.payment;
    if (row.status === 'paid') {
      await store.setPayment(month, row.bill.id, undefined);
      offer(`${row.bill.name} marked unpaid`, () => store.setPayment(month, row.bill.id, before));
    } else {
      const date = isThisMonth ? today : `${month}-01`;
      await store.setPayment(month, row.bill.id, { datePaid: date });
      offer(`${row.bill.name} paid`, () => store.setPayment(month, row.bill.id, before));
    }
  }

  return (
    <div className="screen">
      <h1>{monthLabel(month)}</h1>
      <div className="cols">
        <section className={`card hero${over ? ' over' : ''}`} aria-labelledby="left-h">
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

        <section className="card" aria-labelledby="saved-h">
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

        <section className="card" aria-labelledby="cat-h">
          <h2 id="cat-h">By category</h2>
          {s.byCategory.length === 0 ? (
            <p className="empty-line">Add categories under Setup.</p>
          ) : (
            <ul className="cat-rows">
              {s.byCategory.map((r) => {
                const catOver = r.leftCents < 0;
                return (
                  <li key={r.category.id} className="cat-row">
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
        </section>

        <section className="card" aria-labelledby="bills-h">
          <div className="card-head">
            <h2 id="bills-h">Bills</h2>
            {s.bills.length > 0 && (
              <span className={`pill${s.unpaidCount ? ' idle' : ''}`}>{s.unpaidCount ? `${s.unpaidCount} unpaid` : 'All paid'}</span>
            )}
          </div>
          {s.bills.length === 0 ? (
            <p className="empty-line">Add your fixed bills under Setup.</p>
          ) : (
            <ul className="bills">
              {s.bills.map((r) => (
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
                            ? `Paid ${dayLabel(r.payment.datePaid)}`
                            : 'Paid'
                          : r.status === 'ended'
                            ? 'Ended'
                            : 'Unpaid · tap when paid'}
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
              ))}
            </ul>
          )}
          {s.bills.length > 0 && <p className="muted small">An unpaid bill counts toward this month's savings.</p>}
        </section>
      </div>

      {incomeOpen && <IncomeSheet store={store} month={month} onClose={() => setIncomeOpen(false)} />}
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
  const { offer } = useUndo();

  async function save() {
    const before = row.payment;
    await store.setPayment(month, row.bill.id, { datePaid: date || undefined, amountPaidCents: parsed });
    offer(`${row.bill.name} saved`, () => store.setPayment(month, row.bill.id, before));
    onClose();
  }

  async function unmark() {
    const before = row.payment;
    await store.setPayment(month, row.bill.id, undefined);
    offer(`${row.bill.name} marked unpaid`, () => store.setPayment(month, row.bill.id, before));
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
          if (!bad) void save();
        }}
      >
        <h2 id="bill-h">
          {row.bill.name} · {monthLabel(month)}
        </h2>
        <div className="grid2">
          <label className="field">
            <span>Date paid</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Amount paid</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder={formatCents(row.bill.amountCents).slice(1)} />
          </label>
        </div>
        <p className="muted small">Leave Amount paid blank when you paid the usual {formatCents(row.bill.amountCents)}.</p>
        {bad && <p className="error">Enter an amount like 55.20</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={bad}>
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
