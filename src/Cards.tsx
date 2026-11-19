import { Fragment, useState, type JSX } from 'react';
import { cardSummary, DEBT_KINDS, debtBillId, interestSaved, isPaidOff, minimumFor, debtLabel, formatApr, isLoan, linkedBills, type DebtKind, monthlyInterestCents, parseApr, payoff, projection, totalSeries, type CardPayment, type CardSummary, type CreditCard } from './cards';
import { formatCents, monthLabel, type Category, type MonthKey } from './calc';
import Icon from './icons';
import { centsToAmountInput, dayLabel, newId, ordinal, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { useCardOrder } from './useCardOrder';
import { useHoldDrag } from './useHoldDrag';
import { CatTile, Fig, Meter, MoneyInput } from './ui';

/** Compact dollars for chart labels: $1.2k, $850. */
function compact(cents: number): string {
  const d = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? '−' : ''}${d >= 1000 ? `$${(d / 1000).toFixed(d >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${d}`}`;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (m: MonthKey) => SHORT[Number(m.slice(5, 7)) - 1];
const colorOf = (i: number) => `c${(i % 8) + 1}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Debt: credit cards (balances follow the purchases tagged with the card) and loans, with interest, minimum payments and insights. */
export default function Cards({ store, today }: { store: Store; today: string }) {
  const { cards, purchases, categories } = store.data;
  const [sel, setSel] = useState('all');
  const [editing, setEditing] = useState<CreditCard | 'new' | null>(null);
  const [paying, setPaying] = useState<{ card: CreditCard; payment?: CardPayment } | null>(null);
  const [menu, setMenu] = useState<CreditCard | null>(null);
  const [payingOff, setPayingOff] = useState<CardSummary | null>(null);
  const summaries = cards.map((c) => cardSummary(c, purchases, today, linkedBills(c, store.data, today)));
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
            <div className="chips scroll-row" role="group" aria-label="Debt">
              <button type="button" className={one ? '' : 'on'} aria-pressed={!one} onClick={() => setSel('all')}>
                All debts
              </button>
              {summaries.map((s, i) => (
                <button key={s.card.id} type="button" className={one?.card.id === s.card.id ? 'on' : ''} aria-pressed={one?.card.id === s.card.id} onClick={() => setSel(s.card.id)}>
                  <CatTile category={{ name: s.card.name, color: colorOf(i) }} small />
                  {s.card.name}
                </button>
              ))}
            </div>
          )}
          {one ? (
            <CardDetail key={one.card.id} mode="manage" s={one} categories={categories} today={today} onEdit={() => setEditing(one.card)} onMenu={() => setMenu(one.card)} onPay={(payment) => setPaying({ card: one.card, payment })} />
          ) : (
            <DebtList summaries={summaries} today={today} onOpen={(id) => setSel(id)} />
          )}
          <button type="button" className="add-row" onClick={() => setEditing('new')}>
            <Icon name="add" />
            Add a debt
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
      {payingOff && <PayoffSheet store={store} s={payingOff} today={today} onClose={() => setPayingOff(null)} />}
      {paying && <PaymentSheet store={store} card={paying.card} payment={paying.payment} today={today} onClose={() => setPaying(null)} />}
    </div>
  );
}

/* ---------- drag-to-rearrange plumbing shared by the two views ---------- */

