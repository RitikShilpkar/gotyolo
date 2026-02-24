# Debug Section — Intentional Bugs, Corruption Analysis, and Fixes

---

## Bug 1 — Overbooking via Missing Row Lock

### Location
`src/services/bookingService.ts` — `createBookingService()`

### What Was Changed (the bug)

```diff
- const trip = await findTripByIdForUpdate(data.trip_id, tx);
+ // BUG: plain read — no exclusive lock acquired
+ const trip = await findTripById(data.trip_id);
```

`findTripByIdForUpdate` runs:
```sql
SELECT * FROM trips WHERE id = $1 FOR UPDATE
```

`findTripById` runs:
```sql
SELECT * FROM trips WHERE id = $1
-- no FOR UPDATE → no lock
```

### Why Data Becomes Inconsistent

Without the lock, concurrent transactions proceed in parallel:

```
Time  Tx A (2 seats)          Tx B (2 seats)         DB: available_seats = 2
──────────────────────────────────────────────────────────────────────────────
t1    BEGIN                   BEGIN
t2    READ available_seats=2                           2
t3                            READ available_seats=2   2   ← both see 2
t4    check: 2 >= 2 ✓         check: 2 >= 2 ✓
t5    UPDATE seats = 2-2 = 0                           0
t6    INSERT booking A        UPDATE seats = 0-2 = -2  -2  ← OVERBOOKED
t7    COMMIT                  INSERT booking B
t8                            COMMIT
```

**Result:** `available_seats = -2`. Two bookings exist for a trip that only had 2 seats. A third booking would still be blocked (negative check fails), but the data is already corrupt.

### Secondary Symptom
Switching from `findTripByIdForUpdate` (raw SQL → snake_case properties) to `findTripById` (Prisma ORM → camelCase properties) also broke property access (`trip.start_date` → `trip.startDate`, `trip.available_seats` → `trip.availableSeats`). TypeScript caught this immediately — a secondary benefit of strict typing.

### Fix

```diff
- import {
-   decrementAvailableSeats,
-   findTripById,
- } from "../repositories/tripRepository";
+ import {
+   findTripByIdForUpdate,
+   decrementAvailableSeats,
+   findTripById,
+ } from "../repositories/tripRepository";

  const booking = await prisma.$transaction(async (tx) => {
-   // BUG: plain read — no exclusive lock acquired
-   const trip = await findTripById(data.trip_id);
+   // FIX: SELECT FOR UPDATE serialises all booking attempts for this trip
+   const trip = await findTripByIdForUpdate(data.trip_id, tx);

    ...

-   if (new Date(trip.startDate) <= new Date()) {
+   if (new Date(trip.start_date) <= new Date()) {
-   if (trip.availableSeats < data.num_seats) {
+   if (trip.available_seats < data.num_seats) {
-       `Only ${trip.availableSeats} seat(s) available`,
+       `Only ${trip.available_seats} seat(s) available`,
```

### Prevention
- Code review policy: any seat decrement must be paired with a `FOR UPDATE` read in the same transaction
- Integration test: fire 50 concurrent booking requests for a trip with 1 seat, assert `available_seats >= 0` and exactly 1 CONFIRMED booking exists

---

## Bug 2 — Refund Overcalculation (Sign Error)

### Location
`src/services/cancellationService.ts` — `calculateRefund()`

### What Was Changed (the bug)

```diff
  function calculateRefund(pricePerSeat, numSeats, cancellationFeePercent) {
    const totalPaid = pricePerSeat.mul(numSeats);
-   const keepFraction = new Prisma.Decimal(1).sub(
+   // BUG: .add() instead of .sub() — fee is added to 1, not subtracted
+   const keepFraction = new Prisma.Decimal(1).add(
      cancellationFeePercent.div(100)
    );
    return totalPaid.mul(keepFraction).toDecimalPlaces(2);
  }
```

### Correct Formula
```
refund = total_paid × (1 − fee%)
```

### Buggy Formula
```
refund = total_paid × (1 + fee%)
```

### Concrete Example

| | Correct | Buggy |
|---|---|---|
| price_per_seat | £100 | £100 |
| num_seats | 2 | 2 |
| total_paid | £200 | £200 |
| cancellation_fee | 10% | 10% |
| keepFraction | 1 − 0.10 = **0.90** | 1 + 0.10 = **1.10** |
| refund | £200 × 0.90 = **£180** | £200 × 1.10 = **£220** |

**Result:** Customer is refunded £220 on a £200 booking. The business loses £20 per cancellation at 10% fee. At higher fees (e.g. 50%), refund = £300 on a £200 booking — a £100 loss per cancellation.

### How Data Becomes Inconsistent

The `refund_amount` column would store `220.00` against a `price_at_booking` of `100.00` and `num_seats` of `2`. Any reconciliation query comparing `refund_amount` to `price_at_booking * num_seats` would flag every row as anomalous:

```sql
-- Audit query that would catch this:
SELECT id, price_at_booking * num_seats AS total_paid, refund_amount
FROM bookings
WHERE state = 'CANCELLED'
  AND refund_amount > price_at_booking * num_seats;
-- Returns rows — should always return 0 rows in a correct system
```

### Fix

```diff
- const keepFraction = new Prisma.Decimal(1).add(
+ const keepFraction = new Prisma.Decimal(1).sub(
    cancellationFeePercent.div(100)
  );
```

### Prevention
- Unit test the `calculateRefund` function with known inputs: `price=100, seats=2, fee=10%` must return exactly `180.00`
- Add a DB-level CHECK constraint: `refund_amount <= price_at_booking * num_seats`
- Never use floating-point arithmetic for money — `Prisma.Decimal` is correct here, the bug was purely a wrong method name

---

## Summary Table

| Bug | File | Root Cause | Data Corruption | Fix |
|---|---|---|---|---|
| Overbooking | `bookingService.ts` | Missing `FOR UPDATE` lock | `available_seats < 0`, ghost bookings | Restore `findTripByIdForUpdate(tx)` |
| Refund overcalculation | `cancellationService.ts` | `.add()` instead of `.sub()` | `refund_amount > total_paid` | Change to `.sub()` |
