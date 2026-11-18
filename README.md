# CKNITZ ERP

Job-work production and payment tracking for CKNITZ, rebuilt from the Google Sheets ERP.

- `apps/web/index.html` - single-page ERP (dashboard, lots, workers & ledger, master control). Runs as a hosted page with a shared document database.
- `apps/api` - TypeScript calculation engine (`src/domain/calculations.ts`), Drizzle + Postgres schema (`src/db/schema.ts`), 40 Vitest tests.

## Run the tests
```
cd apps/api && npm install && npx vitest run
```

## Fixes over the old sheet
- Penalty used Std Avg (grams) instead of Delay Days, so it always hit the 2000 cap.
- Deadline Risk compared penalty rupees to days.
- Ledger total is summed from all lots, so no worker is skipped.

Copy `apps/api/.env.example` to `.env` and set `DATABASE_URL` before using the API.
