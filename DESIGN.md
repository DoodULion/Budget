# Design System: Budget Tracker

Sister app to Trip Tracker. It keeps Trip Tracker's styling (shapes, type, components, motion) and swaps in its own theme so the two never look alike side by side. Mode: Operate. A tool you use one-handed at a register and review at home; calm, familiar, precise.

## Colors

Restrained: cool slate neutrals, one navy main color for actions and selection, teal for money still on budget, red only for over. Tokens live in `src/index.css` on `:root` (light, the default) and `:root[data-theme="dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#eef1f5` | `#11161e` | Page ground (slate) |
| `--sign` | `#ffffff` | `#1b222d` | Cards, fields, chips |
| `--field` | `#e6ebf1` | `#27303d` | Inset panels, meter track base |
| `--ink` | `#1e2733` | `#e8edf4` | Text |
| `--mute` | `#536072` | `#9fabbb` | Secondary text (≥4.5:1 on cards) |
| `--line` | `#d9e0e8` | `#303a48` | Hairlines, field borders |
| `--or` (main) | `#1f3a5f` navy | `#a9c4ea` | Primary buttons, picked chips, paid checkboxes, tab bar outline, focus |
| `--teal` | `#0b7480` | `#43c7cf` | Meter fills on budget, active tab icon, goal-met bars |
| `--red` | `#c8331b` | `#ff7a5c` | Over budget, lost money, destructive actions |
| `--good` | `#136b3c` | `#5fd39a` | Positive vs goal, Goal met pill |
| `--cat-c1…c8` | orange, magenta, blue, violet, green, amber, rose, slate | lighter twins | Category tiles and Year bars |

Rules: red always means over and is never decorative; an over meter is striped red so color is not the only signal; teal and navy never stand in for red or green.

## Typography

System rounded face (`ui-rounded`, SF Pro Rounded on iPhone), tabular numerals everywhere. One family. Weights 600 / 700 / 800. Scale: hero figure 3.4rem, big figure 2.2rem, band title 1.45rem, card heading 1.25rem, body 1rem, labels 0.85rem, chart labels 11px. Figures shrink to fit their column (`.fig`, `.big.fit` with `--chars`).

## Layout

One column on a phone; two columns from 700px (`.cols`, `.setup-grid`, `.add-form`, `.day-groups`). Content max 868px. 16px side gutter plus safe-area insets. Only `<main>` scrolls; the band and floating tab bar stay put.

## Shapes and depth

Radii: hero 28px, card 22px, row 16px, control 14px, pills 999px. Cards are flat white on slate (a 1px inset line in dark). One shadow (`--float`) for things that float: tab bar, sheets, Undo toast, the first-run Start bar.

## Components

- **Band**: month or year stepper (‹ title ›) with "This month" or "Back to this month".
- **Hero card**: Budget left with meter and three figures; turns solid red when over.
- **Meter**: 12px track, teal fill, red stripes when over.
- **Bills checklist**: 30px checkbox (navy when paid, dashed when ended), name, status line, amount, ⋮ for date and amount paid.
- **Category row**: tile, name with "spent of budget", left or over, slim meter.
- **Chips**: category tiles and payment methods; picked chip is navy.
- **Sheets**: rise from the bottom; end in "Save changes" / "Discard changes"; destructive steps confirm.
- **Undo toast**: ink panel above the tab bar for about 7 seconds.
- **Year charts**: plain SVG. Saved per month as bars against a dashed goal line (teal met, pale teal under, red lost); balance as a navy line with dots; category totals as bars in category colors. Each chart has a text alternative.

## Motion

Same as Trip Tracker: tab pages slide 300ms, sheets rise 420ms on a spring curve, presses scale to 0.92–0.97. Reduced motion turns all of it off.
