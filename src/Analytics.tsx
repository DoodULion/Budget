import { useState, type JSX } from 'react';
import {
  billsOutlook,
  categoryByMonth,
  chartData,
  chartProblem,
  flowStats,
  GROUPS,
  KINDS,
  METRICS,
  metricInfo,
  monthFlows,
  monthPace,
  newChart,
  RANGES,
  rangeMonths,
  spendByCategory,
  spendByPaidWith,
  spendByWeekday,
  spendStats,
  topPurchases,
  type ChartKind,
  type CustomChart,
  type GroupBy,
  type Metric,
  type Range,
} from './analytics';
import { formatCents, monthLabel, thisMonth } from './calc';
import { Columns, Donut, HBars, Lines, Stacked, monthTick, type Slice } from './charts';
import { DebtAnalytics } from './Cards';
import Icon from './icons';
import { dayLabel, newId } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { CatTile } from './ui';

type Section = 'money' | 'spending' | 'debt' | 'mine';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'spending', label: 'Spending' },
  { id: 'debt', label: 'Debt' },
  { id: 'mine', label: 'My charts' },
];

const signed = (c: number) => `${c < 0 ? '−' : '+'}${formatCents(Math.abs(c))}`;

/** Graphs, timelines and summaries of the whole budget, plus charts you build yourself. */
export default function Analytics({ store, today }: { store: Store; today: string }) {
  const [section, setSection] = useState<Section>('money');
  const [range, setRange] = useState<Range>('6');

  return (
    <div className="screen">
      <h1 className="page-title">Analytics</h1>
      <div className="seg" role="group" aria-label="Analytics section">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={section === s.id ? 'on' : ''} aria-pressed={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {(section === 'money' || section === 'spending') && (
        <div className="chips scroll-row" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {section === 'money' && <MoneyView store={store} today={today} range={range} />}
      {section === 'spending' && <SpendingView store={store} today={today} range={range} />}
      {section === 'debt' && <DebtAnalytics store={store} today={today} />}
      {section === 'mine' && <MyCharts store={store} today={today} />}
    </div>
  );
}

/* ---------- money ---------- */

function MoneyView({ store, today, range }: { store: Store; today: string; range: Range }) {
  const { data } = store;
  const months = new Set(rangeMonths(data, today, range));
  const all = monthFlows(data, today);
  const flows = all.filter((f) => months.has(f.month));
  const goal = data.settings.savingsGoalCents;
  if (flows.length === 0) {
    return (
      <section className="card">
        <h2>Money</h2>
        <p className="muted">Figures fill in once {monthLabel(thisMonth(data.settings, today))} starts.</p>
      </section>
    );
  }
  const stats = flowStats(flows);
  const labels = flows.map((f, i) => monthTick(f.month, i === 0));
  const outlook = billsOutlook(data, thisMonth(data.settings, today), 12);
  const cards: JSX.Element[] = [
    <section key="stats" className="card hero" aria-labelledby="mstat-h">
      <h2 id="mstat-h">Saved per month, on average</h2>
      <p className={`big fit${stats.avgSavedCents < 0 ? ' bad-text' : ''}`} style={{ ['--chars' as string]: Math.max(formatCents(stats.avgSavedCents).length, 4) }}>
        {formatCents(stats.avgSavedCents)}
      </p>
      <div className="stat-grid">
        <div>
          <b>{formatCents(stats.totalSavedCents)}</b>
          <span>Saved in {stats.months} {stats.months === 1 ? 'month' : 'months'}</span>
        </div>
        <div>
          <b>{stats.savingsRatePct}%</b>
          <span>Of income saved</span>
        </div>
        <div>
          <b>
            {stats.goalMet} of {stats.months}
          </b>
          <span>Months goal met</span>
        </div>
        <div>
          <b>{formatCents(stats.avgIncomeCents)}</b>
          <span>Income a month</span>
        </div>
        <div>
          <b>{formatCents(stats.avgBillsCents)}</b>
          <span>Bills a month</span>
        </div>
        <div>
          <b>{formatCents(stats.avgSpentCents)}</b>
          <span>Spending a month</span>
        </div>
        {stats.best && (
          <div>
            <b>{monthLabel(stats.best.month)}</b>
            <span>Best month ({signed(stats.best.vsGoalCents)} vs goal)</span>
          </div>
        )}
        {stats.worst && (
          <div>
            <b>{monthLabel(stats.worst.month)}</b>
            <span>Weakest month ({signed(stats.worst.vsGoalCents)} vs goal)</span>
          </div>
        )}
      </div>
    </section>,
    <section key="flow" className="card" aria-labelledby="flow-h">
      <h2 id="flow-h">Where each month's income went</h2>
      <Columns
        labels={labels}
        label="Income, bills paid and spending each month"
        series={[
          { name: 'Income', cls: 's0', values: flows.map((f) => f.incomeCents) },
          { name: 'Bills', cls: 's1', values: flows.map((f) => f.billsCents) },
          { name: 'Spending', cls: 's2', values: flows.map((f) => f.spentCents) },
        ]}
      />
    </section>,
    <section key="saved" className="card" aria-labelledby="sv-h">
      <h2 id="sv-h">Saved each month</h2>
      <Columns labels={labels} label={`Saved each month against the goal of ${formatCents(goal)}`} series={[{ name: 'Saved', cls: 's0', values: flows.map((f) => f.savedCents) }]} goal={goal} />
      <p className="chart-key">
        <span><i className="k s0" />Saved</span>
        <span><i className="k-ref chart-ref" />Goal {formatCents(goal)}</span>
      </p>
    </section>,
    <section key="bal" className="card" aria-labelledby="bl-h">
      <h2 id="bl-h">Checking balance</h2>
      <Lines labels={labels} label="Checking balance at the end of each month" series={[{ name: 'Balance', cls: 's1', values: flows.map((f) => f.balanceCents) }]} />
      <p className="chart-key">
        <span>Started at {formatCents(data.settings.startingBalanceCents)}</span>
        <span>Now {formatCents(all[all.length - 1].balanceCents)}</span>
      </p>
    </section>,
    <section key="bills" className="card" aria-labelledby="bi-h">
      <h2 id="bi-h">Fixed bills ahead</h2>
      <Columns labels={outlook.monthly.map((m, i) => monthTick(m.month, i === 0))} label="Fixed bills each of the next 12 months" series={[{ name: 'Bills', cls: 's1', values: outlook.monthly.map((m) => m.cents) }]} />
      {outlook.ending.length === 0 ? (
        <p className="muted small">None of your bills have a last payment set.</p>
      ) : (
        <ul className="plain-list">
          {outlook.ending.map((e) => (
            <li key={e.bill.id}>
              <b>{e.bill.name}</b> <span className="muted">ends {monthLabel(e.lastMonth)} · frees {formatCents(e.bill.amountCents)} a month</span>
            </li>
          ))}
        </ul>
      )}
    </section>,
  ];
  return <div className="cols">{cards}</div>;
}

/* ---------- spending ---------- */

function SpendingView({ store, today, range }: { store: Store; today: string; range: Range }) {
  const { data } = store;
  const months = rangeMonths(data, today, range);
  if (months.length === 0 || data.purchases.length === 0) {
    return (
      <section className="card">
        <h2>Spending</h2>
        <p className="muted">Add a purchase with + in Purchases and its patterns show up here.</p>
      </section>
    );
  }
  const stats = spendStats(data, months, today);
  const byCat = spendByCategory(data, months);
  const split = categoryByMonth(data, months);
  const flows = monthFlows(data, today).filter((f) => months.includes(f.month));
  const budget = data.categories.filter((c) => !c.deleted).reduce((s, c) => s + c.budgetCents, 0);
  const slices: Slice[] = byCat.map((s) => ({ key: s.key, label: s.label, value: s.cents, color: s.color }));
  const labels = months.map((m, i) => monthTick(m, i === 0));
  const paidWith = spendByPaidWith(data, months).map((s) => ({ key: s.key, label: s.label, value: s.cents }));
  const weekdays = spendByWeekday(data, months);
  const pace = monthPace(data, thisMonth(data.settings, today), today);
  const biggest = topPurchases(data, months, 5);
  const catOf = (id: string) => data.categories.find((c) => c.id === id);

  const cards: JSX.Element[] = [
    <section key="stats" className="card hero" aria-labelledby="sstat-h">
      <h2 id="sstat-h">Spent</h2>
      <p className="big fit" style={{ ['--chars' as string]: Math.max(formatCents(stats.totalCents).length, 4) }}>
        {formatCents(stats.totalCents)}
      </p>
      <div className="stat-grid">
        <div>
          <b>{formatCents(stats.avgPerMonthCents)}</b>
          <span>A month</span>
        </div>
        <div>
          <b>{formatCents(stats.avgPerDayCents)}</b>
          <span>A day</span>
        </div>
        <div>
          <b>{stats.count}</b>
          <span>Purchases</span>
        </div>
        <div>
          <b>{formatCents(stats.avgPurchaseCents)}</b>
          <span>Average purchase</span>
        </div>
        {stats.topCategory && (
          <div>
            <b>{stats.topCategory.label}</b>
            <span>Biggest category ({formatCents(stats.topCategory.cents)})</span>
          </div>
        )}
        {stats.biggest && (
          <div>
            <b>{formatCents(stats.biggest.amountCents)}</b>
            <span>Largest purchase</span>
          </div>
        )}
      </div>
    </section>,
    <section key="cat" className="card" aria-labelledby="ca-h">
      <h2 id="ca-h">By category</h2>
      <Donut slices={slices} label="Spending by category" />
    </section>,
    <section key="catm" className="card" aria-labelledby="cm-h">
      <h2 id="cm-h">Categories month by month</h2>
      <Stacked labels={labels} label="Spending each month, split by category" series={split.categories.map((c, i) => ({ name: c.label, cls: `cat-${c.color ?? 'c8'}`, values: split.rows.map((r) => r.byCategory[i]) }))} />
      <p className="chart-key">
        {split.categories.map((c) => (
          <span key={c.key}>
            <i className={`k cat-${c.color ?? 'c8'}`} />
            {c.label}
          </span>
        ))}
      </p>
    </section>,
    <section key="budget" className="card" aria-labelledby="bu-h">
      <h2 id="bu-h">Spending against budget</h2>
      <Columns labels={flows.map((f, i) => monthTick(f.month, i === 0))} label={`Spending each month against the budget of ${formatCents(budget)}`} series={[{ name: 'Spent', cls: 's2', values: flows.map((f) => f.spentCents) }]} goal={budget} />
      <p className="chart-key">
        <span><i className="k s2" />Spent</span>
        <span><i className="k-ref chart-ref" />Budget {formatCents(budget)}</span>
      </p>
    </section>,
    <section key="pace" className="card" aria-labelledby="pa-h">
      <h2 id="pa-h">This month's pace</h2>
      {pace.length === 0 ? (
        <p className="empty-line">Nothing yet this month.</p>
      ) : (
        <>
          <Lines labels={pace.map((p) => String(p.day))} label="Spending so far this month against an even pace of the budget" series={[{ name: 'Spent so far', cls: 's2', values: pace.map((p) => p.cents) }]} ref={{ name: 'Even pace', values: pace.map((p) => p.paceCents) }} />
          <p className="muted small">
            {pace[pace.length - 1].cents > pace[pace.length - 1].paceCents ? 'Ahead of' : 'Under'} an even pace by {formatCents(Math.abs(pace[pace.length - 1].cents - pace[pace.length - 1].paceCents))} today.
          </p>
        </>
      )}
    </section>,
    <section key="paid" className="card" aria-labelledby="pw-h">
      <h2 id="pw-h">Paid with</h2>
      <HBars items={paidWith} label="Spending by payment method" />
    </section>,
    <section key="week" className="card" aria-labelledby="wd-h">
      <h2 id="wd-h">Day of the week</h2>
      <Columns labels={weekdays.map((w) => w.label)} label="Spending by day of the week" series={[{ name: 'Spent', cls: 's0', values: weekdays.map((w) => w.cents) }]} />
    </section>,
    <section key="big" className="card" aria-labelledby="bg-h">
      <h2 id="bg-h">Biggest purchases</h2>
      <ul className="list">
        {biggest.map((p) => (
          <li key={p.id} className="row">
            <CatTile category={catOf(p.categoryId)} />
            <span className="row-main">
              <strong>{p.description || catOf(p.categoryId)?.name || 'Deleted category'}</strong>
              <span className="row-sub">
                <span>{dayLabel(p.date)}</span>
                {p.paidWith && <span>· {p.paidWith}</span>}
              </span>
            </span>
            <span className="row-amt">{formatCents(p.amountCents)}</span>
          </li>
        ))}
      </ul>
    </section>,
  ];
  return <div className="cols">{cards}</div>;
}

/* ---------- my charts ---------- */

function ChartView({ def, store, today }: { def: CustomChart; store: Store; today: string }) {
  const d = chartData(def, store.data, today);
  if (d.points.length === 0 || d.points.every((p) => p.value === 0)) return <p className="empty-line">Nothing to show for this yet.</p>;
  const labels = def.groupBy === 'month' ? d.points.map((p, i) => monthTick(p.key, i === 0)) : d.points.map((p) => p.label);
  if (def.kind === 'donut') return <Donut label={d.summary} money={d.money} slices={d.points.map((p) => ({ key: p.key, label: p.label, value: p.value, color: p.color }))} />;
  if (def.kind === 'line') return <Lines labels={labels} money={d.money} label={d.summary} series={[{ name: metricInfo(def.metric).label, cls: 's1', values: d.points.map((p) => p.value) }]} />;
  return <Columns labels={labels} money={d.money} label={d.summary} series={[{ name: metricInfo(def.metric).label, cls: 's0', values: d.points.map((p) => p.value) }]} />;
}

const defaultTitle = (c: CustomChart, store: Store) => {
  const cat = c.categoryId ? store.data.categories.find((x) => x.id === c.categoryId)?.name : undefined;
  return `${cat ? `${cat} ` : ''}${metricInfo(c.metric).label.toLowerCase()} ${GROUPS.find((g) => g.id === c.groupBy)?.label.toLowerCase()}`.replace(/^./, (s) => s.toUpperCase());
};

function MyCharts({ store, today }: { store: Store; today: string }) {
  const charts = store.data.settings.customCharts ?? [];
  const [editing, setEditing] = useState<CustomChart | 'new' | null>(null);
  const [menu, setMenu] = useState<CustomChart | null>(null);
  const { offer } = useUndo();

  const save = (next: CustomChart[]) => store.saveSettings({ customCharts: next });
  async function remove(c: CustomChart) {
    const before = charts;
    await save(charts.filter((x) => x.id !== c.id));
    offer(`Deleted ${c.title || defaultTitle(c, store)}`, () => save(before));
    setMenu(null);
  }

  return (
    <>
      {charts.length === 0 ? (
        <section className="card">
          <h2>Make your own charts</h2>
          <p className="muted">Pick what to measure (spending, income, saved, balance, debt …), how to group it (by month, category, paid with or weekday) and a chart style. It is saved here and in your backups.</p>
        </section>
      ) : (
        <div className="cols">
          {charts.map((c) => (
            <section key={c.id} className="card" aria-label={c.title || defaultTitle(c, store)}>
              <div className="custom-head">
                <h2>{c.title || defaultTitle(c, store)}</h2>
                <button type="button" className="more" aria-label={`Options for ${c.title || defaultTitle(c, store)}`} aria-haspopup="dialog" onClick={() => setMenu(c)}>
                  <Icon name="dots" />
                </button>
              </div>
              <ChartView def={c} store={store} today={today} />
            </section>
          ))}
        </div>
      )}
      <button type="button" className="add-row" onClick={() => setEditing('new')}>
        <Icon name="add" />
        Make a chart
      </button>
      {menu && (
        <SheetBackdrop onClose={() => setMenu(null)}>
          <div className="sheet menu" role="dialog" aria-modal="true" aria-label="Chart options">
            <h2>{menu.title || defaultTitle(menu, store)}</h2>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setEditing(menu);
                setMenu(null);
              }}
            >
              Edit chart
            </button>
            <button type="button" className="danger" onClick={() => void remove(menu)}>
              Delete chart
            </button>
            <button type="button" className="secondary" onClick={() => setMenu(null)}>
              Cancel
            </button>
          </div>
        </SheetBackdrop>
      )}
      {editing && (
        <ChartSheet
          store={store}
          today={today}
          chart={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async (c) => {
            await save(charts.some((x) => x.id === c.id) ? charts.map((x) => (x.id === c.id ? c : x)) : [...charts, c]);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ChartSheet({ store, today, chart, onClose, onSave }: { store: Store; today: string; chart?: CustomChart; onClose: () => void; onSave: (c: CustomChart) => Promise<void> }) {
  const [def, setDef] = useState<CustomChart>(chart ?? newChart(newId()));
  const [title, setTitle] = useState(chart?.title ?? '');
  const cats = store.data.categories.filter((c) => !c.deleted || store.data.purchases.some((p) => p.categoryId === c.id));
  const info = metricInfo(def.metric);
  const problem = chartProblem(def);

  function pickMetric(metric: Metric) {
    const m = metricInfo(metric);
    setDef((d) => {
      const next = { ...d, metric };
      if (!m.byAnything) {
        next.groupBy = 'month';
        delete next.categoryId;
        if (next.kind === 'donut') next.kind = 'bar';
      }
      return next;
    });
  }
  function pickGroup(groupBy: GroupBy) {
    setDef((d) => {
      const next = { ...d, groupBy };
      if (groupBy === 'month' && next.kind === 'donut') next.kind = 'bar';
      if ((groupBy === 'category' || groupBy === 'paidWith') && next.kind === 'line') next.kind = 'bar';
      return next;
    });
  }
  function pickKind(kind: ChartKind) {
    setDef((d) => {
      const next = { ...d, kind };
      if (kind === 'donut' && next.groupBy === 'month') next.groupBy = 'category';
      if (kind === 'line' && (next.groupBy === 'category' || next.groupBy === 'paidWith')) next.groupBy = 'month';
      return next;
    });
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ch-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void onSave({ ...def, title: title.trim() });
        }}
      >
        <h2 id="ch-h">{chart ? 'Edit chart' : 'Make a chart'}</h2>
        <label className="field">
          <span>Title (optional)</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle(def, store)} autoComplete="off" />
        </label>
        <div className="field">
          <span>Measure</span>
          <div className="chips" role="radiogroup" aria-label="What to measure">
            {METRICS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={def.metric === m.id} className={def.metric === m.id ? 'on' : ''} onClick={() => pickMetric(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Group</span>
          <div className="chips" role="radiogroup" aria-label="How to group it">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={def.groupBy === g.id} className={def.groupBy === g.id ? 'on' : ''} disabled={g.id !== 'month' && !info.byAnything} onClick={() => pickGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Style</span>
          <div className="chips" role="radiogroup" aria-label="Chart style">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={def.kind === k.id} className={def.kind === k.id ? 'on' : ''} onClick={() => pickKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Period</span>
          <div className="chips" role="radiogroup" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={def.range === r.id} className={def.range === r.id ? 'on' : ''} onClick={() => setDef({ ...def, range: r.id })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {info.byAnything && cats.length > 0 && (
          <div className="field">
            <span>Only this category (optional)</span>
            <div className="chips" role="radiogroup" aria-label="Category">
              <button type="button" role="radio" aria-checked={!def.categoryId} className={!def.categoryId ? 'on' : ''} onClick={() => setDef({ ...def, categoryId: undefined })}>
                All
              </button>
              {cats.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={def.categoryId === c.id} className={def.categoryId === c.id ? 'on' : ''} onClick={() => setDef({ ...def, categoryId: c.id })}>
                  <CatTile category={c} small />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : (
          <div className="preview" aria-label="Preview">
            <ChartView def={def} store={store} today={today} />
          </div>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={!!problem}>
            {chart ? 'Save chart' : 'Add chart'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}