function useArrange(screen: string, ids: readonly string[]) {
  const [saved, setSaved] = useCardOrder(screen, ids);
  const { order, dragId, listRef, bind, justDragged } = useHoldDrag(saved, setSaved, ':scope > [data-id]');
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

/* ---------- all cards ---------- */

const OVERVIEW = ['total', 'list', 'chart', 'interest', 'order'] as const;

function Overview({ summaries, today, onOpen }: { summaries: CardSummary[]; today: string; onOpen: (id: string) => void }) {
  const { drag, grid } = useArrange('cards-all', OVERVIEW);
  const sum = (f: (s: CardSummary) => number) => summaries.reduce((t, s) => t + f(s), 0);
  const owed = sum((s) => Math.max(0, s.balanceNowCents));
  const limit = sum((s) => s.card.limitCents ?? 0);
  const limited = summaries.filter((s) => s.card.limitCents);
  const limitedOwed = limited.reduce((t, s) => t + Math.max(0, s.balanceNowCents), 0);
  const interestAll = sum((s) => s.interestAllCents);
  const series = totalSeries(summaries, today);
  const monthlyInterest = summaries.reduce((t, s) => t + monthlyInterestCents(Math.max(0, s.balanceNowCents), s.card.aprBps), 0);
  const byApr = summaries.filter((s) => s.balanceNowCents > 0 && !s.card.payInFull).sort((a, b) => b.card.aprBps - a.card.aprBps);

  const cards: Record<string, JSX.Element> = {
    total: (
      <section {...drag('total', 'card hero')} aria-labelledby="owed-h">
        <h2 id="owed-h">Owed on all debts</h2>
        <p className="big fit" style={{ ['--chars' as string]: Math.max(formatCents(owed).length, 4) }}>
          {formatCents(owed)}
        </p>
        {limit > 0 && <Meter spent={limitedOwed} budget={limit} label="Owed of total credit limit" />}
        <div className="rule">
          <div>
            <Fig cents={sum((s) => s.paymentsThisYearCents)} />
            <span className="muted">Paid this year</span>
          </div>
          <div>
            <Fig cents={interestAll} />
            <span className="muted">Interest paid</span>
          </div>
          <div>
            {limit > 0 ? <Fig text={pct(limitedOwed / limit)} /> : <Fig cents={monthlyInterest} />}
            <span className="muted">{limit > 0 ? 'Limit used' : 'Interest a month'}</span>
          </div>
        </div>
      </section>
    ),
    list: (
      <section {...drag('list', 'card')} aria-labelledby="list-h">
        <h2 id="list-h">Your debts</h2>
        <ul className="cat-rows">
          {summaries.map((s, i) => (
            <li key={s.card.id} className="cat-row">
              <CatTile category={{ name: s.card.name, color: colorOf(i) }} />
              <button type="button" className="cat-name card-open" onClick={() => onOpen(s.card.id)} aria-label={`Open ${s.card.name}`}>
                <b>{s.card.name}</b>
                <span>
                  {debtLabel(s.card)} · {formatApr(s.card.aprBps)} APR · {payoffShort(s)}
                </span>
              </button>
              <div className="cat-left">{formatCents(s.balanceNowCents)}</div>
              {s.card.limitCents ? <Meter spent={Math.max(0, s.balanceNowCents)} budget={s.card.limitCents} label={`${s.card.name} balance of limit`} /> : null}
            </li>
          ))}
        </ul>
      </section>
    ),
    chart: (
      <section {...drag('chart', 'card')} aria-labelledby="tot-h">
        <h2 id="tot-h">Total owed over time</h2>
        <BalanceChart points={series.map((p) => ({ month: p.month, cents: p.cents }))} projected={[]} label="Total owed on all debts" />
      </section>
    ),
    interest: (
      <section {...drag('interest', 'card')} aria-labelledby="int-h">
        <h2 id="int-h">Interest</h2>
        <dl className="kv">
          <dt>Paid so far</dt>
          <dd>{formatCents(interestAll)}</dd>
          <dt>Paid this year</dt>
          <dd>{formatCents(sum((s) => s.interestThisYearCents))}</dd>
          <dt>Costs a month at today's balances</dt>
          <dd>{formatCents(monthlyInterest)}</dd>
          <dt>Charged to cards, all time</dt>
          <dd>{formatCents(sum((s) => s.chargesAllCents))}</dd>
          <dt>Paid toward debts</dt>
          <dd>{formatCents(sum((s) => s.paymentsAllCents))}</dd>
        </dl>
      </section>
    ),
    order: (
      <section {...drag('order', 'card')} aria-labelledby="av-h">
        <h2 id="av-h">Which to pay down first</h2>
        {byApr.length === 0 ? (
          <p className="empty-line">Nothing owed. Nice.</p>
        ) : (
          <>
            <ol className="plain-list">
              {byApr.map((s) => (
                <li key={s.card.id}>
                  <b>{s.card.name}</b> <span className="muted">{formatApr(s.card.aprBps)} · {formatCents(s.balanceNowCents)}</span>
                </li>
              ))}
            </ol>
            <p className="muted small">Put extra money on the highest rate first (after every card's minimum). It saves the most interest.</p>
          </>
        )}
      </section>
    ),
  };
  return grid(cards);
}

/** The Debt tab's list: what is owed on each debt with its minimum payment and interest rate. */
function DebtList({ summaries, today, onOpen }: { summaries: CardSummary[]; today: string; onOpen: (id: string) => void }) {
  const { drag, grid } = useArrange('debt-list', ['total', 'list']);
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
            <span className="muted">Minimums a month</span>
          </div>
          <div>
            <Fig cents={monthlyInterest} />
            <span className="muted">Interest a month</span>
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
        <ul className="debt-list">
          {summaries.map((s, i) => (
            <li key={s.card.id} className="debt-row">
              <CatTile category={{ name: s.card.name, color: colorOf(i) }} />
              <button type="button" className="main" onClick={() => onOpen(s.card.id)} aria-label={`Open ${s.card.name}`}>
                <span className="dn">{s.card.name}</span>
                <span className="db">{formatCents(s.balanceNowCents)}</span>
                <span className="ds">
                  {[
                    isPaidOff(s.card, s) ? 'Paid off' : s.card.minPaymentCents ? `Min ${formatCents(s.card.minPaymentCents)}` : 'No minimum set',
                    `${formatApr(s.card.aprBps)} APR`,
                    s.card.dueDay && !isPaidOff(s.card, s) ? `Due the ${s.card.dueDay}${ordinal(s.card.dueDay)}` : undefined,
                    debtLabel(s.card),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
  };
  void today;
  return grid(cards);
}

/** Debt insights for Analytics: all debts together, or one debt's payoff estimate, charts, interest and month-by-month table. */
export function DebtAnalytics({ store, today }: { store: Store; today: string }) {
  const { cards, purchases, categories } = store.data;
  const [sel, setSel] = useState('all');
  const summaries = cards.map((c) => cardSummary(c, purchases, today, linkedBills(c, store.data, today)));
  const one = summaries.length === 1 ? summaries[0] : summaries.find((s) => s.card.id === sel);
  if (summaries.length === 0) {
    return (
      <section className="card">
        <h2>Debt insights</h2>
        <p className="muted">Add a credit card or loan on the Debt tab to see payoff dates, balances over time and interest here.</p>
      </section>
    );
  }
  return (
    <>
      {summaries.length > 1 && (
        <div className="chips scroll-row" role="group" aria-label="Debt">
          <button type="button" className={one ? '' : 'on'} aria-pressed={!one} onClick={() => setSel('all')}>
            All debts
          </button>
          {summaries.map((s, i) => (
            <button key={s.card.id} type="button" className={one?.card.id === s.card.id ? 'on' : ''} aria-pressed={one?.card.id === s.card.id} onClick={() => setSel(s.card.id)}>
              <CatTile category={{ name: s.card.name, color: colorOf(i) }} small />
              {s.card.name}
            </button>
          ))}
        </div>
      )}
      {one ? <CardDetail key={one.card.id} mode="insights" s={one} categories={categories} today={today} /> : <Overview summaries={summaries} today={today} onOpen={(id) => setSel(id)} />}
    </>
  );
}

function payoffShort(s: CardSummary): string {
  const p = s.payoff;
  if (s.closed && !s.loan && p.kind === 'months') return `Closed · paid off ${monthLabel(p.lastMonth)}`;
  if (s.closed && !s.loan && p.kind === 'noPlan') return 'Closed';
  if (p.kind === 'full') return 'Paid in full monthly';
  if (p.kind === 'clear') return 'Paid off';
  if (p.kind === 'noPlan') return 'Set a monthly payment';
  if (p.kind === 'never') return 'Payment too small';
  return `Paid off ${monthLabel(p.lastMonth)}`;
}

/* ---------- one card ---------- */

/** On the Debt tab a debt shows its balance, statement and payments; the insights (payoff, charts, interest) are on Analytics. */
const MANAGE = ['balance', 'statement', 'payments'] as const;
const INSIGHTS = ['payoff', 'chart', 'spending', 'interest', 'categories', 'table'] as const;

function CardDetail({
  mode,
  s,
  categories,
  today,
  onEdit,
  onMenu,
  onPay,
}: {
  mode: 'manage' | 'insights';
  s: CardSummary;
  categories: Category[];
  today: string;
  onEdit?: () => void;
  onMenu?: () => void;
  onPay?: (payment?: CardPayment) => void;
}) {
  const { drag, grid } = useArrange(mode === 'manage' ? 'card-detail' : 'card-insights', mode === 'manage' ? MANAGE : INSIGHTS);
  const { card } = s;
  const owedNow = Math.max(0, s.balanceNowCents);
  const nowMonth = today.slice(0, 7);
  const plan = s.payoffPaymentCents;
  const proj = projection(s.balanceNowCents, card.aprBps, plan);
  const interestRow = s.rows.filter((r) => !r.current || r.interestCents > 0);
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.cents));
  const payments = [...card.payments, ...s.billPayments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const monthlyCost = monthlyInterestCents(owedNow, card.aprBps);

  const whatIf = (extra: number) => {
    if (!plan) return null;
    const p = payoff(s.balanceNowCents, card.aprBps, plan + extra, nowMonth);
    if (p.kind !== 'months' || s.payoff.kind !== 'months') return null;
    return { p, saved: s.payoff.interestCents - p.interestCents };
  };

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
              <span className="muted">Interest a month</span>
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
          {!s.closed && s.statementCents > 0 && <span className={`pill${s.leftToAvoidInterestCents > 0 ? ' idle' : ''}`}>{s.leftToAvoidInterestCents > 0 ? (card.payInFull ? 'Due' : 'Unpaid') : 'Paid'}</span>}
        </div>
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
      </section>
    ),
    payoff: (
      <section {...drag('payoff', 'card')} aria-labelledby="po-h">
        <h2 id="po-h">Estimated payoff</h2>
        {s.payoff.kind === 'full' && (
          <p className="muted">
            This card is paid in full every month, so there is no payoff date and no interest. Pay the {formatCents(s.statementCents)} statement and the balance starts over with new purchases.
          </p>
        )}
        {s.payoff.kind === 'clear' && (
          <>
            <p className="muted">{card.paidOffDate ? `Paid off ${dayLabel(card.paidOffDate)}.` : 'No balance to pay off.'}</p>
            {card.paidOffDate && card.interestSavedCents !== undefined && (
              <p className="whatif">
                <b>{formatCents(card.interestSavedCents)} interest saved</b> by paying off early instead of making only the minimum
              </p>
            )}
          </>
        )}
        {s.payoff.kind === 'noPlan' && (
          <>
            <p className="muted">Enter what you plan to pay each month to see a payoff date.</p>
            {onEdit ? (
              <button type="button" className="secondary" onClick={onEdit}>
                Set a monthly payment
              </button>
            ) : (
              <p className="muted small">Set a minimum or planned payment on the Debt tab.</p>
            )}
          </>
        )}
        {s.payoff.kind === 'never' && (
          <p className="warn-line">
            <Icon name="alert" />
            {formatCents(plan ?? 0)} a month doesn't beat the {formatCents(monthlyCost)} of monthly interest, so the balance never reaches zero. Pay more than {formatCents(monthlyCost)}.
          </p>
        )}
        {s.payoff.kind === 'months' && (
          <>
            <p className="big-sm">{monthLabel(s.payoff.lastMonth)}</p>
            <p className="muted">
              {s.payoff.months} payment{s.payoff.months === 1 ? '' : 's'} of {formatCents(plan ?? 0)}
              {s.payoffUsesBill ? ' (your linked bill)' : s.payoffUsesAverage ? ' (your average so far)' : ''} · about {formatCents(s.payoff.interestCents)} more interest, counted every month on what is left, if nothing new is charged. You would pay {formatCents(s.balanceNowCents + s.payoff.interestCents)} in all.
            </p>
            {[5_000, 10_000].map((extra) => {
              const w = whatIf(extra);
              return w ? (
                <p key={extra} className="whatif">
                  <b>+{formatCents(extra)} a month</b> → {monthLabel(w.p.lastMonth)}, saves {formatCents(Math.max(0, w.saved))} interest
                </p>
              ) : null;
            })}
          </>
        )}
      </section>
    ),
    chart: (
      <section {...drag('chart', 'card')} aria-labelledby="ch-h">
        <h2 id="ch-h">Balance over time</h2>
        <BalanceChart points={s.rows.map((r) => ({ month: r.month, cents: r.closingCents }))} projected={proj} label={`${card.name} balance`} />
        {proj.length > 0 && <p className="muted small">The dashed line is where the balance goes paying {formatCents(plan ?? 0)} a month with no new charges.</p>}
      </section>
    ),
    spending: (
      <section {...drag('spending', 'card')} aria-labelledby="sp-h">
        <h2 id="sp-h">Spending</h2>
        <div className="rule">
          <div>
            <Fig cents={s.chargesThisMonthCents} />
            <span className="muted">This month</span>
          </div>
          <div>
            <Fig cents={s.chargesThisYearCents} />
            <span className="muted">This year</span>
          </div>
          <div>
            <Fig cents={s.chargesAllCents} />
            <span className="muted">All time</span>
          </div>
        </div>
        <BarChart label={`${card.name} spending each month`} items={s.rows.map((r) => ({ month: r.month, cents: r.chargesCents }))} />
      </section>
    ),
    interest: (
      <section {...drag('interest', 'card')} aria-labelledby="in-h">
        <h2 id="in-h">Interest and payments</h2>
        <dl className="kv">
          <dt>Interest paid, all time</dt>
          <dd>{formatCents(s.interestAllCents)}</dd>
          <dt>Interest this year</dt>
          <dd>{formatCents(s.interestThisYearCents)}</dd>
          <dt>Costs a month at this balance</dt>
          <dd>{formatCents(monthlyCost)}</dd>
          <dt>Paid toward the card</dt>
          <dd>{formatCents(s.paymentsAllCents)}</dd>
          <dt>Average payment</dt>
          <dd>{formatCents(s.avgPaymentCents)}</dd>
          {!s.loan && !s.closed && (
            <>
              <dt>Statements paid in full</dt>
              <dd>{s.statements ? `${s.paidInFull} of ${s.statements}` : '—'}</dd>
            </>
          )}
        </dl>
        {s.interestAllCents > 0 && <BarChart label={`${card.name} interest each month`} items={interestRow.map((r) => ({ month: r.month, cents: r.interestCents }))} warm />}
      </section>
    ),
    categories: (
      <section {...drag('categories', 'card')} aria-labelledby="cc-h">
        <h2 id="cc-h">Where it went this year</h2>
        {s.byCategory.length === 0 ? (
          <p className="empty-line">Purchases paid with {card.name} will show here.</p>
        ) : (
          <ul className="hbars">
            {s.byCategory.map((c) => {
              const cat = categories.find((x) => x.id === c.categoryId);
              return (
                <li key={c.categoryId}>
                  <span className="hb-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <CatTile category={cat} small />
                    {cat?.name ?? '(deleted)'}
                  </span>
                  <b>{formatCents(c.cents)}</b>
                  <span className="hb-track">
                    <i style={{ width: `${(c.cents / maxCat) * 100}%`, ['--meter' as string]: `var(--cat-${cat?.color ?? 'c8'})` }} />
                  </span>
                </li>
              );
            })}
          </ul>
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
    table: (
      <section {...drag('table', 'card span-all')} aria-labelledby="tb-h">
        <h2 id="tb-h">Month by month</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="tb-h">
          <table className="ytable">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Start</th>
                <th scope="col">Spent</th>
                <th scope="col">Paid</th>
                <th scope="col">Interest</th>
                <th scope="col">End</th>
              </tr>
            </thead>
            <tbody>
              {[...s.rows].reverse().map((r) => (
                <tr key={r.month} className={r.current ? 'now' : ''}>
                  <th scope="row">{monthLabel(r.month)}</th>
                  <td>{formatCents(r.openingCents)}</td>
                  <td>{formatCents(r.chargesCents)}</td>
                  <td>{formatCents(r.paymentsCents)}</td>
                  <td>{r.current ? '—' : formatCents(r.interestCents)}</td>
                  <td>{formatCents(r.closingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Interest is added when a month ends if the statement from the month before wasn't paid in full.</p>
      </section>
    ),
  };
  if (s.loan) {
    delete cards.spending;
    delete cards.categories;
  }
  return grid(cards);
}

/* ---------- charts ---------- */

const W = 340;
const H = 150;
const PAD = { l: 40, r: 8, t: 10, b: 20 };

/** Month labels thin out as the chart fills: every nth month, Jan with its year. */
function xLabels(months: MonthKey[]): Map<number, string> {
  const every = Math.max(1, Math.ceil(months.length / 8));
  const out = new Map<number, string>();
  months.forEach((m, i) => {
    if (i % every === 0) out.set(i, m.slice(5) === '01' ? `${shortMonth(m)} ’${m.slice(2, 4)}` : shortMonth(m));
  });
  return out;
}

function nextMonths(from: MonthKey, n: number): MonthKey[] {
  const out: MonthKey[] = [];
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

function BalanceChart({ points, projected, label }: { points: { month: MonthKey; cents: number }[]; projected: number[]; label: string }) {
  if (points.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  const lastActual = points[points.length - 1];
  // Projected month-ends start with this month's, which sits on the same month as the last actual point.
  const projMonths = projected.map((_, i) => (i === 0 ? lastActual.month : nextMonths(lastActual.month, i)[i - 1]));
  const months = [...points.map((p) => p.month), ...projMonths.slice(1)];
  const all = [...points.map((p) => p.cents), ...projected];
  const top = Math.max(1, ...all);
  const bottom = Math.min(0, ...all);
  const span = top - bottom || 1;
  const yOf = (v: number) => PAD.t + ((top - v) / span) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / Math.max(1, months.length);
  const xOf = (i: number) => PAD.l + slot * i + slot / 2;
  const actual = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.cents).toFixed(1)}`).join(' ');
  const dash = projected.length
    ? projected.map((v, i) => `${i ? 'L' : 'M'}${xOf(points.length - 1 + i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    : '';
  const labels = xLabels(months);
  const desc = points.map((p) => `${monthLabel(p.month)}: ${formatCents(p.cents)}`).join('; ');
  return (
    <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} by month. ${desc}${projected.length ? `. Projected to reach ${formatCents(projected[projected.length - 1])}` : ''}`}>
      <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top)} y2={yOf(top)} />
      <text x={PAD.l - 6} y={yOf(top) + 4} textAnchor="end">{compact(top)}</text>
      <line className="zero" x1={PAD.l} x2={W - PAD.r} y1={yOf(0)} y2={yOf(0)} />
      <text x={PAD.l - 6} y={yOf(0) + 4} textAnchor="end">$0</text>
      {dash && <path className="proj" d={dash} />}
      <path className="line" d={actual} />
      {points.map((p, i) => (
        <circle key={p.month} className="dot" cx={xOf(i)} cy={yOf(p.cents)} r={points.length > 14 ? 2.5 : 3.5} />
      ))}
      {[...labels].map(([i, t]) => (
        <text key={months[i]} x={xOf(i)} y={H - 4} textAnchor="middle">{t}</text>
      ))}
    </svg>
  );
}

function BarChart({ items, label, warm }: { items: { month: MonthKey; cents: number }[]; label: string; warm?: boolean }) {
  const top = Math.max(1, ...items.map((i) => i.cents));
  const yOf = (v: number) => PAD.t + ((top - v) / top) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / Math.max(1, items.length);
  const bw = Math.max(4, Math.min(28, slot * 0.6));
  const labels = xLabels(items.map((i) => i.month));
  return (
    <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${items.map((i) => `${monthLabel(i.month)}: ${formatCents(i.cents)}`).join('; ')}`}>
      <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top)} y2={yOf(top)} />
      <text x={PAD.l - 6} y={yOf(top) + 4} textAnchor="end">{compact(top)}</text>
      <line className="zero" x1={PAD.l} x2={W - PAD.r} y1={yOf(0)} y2={yOf(0)} />
      <text x={PAD.l - 6} y={yOf(0) + 4} textAnchor="end">$0</text>
      {items.map((it, i) => {
        const x = PAD.l + slot * i + (slot - bw) / 2;
        return (
          <g key={it.month}>
            {it.cents > 0 && <rect className={`bar${warm ? ' neg' : ''}`} x={x} width={bw} y={yOf(it.cents)} height={Math.max(1.5, yOf(0) - yOf(it.cents))} rx={3} />}
            {labels.has(i) && <text x={x + bw / 2} y={H - 4} textAnchor="middle">{labels.get(i)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- sheets ---------- */

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
  const [start, setStart] = useState(card?.startMonth ?? today.slice(0, 7));
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
          <div className="chips scroll-row" role="group" aria-label="Use an existing Paid with name">
            {linkable.map((m) => (
              <button key={m} type="button" className={m === typed ? 'on' : ''} aria-pressed={m === typed} onClick={() => setName(m)}>
                {m}
              </button>
            ))}
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
          <input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
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
          The minimum payment is added to your fixed bills as "{typed || 'name'} payment". Mark that bill paid on Overview (or turn on autopay) and the payment is recorded here.
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
    date && date.slice(0, 7) < card.startMonth && `That is before you started tracking (${monthLabel(card.startMonth)})`,
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

function PaymentSheet({ store, card, payment, today, onClose }: { store: Store; card: CreditCard; payment?: CardPayment; today: string; onClose: () => void }) {
  const { offer } = useUndo();
  const [amount, setAmount] = useState(payment ? centsToAmountInput(payment.amountCents) : '');
  const [date, setDate] = useState(payment?.date ?? today);
  const [tried, setTried] = useState(false);
  const cents = parseCents(amount);
  const errors = [(cents === undefined || cents === 0) && 'Enter the amount paid', !date && 'Pick the date', date && date.slice(0, 7) < card.startMonth && `That is before you started tracking (${monthLabel(card.startMonth)})`].filter(Boolean) as string[];

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
