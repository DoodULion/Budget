import { Fragment, type JSX } from 'react';
import { useCardOrder } from './useCardOrder';
import { useHoldDrag } from './useHoldDrag';
import { formatCents, monthLabel, yearSummary, type YearSummary } from './calc';
import { CatTile, Fig, signed } from './ui';
const YEAR_CARDS = ['saved-ytd', 'saved-chart', 'balance', 'categories', 'table'] as const;

const SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const short = (month: string) => SHORT[Number(month.slice(5, 7)) - 1];
/** Compact dollars for chart labels: $1.2k, $850, −$300. */
function compact(cents: number): string {
  const d = Math.round(cents / 100);
  const abs = Math.abs(d);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${abs}`;
  return d < 0 ? `−${s}` : s;
}

/** The year: saved to date, months goal met, checking balance; charts, the month-by-month table and categories. */
export default function Year({ store, year, today }: { store: { data: import('./calc').Data }; year: number; today: string }) {
  const y = yearSummary(store.data, year, today);
  const goal = store.data.settings.savingsGoalCents;
  const nothingYet = y.monthsCounted === 0;

  // Hold a card and drag it to rearrange the screen; the order is kept on this device.
  const [cardOrder, setCardOrder] = useCardOrder('year', YEAR_CARDS);
  const { order, dragId, listRef, bind, justDragged } = useHoldDrag(cardOrder, setCardOrder, ':scope > [data-id]');
  const drag = (id: string, cls: string) => ({ ...bind(id), className: `${cls} sum-card${dragId === id ? ' lifted' : ''}` });

  const cards: Record<string, JSX.Element> = {
    'saved-ytd': (
      <section {...drag('saved-ytd', 'card hero')} aria-labelledby="ytd-h">
        <h2 id="ytd-h">Saved in {year}</h2>
        <p className={`big fit${y.savedToDateCents < 0 ? ' bad-text' : ''}`} style={{ ['--chars' as string]: Math.max(formatCents(y.savedToDateCents).length, 4) }}>
          {formatCents(y.savedToDateCents)}
        </p>
        <div className="rule">
          <div>
            <Fig text={y.monthsGoalMetLabel} />
            <span className="muted">Goal met</span>
          </div>
          <div>
            <Fig cents={y.checkingBalanceNowCents} />
            <span className="muted">Balance now</span>
          </div>
          <div>
            <Fig cents={goal} />
            <span className="muted">Goal / month</span>
          </div>
        </div>
        {nothingYet && <p className="muted small">Figures fill in once {monthLabel(y.thisMonth)} starts.</p>}
      </section>

    ),
    'saved-chart': (
      <section {...drag('saved-chart', 'card')} aria-labelledby="sv-h">
        <h2 id="sv-h">Saved each month</h2>
        <SavedChart y={y} goal={goal} />
        <p className="chart-key">
          <span><i />Goal met</span>
          <span><i className="k-below" />Under goal</span>
          <span><i className="k-neg" />Lost money</span>
          <span><i className="k-goal" />Goal {formatCents(goal)}</span>
        </p>
      </section>

    ),
    balance: (
      <section {...drag('balance', 'card')} aria-labelledby="bal-h">
        <h2 id="bal-h">Checking balance</h2>
        <BalanceChart y={y} start={store.data.settings.startingBalanceCents} />
      </section>

    ),
    categories: (
      <section {...drag('categories', 'card')} aria-labelledby="yc-h">
        <h2 id="yc-h">Spending by category</h2>
        {y.categories.length === 0 ? (
          <p className="empty-line">No categories yet.</p>
        ) : (
          <ul className="hbars stack">
            {(() => {
              const max = Math.max(1, ...y.categories.map((c) => c.totalCents));
              return y.categories.map((c) => (
                <li key={c.category.id}>
                  <span className="hb-label">
                    <CatTile category={c.category} small />
                    {c.category.name}
                  </span>
                  <b>{formatCents(c.totalCents)}</b>
                  <span className="hb-track">
                    <i style={{ width: `${(c.totalCents / max) * 100}%`, ['--meter' as string]: `var(--cat-${c.category.color})` }} />
                  </span>
                  <span className="st-sub">
                    {formatCents(c.avgPerMonthCents)} a month on average · budget {formatCents(c.budgetCents)}
                  </span>
                </li>
              ));
            })()}
          </ul>
        )}
      </section>

    ),
    table: (
      <section {...drag('table', 'card span-all')} aria-labelledby="tbl-h">
        <h2 id="tbl-h">Month by month</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="tbl-h">
          <table className="ytable">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Income</th>
                <th scope="col">Bills paid</th>
                <th scope="col">Spent</th>
                <th scope="col">Budget left</th>
                <th scope="col">Saved</th>
                <th scope="col">vs goal</th>
                <th scope="col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {y.rows.map(({ summary: s, balanceCents }) => (
                <tr key={s.month} className={`${s.future ? 'future' : ''}${s.month === y.thisMonth ? ' now' : ''}`}>
                  <th scope="row">{monthLabel(s.month).slice(0, 3)}</th>
                  <td>{formatCents(s.incomeCents)}</td>
                  <td>{formatCents(s.billsPaidCents)}</td>
                  <td>{formatCents(s.spentCents)}</td>
                  <td className={s.budgetLeftCents < 0 ? 'fig-neg' : ''}>{formatCents(s.budgetLeftCents)}</td>
                  <td>{s.savedCents === undefined ? '—' : formatCents(s.savedCents)}</td>
                  <td className={s.vsGoalCents === undefined ? '' : s.vsGoalCents < 0 ? 'fig-neg' : 'fig-pos'}>{s.vsGoalCents === undefined ? '—' : signed(s.vsGoalCents)}</td>
                  <td>{balanceCents === undefined ? '—' : formatCents(balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{formatCents(y.rows.filter((r) => !r.summary.future).reduce((s, r) => s + r.summary.incomeCents, 0))}</td>
                <td>{formatCents(y.rows.reduce((s, r) => s + r.summary.billsPaidCents, 0))}</td>
                <td>{formatCents(y.rows.reduce((s, r) => s + r.summary.spentCents, 0))}</td>
                <td />
                <td>{formatCents(y.savedToDateCents)}</td>
                <td />
                <td>{formatCents(y.checkingBalanceNowCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    ),
  };

  return (
    <div className="screen">
      <h1>{year}</h1>
      <div className={`cols${dragId ? ' dragging' : ''}`} ref={(el) => { listRef.current = el; }} onClickCapture={(e) => {
        if (justDragged()) { e.preventDefault(); e.stopPropagation(); }
      }}>
        {order.map((id) => <Fragment key={id}>{cards[id]}</Fragment>)}
      </div>
    </div>
  );
}

const W = 340;
const H = 150;
const PAD = { l: 40, r: 6, t: 10, b: 20 };

function SavedChart({ y, goal }: { y: YearSummary; goal: number }) {
  const vals = y.rows.map((r) => r.summary.savedCents);
  const nums = vals.filter((v): v is number => v !== undefined);
  const top = Math.max(goal, 1, ...nums);
  const bottom = Math.min(0, ...nums);
  const span = top - bottom || 1;
  const yOf = (v: number) => PAD.t + ((top - v) / span) * (H - PAD.t - PAD.b);
  const n = y.rows.length || 1;
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.max(6, slot * 0.6);
  const label = y.rows
    .map((r) => `${monthLabel(r.summary.month)}: ${r.summary.savedCents === undefined ? 'not started' : formatCents(r.summary.savedCents)}`)
    .join('; ');

  return (
    <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Saved each month against the goal of ${formatCents(goal)}. ${label}`}>
      <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top)} y2={yOf(top)} />
      <text x={PAD.l - 6} y={yOf(top) + 4} textAnchor="end">{compact(top)}</text>
      <line className="zero" x1={PAD.l} x2={W - PAD.r} y1={yOf(0)} y2={yOf(0)} />
      <text x={PAD.l - 6} y={yOf(0) + 4} textAnchor="end">$0</text>
      {bottom < 0 && <text x={PAD.l - 6} y={yOf(bottom) + 4} textAnchor="end">{compact(bottom)}</text>}
      {vals.map((v, i) => {
        const x = PAD.l + slot * i + (slot - bw) / 2;
        const cls = v === undefined ? '' : v < 0 ? 'neg' : v < goal ? 'below' : '';
        return (
          <g key={y.rows[i].summary.month}>
            {v !== undefined && v !== 0 && (
              <rect className={`bar ${cls}`} x={x} width={bw} y={Math.min(yOf(v), yOf(0))} height={Math.max(1.5, Math.abs(yOf(v) - yOf(0)))} rx={3} />
            )}
            <text x={x + bw / 2} y={H - 4} textAnchor="middle">{short(y.rows[i].summary.month)}</text>
          </g>
        );
      })}
      {goal > 0 && <line className="goal" x1={PAD.l} x2={W - PAD.r} y1={yOf(goal)} y2={yOf(goal)} />}
    </svg>
  );
}

