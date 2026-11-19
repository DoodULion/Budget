/** Plain SVG charts for the Analytics tab. No chart library: each is a few paths and rects. */
import { formatCents, type MonthKey } from './calc';

const W = 340;
const H = 160;
const PAD = { l: 42, r: 8, t: 12, b: 22 };

/** Compact dollars for axes: $1.2k, $850, −$300. */
export function compact(cents: number): string {
  const d = Math.round(cents / 100);
  const abs = Math.abs(d);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${abs}`;
  return d < 0 ? `−${s}` : s;
}

const plain = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v));
const axis = (money: boolean) => (money ? compact : plain);
const full = (money: boolean) => (money ? formatCents : (v: number) => String(v));

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Jan", with the year after a January or at the start so a long range stays readable. */
export function monthTick(month: MonthKey, first: boolean): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return first || month.endsWith('-01') ? `${name} ’${month.slice(2, 4)}` : name;
}

/** Which labels to show: all when few, otherwise about every k-th so they don't collide. */
function showEvery(n: number, max = 8): number {
  return Math.max(1, Math.ceil(n / max));
}

/** Nice-ish round top value for the axis. */
function niceTop(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (v <= m * pow) return m * pow;
  return v;
}

export interface Series {
  name: string;
  values: number[];
  /** A CSS class: s0 … s3 (see index.css). */
  cls: string;
}

function scale(all: number[], includeZero = true) {
  const max = Math.max(...all, includeZero ? 0 : -Infinity);
  const min = Math.min(...all, includeZero ? 0 : Infinity);
  const top = max > 0 ? niceTop(max) : 0;
  const bottom = min < 0 ? -niceTop(-min) : 0;
  const span = top - bottom || 1;
  const yOf = (v: number) => PAD.t + ((top - v) / span) * (H - PAD.t - PAD.b);
  return { top, bottom, yOf };
}

function YAxis({ top, bottom, yOf, money }: { top: number; bottom: number; yOf: (v: number) => number; money: boolean }) {
  const f = axis(money);
  return (
    <>
      <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top)} y2={yOf(top)} />
      <text x={PAD.l - 6} y={yOf(top) + 4} textAnchor="end">{f(top)}</text>
      {top > 0 && bottom === 0 && (
        <>
          <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(top / 2)} y2={yOf(top / 2)} />
          <text x={PAD.l - 6} y={yOf(top / 2) + 4} textAnchor="end">{f(top / 2)}</text>
        </>
      )}
      <line className="zero" x1={PAD.l} x2={W - PAD.r} y1={yOf(0)} y2={yOf(0)} />
      <text x={PAD.l - 6} y={yOf(0) + 4} textAnchor="end">{f(0)}</text>
      {bottom < 0 && <text x={PAD.l - 6} y={yOf(bottom) + 4} textAnchor="end">{f(bottom)}</text>}
    </>
  );
}

function Legend({ series }: { series: Pick<Series, 'name' | 'cls'>[] }) {
  if (series.length < 2) return null;
  return (
    <p className="chart-key">
      {series.map((s) => (
        <span key={s.name}>
          <i className={`k ${s.cls}`} />
          {s.name}
        </span>
      ))}
    </p>
  );
}

const describe = (labels: string[], series: Series[], money: boolean) => series.map((s) => `${s.name}: ${labels.map((l, i) => `${l} ${full(money)(s.values[i] ?? 0)}`).join(', ')}`).join('. ');

/** Bars per label, one per series side by side (a single series is plain bars). Negative values hang below zero. */
export function Columns({ labels, series, money = true, label, goal }: { labels: string[]; series: Series[]; money?: boolean; label: string; goal?: number }) {
  if (labels.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  const { top, bottom, yOf } = scale([...series.flatMap((s) => s.values), goal ?? 0]);
  const slot = (W - PAD.l - PAD.r) / labels.length;
  const group = Math.min(slot * 0.8, 36 * series.length);
  const bw = group / series.length;
  const every = showEvery(labels.length);
  return (
    <>
      <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${describe(labels, series, money)}`}>
        <YAxis top={top} bottom={bottom} yOf={yOf} money={money} />
        {labels.map((l, i) => {
          const x0 = PAD.l + slot * i + (slot - group) / 2;
          return (
            <g key={`${l}-${i}`}>
              {series.map((s, j) => {
                const v = s.values[i] ?? 0;
                if (v === 0) return null;
                return <rect key={s.name} className={`bar ${s.cls}${v < 0 && series.length === 1 ? ' neg' : ''}`} x={x0 + bw * j + (series.length > 1 ? 0.5 : 0)} width={Math.max(2, bw - (series.length > 1 ? 1 : 0))} y={Math.min(yOf(v), yOf(0))} height={Math.max(1.5, Math.abs(yOf(v) - yOf(0)))} rx={2.5} />;
              })}
              {i % every === 0 && <text x={PAD.l + slot * i + slot / 2} y={H - 5} textAnchor="middle">{l}</text>}
            </g>
          );
        })}
        {goal !== undefined && goal > 0 && <line className="goal" x1={PAD.l} x2={W - PAD.r} y1={yOf(goal)} y2={yOf(goal)} />}
      </svg>
      <Legend series={series} />
    </>
  );
}

