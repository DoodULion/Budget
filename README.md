# Budget Tracker

A personal monthly budget tracker for the year, installable on an iPhone Home Screen. Everything is stored on the device; there is no account or server, and no personal figures live in this repository. See `CLAUDE.md` for the full spec.

## Run it while developing (PowerShell)

```powershell
npm install
npm run dev -- --host   # open the "Network" address in Safari on the same Wi-Fi
npm test                # calculation, input and backup tests
npm run build           # type-check and build into dist/
```

## Code map

- `src/calc.ts`: all budget math (months, bills, categories, saved, year figures), pure and tested in `src/calc.test.ts`.
- `src/money.ts`: dollar input parsing and dates.
- `src/backup.ts`: JSON backup and CSV export.
- `src/db.ts`: on-device storage (IndexedDB).
- `src/theme.ts`, `src/index.css`: light / dark / system appearance and the theme colors.

## Icons

The PNG icons in `public/icons/` are rendered from `scripts/icon.svg` with `node scripts/render-icons.mjs` (needs Playwright installed globally).
