# FuelShare product plan

FuelShare is a mobile-first shared scooter-petrol ledger for a trusted group of roughly six people. Every refill, ride, and repayment is recorded as a small event. The app derives how much petrol and value remain, who funded it, who consumed it, and the smallest practical list of repayments.

## Product rules

- A refill records its payer, amount paid, pump price, calculated litres, and time. It creates a payer-owned fuel batch.
- A refill marked as full calibrates the estimated pre-refill balance from the tank capacity and actual pump litres.
- A ride records its rider and kilometres. It consumes fuel using the scooter mileage captured at the time of that ride.
- Fuel is consumed from refill batches oldest-first, preserving the actual price of the petrol used.
- A member consuming fuel they purchased creates no debt. Other consumption credits the batch owner and debits the rider.
- UPI and cash repayments adjust member balances. The app nets those balances into minimal suggested transfers.
- Money is stored in paise, volume in millilitres, and distance in metres.
- Backdated additions or corrections are rejected when they would make the calculated tank negative or exceed capacity.
- Corrections retain their previous values in a visible revision history.

## First release

- Installable Next.js PWA for phones.
- Invite-link membership with an anonymous per-device identity and display name.
- Supabase Postgres, row-level security, anonymous authentication, and realtime refresh.
- Local browser mode when Supabase is not configured.
- Known-refill onboarding, quick ride/refill forms, settlement recording, dashboard, activity, member balances, and scooter settings.
- One group and one scooter per active device in the initial UI.

## Deferred

GPS and odometer integrations, payment processing, automatic fuel-price lookup, maintenance expenses, notifications, multiple-vehicle switching, and production-grade account recovery are intentionally outside the first release.
