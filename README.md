# FuelShare

FuelShare is an installable, mobile-first web app for sharing one scooter. It tracks refill ownership, estimated fuel remaining, ride costs, member balances, and manual UPI/cash repayments.

## Run locally

Requirements: Node.js 20.9 or newer.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. Without environment variables, FuelShare automatically uses browser local storage so the complete workflow can be tried on one device.

## Enable sharing across phones

1. Create a Supabase project.
2. In Supabase Authentication settings, enable Anonymous Sign-Ins.
3. Run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) in the Supabase SQL editor.
4. Copy `.env.example` to `.env.local` and add the project URL and publishable/anon key.
5. Restart `npm run dev`.

The migration creates the schema, validation triggers, correction audit log, row-level access policies, invite RPCs, and realtime publication. Do not put a Supabase service-role key in the frontend environment.

The production PWA caches its application shell. New rides, refills, and repayments entered while offline are kept on the device, shown as pending, and retried when the app reconnects. Client-generated event IDs make retries idempotent.

## First-use baseline

For a trustworthy starting balance, begin with a near-empty or otherwise known tank and record the full first refill during group setup. The app calculates later usage from the configured mileage, so displayed litres and rupee value are estimates rather than a physical fuel-sensor reading.

## Commands

```powershell
npm test
npm run check
npm run build
```

The ledger implementation and tests are in `src/lib/ledger.ts` and `src/lib/ledger.test.ts`. The agreed product specification is saved in [`docs/product-plan.md`](docs/product-plan.md).
