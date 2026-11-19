# Budget Tracker — yearly budget tracker, home-screen web app (PWA)

This file is the spec for the app. Read it fully before writing code, and keep the app consistent with it. If something here conflicts with a request in the chat, ask before changing behavior.

## What the app does

A personal monthly budget tracker for the year, used on my iPhone from the Home Screen. Each month I log my purchases, tick off my fixed bills as I pay them, and type in the income I actually received. The app shows how much of my spending budget is left this month (overall and by category), how much I saved each month against my savings goal, and where my checking balance stands.

It replaces a spreadsheet I built ("Monthly Budget Tracker"), and its numbers must match that spreadsheet's math. It is a sister app to my Trip Tracker and is built the same way.

I'm developing on Windows, so there's no Mac and no Xcode. The app must run as a web app in iOS Safari and as a Home Screen app.

## Privacy rule (important)

**None of my real figures go in this repository**: no income, bills, bill names, balances, card names or purchases, not in code, defaults, tests, fixtures, screenshots or docs. The repo is public (GitHub Pages). The app starts empty and I enter my own numbers on the phone in a first-run setup. Tests use the made-up figures in **Test cases** below.

## Tech

Same stack as Trip Tracker. Keep dependencies minimal and ask before adding any beyond these:

- Vite + React + TypeScript
- `vite-plugin-pwa` (manifest + service worker, so the app works offline)
- `idb` (a small IndexedDB wrapper) for storage
- `vitest` for tests
- Charts as plain SVG components. No chart library.

All data stays on the device in IndexedDB. No accounts, no backend and no network calls after the first load. On first launch, call `navigator.storage.persist()`.

- Money: store dollars as integer cents. Never do money math with floats. Averages round to the nearest cent, halves away from zero.
- Dates: store dates as local `YYYY-MM-DD` strings and months as `YYYY-MM`. Compare them as strings, never with time zones.

## iPhone and Home Screen requirements

- `manifest.webmanifest`: name "Budget Tracker", a short name, `display: standalone`, a theme color, and icons, including a 180×180 `apple-touch-icon`.
- Meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `viewport-fit=cover`. Respect safe-area insets.
- Inputs: 16px or larger text, `inputmode="decimal"` for dollar amounts, thousands commas shown as you type (`4,000`) and ignored when read. Tap targets at least 44px. No field is ever focused automatically.
- One column on a normal phone, two columns from about 700px (unfolded foldable).
- Light mode by default; Dark or System in App settings (a per-device preference).
- **Styling** follows Trip Tracker's `DESIGN.md`: system rounded font, type scale, spacing, card and sheet shapes, tab bar, category tiles, meters where red always means "over" and green "under", hold-and-drag, Undo toast.
- **Theme is its own**, so the two apps never look alike side by side: cool slate neutrals in place of Trip Tracker's warm stone (light background about `#eef1f5`, cards white, ink about `#1e2733`; dark background about `#141922`), a deep navy main color (about `#1f3a5f`; a lighter navy in dark mode) with a teal accent (about `#0f7c86`), and its own Home Screen icon. Over-red and under-green keep their meaning but are tuned for contrast on the new neutrals and must stay clearly different from the main and accent colors. The app gets its own `DESIGN.md` recording these tokens; exact values are settled while building the screens.

## Data model

**Settings** (one record, entered in the first-run setup and editable later under Setup)
- `incomeBaselineCents`: the monthly income the budget is planned on. A month with no income typed in uses this.
- `savingsGoalCents`: the minimum I want to save each month.
- `startingBalanceCents`: checking balance before the first month.
- `firstMonth`: the first month tracked (`YYYY-MM`), chosen in setup (defaults to the current month).
- `paidWith`: my list of payment methods (cards, cash, etc.), editable. Optional on a purchase.
- `customCharts`: the charts I made on Analytics (see **Analytics**): `id`, `title` (optional), `metric`, `groupBy`, `kind`, `range`, and an optional `categoryId`.

