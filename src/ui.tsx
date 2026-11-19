/** Small shared pieces: money fields, category tiles, figures. */
import { type InputHTMLAttributes } from 'react';
import { formatCents, type Category } from './calc';
import { formatAmountInput } from './money';

/** A dollar amount field: decimal keypad, thousands commas as you type. The value is the text; parse it with parseCents. */
export function MoneyInput({
  value,
  onValue,
  ...rest
}: { value: string; onValue: (text: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="done"
      {...rest}
      value={value}
      onChange={(e) => onValue(formatAmountInput(e.target.value))}
    />
  );
}

/** The category's tile: its color and first letter. */
export function CatTile({ category, small }: { category?: Pick<Category, 'name' | 'color'>; small?: boolean }) {
  const name = category?.name ?? '?';
  return (
    <i className={`rd${small ? ' sm' : ''}`} style={{ ['--c' as string]: `var(--cat-${category?.color ?? 'c8'})` }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </i>
  );
}

/** "+$12.00" / "−$5.00" for a difference. */
export function signed(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** A money figure that shrinks to fit its column (see .fig in the stylesheet). */
export function Fig({ cents, className, text }: { cents?: number; className?: string; text?: string }) {
  const s = text ?? (cents === undefined ? '—' : formatCents(cents));
  return (
    <b className={`fig${className ? ` ${className}` : ''}`} style={{ ['--chars' as string]: Math.max(s.length, 4) }}>
      {s}
    </b>
  );
}

/** The share a meter shows: spent ÷ budget, capped at 1 (0 when there is no budget and nothing spent). */
export function share(spent: number, budget: number): number {
  if (budget <= 0) return spent > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, spent / budget));
}

export function Meter({ spent, budget, label }: { spent: number; budget: number; label: string }) {
  const over = spent > budget;
  const p = share(spent, budget);
  return (
    <div
      className={`meter${over ? ' over' : ''}${p === 0 ? ' zero' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(budget, spent)}
      aria-valuenow={spent}
      aria-valuetext={`${formatCents(spent)} of ${formatCents(budget)}${over ? ', over budget' : ''}`}
    >
      <i style={{ ['--p' as string]: p }} />
    </div>
  );
}
