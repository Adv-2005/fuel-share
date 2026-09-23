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
3. Run the SQL files in [`supabase/migrations`](supabase/migrations) in numeric order in the Supabase SQL editor.
4. Copy `.env.example` to `.env.local` and add the project URL and publishable/anon key.
5. Restart `npm run dev`.

The migrations create the schema, validation triggers, correction audit log, row-level access policies, invite RPCs, and realtime publication. Do not put a Supabase service-role key in the frontend environment.

When a refill reaches the brim, select **Filled the tank completely**. FuelShare uses the purchased litres and configured tank capacity to reset estimation drift while keeping previously accounted fuel from being charged twice.

The production PWA caches its application shell. New rides, refills, and repayments entered while offline are kept on the device, shown as pending, and retried when the app reconnects. Client-generated event IDs make retries idempotent.

## First-use baseline

Group setup records an opening tank balance before normal rides and refills. Start with an empty tank, estimate the petrol already present, or invite members before finishing setup. Existing petrol can belong to one member, be split equally among selected members, or be tracked as non-reimbursable shared opening fuel. A full first refill is not required.

The app calculates later usage from the configured mileage, so displayed litres, price, and rupee value remain estimates rather than a physical fuel-sensor reading. Opening-balance corrections keep an audit record and are rejected if they would make the historical tank overflow or underflow.

## Commands

```powershell
npm test
npm run check
npm run build
```

The ledger implementation and tests are in `src/lib/ledger.ts` and `src/lib/ledger.test.ts`. The agreed product specification is saved in [`docs/product-plan.md`](docs/product-plan.md).
