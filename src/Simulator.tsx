/**
 * Spend simulator: try out changes (pay a debt down, change or add a fixed bill, a one-time expense, new income or
 * spending) and see the cash balance, savings and debts ahead, next to how things go as planned. The changes are a
 * per-device scratchpad (localStorage), not budget data and not in backups.
 */
import { useEffect, useMemo, useState } from 'react';
import { haptic } from './haptics';
import { addMonths, formatCents, monthLabel, type Cents, type MonthKey } from './calc';
import { Columns, Lines, monthTick, type Series } from './charts';
import Icon from './icons';
import { formatApr, parseApr } from './cards';
import { centsToAmountInput, newId, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import {
  budgetSpendingCents,
  changeImpact,
  cashReaches,
  debtFreeMonth,
  firstSimMonth,
  monthsToReach,
  neededPerMonth,
  payoffImpact,
  project,
  recentSpendingCents,
  simDebts,
  type Change,
  type Projection,
} from './simulate';
import type { Store } from './store';
import { Fig, MoneyInput, signed } from './ui';
import { useUndo } from './undo';

const KEY = 'budget-tracker-simulator';
const HORIZONS = [
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 36, label: '3 years' },
  { months: 60, label: '5 years' },
];

/** A named set of changes. Every change in it stacks on the others. */
interface Plan {
  id: string;
  name: string;
  changes: Change[];
  /** Ids of changes that are switched off: kept in the list but left out of the results. */
  off: string[];
}

interface SimState {
  horizon: number;
  basis: 'budget' | 'recent';
  plans: Plan[];
  activeId: string;
  goalText: string;
  rateText: string;
  byMonth: MonthKey | '';
}

const DEFAULTS: SimState = { horizon: 12, basis: 'budget', plans: [{ id: 'a', name: 'Plan A', changes: [], off: [] }], activeId: 'a', goalText: '', rateText: '', byMonth: '' };

const isChange = (c: unknown) => !!c && typeof c === 'object' && typeof (c as Change).kind === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** Saved plans; a scratchpad from before plans existed becomes Plan A. */
function loadPlans(raw: Record<string, unknown>): Pick<SimState, 'plans' | 'activeId'> {
  const plans: Plan[] = Array.isArray(raw.plans)
    ? raw.plans
        .filter((p: unknown) => !!p && typeof p === 'object' && typeof (p as Plan).id === 'string')
        .map((p: Plan) => ({ id: p.id, name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Plan', changes: Array.isArray(p.changes) ? p.changes.filter(isChange) : [], off: strings(p.off) }))
    : [{ id: 'a', name: 'Plan A', changes: Array.isArray(raw.changes) ? raw.changes.filter(isChange) : [], off: strings(raw.off) }];
  if (plans.length === 0) plans.push({ id: 'a', name: 'Plan A', changes: [], off: [] });
  const activeId = plans.some((p) => p.id === raw.activeId) ? (raw.activeId as string) : plans[0].id;
  return { plans, activeId };
}

/** The next free "Plan B", "Plan C"… name. */
function nextPlanName(plans: Plan[]): string {
  for (let i = 0; i < 26; i++) {
    const name = `Plan ${String.fromCharCode(65 + i)}`;
    if (!plans.some((p) => p.name === name)) return name;
  }
  return `Plan ${plans.length + 1}`;
}

function load(): SimState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      horizon: HORIZONS.some((h) => h.months === raw.horizon) ? raw.horizon : DEFAULTS.horizon,
      basis: raw.basis === 'recent' ? 'recent' : 'budget',
      ...loadPlans(raw),
      goalText: typeof raw.goalText === 'string' ? raw.goalText : '',
      rateText: typeof raw.rateText === 'string' ? raw.rateText : '',
      byMonth: typeof raw.byMonth === 'string' ? raw.byMonth : '',
    };
  } catch {
    return DEFAULTS;
  }
}

/** The kinds of change, in the order they are offered. */
const KINDS: { kind: Change['kind']; label: string; hint: string }[] = [
  { kind: 'payoff', label: 'Pay down a debt', hint: 'Pay part or all of a balance from cash' },
  { kind: 'extra', label: 'Pay more each month', hint: 'An extra monthly payment on a debt' },
  { kind: 'bill', label: 'Change a fixed bill', hint: 'Raise, lower or remove one' },
  { kind: 'newBill', label: 'Add a fixed bill', hint: 'A new monthly expense' },
  { kind: 'newDebt', label: 'Take on a new debt', hint: 'A loan or card balance with its payment and APR' },
  { kind: 'oneTime', label: 'One-time expense', hint: 'Or money coming in once' },
  { kind: 'income', label: 'Change income', hint: 'A new monthly income' },
  { kind: 'spending', label: 'Change spending', hint: 'A new monthly spending amount' },
];

