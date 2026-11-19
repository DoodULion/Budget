# Design System: Budget Tracker

Sister app to Trip Tracker. It keeps Trip Tracker's styling (shapes, type, components, motion) and swaps in its own theme so the two never look alike side by side. Mode: Operate. A tool you use one-handed at a register and review at home; calm, familiar, precise.

## Colors

Theme "Fare card" (chosen 2026-11-19, replacing slate / navy / teal). The idea: your monthly budget is a transit pass you spend down, one purchase at a time. Committed shell, restrained content: the top band and the tab bar are solid cobalt; the content sits on cool blue-grey with white cards; the one headline balance on each screen is printed on a sunflower pass with a magnetic stripe. Red only for over, green only for under. Tokens live in `src/index.css` on `:root` (light, the default) and `:root[data-theme="dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#edf0f7` | `#0d1124` | Page ground (cool blue-grey) |
| `--sign` | `#ffffff` | `#171c35` | Cards, fields, chips |
| `--field` | `#e3e7f2` | `#232a4a` | Inset panels, meter track base |
| `--ink` | `#131a35` | `#eef0fa` | Text |
| `--mute` | `#4c5474` | `#a2a9c8` | Secondary text (≥4.5:1 on cards) |
| `--line` | `#d6dbea` | `#2a3156` | Hairlines, field borders |
| `--shell` / `--on-shell` | `#1d348f` / white | `#16224f` / white | Top band (under the status bar too) and tab bar; also the status-bar `theme-color` |
| `--or` (main) | `#2440b3` cobalt | `#8fa3ff` | Primary buttons, picked chips, paid checkboxes, focus, balance line |
| `--fill` | `#2440b3` | `#8fa3ff` | Meter fills on budget, goal-met bars, switches |
| `--gold` / `--on-gold` | `#f6c833` / `#131a35` | `#f2c443` / `#131a35` | The pass (hero cards) and the picked tab |
| `--s0…s3` | cobalt, slate `#6b7499`, amber `#c98a00`, magenta | lighter twins | Chart series (income, bills, spending, a fourth) |
| `--red` | `#c42d1a` | `#ff7a5c` | Over budget, lost money, destructive actions |
| `--good` | `#13723c` | `#5fd39a` | Positive vs goal, Goal met pill |
| `--cat-c1…c8` | orange, magenta, sky, violet, green, amber, rose, slate | lighter twins | Category tiles and category bars |

Rules: red always means over and is never decorative; an over meter is striped red so color is not the only signal; cobalt and sunflower never stand in for red or green. Sunflower is reserved for the pass and the picked tab: no other surface or text uses it. Category sky (`c3`) stays clearly bluer-green than cobalt so a category bar never reads as a meter fill.

### The pass (signature)

Every `.hero` card (Budget left, Saved in the year, Owed on all debts, a debt's balance, Analytics' headline stats) is the pass: sunflower ground, `--on-gold` ink for every figure and label, a 12px ink magnetic stripe 14px from the top edge, and its meter in ink on a darker sunflower track. Over budget, the pass turns solid red and keeps its stripe.

## Typography

System rounded face (`ui-rounded`, SF Pro Rounded on iPhone), tabular numerals everywhere. One family. Weights 600 / 700 / 800. Scale: hero figure 3.4rem, big figure 2.2rem, band title 1.45rem, card heading 1.25rem, body 1rem, labels 0.85rem, chart labels 11px. Figures shrink to fit their column (`.fig`, `.big.fit` with `--chars`).

## Layout

One column on a phone; two columns from 700px (`.cols`, `.setup-grid`, `.add-form`, `.day-groups`). Content max 868px. 16px side gutter plus safe-area insets. Only `<main>` scrolls; the band and floating tab bar stay put.

## Shapes and depth

Radii: hero 28px, card 22px, row 16px, control 14px, pills 999px. Cards are flat white on blue-grey (a 1px inset line in dark). One shadow (`--float`) for things that float: tab bar, sheets, Undo toast, the first-run Start bar.

## Components

- **Band**: solid `--shell` cobalt edge to edge, white text, translucent white round buttons. On Overview and Purchases, a month or year stepper (‹ title ›) with "This month"; on Analytics, Debt and Setup, which don't follow the period, the tab's name in the same place. The visible page title below the band is only on Purchases (with its + button).
- **Hero card (the pass)**: Budget left with meter and three figures, printed on the sunflower pass (see Colors); turns solid red when over.
- **Meter**: 12px track (a faint cobalt tint, so the empty part never reads as a second value), `--fill` cobalt, red stripes when over; ink on the pass.
- **Bills checklist**: 30px checkbox (cobalt when paid, dashed when ended), name, status line, amount, ⋮ for date and amount paid.
- **Category row**: tile, name with "spent of budget", left or over, slim meter.
- **Chips**: category tiles, payment methods and periods; picked chip is cobalt.
- **Segmented control** (`.seg`): a tinted track with a raised card-colored pill for the choice. Used for switching views or sections (Analytics sections, Month / Year, Appearance), never for picking data, so it stays distinct from chips.
- **Sheets**: rise from the bottom; end in "Save changes" / "Discard changes"; destructive steps confirm.
- **Tab bar**: floating cobalt `--shell` pill; tabs in translucent white, the picked tab punched out in sunflower with ink label and icon.
- **Undo toast**: ink panel above the tab bar for about 7 seconds.
- **Year charts**: plain SVG. Saved per month as bars against a dashed goal line (cobalt met, pale cobalt under, red lost); balance as a cobalt line with dots; category totals as bars in category colors. Each chart has a text alternative.

## Motion

Same as Trip Tracker: tab pages slide 300ms, sheets rise 420ms on a spring curve, presses scale to 0.92–0.97. Reduced motion turns all of it off.
