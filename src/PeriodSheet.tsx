import { useState } from 'react';
import type { MonthKey } from './calc';
import Icon from './icons';
import SheetBackdrop from './SheetBackdrop';

/** What the Summary shows: one month, or a whole year. */
export type Period = { kind: 'month'; month: MonthKey } | { kind: 'year'; year: number };

const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const key = (year: number, m: number): MonthKey => `${year}-${String(m).padStart(2, '0')}`;

/**
 * Pick any month or any year. Month / Year at the top switches the view; the grid below picks the period.
 * `monthOnly` hides the switch (Purchases is always one month).
 */
export default function PeriodSheet({
  value,
  firstMonth,
  lastMonth,
  current,
  monthOnly,
  onPick,
  onClose,
}: {
  value: Period;
  firstMonth: MonthKey;
  lastMonth: MonthKey;
  current: MonthKey;
  monthOnly?: boolean;
  onPick: (p: Period) => void;
  onClose: () => void;
}) {
  const firstYear = Number(firstMonth.slice(0, 4));
  const lastYear = Number(lastMonth.slice(0, 4));
  const curYear = Number(current.slice(0, 4));
  const [kind, setKind] = useState<Period['kind']>(monthOnly ? 'month' : value.kind);
  // The year whose months are on show.
  const [year, setYear] = useState(value.kind === 'month' ? Number(value.month.slice(0, 4)) : value.year);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const pick = (p: Period) => {
    onPick(p);
    onClose();
  };

  return (
    <SheetBackdrop onClose={onClose}>
      <div className="sheet period" role="dialog" aria-modal="true" aria-labelledby="period-h">
        <h2 id="period-h">{monthOnly ? 'Pick a month' : 'Show a period'}</h2>
        {!monthOnly && (
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={kind === 'month' ? 'on' : ''} aria-pressed={kind === 'month'} onClick={() => setKind('month')}>
              Month
            </button>
            <button type="button" className={kind === 'year' ? 'on' : ''} aria-pressed={kind === 'year'} onClick={() => setKind('year')}>
              Year
            </button>
          </div>
        )}

        {kind === 'month' ? (
          <>
            <div className="period-year">
              <button type="button" className="hit" onClick={() => setYear(year - 1)} disabled={year <= firstYear} aria-label="Previous year">
                <Icon name="back" />
              </button>
              <b aria-live="polite">{year}</b>
              <button type="button" className="hit" onClick={() => setYear(year + 1)} disabled={year >= lastYear} aria-label="Next year">
                <Icon name="next" />
              </button>
            </div>
            <div className="period-grid">
              {NAMES.map((name, i) => {
                const m = key(year, i + 1);
                const on = value.kind === 'month' && value.month === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className={`${on ? 'on' : ''}${m === current ? ' now' : ''}`}
                    aria-pressed={on}
                    disabled={m < firstMonth || m > lastMonth}
                    onClick={() => pick({ kind: 'month', month: m })}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {!(value.kind === 'month' && value.month === current) && (
              <button type="button" className="secondary" onClick={() => pick({ kind: 'month', month: current })}>
                This month
              </button>
            )}
          </>
        ) : (
          <>
            <div className="period-grid">
              {years.map((y) => {
                const on = value.kind === 'year' && value.year === y;
                return (
                  <button key={y} type="button" className={`${on ? 'on' : ''}${y === curYear ? ' now' : ''}`} aria-pressed={on} onClick={() => pick({ kind: 'year', year: y })}>
                    {y}
                  </button>
                );
              })}
            </div>
            {!(value.kind === 'year' && value.year === curYear) && (
              <button type="button" className="secondary" onClick={() => pick({ kind: 'year', year: curYear })}>
                This year
              </button>
            )}
          </>
        )}
      </div>
    </SheetBackdrop>
  );
}