export default function Simulator({ store, today }: { store: Store; today: string }) {
  const { data } = store;
  const { offer } = useUndo();
  const [st, setSt] = useState<SimState>(load);
  const [editing, setEditing] = useState<Change | Change['kind'] | 'pick' | null>(null);
  // The results popup: for one change (on top of the others) or for all of them.
  const [results, setResults] = useState<Change | 'all' | null>(null);
  // After a change is saved: ask whether to add another or see the results of all of them together.
  const [justSaved, setJustSaved] = useState<Change | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* storage unavailable: the scenario lasts until the app closes */
    }
  }, [st]);

  const debts = useMemo(() => simDebts(data, today), [data, today]);
  const bills = data.bills.filter((b) => !b.deleted);
  // Changes that name a debt or bill that is gone are left out.
  const plan = st.plans.find((p) => p.id === st.activeId) ?? st.plans[0];
  const valid = (list: Change[]) => list.filter((c) => (c.kind === 'payoff' || c.kind === 'extra' ? debts.some((d) => d.id === c.debtId) : c.kind === 'bill' ? bills.some((b) => b.id === c.billId) : true));
  const counted = (p: Plan) => valid(p.changes).filter((c) => !p.off.includes(c.id));
  const listed = valid(plan.changes);
  // Every change in the list stacks on the others; a switched-off one stays listed but doesn't count.
  const changes = counted(plan);
  const spendingCents = st.basis === 'recent' ? recentSpendingCents(data, today) : budgetSpendingCents(data);
  const input = { data, today, horizon: st.horizon, spendingCents };
  const base = useMemo(() => project(input), [data, today, st.horizon, spendingCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const scen = useMemo(() => project(input, changes), [data, today, st.horizon, spendingCents, JSON.stringify(changes)]); // eslint-disable-line react-hooks/exhaustive-deps
  const has = changes.length > 0;
  const start = firstSimMonth(data, today);
  const end = addMonths(start, st.horizon - 1);
  const labels = scen.months.map((m, i) => monthTick(m.month, i === 0));
  const goalCents = parseCents(st.goalText);

  const set = (patch: Partial<SimState>) => setSt((s) => ({ ...s, ...patch }));
  const setPlan = (id: string, patch: Partial<Plan>) => setSt((s) => ({ ...s, plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const [planSheet, setPlanSheet] = useState(false);
  function saveChange(c: Change) {
    setPlan(plan.id, { changes: plan.changes.some((x) => x.id === c.id) ? plan.changes.map((x) => (x.id === c.id ? c : x)) : [...plan.changes, c], off: plan.off.filter((x) => x !== c.id) });
    setJustSaved(c);
  }
  function removeChange(c: Change) {
    const { id, changes: before, off: offBefore } = plan;
    setPlan(id, { changes: before.filter((x) => x.id !== c.id), off: offBefore.filter((x) => x !== c.id) });
    offer('Change removed', async () => setPlan(id, { changes: before, off: offBefore }), 'warn');
  }
  function toggleChange(c: Change) {
    haptic();
    setPlan(plan.id, { off: plan.off.includes(c.id) ? plan.off.filter((x) => x !== c.id) : [...plan.off, c.id] });
  }
  function clearAll() {
    const { id, changes: before, off: offBefore } = plan;
    setPlan(id, { changes: [], off: [] });
    offer(`${plan.name} cleared`, async () => setPlan(id, { changes: before, off: offBefore }), 'warn');
  }
  function addPlan(copy: boolean) {
    const id = newId();
    const name = copy ? `${plan.name} copy` : nextPlanName(st.plans);
    const changes = copy ? plan.changes.map((c) => ({ ...c, id: newId() })) : [];
    const off = copy ? plan.off.map((o) => changes[plan.changes.findIndex((c) => c.id === o)]?.id).filter((x): x is string => !!x) : [];
    setSt((s) => ({ ...s, plans: [...s.plans, { id, name, changes, off }], activeId: id }));
    haptic();
  }
  function removePlan() {
    const before = st;
    const rest = st.plans.filter((p) => p.id !== plan.id);
    set({ plans: rest, activeId: rest[0].id });
    offer(`${plan.name} deleted`, async () => setSt(before), 'warn');
  }

  const two = (a: number[], b: number[]): Series[] => (has ? [{ name: 'With changes', values: a, cls: 's0' }, { name: 'As planned', values: b, cls: 's2 planned' }] : [{ name: 'As planned', values: b, cls: 's0' }]);
  const freeBase = debtFreeMonth(base);
  const freeScen = debtFreeMonth(scen);
  const describeChange = (c: Change) => changeText(c, debts, bills);

  return (
    <div className="screen sim">
      <div className="cols">
      <section className="card hero" aria-labelledby="sim-h">
        <h2 id="sim-h">Cash at the end of {monthLabel(end)}</h2>
        <p className="big fit" style={{ ['--chars' as string]: Math.max(formatCents(scen.endCashCents).length, 4) }}>
          {formatCents(scen.endCashCents)}
        </p>
        <div className="rule">
          <div>
            <Fig text={has ? signed(scen.endCashCents - base.endCashCents) : formatCents(scen.startCashCents)} />
            <span className="muted">{has ? 'vs as planned' : 'Cash now'}</span>
          </div>
          <div>
            <Fig cents={scen.avgSavedCents} />
            <span className="muted">Saved a month</span>
          </div>
          <div>
            <Fig text={freeScen ? monthLabel(freeScen).replace(/ (\d\d)(\d\d)$/, ' ’$2') : scen.debts.length ? 'Not yet' : 'No debt'} />
            <span className="muted">Debt-free</span>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="set-h">
        <h2 id="set-h">Look ahead</h2>
        <div className="seg" role="radiogroup" aria-label="How far ahead">
          {HORIZONS.map((h) => (
            <button key={h.months} type="button" role="radio" aria-checked={st.horizon === h.months} className={st.horizon === h.months ? 'on' : ''} onClick={() => set({ horizon: h.months })}>
              {h.label}
            </button>
          ))}
        </div>
        <p className="field-label">Spending each month</p>
        <div className="seg" role="radiogroup" aria-label="Spending each month">
          <button type="button" role="radio" aria-checked={st.basis === 'budget'} className={st.basis === 'budget' ? 'on' : ''} onClick={() => set({ basis: 'budget' })}>
            Budget {formatCents(budgetSpendingCents(data))}
          </button>
          <button type="button" role="radio" aria-checked={st.basis === 'recent'} className={st.basis === 'recent' ? 'on' : ''} onClick={() => set({ basis: 'recent' })}>
            Recent {formatCents(recentSpendingCents(data, today))}
          </button>
        </div>
        <p className="muted small">
          From {monthLabel(start)}, starting with your checking balance now ({formatCents(scen.startCashCents)}): your income baseline, fixed bills (debt payments stop once a debt is paid off) and this much spending each month.
        </p>
      </section>

      <section className="card" aria-labelledby="chg-h">
        <div className="card-head">
          <h2 id="chg-h">What if…</h2>
          {listed.length > 0 && (
            <button type="button" className="link-danger" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
        <div className="plan-row">
          <label className="debt-pick">
            <span className="sr-only">Plan</span>
            <select value={plan.id} onChange={(e) => set({ activeId: e.target.value })}>
              {st.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {counted(p).length} {counted(p).length === 1 ? 'change' : 'changes'}
                </option>
              ))}
            </select>
            <Icon name="down" />
          </label>
          <button type="button" className="more plan-more" onClick={() => setPlanSheet(true)} aria-label={`Plans: rename, copy, add or delete ${plan.name}`}>
            <Icon name="dots" />
          </button>
        </div>
        {listed.length === 0 ? (
          <p className="muted">Try a change to see how it moves your cash, savings and debts. Nothing here changes your budget.</p>
        ) : (
          <ul className="sim-changes">
            {listed.map((c) => {
              const t = describeChange(c);
              const on = !plan.off.includes(c.id);
              return (
                <li key={c.id} className={on ? '' : 'is-off'}>
                  <button type="button" role="switch" aria-checked={on} className={`onoff${on ? ' on' : ''}`} onClick={() => toggleChange(c)} aria-label={`Count: ${t.title}`}>
                    <i aria-hidden="true" />
                  </button>
                  <button type="button" className="main" onClick={() => setEditing(c)} aria-label={`Edit: ${t.title}`}>
                    <b>{t.title}</b>
                    <span>{t.detail}</span>
                  </button>
                  <button type="button" className="more" onClick={() => removeChange(c)} aria-label={`Remove: ${t.title}`}>
                    <Icon name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {listed.length > 1 && (
          <p className="muted small sim-stack">
            {changes.length === listed.length ? `All ${listed.length} changes count together.` : `${changes.length} of ${listed.length} changes count together.`} Switch one off to leave it out without losing it.
          </p>
        )}
        <button type="button" className="add-row" onClick={() => setEditing('pick')}>
          <Icon name="add" />
          Add a change
        </button>
        {has && (
          <button type="button" className="primary sim-run" onClick={() => setResults('all')}>
            See the results
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="cash-h">
        <h2 id="cash-h">Cash balance</h2>
        <Lines labels={labels} series={two(scen.months.map((m) => m.cashCents), base.months.map((m) => m.cashCents))} label="Cash balance each month" ref={goalCents ? { name: `Goal ${formatCents(goalCents)}`, values: scen.months.map(() => goalCents) } : undefined} />
        <dl className="kv">
          <dt>Lowest point</dt>
          <dd className={lowest(scen).cents < 0 ? 'fig-neg' : ''}>
            {formatCents(lowest(scen).cents)}
            <small>{monthLabel(lowest(scen).month)}</small>
          </dd>
        </dl>
        {lowest(scen).cents < 0 && <p className="bad-text small">Your checking balance would go below zero.</p>}
      </section>

      <section className="card" aria-labelledby="saved-h">
        <div className="card-head">
          <h2 id="saved-h">Saved each month</h2>
          <span className="band-note">Goal {formatCents(data.settings.savingsGoalCents)}</span>
        </div>
        <Columns labels={labels} series={two(scen.months.map((m) => m.savedCents), base.months.map((m) => m.savedCents))} label="Saved each month" goal={data.settings.savingsGoalCents} />
        <dl className="kv">
          <dt>Saved in total</dt>
          <dd>
            {formatCents(scen.totalSavedCents)}
            {has && <small>{signed(scen.totalSavedCents - base.totalSavedCents)} vs as planned</small>}
          </dd>
          <dt>Months that meet the goal</dt>
          <dd>
            {scen.goalMet} of {scen.months.length}
          </dd>
        </dl>
      </section>

      {changes
        .filter((c): c is Extract<Change, { kind: 'payoff' }> => c.kind === 'payoff')
        .map((c) => {
          const d = debts.find((x) => x.id === c.debtId)!;
          const im = payoffImpact(base, scen, c);
          return (
            <section key={c.id} className="card" aria-label={`Paying down ${d.name}`}>
              <h2>Paying down {d.name}</h2>
              <dl className="kv">
                <dt>From cash in {monthLabel(c.month)}</dt>
                <dd>{formatCents(im.lumpCents)}</dd>
                <dt>Interest saved</dt>
                <dd className="fig-pos">{formatCents(im.interestSavedCents)}</dd>
                {im.freedCents > 0 && (
                  <>
                    <dt>Freed up the next month</dt>
                    <dd>{formatCents(im.freedCents)}</dd>
                  </>
                )}
                <dt>Cash catches up with as planned</dt>
                <dd>{im.caughtUp ? monthLabel(im.caughtUp) : `After ${monthLabel(end)}`}</dd>
              </dl>
              <p className="muted small">Interest saved counts the months shown. Other changes you try are included.</p>
            </section>
          );
        })}

      {scen.debts.length > 0 && (
        <section className="card" aria-labelledby="debt-h">
          <h2 id="debt-h">Debts</h2>
          <Lines labels={labels} series={two(scen.months.map((m) => m.debtCents), base.months.map((m) => m.debtCents))} label="Owed on debts each month" />
          <ul className="sim-debts">
            {scen.debts.map((d) => {
              const b = base.debts.find((x) => x.id === d.id) ?? { paidOffMonth: undefined, interestCents: 0 };
              return (
                <li key={d.id}>
                  <b>
                    {d.name}
                    {d.isNew && <span className="pill idle">New</span>}
                  </b>
                  <span>
                    {d.noPayment ? 'No payment set, so it only grows' : d.paidOffMonth ? `Paid off ${monthLabel(d.paidOffMonth)}` : `Still owed after ${monthLabel(end)}`}
                    {has && !d.isNew && b.paidOffMonth !== d.paidOffMonth && !d.noPayment ? ` (as planned: ${b.paidOffMonth ? monthLabel(b.paidOffMonth) : 'later'})` : ''}
                  </span>
                  <span>
                    Interest {formatCents(d.interestCents)}
                    {has && !d.isNew && b.interestCents !== d.interestCents && <em className="fig-pos"> · {formatCents(b.interestCents - d.interestCents)} saved</em>}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className="kv">
            <dt>Interest over {HORIZONS.find((h) => h.months === st.horizon)?.label}</dt>
            <dd>
              {formatCents(scen.interestCents)}
              {has && scen.interestCents !== base.interestCents && <small className={scen.interestCents < base.interestCents ? 'fig-pos' : 'fig-neg'}>{scen.interestCents < base.interestCents ? `${formatCents(base.interestCents - scen.interestCents)} saved` : `${formatCents(scen.interestCents - base.interestCents)} more`}</small>}
            </dd>
            <dt>Debt-free</dt>
            <dd>
              {freeScen ? monthLabel(freeScen) : 'Not within the view'}
              {has && freeBase !== freeScen && <small>As planned: {freeBase ? monthLabel(freeBase) : 'not within the view'}</small>}
            </dd>
          </dl>
        </section>
      )}

      {st.plans.length > 1 && <ComparePlans plans={st.plans.map((p) => ({ plan: p, changes: counted(p) }))} activeId={plan.id} input={input} base={base} onPick={(id) => set({ activeId: id })} />}

      <Goal st={st} set={set} scen={scen} start={start} input={input} changes={changes} />

      <section className="card span-all" aria-labelledby="tbl-sim-h">
        <h2 id="tbl-sim-h">Month by month{has ? ', with changes' : ''}</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="tbl-sim-h">
          <table className="ytable">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Income</th>
                <th scope="col">Bills</th>
                <th scope="col">Spending</th>
                <th scope="col">Saved</th>
                <th scope="col">One-time</th>
                <th scope="col">Cash</th>
                {scen.debts.length > 0 && <th scope="col">Debt</th>}
              </tr>
            </thead>
            <tbody>
              {scen.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthTick(m.month, true)}</th>
                  <td>{formatCents(m.incomeCents)}</td>
                  <td>{formatCents(m.billsCents)}</td>
                  <td>{formatCents(m.spendingCents)}</td>
                  <td className={m.savedCents < data.settings.savingsGoalCents ? 'fig-neg' : 'fig-pos'}>{formatCents(m.savedCents)}</td>
                  <td>{m.oneTimeCents ? signed(-m.oneTimeCents) : '—'}</td>
                  <td className={m.cashCents < 0 ? 'fig-neg' : ''}>{formatCents(m.cashCents)}</td>
                  {scen.debts.length > 0 && <td>{formatCents(m.debtCents)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </div>

      {planSheet && (
        <PlanSheet
          plan={plan}
          count={st.plans.length}
          onRename={(name) => setPlan(plan.id, { name })}
          onAdd={(copy) => {
            addPlan(copy);
            setPlanSheet(false);
          }}
          onDelete={() => {
            removePlan();
            setPlanSheet(false);
          }}
          onClose={() => setPlanSheet(false)}
        />
      )}
      {results && (
        <ResultSheet
          {...(results === 'all' ? { before: base, after: scen } : changeImpact(input, changes, results))}
          change={results === 'all' ? undefined : results}
          title={results === 'all' ? (changes.length === 1 ? describeChange(changes[0]).title : `All ${changes.length} changes together`) : describeChange(results).title}
          end={end}
          savingsGoalCents={data.settings.savingsGoalCents}
          onEdit={results === 'all' ? undefined : () => {
            setEditing(results);
            setResults(null);
          }}
          onClose={() => setResults(null)}
        />
      )}
      {justSaved && (
        <SheetBackdrop onClose={() => setJustSaved(null)}>
          <div className="sheet menu" role="dialog" aria-modal="true" aria-labelledby="next-h">
            <h2 id="next-h">Change saved</h2>
            <p className="muted">
              {describeChange(justSaved).title}. {changes.length > 1 ? `${plan.name} now has ${changes.length} changes that count together.` : 'Add more to stack them, or see what it does now.'}
            </p>
            <button
              type="button"
              className="secondary with-ic"
              onClick={() => {
                setJustSaved(null);
                setEditing('pick');
              }}
            >
              <Icon name="add" /> Add another change
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setJustSaved(null);
                setResults('all');
              }}
            >
              See the results{changes.length > 1 ? ` of all ${changes.length}` : ''}
            </button>
          </div>
        </SheetBackdrop>
      )}
      {editing === 'pick' && <PickSheet onPick={(k) => setEditing(k)} onClose={() => setEditing(null)} debtsCount={debts.length} />}
      {editing && editing !== 'pick' && (
        <ChangeSheet
          change={typeof editing === 'string' ? undefined : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          store={store}
          debts={debts}
          start={start}
          onSave={(c) => {
            saveChange(c);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** The results popup: what a change (or all of them) does to cash, savings and debts over the months shown. */
function ResultSheet({ before, after, change, title, end, savingsGoalCents, onEdit, onClose }: { before: Projection; after: Projection; change?: Change; title: string; end: MonthKey; savingsGoalCents: Cents; onEdit?: () => void; onClose: () => void }) {
  const dCash = after.endCashCents - before.endCashCents;
  const dSaved = after.avgSavedCents - before.avgSavedCents;
  const dInterest = after.interestCents - before.interestCents;
  const low = lowest(after);
  const freeB = debtFreeMonth(before);
  const freeA = debtFreeMonth(after);
  const tone = (cents: number) => (cents > 0 ? 'fig-pos' : cents < 0 ? 'fig-neg' : '');
  const at = (m: MonthKey) => Math.max(0, after.months.findIndex((x) => x.month >= m));
  const billsDelta = (m: MonthKey) => (after.months[at(m)]?.billsCents ?? 0) - (before.months[at(m)]?.billsCents ?? 0);
  const newDebt = change?.kind === 'newDebt' ? after.debts.find((d) => d.isNew && d.id === `new:${change.id}`) : undefined;
  const debtId = change && (change.kind === 'payoff' || change.kind === 'extra') ? change.debtId : undefined;
  const dB = debtId ? before.debts.find((d) => d.id === debtId) : undefined;
  const dA = debtId ? after.debts.find((d) => d.id === debtId) : undefined;
  const impact = change?.kind === 'payoff' ? payoffImpact(before, after, change) : undefined;
  return (
    <SheetBackdrop onClose={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="res-h">
        <p className="muted small sim-res-kicker">Simulation results through {monthLabel(end)}</p>
        <h2 id="res-h">{title}</h2>
        <div className="card hero sim-res-hero">
          <h3>Cash at the end</h3>
          <p className="big fit" style={{ ['--chars' as string]: Math.max(formatCents(after.endCashCents).length, 4) }}>
            {formatCents(after.endCashCents)}
          </p>
          <p className="muted">{dCash === 0 ? 'The same as without it' : `${signed(dCash)} vs. without ${change ? 'this change' : 'the changes'}`}</p>
        </div>
        <dl className="kv">
          {impact && (
            <>
              <dt>Paid from cash</dt>
              <dd>{formatCents(impact.lumpCents)}</dd>
              <dt>Interest saved</dt>
              <dd className="fig-pos">{formatCents(impact.interestSavedCents)}</dd>
              {impact.freedCents > 0 && (
                <>
                  <dt>Freed up each month after</dt>
                  <dd className="fig-pos">{formatCents(impact.freedCents)}</dd>
                </>
              )}
              <dt>Cash catches up</dt>
              <dd>{impact.caughtUp ? monthLabel(impact.caughtUp) : `After ${monthLabel(end)}`}</dd>
            </>
          )}
          {change?.kind === 'extra' && dA && dB && (
            <>
              <dt>Interest saved</dt>
              <dd className="fig-pos">{formatCents(Math.max(0, dB.interestCents - dA.interestCents))}</dd>
              <dt>{dA.name} paid off</dt>
              <dd>
                {dA.paidOffMonth ? monthLabel(dA.paidOffMonth) : `After ${monthLabel(end)}`}
                <small>was {dB.paidOffMonth ? monthLabel(dB.paidOffMonth) : `after ${monthLabel(end)}`}</small>
              </dd>
            </>
          )}
          {change?.kind === 'newDebt' && newDebt && (
            <>
              <dt>Monthly bills go up by</dt>
              <dd className="fig-neg">{formatCents(change.paymentCents)}</dd>
              <dt>Interest the first month</dt>
              <dd className="fig-neg">{formatCents(newDebt.firstInterestCents ?? 0)}</dd>
              <dt>Interest in total</dt>
              <dd className="fig-neg">
                {formatCents(newDebt.interestCents)}
                {!newDebt.paidOffMonth && <small>through {monthLabel(end)}</small>}
              </dd>
              <dt>Paid off</dt>
              <dd>{newDebt.paidOffMonth ? monthLabel(newDebt.paidOffMonth) : newDebt.noPayment ? 'Never: the payment starts after this view' : `After ${monthLabel(end)}`}</dd>
              {change.paymentCents <= (newDebt.firstInterestCents ?? 0) && <dd className="bad-text sim-res-warn">The payment doesn't cover the interest, so the balance keeps growing.</dd>}
            </>
          )}
          {(change?.kind === 'bill' || change?.kind === 'newBill') && (
            <>
              <dt>Monthly bills change by</dt>
              <dd className={tone(-billsDelta(change.from))}>{signed(billsDelta(change.from))}</dd>
            </>
          )}
          <dt>Saved a month on average</dt>
          <dd>
            {formatCents(after.avgSavedCents)}
            {dSaved !== 0 && <small className={tone(dSaved)}>{signed(dSaved)}</small>}
          </dd>
          <dt>Months that meet the {formatCents(savingsGoalCents)} goal</dt>
          <dd>
            {after.goalMet} of {after.months.length}
            {after.goalMet !== before.goalMet && <small>was {before.goalMet}</small>}
          </dd>
          <dt>Lowest cash</dt>
          <dd className={low.cents < 0 ? 'fig-neg' : ''}>
            {formatCents(low.cents)}
            <small>{monthLabel(low.month)}</small>
          </dd>
          {(after.debts.length > 0 || before.debts.length > 0) && (
            <>
              <dt>Interest on debts</dt>
              <dd>
                {formatCents(after.interestCents)}
                {dInterest !== 0 && <small className={tone(-dInterest)}>{dInterest < 0 ? `${formatCents(-dInterest)} saved` : `${formatCents(dInterest)} more`}</small>}
              </dd>
              <dt>Debt-free</dt>
              <dd>
                {freeA ? monthLabel(freeA) : 'Not within the view'}
                {freeA !== freeB && <small>was {freeB ? monthLabel(freeB) : 'not within the view'}</small>}
              </dd>
            </>
          )}
        </dl>
        {low.cents < 0 && <p className="bad-text small">Your checking balance would go below zero in {monthLabel(low.month)}.</p>}
        <div className="sheet-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
          {onEdit && (
            <button type="button" className="secondary" onClick={onEdit}>
              Edit this change
            </button>
          )}
        </div>
      </div>
    </SheetBackdrop>
  );
}

function lowest(p: Projection): { cents: Cents; month: MonthKey } {
  const m = p.months.reduce((a, b) => (b.cashCents < a.cashCents ? b : a), p.months[0]);
  return { cents: m.cashCents, month: m.month };
}

/** Reach a cash balance: how long at a monthly saving, when the plan gets there, and what reaching it by a month takes. */
function Goal({ st, set, scen, start, input, changes }: { st: SimState; set: (p: Partial<SimState>) => void; scen: Projection; start: MonthKey; input: Parameters<typeof project>[0]; changes: Change[] }) {
  const target = parseCents(st.goalText);
  const rateTyped = parseCents(st.rateText);
  const rate = st.rateText.trim() === '' ? Math.max(0, scen.avgSavedCents) : rateTyped;
  const from = scen.startCashCents;
  const reach = target !== undefined && rate !== undefined ? monthsToReach(from, target, rate, start) : undefined;
  // When the plan itself gets there: look up to 30 years ahead.
  const planHit = useMemo(() => (target ? cashReaches(project({ ...input, horizon: 360 }, changes), target) : undefined), [target, input.data, input.today, input.spendingCents, JSON.stringify(changes)]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = target !== undefined && st.byMonth ? neededPerMonth(from, target, start, st.byMonth) : undefined;
  return (
    <section className="card" aria-labelledby="goal-h">
      <h2 id="goal-h">Reach a cash balance</h2>
      <div className="grid2">
        <label className="field">
          <span>Cash goal</span>
          <MoneyInput value={st.goalText} onValue={(v) => set({ goalText: v })} placeholder="0.00" />
        </label>
        <label className="field">
          <span>Saving a month</span>
          <MoneyInput value={st.rateText} onValue={(v) => set({ rateText: v })} placeholder={centsToAmountInput(Math.max(0, scen.avgSavedCents))} />
        </label>
      </div>
      {target === undefined ? (
        <p className="muted small">Enter a goal to see how long it takes. Saving a month starts at your average saved ({formatCents(Math.max(0, scen.avgSavedCents))}).</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Cash now</dt>
            <dd>{formatCents(from)}</dd>
            <dt>Saving {rate === undefined ? '—' : formatCents(rate)} a month</dt>
            <dd>
              {!reach ? '—' : reach.kind === 'already' ? 'Already there' : reach.kind === 'never' ? 'Never' : `${reach.months} ${reach.months === 1 ? 'month' : 'months'}`}
              {reach?.kind === 'months' && <small>{monthLabel(reach.month)}</small>}
            </dd>
            <dt>With your plan{changes.length ? ' and changes' : ''}</dt>
            <dd>{from >= target ? 'Already there' : planHit ? monthLabel(planHit) : 'Not within 30 years'}</dd>
          </dl>
          <label className="field sim-by">
            <span>Reach it by</span>
            <input type="month" min={start} value={st.byMonth} onChange={(e) => set({ byMonth: e.target.value })} />
          </label>
          {need !== undefined && (
            <p className="saved-line" role="status">
              <Icon name="check" />
              <span>
                Save <b>{formatCents(need)}</b> a month from {monthLabel(start)} to have {formatCents(target)} by the end of {monthLabel(st.byMonth as MonthKey)}.
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function changeText(c: Change, debts: { id: string; name: string }[], bills: { id: string; name: string; amountCents: number }[]): { title: string; detail: string } {
  // eslint-disable-next-line default-case
  const debt = 'debtId' in c ? debts.find((d) => d.id === c.debtId)?.name ?? 'A debt' : '';
  switch (c.kind) {
    case 'payoff':
      return { title: c.amountCents ? `Pay ${formatCents(c.amountCents)} on ${debt}` : `Pay off ${debt}`, detail: `From cash in ${monthLabel(c.month)}` };
    case 'extra':
      return { title: `${formatCents(c.amountCents)} more a month on ${debt}`, detail: `From ${monthLabel(c.from)}` };
    case 'bill': {
      const b = bills.find((x) => x.id === c.billId);
      return c.amountCents === 0
        ? { title: `Remove ${b?.name ?? 'a bill'}`, detail: `From ${monthLabel(c.from)} (saves ${formatCents(b?.amountCents ?? 0)} a month)` }
        : { title: `${b?.name ?? 'A bill'} to ${formatCents(c.amountCents)}`, detail: `From ${monthLabel(c.from)} (${signed(c.amountCents - (b?.amountCents ?? 0))} a month)` };
    }
    case 'newBill':
      return { title: `Add ${c.name || 'a bill'}: ${formatCents(c.amountCents)} a month`, detail: c.to ? `${monthLabel(c.from)} to ${monthLabel(c.to)}` : `From ${monthLabel(c.from)}` };
    case 'oneTime':
      return { title: `${c.name || (c.income ? 'Money in' : 'Expense')}: ${c.income ? '+' : ''}${formatCents(c.amountCents)}`, detail: `${c.income ? 'Coming in' : 'Paid'} in ${monthLabel(c.month)}` };
    case 'income':
      return { title: `Income ${formatCents(c.amountCents)} a month`, detail: `From ${monthLabel(c.from)}` };
    case 'spending':
      return { title: `Spending ${formatCents(c.amountCents)} a month`, detail: `From ${monthLabel(c.from)}` };
    case 'newDebt':
      return { title: `Borrow ${formatCents(c.amountCents)}${c.name ? ` (${c.name})` : ''}`, detail: `${formatApr(c.aprBps)} APR, ${formatCents(c.paymentCents)} a month, from ${monthLabel(c.month)}` };
  }
}

function PickSheet({ onPick, onClose, debtsCount }: { onPick: (k: Change['kind']) => void; onClose: () => void; debtsCount: number }) {
  return (
    <SheetBackdrop onClose={onClose}>
      <div className="sheet menu" role="dialog" aria-modal="true" aria-labelledby="pick-h">
        <h2 id="pick-h">Add a change</h2>
        <ul className="sim-kinds">
          {KINDS.filter((k) => debtsCount > 0 || (k.kind !== 'payoff' && k.kind !== 'extra')).map((k) => (
            <li key={k.kind}>
              <button type="button" onClick={() => onPick(k.kind)}>
                <b>{k.label}</b>
                <span>{k.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </SheetBackdrop>
  );
}

function ChangeSheet({
  change,
  kind,
  store,
  debts,
  start,
  onSave,
  onClose,
}: {
  change?: Change;
  kind: Change['kind'];
  store: Store;
  debts: { id: string; name: string; balanceCents: number }[];
  start: MonthKey;
  onSave: (c: Change) => void;
  onClose: () => void;
}) {
  const { data } = store;
  const bills = data.bills.filter((b) => !b.deleted);
  const c = change as (Change & Record<string, unknown>) | undefined;
  const [debtId, setDebtId] = useState<string>((c?.debtId as string) ?? debts[0]?.id ?? '');
  const [billId, setBillId] = useState<string>((c?.billId as string) ?? bills[0]?.id ?? '');
  const [remove, setRemove] = useState(kind === 'bill' && c?.amountCents === 0);
  const [whole, setWhole] = useState(kind === 'payoff' ? c?.amountCents === undefined : false);
  const [amount, setAmount] = useState(typeof c?.amountCents === 'number' && c.amountCents > 0 ? centsToAmountInput(c.amountCents) : '');
  const [name, setName] = useState((c?.name as string) ?? '');
  const [month, setMonth] = useState<string>((c?.month as string) ?? (c?.from as string) ?? start);
  const [to, setTo] = useState<string>((c?.to as string) ?? '');
  const [income, setIncome] = useState(!!c?.income || !!c?.cashIn);
  const [apr, setApr] = useState(typeof c?.aprBps === 'number' ? String(c.aprBps / 100) : '');
  const [payment, setPayment] = useState(typeof c?.paymentCents === 'number' ? centsToAmountInput(c.paymentCents) : '');
  const aprBps = parseApr(apr);
  const payCents = parseCents(payment);
  const [tried, setTried] = useState(false);
  const cents = parseCents(amount);
  const debt = debts.find((d) => d.id === debtId);
  const bill = bills.find((b) => b.id === billId);
  const title = KINDS.find((k) => k.kind === kind)!.label;
  const needsAmount = !(kind === 'payoff' && whole) && !(kind === 'bill' && remove);

  const errors = [
    (kind === 'payoff' || kind === 'extra') && !debt && 'Pick a debt',
    kind === 'bill' && !bill && 'Pick a bill',
    needsAmount && (cents === undefined || (cents === 0 && kind !== 'income' && kind !== 'spending')) && 'Enter the amount',
    !/^\d{4}-\d{2}$/.test(month) && 'Pick the month',
    /^\d{4}-\d{2}$/.test(month) && month < start && `Pick ${monthLabel(start)} or later`,
    kind === 'newBill' && to && to < month && 'The last month comes after the first',
    kind === 'newDebt' && aprBps === undefined && 'Enter the APR, like 24.99',
    kind === 'newDebt' && !payCents && 'Enter the monthly payment',
  ].filter(Boolean) as string[];

  function save() {
    setTried(true);
    if (errors.length) return;
    const id = change?.id ?? newId();
    const amt = cents ?? 0;
    let made: Change;
    switch (kind) {
      case 'payoff':
        made = { id, kind, debtId, month, ...(whole ? {} : { amountCents: amt }) };
        break;
      case 'extra':
        made = { id, kind, debtId, amountCents: amt, from: month };
        break;
      case 'bill':
        made = { id, kind, billId, amountCents: remove ? 0 : amt, from: month };
        break;
      case 'newBill':
        made = { id, kind, name: name.trim(), amountCents: amt, from: month, ...(to ? { to } : {}) };
        break;
      case 'oneTime':
        made = { id, kind, name: name.trim(), amountCents: amt, month, ...(income ? { income: true } : {}) };
        break;
      case 'newDebt':
        made = { id, kind, name: name.trim(), amountCents: amt, aprBps: aprBps ?? 0, paymentCents: payCents ?? 0, month, ...(income ? { cashIn: true } : {}) };
        break;
      case 'income':
      case 'spending':
        made = { id, kind, amountCents: amt, from: month };
    }
    onSave(made);
  }

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chg-sheet-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 id="chg-sheet-h">{title}</h2>
        {(kind === 'payoff' || kind === 'extra') && (
          <label className="field">
            <span>Debt</span>
            <select value={debtId} onChange={(e) => setDebtId(e.target.value)}>
              {debts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {formatCents(d.balanceCents)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'bill' && (
          <label className="field">
            <span>Fixed bill</span>
            <select value={billId} onChange={(e) => setBillId(e.target.value)}>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {formatCents(b.amountCents)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === 'newBill' || kind === 'oneTime' || kind === 'newDebt') && (
          <label className="field">
            <span>Name (optional)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'newBill' ? 'Gym' : kind === 'newDebt' ? 'Car loan' : 'Trip'} autoComplete="off" />
          </label>
        )}
        {kind === 'payoff' && (
          <div className="seg" role="radiogroup" aria-label="How much">
            <button type="button" role="radio" aria-checked={whole} className={whole ? 'on' : ''} onClick={() => setWhole(true)}>
              The whole balance
            </button>
            <button type="button" role="radio" aria-checked={!whole} className={!whole ? 'on' : ''} onClick={() => setWhole(false)}>
              Part of it
            </button>
          </div>
        )}
        {kind === 'bill' && (
          <div className="seg" role="radiogroup" aria-label="Change">
            <button type="button" role="radio" aria-checked={!remove} className={!remove ? 'on' : ''} onClick={() => setRemove(false)}>
              New amount
            </button>
            <button type="button" role="radio" aria-checked={remove} className={remove ? 'on' : ''} onClick={() => setRemove(true)}>
              Remove it
            </button>
          </div>
        )}
        {kind === 'oneTime' && (
          <div className="seg" role="radiogroup" aria-label="Money out or in">
            <button type="button" role="radio" aria-checked={!income} className={!income ? 'on' : ''} onClick={() => setIncome(false)}>
              Expense
            </button>
            <button type="button" role="radio" aria-checked={income} className={income ? 'on' : ''} onClick={() => setIncome(true)}>
              Money in
            </button>
          </div>
        )}
        <div className="grid2">
          {needsAmount && (
            <label className="field">
              <span>{kind === 'payoff' || kind === 'oneTime' ? 'Amount' : kind === 'newDebt' ? 'Borrowed' : kind === 'extra' ? 'Extra a month' : 'A month'}</span>
              <MoneyInput
                value={amount}
                onValue={setAmount}
                placeholder={kind === 'bill' && bill ? centsToAmountInput(bill.amountCents) : kind === 'income' ? centsToAmountInput(data.settings.incomeBaselineCents) : '0.00'}
              />
            </label>
          )}
          <label className="field">
            <span>{kind === 'payoff' || kind === 'oneTime' || kind === 'newDebt' ? 'Month' : 'Starting'}</span>
            <input type="month" min={start} value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          {kind === 'newDebt' && (
            <>
              <label className="field">
                <span>APR %</span>
                <input type="text" inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="24.99" autoComplete="off" />
              </label>
              <label className="field">
                <span>Payment a month</span>
                <MoneyInput value={payment} onValue={setPayment} placeholder="0.00" />
              </label>
            </>
          )}
          {kind === 'newBill' && (
            <label className="field">
              <span>Last month (optional)</span>
              <input type="month" min={month} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          )}
        </div>
        {kind === 'payoff' && debt && <p className="muted small">{debt.name} owes {formatCents(debt.balanceCents)} now. The payment comes out of your checking balance, and its monthly payment stops once it is cleared.</p>}
        {kind === 'newDebt' && (
          <button type="button" role="switch" aria-checked={income} className={`switch-row${income ? ' on' : ''}`} onClick={() => setIncome(!income)}>
            <span>
              <b>The money goes into checking</b>
              <small>Leave it off when the loan pays for something directly, like a car. Payments start the month after.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        )}
        {kind === 'income' && <p className="muted small">Your income baseline is {formatCents(data.settings.incomeBaselineCents)} a month.</p>}
        {kind === 'spending' && <p className="muted small">Replaces the spending figure from {monthLabel(month || start)} on.</p>}
        {tried && errors.length > 0 && (
          <p className="error" role="alert">
            {errors.join(' · ')}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {change ? 'Save change' : 'Add change'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SheetBackdrop>
  );
}

/** Every saved plan side by side: cash at the end, against as planned, saved a month, interest and the debt-free month. */
function ComparePlans({ plans, activeId, input, base, onPick }: { plans: { plan: Plan; changes: Change[] }[]; activeId: string; input: Parameters<typeof project>[0]; base: Projection; onPick: (id: string) => void }) {
  const rows = useMemo(
    () => plans.map(({ plan, changes }) => ({ plan, p: project(input, changes) })),
    [JSON.stringify(plans), input.data, input.today, input.horizon, input.spendingCents], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const best = Math.max(...rows.map((r) => r.p.endCashCents));
  const free = (p: Projection) => {
    const m = debtFreeMonth(p);
    return m ? monthLabel(m).replace(/ (\d\d)(\d\d)$/, ' ’$2') : p.debts.length ? 'Not yet' : 'No debt';
  };
  return (
    <section className="card" aria-labelledby="cmp-h">
      <h2 id="cmp-h">Compare plans</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="cmp-h">
        <table className="ytable cmp-table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Cash at end</th>
              <th scope="col">vs as planned</th>
              <th scope="col">Saved a month</th>
              <th scope="col">Interest</th>
              <th scope="col">Debt-free</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">As planned</th>
              <td>{formatCents(base.endCashCents)}</td>
              <td className="muted">—</td>
              <td>{formatCents(base.avgSavedCents)}</td>
              <td>{formatCents(base.interestCents)}</td>
              <td>{free(base)}</td>
            </tr>
            {rows.map(({ plan, p }) => (
              <tr key={plan.id} className={plan.id === activeId ? 'is-active' : ''}>
                <th scope="row">
                  <button type="button" className="link" onClick={() => onPick(plan.id)} aria-pressed={plan.id === activeId}>
                    {plan.name}
                  </button>
                  {p.endCashCents === best && rows.length > 1 && <span className="cmp-best">Most cash</span>}
                </th>
                <td>{formatCents(p.endCashCents)}</td>
                <td className={p.endCashCents - base.endCashCents < 0 ? 'fig-neg' : p.endCashCents > base.endCashCents ? 'fig-pos' : ''}>{signed(p.endCashCents - base.endCashCents)}</td>
                <td>{formatCents(p.avgSavedCents)}</td>
                <td>{formatCents(p.interestCents)}</td>
                <td>{free(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Each plan counts only its switched-on changes. Tap a plan to open it.</p>
    </section>
  );
}

function PlanSheet({ plan, count, onRename, onAdd, onDelete, onClose }: { plan: Plan; count: number; onRename: (name: string) => void; onAdd: (copy: boolean) => void; onDelete: () => void; onClose: () => void }) {
  const [name, setName] = useState(plan.name);
  const save = () => {
    if (name.trim() && name.trim() !== plan.name) onRename(name.trim());
  };
  return (
    <SheetBackdrop onClose={() => (save(), onClose())}>
      <div className="sheet menu" role="dialog" aria-modal="true" aria-labelledby="plan-sheet-h">
        <h2 id="plan-sheet-h">Plans</h2>
        <label className="field">
          <span>Name of this plan</span>
          <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={save} enterKeyHint="done" />
        </label>
        <button type="button" className="secondary" onClick={() => (save(), onAdd(true))}>
          Copy {plan.name} into a new plan
        </button>
        <button type="button" className="secondary" onClick={() => (save(), onAdd(false))}>
          Start an empty plan
        </button>
        {count > 1 && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete {plan.name}
          </button>
        )}
        <button type="button" className="primary" onClick={() => (save(), onClose())}>
          Done
        </button>
      </div>
    </SheetBackdrop>
  );
}
