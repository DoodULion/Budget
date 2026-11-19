import { useEffect, useState } from 'react';
import { formatCents, monthLabel, monthSummary, thisMonth, type Data } from './calc';
import { loadData, requestPersistence } from './db';
import { todayLocal } from './money';

/**
 * App shell. Step 2 sets up storage, offline support and the tested math;
 * the screens (first-run setup, Month, Add, Purchases, Year, Setup) arrive in step 3.
 */
export default function App() {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void requestPersistence();
    loadData().then(setData, () => setError('Could not open this device’s storage.'));
  }, []);

  const today = todayLocal();
  const month = data ? thisMonth(data.settings, today) : undefined;
  const summary = data && month ? monthSummary(data, month, today) : undefined;

  return (
    <main className="shell">
      <header className="shell-header">
        <h1>Budget Tracker</h1>
        {month && <p className="mute">{monthLabel(month)}</p>}
      </header>
      {error && <p className="card">{error}</p>}
      {data && !data.settings.setupDone && (
        <section className="card">
          <h2>Getting ready</h2>
          <p className="mute">
            Your data stays on this phone. Setup for your income, bills and categories comes in the next build.
          </p>
        </section>
      )}
      {summary && data?.settings.setupDone && (
        <section className="card">
          <h2>Budget left</h2>
          <p className="figure">{formatCents(summary.budgetLeftCents)}</p>
          <p className="mute">
            {formatCents(summary.spentCents)} spent of {formatCents(summary.spendingBudgetCents)}
          </p>
        </section>
      )}
    </main>
  );
}
