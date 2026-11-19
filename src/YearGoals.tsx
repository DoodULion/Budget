/**
 * Overview's "This year's goals" card: the savings goal and spending budget from Setup, plus goals you add,
 * each scored month by month (or toward its finish line), and a few insights on the year so far.
 */
import { useState, type HTMLAttributes } from 'react';
import { checkingBalanceNowCents, formatCents, monthLabel, spendingBudgetCents, thisMonth, type Cents, type Data, type MonthKey } from './calc';
import { averageSavedCents, builtInGoals, scoreGoal, yearInsights, type Goal, type GoalKind, type GoalResult } from './goals';
import Icon from './icons';
import { centsToAmountInput, newId, parseCents } from './money';
import SheetBackdrop from './SheetBackdrop';
import type { Store } from './store';
import { useUndo } from './undo';
import { Fig, MoneyInput, signed } from './ui';

const KINDS: { kind: GoalKind; label: string; hint: string }[] = [
  { kind: 'category-month', label: 'Keep a category under an amount', hint: 'Each month, e.g. Food at or under its budget' },
  { kind: 'spend-month', label: 'Spend no more than an amount', hint: 'All spending, each month' },
  { kind: 'save-month', label: 'Save an amount each month', hint: 'Income minus bills and spending' },
  { kind: 'bills-paid', label: 'Pay every bill', hint: 'No unpaid bills when a month ends' },
  { kind: 'save-year', label: 'Save an amount this year', hint: 'Added up over the year' },
  { kind: 'cash', label: 'Reach a checking balance', hint: 'By a month you pick' },
  { kind: 'debt-off', label: 'Pay off a debt', hint: 'By a month you pick' },
];

const short = (m: MonthKey) => monthLabel(m).replace(/ (\d\d)(\d\d)$/, ' ’$2');

export function goalTitle(g: Goal, data: Data): string {
  switch (g.kind) {
    case 'save-month':
      return `Save ${formatCents(g.amountCents)} a month`;
    case 'spend-month':
      return `Spend ${formatCents(g.amountCents)} or less a month`;
    case 'category-month':
      return `${data.categories.find((c) => c.id === g.categoryId)?.name ?? 'A category'} at or under ${formatCents(g.amountCents)}`;
    case 'bills-paid':
      return 'Pay every bill each month';
    case 'save-year':
      return `Save ${formatCents(g.amountCents)} this year`;
    case 'cash':
      return `Reach ${formatCents(g.amountCents)} in checking by ${short(g.by)}`;
    case 'debt-off':
      return `Pay off ${data.cards.find((c) => c.id === g.debtId)?.name ?? 'a debt'} by ${short(g.by)}`;
  }
}

function onTrack(r: GoalResult): boolean {
  return r.type === 'monthly' ? r.of === 0 || r.streak > 0 : r.onTrack;
}

function detail(g: Goal, r: GoalResult, avg: Cents): string {
  if (r.type === 'monthly') {
    if (r.of === 0) return r.months.some((m) => m.state === 'pending') ? 'This month is still to go' : 'Nothing to score yet';
    const pending = r.months.some((m) => m.state === 'pending') ? ' · this month still to go' : '';
    return `Met ${r.met} of ${r.of} ${r.of === 1 ? 'month' : 'months'}${r.streak > 1 ? ` · ${r.streak} in a row` : ''}${pending}`;
  }
  if (r.done) return g.kind === 'debt-off' ? 'Paid off' : `Done · ${formatCents(r.nowCents)}`;
  if (r.monthsLeft === 0) return `Missed · ${formatCents(r.nowCents)} ${g.kind === 'debt-off' ? 'still owed' : `of ${formatCents(r.targetCents)}`}`;
  const per = `${formatCents(r.neededPerMonthCents)} a month for ${r.monthsLeft} ${r.monthsLeft === 1 ? 'month' : 'months'}`;
  if (g.kind === 'debt-off') return `${formatCents(r.nowCents)} left · needs ${per}`;
  return `${formatCents(r.nowCents)} of ${formatCents(r.targetCents)} · needs ${per}${r.onTrack ? '' : ` (you average ${formatCents(avg)})`}`;
}

