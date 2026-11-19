import { useEffect, useRef, useState } from 'react';
import Add from './Add';
import Cards from './Cards';
import { addMonths, autopayMonths, monthLabel, thisMonth, type MonthKey } from './calc';
import Icon, { type IconName } from './icons';
import Month from './Month';
import PeriodSheet, { type Period } from './PeriodSheet';
import Purchases from './Purchases';
import Setup from './Setup';
import { useStore, type Store } from './store';
import { UndoProvider } from './undo';
import { useToday } from './useToday';
import Year from './Year';

type Tab = 'summary' | 'cards' | 'add' | 'purchases' | 'setup';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'summary', label: 'Summary', icon: 'year' },
  { id: 'cards', label: 'Credit Cards', icon: 'card' },
  { id: 'add', label: 'Add', icon: 'add' },
  { id: 'purchases', label: 'Purchases', icon: 'entries' },
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
  const [tab, setTab] = useState<Tab>('summary');
  // Summary shows a month or a year; Purchases always shows a month (the Summary's month, or the year's last pick).
  const [view, setView] = useState<Period['kind']>('month');
  const [month, setMonth] = useState<MonthKey>(current);
  const [year, setYear] = useState(Number(current.slice(0, 4)));
  const [picking, setPicking] = useState(false);
  const motion = useRef('');

  // Autopay: record the payments of bills whose autopay date has arrived (safe to repeat: it only fills what is missing).
  const { bills, months } = store.data;
  useEffect(() => {
    const due = autopayMonths({ ...store.data, bills, months }, today);
    if (due.length) void store.putMonths(due);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, bills, months, settings.firstMonth]);

  function go(next: Tab) {
    if (next === tab) return;
    const from = TABS.findIndex((t) => t.id === tab);
    const to = TABS.findIndex((t) => t.id === next);
    motion.current = to > from ? 'fwd' : 'back';
    setTab(next);
    document.querySelector('main')?.scrollTo(0, 0);
  }

  const firstYear = Number(settings.firstMonth.slice(0, 4));
  const lastMonth = addMonths(current, 12);
  const lastYear = Math.max(firstYear, Number(lastMonth.slice(0, 4)));
  const curYear = Number(current.slice(0, 4));
  const showYear = tab === 'summary' && view === 'year';
  const period: Period = showYear ? { kind: 'year', year } : { kind: 'month', month };

  function pickPeriod(p: Period) {
    setView(p.kind);
    if (p.kind === 'month') {
      setMonth(p.month);
      setYear(Number(p.month.slice(0, 4)));
    } else {
      setYear(p.year);
    }
  }

  let band;
  if (tab === 'summary' || tab === 'purchases') {
    band = showYear ? (
      <Stepper
        label={String(year)}
        sub={year === curYear ? 'This year' : 'Year'}
        onOpen={() => setPicking(true)}
        prev={year > firstYear ? () => setYear(year - 1) : undefined}
        next={year < lastYear ? () => setYear(year + 1) : undefined}
        unit="year"
      />
    ) : (
      <Stepper
        label={monthLabel(month)}
        sub={month === current ? 'This month' : 'Month'}
        onOpen={() => setPicking(true)}
        prev={month > settings.firstMonth ? () => setMonth(addMonths(month, -1)) : undefined}
        next={month < lastMonth ? () => setMonth(addMonths(month, 1)) : undefined}
        unit="month"
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
            {tab === 'summary' ? (
              view === 'year' ? (
                <Year store={store} year={year} today={today} />
              ) : (
                <Month store={store} month={month} today={today} />
              )
            ) : tab === 'cards' ? (
              <Cards store={store} today={today} />
            ) : tab === 'add' ? (
              <Add store={store} today={today} />
            ) : tab === 'purchases' ? (
              <Purchases store={store} month={month} today={today} />
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
        {picking && (
          <PeriodSheet
            value={period}
            firstMonth={settings.firstMonth}
            lastMonth={lastMonth}
            current={current}
            monthOnly={tab === 'purchases'}
            onPick={pickPeriod}
            onClose={() => setPicking(false)}
          />
        )}
      </UndoProvider>
    </div>
  );
}

/** ‹ period › in the band. Tapping the period opens the picker (any month or year, and Month / Year). */
function Stepper({
  label,
  sub,
  onOpen,
  prev,
  next,
  unit,
}: {
  label: string;
  sub: string;
  onOpen: () => void;
  prev?: () => void;
  next?: () => void;
  unit: string;
}) {
  return (
    <div className="band-step">
      <button type="button" className="hit" onClick={prev} disabled={!prev} aria-label={`Previous ${unit}`}>
        <Icon name="back" />
      </button>
      <button type="button" className="band-pick" onClick={onOpen} aria-haspopup="dialog" aria-label={`${label}, ${sub}. Change period`}>
        <span className="band-title" aria-live="polite">
          {label}
          <Icon name="down" />
        </span>
        <span className="band-sub">{sub}</span>
      </button>
      <button type="button" className="hit" onClick={next} disabled={!next} aria-label={`Next ${unit}`}>
        <Icon name="next" />
      </button>
    </div>
  );
}
