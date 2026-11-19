import { useRef, useState } from 'react';
import Add from './Add';
import { addMonths, monthLabel, thisMonth, type MonthKey } from './calc';
import Icon, { type IconName } from './icons';
import Month from './Month';
import Purchases from './Purchases';
import Setup from './Setup';
import { useStore, type Store } from './store';
import { UndoProvider } from './undo';
import { useToday } from './useToday';
import Year from './Year';

type Tab = 'month' | 'add' | 'purchases' | 'year' | 'setup';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'month', label: 'Month', icon: 'month' },
  { id: 'add', label: 'Add', icon: 'add' },
  { id: 'purchases', label: 'Purchases', icon: 'entries' },
  { id: 'year', label: 'Year', icon: 'year' },
  { id: 'setup', label: 'Setup', icon: 'setup' },
];

export default function App() {
  const app = useStore();
  const today = useToday();
  if (!app.ready) return <p className="screen" style={{ padding: 16 }}>Loading…</p>;
  if (!app.data.settings.setupDone) return <FirstRun store={app} today={today} />;
  return <Main store={app} today={today} />;
}

function FirstRun({ store, today }: { store: Store; today: string }) {
  return (
    <div className="app first">
      <UndoProvider>
        <main>
          <Setup store={store} today={today} firstRun onStart={() => document.querySelector('main')?.scrollTo(0, 0)} />
        </main>
      </UndoProvider>
    </div>
  );
}

function Main({ store, today }: { store: Store; today: string }) {
  const { settings } = store.data;
  const current = thisMonth(settings, today);
  const [tab, setTab] = useState<Tab>('month');
  const [month, setMonth] = useState<MonthKey>(current);
  const [year, setYear] = useState(Number(current.slice(0, 4)));
  const motion = useRef('');

  function go(next: Tab) {
    if (next === tab) return;
    const from = TABS.findIndex((t) => t.id === tab);
    const to = TABS.findIndex((t) => t.id === next);
    motion.current = to > from ? 'fwd' : 'back';
    setTab(next);
    document.querySelector('main')?.scrollTo(0, 0);
  }

  const firstYear = Number(settings.firstMonth.slice(0, 4));
  const lastYear = Math.max(firstYear, Number(current.slice(0, 4)) + 1);
  const lastMonth = addMonths(current, 12);

  let band;
  if (tab === 'month' || tab === 'purchases') {
    band = (
      <Stepper
        label={monthLabel(month)}
        sub={month === current ? 'This month' : undefined}
        onToday={month === current ? undefined : () => setMonth(current)}
        prev={month > settings.firstMonth ? () => setMonth(addMonths(month, -1)) : undefined}
        next={month < lastMonth ? () => setMonth(addMonths(month, 1)) : undefined}
        unit="month"
      />
    );
  } else if (tab === 'year') {
    band = (
      <Stepper
        label={String(year)}
        sub={year === Number(current.slice(0, 4)) ? 'This year' : undefined}
        onToday={year === Number(current.slice(0, 4)) ? undefined : () => setYear(Number(current.slice(0, 4)))}
        prev={year > firstYear ? () => setYear(year - 1) : undefined}
        next={year < lastYear ? () => setYear(year + 1) : undefined}
        unit="year"
      />
    );
  } else {
    band = (
      <p className="band-title center">
        {monthLabel(current)}
        <span className="band-sub">This month</span>
      </p>
    );
  }

  return (
    <div className="app">
      <UndoProvider>
        <header className="band">
          <div className="band-in">{band}</div>
        </header>
        <main>
          <div key={tab} className={`page ${motion.current}`}>
            {tab === 'month' ? (
              <Month store={store} month={month} today={today} />
            ) : tab === 'add' ? (
              <Add store={store} today={today} />
            ) : tab === 'purchases' ? (
              <Purchases store={store} month={month} today={today} />
            ) : tab === 'year' ? (
              <Year store={store} year={year} today={today} />
            ) : (
              <Setup store={store} today={today} />
            )}
          </div>
        </main>
        <nav className="tabbar" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
      </UndoProvider>
    </div>
  );
}

function Stepper({
  label,
  sub,
  onToday,
  prev,
  next,
  unit,
}: {
  label: string;
  sub?: string;
  onToday?: () => void;
  prev?: () => void;
  next?: () => void;
  unit: string;
}) {
  return (
    <div className="band-step">
      <button type="button" className="hit" onClick={prev} disabled={!prev} aria-label={`Previous ${unit}`}>
        <Icon name="back" />
      </button>
      <p className="band-title" aria-live="polite">
        {label}
        {sub && <span className="band-sub">{sub}</span>}
        {onToday && (
          <button type="button" className="today-btn" onClick={onToday}>
            Back to this {unit}
          </button>
        )}
      </p>
      <button type="button" className="hit" onClick={next} disabled={!next} aria-label={`Next ${unit}`}>
        <Icon name="next" />
      </button>
    </div>
  );
}