export default function YearGoals({ store, today, section }: { store: Store; today: string; section: HTMLAttributes<HTMLElement> }) {
  const { data } = store;
  const { offer } = useUndo();
  const [sheet, setSheet] = useState<Goal | 'new' | null>(null);
  const mine = data.settings.goals ?? [];
  const goals = [...builtInGoals(data), ...mine];
  const scored = goals.map((g) => ({ g, r: scoreGoal(data, g, today) }));
  const y = yearInsights(data, today);
  const avg = averageSavedCents(data, today);
  const tracking = scored.filter((x) => onTrack(x.r)).length;
  const vsGoal = y.savedCents - y.goalToDateCents;
  const over = y.mostOver ? data.categories.find((c) => c.id === y.mostOver!.categoryId) : undefined;

  async function saveGoals(next: Goal[], text: string, feel?: 'warn') {
    const before = data.settings.goals;
    await store.saveSettings({ goals: next });
    offer(text, () => store.saveSettings({ goals: before }), feel);
  }

  return (
    <>
    <section {...section} aria-labelledby="goals-h">
      <div className="card-head">
        <h2 id="goals-h">This year’s goals</h2>
        {goals.length > 0 && <span className={`pill${tracking === goals.length ? '' : ' idle'}`}>{tracking} of {goals.length} on track</span>}
      </div>

      {y.monthsCounted > 0 && (
        <div className="stat-grid three">
          <div>
            <Fig cents={y.savedCents} />
            <span>Saved in {y.year}</span>
          </div>
          <div>
            <Fig text={signed(vsGoal)} className={vsGoal < 0 ? 'fig-neg' : 'fig-pos'} />
            <span>vs goal so far</span>
          </div>
          <div>
            <Fig cents={y.avgSavedCents} />
            <span>Saved a month</span>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <p className="muted">Set a savings goal or budgets in Setup, or add a goal below, to track it here.</p>
      ) : (
        <ul className="goal-list">
          {scored.map(({ g, r }) => {
            const built = g.id.startsWith('builtin:');
            const good = onTrack(r);
            const body = (
              <>
                <span className="goal-main">
                  <b>{goalTitle(g, data)}</b>
                  <span>{detail(g, r, avg)}</span>
                  {r.type === 'monthly' ? (
                    <span className="goal-dots" aria-hidden="true">
                      {r.months.map((m) => (
                        <i key={m.month} className={m.state} title={`${monthLabel(m.month)}: ${m.state}`} />
                      ))}
                    </span>
                  ) : (
                    <span className={`goal-bar${r.done ? ' done' : ''}`} aria-hidden="true">
                      <i style={{ width: `${Math.round(r.progress * 100)}%` }} />
                    </span>
                  )}
                </span>
                <span className={`goal-state ${good ? 'ok' : 'behind'}`}>{r.type === 'target' && r.done ? 'Done' : good ? 'On track' : 'Behind'}</span>
              </>
            );
            return (
              <li key={g.id}>
                {built ? (
                  <div className="goal-row">
                    {body}
                  </div>
                ) : (
                  <button type="button" className="goal-row" onClick={() => setSheet(g)} aria-label={`Edit goal: ${goalTitle(g, data)}`}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {goals.some((g) => g.id.startsWith('builtin:')) && <p className="muted small">Your savings goal and spending budget come from Setup.</p>}

      <button type="button" className="add-row" onClick={() => setSheet('new')}>
        <Icon name="add" />
        Add a goal
      </button>

      {y.monthsCounted > 0 && (
        <div className="part">
          <h3>Insights</h3>
          <dl className="kv">
            {data.settings.savingsGoalCents > 0 && (
              <>
                <dt>Savings vs your goal so far</dt>
                <dd className={vsGoal < 0 ? 'fig-neg' : 'fig-pos'}>
                  {vsGoal >= 0 ? `${formatCents(vsGoal)} ahead` : `${formatCents(-vsGoal)} behind`}
                  <small>{formatCents(y.savedCents)} of {formatCents(y.goalToDateCents)}</small>
                </dd>
              </>
            )}
            {y.best && y.worst && (
              <>
                <dt>Best month</dt>
                <dd>
                  {monthLabel(y.best.month)}
                  <small>saved {formatCents(y.best.savedCents)}</small>
                </dd>
                <dt>Toughest month</dt>
                <dd>
                  {monthLabel(y.worst.month)}
                  <small>saved {formatCents(y.worst.savedCents)}</small>
                </dd>
              </>
            )}
            {y.categoryOf > 0 && (
              <>
                <dt>Category budgets kept</dt>
                <dd>
                  {Math.round((y.categoryKept / y.categoryOf) * 100)}%<small>{y.categoryKept} of {y.categoryOf} category-months</small>
                </dd>
              </>
            )}
            {over && y.mostOver && (
              <>
                <dt>Most often over budget</dt>
                <dd className="fig-neg">
                  {over.name}
                  <small>
                    {y.mostOver.months} {y.mostOver.months === 1 ? 'month' : 'months'}, {formatCents(y.mostOver.overCents)} over
                  </small>
                </dd>
              </>
            )}
            {data.settings.savingsGoalCents > 0 && y.monthsLeft > 0 && (
              <>
                <dt>To save {formatCents(y.yearGoalCents)} by December</dt>
                <dd className={y.neededPerMonthCents > data.settings.savingsGoalCents ? 'fig-neg' : ''}>
                  {y.neededPerMonthCents > 0 ? `${formatCents(y.neededPerMonthCents)} a month` : 'Already there'}
                  <small>
                    {y.monthsLeft} {y.monthsLeft === 1 ? 'month' : 'months'} left
                  </small>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

    </section>
      {sheet && (
        <GoalSheet
          data={data}
          today={today}
          goal={sheet === 'new' ? undefined : sheet}
          onSave={(g) => {
            const exists = mine.some((x) => x.id === g.id);
            void saveGoals(exists ? mine.map((x) => (x.id === g.id ? g : x)) : [...mine, g], exists ? 'Goal saved' : 'Goal added');
            setSheet(null);
          }}
          onDelete={(g) => {
            void saveGoals(
              mine.filter((x) => x.id !== g.id),
              'Goal deleted',
              'warn',
            );
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

/** Pick a kind of goal, then its amount, category, debt or month, filled in from your own numbers. */
function GoalSheet({ data, today, goal, onSave, onDelete, onClose }: { data: Data; today: string; goal?: Goal; onSave: (g: Goal) => void; onDelete: (g: Goal) => void; onClose: () => void }) {
  const [kind, setKind] = useState<GoalKind | null>(goal?.kind ?? null);
  const year = thisMonth(data.settings, today).slice(0, 4);
  const current = thisMonth(data.settings, today);
  const cats = data.categories.filter((c) => !c.deleted);
  const debts = data.cards;
  const [categoryId, setCategoryId] = useState(goal?.kind === 'category-month' ? goal.categoryId : cats[0]?.id ?? '');
  const [debtId, setDebtId] = useState(goal?.kind === 'debt-off' ? goal.debtId : debts[0]?.id ?? '');
  const [by, setBy] = useState<MonthKey>(goal && 'by' in goal ? goal.by : `${year}-12`);
  const [amount, setAmount] = useState(goal && 'amountCents' in goal ? centsToAmountInput(goal.amountCents) : '');
  const [tried, setTried] = useState(false);

  // A starting amount from your own numbers.
  function suggest(k: GoalKind, catId = categoryId): string {
    const goalCents = data.settings.savingsGoalCents;
    switch (k) {
      case 'category-month':
        return centsToAmountInput(cats.find((c) => c.id === catId)?.budgetCents ?? 0);
      case 'spend-month':
        return centsToAmountInput(spendingBudgetCents(data.categories));
      case 'save-month':
        return centsToAmountInput(goalCents);
      case 'save-year':
        return centsToAmountInput(goalCents * 12);
      case 'cash':
        return centsToAmountInput(checkingBalanceNowCents(data, today) + goalCents * 6);
      default:
        return '';
    }
  }
  function pick(k: GoalKind) {
    setKind(k);
    if (!goal) setAmount(suggest(k));
  }

  const cents = parseCents(amount);
  const needsAmount = kind !== null && kind !== 'bills-paid' && kind !== 'debt-off';
  const errors = [
    needsAmount && (cents === undefined || cents <= 0) && 'Enter an amount',
    kind === 'category-month' && !categoryId && 'Pick a category',
    kind === 'debt-off' && !debtId && 'Add a debt first',
    (kind === 'cash' || kind === 'debt-off') && (!by || by < current) && 'Pick this month or later',
  ].filter(Boolean) as string[];

  function save() {
    setTried(true);
    if (!kind || errors.length) return;
    const id = goal?.id ?? newId();
    const a = cents ?? 0;
    const g: Goal =
      kind === 'category-month'
        ? { id, kind, categoryId, amountCents: a }
        : kind === 'bills-paid'
          ? { id, kind }
          : kind === 'cash'
            ? { id, kind, amountCents: a, by }
            : kind === 'debt-off'
              ? { id, kind, debtId, by }
              : { id, kind, amountCents: a };
    onSave(g);
  }

  if (!kind)
    return (
      <SheetBackdrop onClose={onClose}>
        <div className="sheet menu" role="dialog" aria-modal="true" aria-labelledby="goal-pick-h">
          <h2 id="goal-pick-h">Add a goal</h2>
          <ul className="sim-kinds">
            {KINDS.filter((k) => (k.kind === 'debt-off' ? debts.length > 0 : k.kind === 'category-month' ? cats.length > 0 : true)).map((k) => (
              <li key={k.kind}>
                <button type="button" onClick={() => pick(k.kind)}>
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

  return (
    <SheetBackdrop onClose={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-h"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 id="goal-h">{KINDS.find((k) => k.kind === kind)?.label}</h2>
        {kind === 'category-month' && (
          <label className="field">
            <span>Category</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                if (!goal) setAmount(suggest('category-month', e.target.value));
              }}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · budget {formatCents(c.budgetCents)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'debt-off' && (
          <label className="field">
            <span>Debt</span>
            <select value={debtId} onChange={(e) => setDebtId(e.target.value)}>
              {debts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsAmount && (
          <label className="field">
            <span>{kind === 'cash' ? 'Checking balance to reach' : kind === 'save-year' ? 'Amount to save this year' : kind === 'save-month' ? 'Amount to save a month' : 'Most to spend a month'}</span>
            <MoneyInput value={amount} onValue={setAmount} placeholder="0" aria-invalid={tried && (cents === undefined || cents <= 0)} />
          </label>
        )}
        {(kind === 'cash' || kind === 'debt-off') && (
          <label className="field">
            <span>By</span>
            <input type="month" min={current} value={by} onChange={(e) => setBy(e.target.value)} />
          </label>
        )}
        {kind === 'bills-paid' && <p className="muted">Met in a month when every fixed bill is marked paid. The month in progress counts once they all are.</p>}
        {tried && errors.length > 0 && (
          <p className="error" role="alert">
            {errors.join(' · ')}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary">
            {goal ? 'Save goal' : 'Add goal'}
          </button>
          {goal ? (
            <button type="button" className="danger" onClick={() => onDelete(goal)}>
              Delete goal
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => setKind(null)}>
              Back
            </button>
          )}
        </div>
      </form>
    </SheetBackdrop>
  );
}