/** Stacked bars: each label's bar is split into the series (e.g. categories) it is made of. */
export function Stacked({ labels, series, label }: { labels: string[]; series: Series[]; label: string }) {
  if (labels.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const { top, bottom, yOf } = scale(totals);
  const slot = (W - PAD.l - PAD.r) / labels.length;
  const bw = Math.min(slot * 0.65, 34);
  const every = showEvery(labels.length);
  return (
    <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${labels.map((l, i) => `${l} ${formatCents(totals[i])}`).join(', ')}`}>
      <YAxis top={top} bottom={bottom} yOf={yOf} money />
      {labels.map((l, i) => {
        const x = PAD.l + slot * i + (slot - bw) / 2;
        let run = 0;
        return (
          <g key={`${l}-${i}`}>
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              if (v <= 0) return null;
              const y1 = yOf(run + v);
              const y0 = yOf(run);
              run += v;
              return <rect key={s.name} className={`bar ${s.cls}`} x={x} width={bw} y={y1} height={Math.max(1, y0 - y1)} />;
            })}
            {i % every === 0 && <text x={PAD.l + slot * i + slot / 2} y={H - 5} textAnchor="middle">{l}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** One or more lines over the same labels. A dashed reference line (a goal, a pace) is optional. */
export function Lines({ labels, series, money = true, label, ref }: { labels: string[]; series: Series[]; money?: boolean; label: string; ref?: { name: string; values: number[] } }) {
  if (labels.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  const { top, bottom, yOf } = scale([...series.flatMap((s) => s.values), ...(ref?.values ?? [])]);
  const slot = (W - PAD.l - PAD.r) / labels.length;
  const xOf = (i: number) => PAD.l + slot * i + slot / 2;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const every = showEvery(labels.length);
  const dots = labels.length <= 16;
  return (
    <>
      <svg className="ychart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${describe(labels, series, money)}`}>
        <YAxis top={top} bottom={bottom} yOf={yOf} money={money} />
        {ref && <path className="goal" d={path(ref.values)} />}
        {series.map((s) => (
          <g key={s.name} className={s.cls}>
            <path className="line" d={path(s.values)} />
            {dots && s.values.map((v, i) => <circle key={i} className="dot" cx={xOf(i)} cy={yOf(v)} r={3.2} />)}
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 ? <text key={`${l}-${i}`} x={xOf(i)} y={H - 5} textAnchor="middle">{l}</text> : null))}
      </svg>
      <Legend series={ref ? [...series, { name: ref.name, cls: 'k-ref' }] : series} />
    </>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** A category color token (c1…c8); else colors cycle through the palette. */
  color?: string;
}

const PALETTE = ['c3', 'c5', 'c1', 'c4', 'c6', 'c2', 'c7', 'c8'];
export const sliceColor = (s: Slice, i: number) => `var(--cat-${s.color ?? PALETTE[i % PALETTE.length]})`;

/** A donut of shares with a legend giving each amount and percent. Many small slices are rolled into "Other". */
export function Donut({ slices, money = true, label, max = 6 }: { slices: Slice[]; money?: boolean; label: string; max?: number }) {
  const pos = slices.filter((s) => s.value > 0);
  if (pos.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  let shown = pos;
  if (pos.length > max) {
    const rest = pos.slice(max - 1);
    shown = [...pos.slice(0, max - 1), { key: '__rest', label: `${rest.length} others`, value: rest.reduce((s, x) => s + x.value, 0), color: 'c8' }];
  }
  const total = shown.reduce((s, x) => s + x.value, 0);
  const R = 15.9155; // circumference 100
  let offset = 25; // start at 12 o'clock
  const f = full(money);
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 42 42" role="img" aria-label={`${label}. ${shown.map((s) => `${s.label} ${f(s.value)}`).join(', ')}`}>
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--field)" strokeWidth="6" />
        {shown.map((s, i) => {
          const pct = (s.value / total) * 100;
          const el = <circle key={s.key} cx="21" cy="21" r={R} fill="none" stroke={sliceColor(s, i)} strokeWidth="6" strokeDasharray={`${Math.max(0, pct - (shown.length > 1 ? 0.8 : 0)).toFixed(2)} ${(100 - pct + (shown.length > 1 ? 0.8 : 0)).toFixed(2)}`} strokeDashoffset={offset.toFixed(2)} />;
          offset -= pct;
          return el;
        })}
        <text x="21" y="22.5" textAnchor="middle" className="donut-total">{money ? compact(total) : plain(total)}</text>
      </svg>
      <ul className="dlegend">
        {shown.map((s, i) => (
          <li key={s.key}>
            <i style={{ background: sliceColor(s, i) }} />
            <span>
              {s.label}
              <small>{Math.round((s.value / total) * 100)}%</small>
            </span>
            <b>{f(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, largest first, for comparing groups. */
export function HBars({ items, money = true, label }: { items: Slice[]; money?: boolean; label: string }) {
  if (items.length === 0) return <p className="empty-line">Nothing to chart yet.</p>;
  const top = Math.max(1, ...items.map((i) => i.value));
  const f = full(money);
  return (
    <ul className="hbars" aria-label={label}>
      {items.map((it, i) => (
        <li key={it.key}>
          <span className="hb-name">{it.label}</span>
          <span className="hb-track">
            <span className="hb-fill" style={{ width: `${Math.max(2, (Math.max(0, it.value) / top) * 100)}%`, background: sliceColor(it, i) }} />
          </span>
          <b>{f(it.value)}</b>
        </li>
      ))}
    </ul>
  );
}