**Bill** (fixed monthly bills, my own list): `id`, `name`, `amountCents`, `lastMonth` (optional `YYYY-MM`: the bill ends after this month, e.g. a car loan's final payment), `note` (optional), `cardId` (optional: the credit card this bill pays), `autoPay` (optional: `day` 1–31 and `since` month). Changing a bill's amount applies to every month that has not recorded its own paid amount.

**Category** (spending categories, my own list): `id`, `name`, `budgetCents` (monthly budget), `color`, `hidden` (optional: not offered when adding a purchase). The first-run setup suggests names only (Food, Shopping, Entertainment, Misc) with empty budgets. A deleted category stops being offered but stays on past purchases and in their totals.

**CreditCard** (a debt; my own list, kept in `cards`. The name is from when only cards were tracked): `id`, `kind` (optional: `credit-card` when missing, or `personal-loan`, `student-loan`, `auto-loan`, `other`), `minPaymentCents` (optional: the minimum monthly payment), `dueDay` (optional, 1–31: the day the minimum is due), `name` (also its **Paid with** name, which is how purchases link to it), `aprBps` (APR in hundredths of a percent: 24.99% is 2499), `startBalanceCents` and `startMonth` (what I owed at the start of that month), `limitCents` (optional), `plannedPaymentCents` (optional), `payInFull` (optional: paid off in full every month), `closedMonth` (optional: the account is closed from this month), and `payments`: `id`, `date`, `amountCents`. Adding a credit card adds its name to Paid with (loans are not Paid with names and take no purchases); renaming it renames the Paid with entry and every purchase tagged with it. Removing a card keeps the Paid with name and past purchases.

**Month** (one per tracked month, created when first needed): `month` (`YYYY-MM`), `incomeCents` (optional: the income actually received; blank means the baseline), and per bill a `BillPayment`: `billId`, `datePaid` (optional), `amountPaidCents` (optional), `auto` (recorded by autopay), `skipped` (unmarked on purpose, so autopay leaves the month alone).

**Autopay** (a switch on a bill, with a day of the month and a starting month): when the app is open on or after the autopay day, each active month from the starting month (never before the first tracked month) that has no payment entry yet gets the bill recorded as paid on that day (a short month uses its last day). The bill row says "Autopaid <date>". Unmarking an autopaid bill keeps a `skipped` entry so autopay doesn't put it back; marking it paid again replaces that. Autopaid bills count as paid everywhere, including a linked credit card's payments.

**Purchase**: `id`, `date`, `categoryId`, `amountCents` (all required); `description`, `paidWith`, `note` (optional). Its month is the month of its date.

## Calculations

Put these in a pure TypeScript module (`src/calc.ts`) with no UI code, and test them. Each matches a formula in the spreadsheet.

**Per month**
- **Income** = the month's typed income, or the baseline when blank.
- **Bill status**: *Ended* when the bill's `lastMonth` is set and earlier than this month; otherwise *Paid* when a date paid or an amount paid is entered; otherwise *Unpaid*.
- **Bill counted** = amount paid if entered, else the bill amount, for Paid bills; 0 for Unpaid and Ended.
- **Bills paid** = sum of bills counted. An unpaid bill therefore counts toward that month's savings, as in the spreadsheet. Also show "n unpaid".
- **Spending budget** = sum of category budgets.
- **Spent** = sum of the month's purchases. **Spent by category** likewise; **Left** = budget − spent (can go negative, shown as over).
- **Budget left** = spending budget − spent.
- **Saved** = income − bills paid − spent. **vs goal** = saved − savings goal.
- **Future months** (the month starts after today) show no Saved, vs goal or balance, and are left out of the year figures below.

**Planning figures (Setup)**
- **Left for spending** (per month) = income baseline − bills active that month − savings goal. Warn when the spending budget is more than this.
- **Freed up after bills end** = total of bills that have a last month.

**Year**
- **This month** = the current month, or the first tracked month if today is before it.
- **Saved to date** = sum of Saved over counted months (all started months).
- **Months goal met** = "x of y": months with vs goal ≥ 0, out of counted months.
- **Checking balance**, month by month = starting balance + each month's Saved, carried forward. **Checking balance now** = the latest counted month's, or the starting balance when none.
- **Per category**: this month's spent and left, total for the year, and **average per month** = total ÷ number of started months (at least 1).

## Credit cards (`src/cards.ts`, pure and tested)

Statements are calendar months. For each month from a card's start month through today's: **opening** = last month's closing (the starting balance in the first month); **charges** = purchases paid with the card dated in the month; **payments** = the card's payments dated in the month; **interest**: if the payments cover the opening balance (last statement paid in full) there is none, otherwise (opening − payments) × APR ÷ 12, rounded to the cent, is added when the month ends; **closing** = opening + charges − payments + interest. The month in progress shows what interest would be added if its statement stays unpaid ("Left to avoid interest"). **Payoff estimate**: paying the planned monthly payment (else the average payment so far) every month starting this month, with no new charges, counting each month's interest on what is left (the total paid is shown too); "never" when the payment doesn't beat the monthly interest. **Loans** (personal, student, auto, other) have no purchases, limit, closed or paid-in-full switches: the balance only goes down with payments, and every month's interest is APR ÷ 12 on that month's ending balance (the same rule as a closed card). **Minimum payment**: a debt with a minimum payment gets a fixed bill named "<name> payment" (id `debt:<debt id>`) with that amount, linked to the debt. It is created, renamed and re-amounted when the debt is saved or renamed, and removed with the debt (kept on months where it was paid). Its name, amount and link are set on the Debt tab; autopay, last payment and note can be set on the bill. A card paid in full every month gets no bill. **Due date** (`dueDay`, needs a minimum payment): on that day each month the minimum is recorded automatically. It sets the minimum bill's autopay (that day, starting the month it was set, so earlier months you tracked by hand are not filled in), so the bill shows "Autopaid <date>", the payment is recorded on the debt and the balance drops. Changing the day restarts from the current month; clearing it turns autopay off; unmarking a month keeps it unpaid as for any autopay. The bill's own autopay is not editable in Setup while it belongs to a debt. Marking the bill paid then records the payment on the debt (below). **Linked bills**: a bill can be set (in its Setup editor) to pay a card. Every month that bill is marked paid counts as a payment on the card, for the amount paid (else the bill's amount) and dated the day it was paid, so the balance and interest update automatically; unmarking it takes the payment away. Payments from bills are shown on the card as "From the bill …" and can't be edited there. A card with a linked bill uses that bill's amount for its payoff estimate (unless a planned payment is set). **Closed account** (a switch on the card, with a "Closed since" month): no new purchases can be added to it (it is no longer offered under Paid with on Add, though a past purchase tagged with it keeps it), and from the closed month on, each month's interest is APR ÷ 12 on that month's ending balance, paid or not. Months before it closed keep working as above. **Paid in full every month** (a switch on the card): each finished month's statement counts as paid automatically, so the card never carries interest or a payoff date, and Month's By category list gets a **Credit Card payoff** line: what the pay-in-full cards charged that month. That line is a regrouping of spending already counted in its categories, so it is not added to Spent again. **Pay off balance** (the ⋮ on a debt offers Edit or Pay off balance): records a payment of the amount entered (the balance by default) on the chosen date. Once the balance is zero after a payoff (a loan or closed account also counts once payments clear it), the debt's minimum-payment bill leaves the fixed bills (kept on months where it was paid), and autopay stops recording bills that pay it. If the debt owes again the bill comes back. When the payoff clears the balance, the **interest saved** is stored: the interest the minimum payment (else the linked bills' amount) would still have added if paid every month from this month until gone (shown before confirming, and on the paid-off debt). Card figures do not change the Summary's Saved or budget math, which still match the spreadsheet.

## Screens

**First-run setup** (shown until finished; everything editable later under Setup): income baseline, savings goal, starting checking balance, first month, my bills (name, amount, optional last month), my categories with monthly budgets, and my payment methods. Shows Left for spending live and warns if the budgets add up to more. Nothing is pre-filled except suggested category names.

A bottom tab bar: Analytics, Debt, Overview, Purchases, Setup. The app opens on Overview.

At the top of Overview and Purchases, ‹ period › steps one month (or year) at a time; tapping the period opens a picker with **Month / Year** and a grid to jump to any month (first tracked month to 12 months ahead) or any year, plus This month / This year. Purchases always shows a month.

On Overview (Month and Year views), holding a card and dragging it rearranges the cards (no on-screen hint), with the same motion as Trip Tracker. Each view's order is a per-device preference, not in backups.

1. **Overview, Month view** (opens on This month; this is the old Summary): budget left and spent with a meter, income (tap to enter the actual amount), saved and vs goal, a **Checking balance** card (the starting balance with every started month's income, bills paid and spending applied: balance at the start of the month, + income, − bills paid, − spent, and the balance now or at month end; the same math as Saved, so it matches the Year view), each category's spent / budget / left as meters, and the bills checklist (bills that pay debts of the same type are combined into one row, like "Credit cards", showing "x of y paid" and the total, and open to the individual bills; a type with one bill stays a plain row; Paid / Unpaid / Ended; tapping an unpaid bill marks it paid today, ⋮ to set date or a different amount, or to unmark). The bills card has a **Sort** button (Setup order, Name A to Z, Amount largest first, Unpaid first; a group sorts by its label, total or whether any bill in it is unpaid, and its bills sort the same way; the choice is a per-device preference, not in backups). The **Credit Card payoff** line sits apart from the categories in its own dashed box, with no note.
2. **Overview, Year view**: saved to date, months goal met, checking balance now; a month-by-month table (income, bills paid, spent, budget left, saved, vs goal, balance) and SVG charts (saved per month against the goal, balance over the year, spending by category).
3. **Debt**: credit cards and loans (personal, student, auto, other), with the balance following purchases automatically (see **Credit cards** below). Opens on All debts: owed on all debts, minimums a month and interest a month, then each debt with its balance, minimum payment, interest rate and due date. Holding a debt in the list and dragging it rearranges the debts (a per-device preference, not in backups; the chip rows here and on Analytics follow the same order, and each debt keeps its color). A chip row opens one debt: balance with limit meter, APR, available and limit used; this month's statement with Add a payment; and the payments list. Cards on each view can be rearranged by hold-and-drag (per-device). Add / edit / pay off / remove a debt from this tab. The insights are on Analytics.
4. **Analytics** (a new tab, first in the bar): sections **Money**, **Spending**, **Debt** and **My charts**. Money and Spending take a period (3 months, 6 months, 12 months, All time; always ending with the current month, never before the first tracked month). *Money*: average saved a month, savings rate, months goal met, best and weakest month; income, bills and spending each month; saved each month against the goal; checking balance over time; fixed bills for the next 12 months with when each bill ends and what it frees up. *Spending*: totals and averages (a month, a day, a purchase), biggest category and purchase; by category (a donut); categories month by month (stacked); spending against the budget; this month's pace against an even pace of the budget; paid with; day of the week; biggest purchases. *Debt*: the old Debt insights, moved here: All debts (owed, total balance over time, interest, which to pay down first by APR) and, per debt, payoff estimate with what-ifs, balance over time, spending, interest and payments, spending by category and a month-by-month table. *My charts*: charts I make myself: pick what to **measure** (spending, number of purchases, income, bills paid, saved, checking balance, debt owed, debt interest), how to **group** it (by month, category, paid with or weekday; only spending and purchase counts can be grouped by anything but month), a **style** (bars, line or a share donut; a share needs groups other than month, and a line needs month or weekday), a period, and optionally one category. A title is optional. Charts are kept in the settings (so they are in backups), can be edited or deleted (with Undo), and show a live preview while being made. All charts are plain SVG.
5. **Adding a purchase** (there is no Add tab: the **+** at the top right of Purchases opens it in a sheet): a purchase in a few taps: amount, category tiles, date (today by default), optional description, paid with and note. Shows the category's left this month as you type. Paid with a credit card, it also shows that card's balance counting the purchase. Offers the categories chosen under Setup, plus **New category** (name and budget) which joins the list and is selected.
6. **Purchases**: the **+** at the top right (see above); the month's purchases grouped by day with day totals, search and filter (category, paid with, amount range), ⋮ for Edit / Delete with Undo for about 7 seconds, as in Trip Tracker.
7. **Setup**: the settings, bills, categories and payment methods, Left for spending and Freed up figures, plus App settings (theme, backup, CSV export, delete all data). Every entry is editable: tap a bill, category or Paid with name (rename updates past purchases and a card of the same name; category color; bill note). Under the categories, **Show when adding a purchase** picks which categories the + offers (at least one); a hidden category keeps its budget and still shows on Overview.

## Backup

JSON backup of everything (settings, bills, categories, months, purchases) that I export to Files or email and can restore; CSV export of purchases. Backup files never go in the repo.

## Test cases (must pass, in Vitest)

Made-up figures only (see **Privacy rule**). "Today" is 2027-02-15.

Settings: baseline $3,000.00, savings goal $500.00, starting balance $2,000.00, first month 2027-01.
Bills: Rent $1,200.00; Phone $50.00; Gym $30.00, last month 2027-01.
Categories: Food $400.00, Fun $100.00, Other $50.00 (spending budget $550.00).

January 2027 (income blank): Rent paid 01-01; Phone paid 01-05 with amount paid $55.20; Gym unpaid. Purchases: Food $120.50, Food $60.25, Fun $45.00, Other $10.00.
February 2027 (income $1,800.00): Rent paid 02-01; Phone unpaid; Gym (ended). Purchases: Food $450.00, Fun $20.00.

Expected:
- Jan: income $3,000.00; statuses Paid / Paid / Unpaid ("1 unpaid"); bills paid $1,255.20; spent $235.75; by category Food $180.75 (left $219.25), Fun $45.00 (left $55.00), Other $10.00 (left $40.00); budget left $314.25; saved $1,509.05; vs goal +$1,009.05; balance $3,509.05.
- Feb: income $1,800.00; statuses Paid / Unpaid / Ended ("1 unpaid"); bills paid $1,200.00; spent $470.00; Food $450.00 (left −$50.00, over); budget left $80.00; saved $130.00; vs goal −$370.00; balance $3,639.05.
- Mar: a future month: saved, vs goal and balance are blank.
- Left for spending: Jan $1,220.00, Feb $1,250.00. Spending budget $550.00 is under both (no warning). Freed up after bills end $30.00.
- Cards (made-up Test Visa: APR 24%, start balance $1,000.00 in 2027-01, payments $300.00 on 01-20 and $964.00 on 02-10; purchases $250.00 in Jan, $100.00 in Feb, $40.00 in Mar; today 2027-03-15): Jan interest $14.00 and closing $964.00; Feb paid in full, no interest, closing $100.00; Mar (in progress) closing $140.00 with $2.00 projected interest; payoff at $50.00 a month is 3 payments ending 2027-05 with $2.64 of interest.
- Linked bill (made-up Old Card: APR 24%, start balance $1,000.00 in 2027-01, no purchases; a $200.00 bill linked to it, paid 01-05 for $200.00 and 02-06 with $250.00 paid, unpaid in Mar; today 2027-03-15): Jan interest $16.00, closing $816.00; Feb interest $11.32, closing $577.32; Mar closing $577.32; payoff at the bill's $200.00 is 3 payments ending 2027-05 with $11.25 of interest. Unmarking a month removes its payment.
- Closed card (made-up: APR 24%, start balance $1,000.00 in 2027-01, closed since 2027-01, a $300.00 payment on 01-20, nothing else; today 2027-03-15): Jan interest $14.00, closing $714.00; Feb nothing paid, interest $14.28, closing $728.28; Mar (in progress) closing $728.28 with $14.57 projected interest.
- Loan (made-up Car loan: auto loan, APR 6%, start balance $10,000.00 in 2027-01, minimum $300.00, a $300.00 payment on 01-10, nothing else; today 2027-03-15): Jan interest $48.50 (on the $9,700.00 left), closing $9,748.50; Feb nothing paid, interest $48.74, closing $9,797.24. Purchases tagged "Car loan" are ignored. The minimum makes a fixed bill "Car loan payment" of $300.00.
- Interest saved: paying off $140.00 at 24% with a $50.00 minimum would take 3 payments and $2.64 of interest, so $2.64 is saved. Paid-off debts lose their minimum bill, which returns if the debt owes again; autopay skips bills linked to a paid-off debt.
- Analytics (the main test case; today 2027-02-15): money flow per month is Jan income $3,000.00, bills $1,255.20, spent $235.75, saved $1,509.05, balance $3,509.05 and Feb $1,800.00, $1,200.00, $470.00, $130.00, $3,639.05; over both months saved totals $1,639.05, averages $819.53 a month (halves round up), 34% of income, goal met 1 of 2, best month Jan, weakest Feb. Spending over both months by category: Food $630.75, Fun $65.00, Other $10.00; average per month $352.88; per day $15.34 over the 46 days so far; average purchase $117.63; largest is Food $450.00. Fixed bills ahead from 2027-01: $1,280.00, then $1,250.00 once Gym ends. A chart that can't work (Income by category, a share by month, a line by category) explains why and can't be saved.
- Sorting bills: with Rent (paid), Gym (ended), a credit card payment (unpaid, $20.00) and a credit card payment (paid $45.00) and Phone (unpaid, $50.00), Name sorts the "Credit cards" group among them by that label ignoring case, Amount puts Rent first and the group ($65.00) above Phone, and Unpaid first puts the group (it has an unpaid bill) and Phone before Rent and the ended Gym.
- Combined debt bills: bills linked to two credit cards and one auto loan show as a "Credit cards" row (2 bills, "1 of 2 paid" with one paid, total = amount paid for paid ones + amount for unpaid ones, ended ones excluded) and a plain Car loan bill; a lone credit card bill is a plain row.
- Due date (made-up Car loan: minimum $300.00, due day 15, bill autopay since 2027-01, today 2027-02-14): only Jan is recorded (paid 01-15); on 02-15 Feb is recorded too, and both show as payments on the loan. Changing the due day restarts autopay from the current month.
- Pay in full (same Test Visa with the switch on and no payments entered): Jan closing $250.00 (the $1,000.00 start and Jan's charges are paid, no interest), Feb closing $100.00, Mar closing $140.00; Credit Card payoff is $250.00 for Jan and $40.00 for Mar.
- Autopay (Rent $1,200.00, autopay day 5 since 2027-01, no payments entered; today 2027-02-15): Jan and Feb are each recorded paid on the 5th; on 2027-02-04 only Jan is. Day 31 in Feb 2027 is the 28th. A month already holding a payment or a skipped entry is left alone.
- Year: this month Feb 2027 (spent $470.00, budget left $80.00); saved to date $1,639.05; months goal met "1 of 2"; checking balance now $3,639.05.
- Category averages over 2 started months: Food $315.38 (total $630.75), Fun $32.50, Other $5.00.
- With today 2026-12-10 (before the first month): this month is Jan 2027, no months counted, months goal met "0 of 0", balance now $2,000.00.

## Hosting

GitHub Pages, deployed by a GitHub Actions workflow on every push to `main`, as in Trip Tracker. Vite's `base` is the repository name. Served over HTTPS.

## How to work

- I'm on Windows using PowerShell. Give commands that work there.
- Build in small, runnable steps. After each step, run the tests and the build, then tell me exactly what to check. For phone testing, run the dev server with `--host` and give me the address to open in Safari on the same Wi-Fi.
- Use `npx tsc --noEmit -p tsconfig.json` for type checks (not `tsc -b`).