function BalanceChart({ y, start }: { y: YearSummary; start: number }) {
  const pts = y.rows.map((r) => r.balanceCents);
  const nums = [start, ...pts.filter((v): v is number => v !== undefined)];
  const top = Math.max(...nums);
  const bottom = Math.min(0, ...nums);
  const span = top - bottom || 1;
  const yOf = (v: number) => PAD.t + ((top - v) / span) * (H - PAD.t - PAD.b);
  const n = y.rows.length || 1;
  const slot = (W - PAD.l - PAD.r) / n;
  const xOf = (i: number) => PAD.l + slot * i + slot / 2;
  const known = pts.map((v, i) => (v === undefined ? null : ([xOf(i), yOf(v)] as const))).filter((p): p is readonly [number, number] => p !== null);
  const path = known.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  const last = known[known.length - 1];
  const label = y.rows.map((r) => `${monthLabel(r.summary.month)}: ${r.balanceCents === undefined ? 'not started' : formatCents(r.balanceCents)}`).join('; ');

  return (
    <>
      <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Checking balance, starting at ${formatCents(start)}. ${label}`}>
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top)} y2={yOf(top)} />
        <text x={PAD.l - 6} y={yOf(top) + 4} textAnchor="end">{compact(top)}</text>
        <line className="zero" x1={PAD.l} x2={W - PAD.r} y1={yOf(bottom)} y2={yOf(bottom)} />
        <text x={PAD.l - 6} y={yOf(bottom) + 4} textAnchor="end">{compact(bottom)}</text>
        {path && <path className="line" d={path} />}
        {known.map(([x, yy]) => (
          <circle key={x} className="dot" cx={x} cy={yy} r={3.5} />
        ))}
        {y.rows.map((r, i) => (
          <text key={r.summary.month} x={xOf(i)} y={H - 4} textAnchor="middle">{short(r.summary.month)}</text>
        ))}
      </svg>
      <p className="chart-key">
        <span>Started at {formatCents(start)}</span>
        {last && <span>Now {formatCents(y.checkingBalanceNowCents)}</span>}
      </p>
    </>
  );
}
