# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner, on their own iPhone (installed to the Home Screen from Safari) and sometimes a foldable phone unfolded. A personal tool, not a shared or public product: no onboarding funnel, marketing or multi-user concerns. The code lives in a public GitHub repo for GitHub Pages hosting, but all figures stay on the device.

The job: through the month, log each purchase within moments of making it, tick off fixed bills as they are paid, and type in the income actually received; then glance at how much spending budget is left this month (overall and per category), whether the month is on track to meet the savings goal, and where the checking balance stands across the year.

## Product Purpose

A monthly budget tracker for the year that replaces the owner's "Monthly Budget Tracker" spreadsheet and must behave like it: its numbers match the spreadsheet's formulas (recorded in CLAUDE.md and tested). Success means a purchase takes a few taps, the month's budget left is always one glance away, and saved-versus-goal and the checking balance are never in doubt.

## Positioning

It is the owner's own spreadsheet logic, made pocket-sized: income falls back to a planned baseline, an unpaid bill counts toward that month's savings, bills can end on a set month and free up money, and savings carry forward into a running checking balance. Nothing is estimated or synced; every figure traces to amounts the owner entered.

## Operating Context

- Entry happens at registers and on the move, one-handed, often in daylight; review happens at home at month's end or when a bill comes due.
- The year is a run of months starting at a chosen first month. Each month has its own typed income (blank = baseline), bill payments and purchases.
- Fixed bills, spending categories with monthly budgets, and payment methods are the owner's own lists, entered in a first-run setup and edited later under Setup.
- Dollars only, shown as `$1,234.56`; dates as `2/3`.
- Backup is a JSON file exported to Files or email; CSV export of purchases for review elsewhere.

## Capabilities and Constraints

- Installable web app (PWA) in iOS Safari and as a Home Screen app; developed on Windows, no Mac or Xcode.
- Stack: Vite, React 19, TypeScript, IndexedDB via `idb`, `vite-plugin-pwa`, Vitest; plain SVG charts. Ask before adding dependencies.
- Money as integer cents; dates as local `YYYY-MM-DD`, months as `YYYY-MM`. Calculations are a pure, tested module; CLAUDE.md is the behavior authority.
- No network calls after first load; no accounts or backend.
- Hosting: GitHub Pages, deployed by GitHub Actions on push to `main`.
- Interaction decisions carried over from Trip Tracker (confirmed by the owner as "keep the general styling"): no field is focused automatically; list rows do nothing on tap and have a ⋮ button for Edit / Delete; edit sheets end in "Save changes" / "Discard changes"; Undo for about 7 seconds after saving, editing or deleting.

## Brand Commitments

- App name **"Budget Tracker"**, Home Screen short name "Budget".
- Sister app to the owner's Trip Tracker: it keeps Trip Tracker's general styling (rounded system face, flat cards, sheets, floating tab bar, meters, category tiles) but has its own distinct theme so the two never look alike side by side. Red on a meter always means over budget.
- Voice: plain, direct, money-literate. Short labels, no cheerleading.

## Evidence on Hand

- The owner's spreadsheet is the behavioral reference; it stays on the owner's computer and never enters the repo.
- No personal figures may appear anywhere in the repository (code, tests, fixtures, screenshots, docs). Screenshots and demos use made-up figures, labelled as such.

## Product Principles

1. Logging a purchase is the primary act: fast, one-handed, forgiving.
2. The spreadsheet's math is the truth; the app never invents or estimates a figure.
3. The month's standing (budget left, saved vs goal) is visible at a glance; over is unmistakable.
4. The phone is the only place the data lives: offline, private, easy to back up.
5. Calm clarity over decoration.

## Accessibility & Inclusion

Standard good practice: legible contrast in light and dark, tap targets of at least 44px, 16px or larger inputs so iOS does not zoom, color never the only signal for over/under, safe-area handling on iPhone.
