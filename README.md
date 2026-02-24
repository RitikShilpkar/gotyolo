# GoTyolo — Travel Booking Backend

Production-grade booking system built as an SDE II take-home assignment.
Focus areas: state machine correctness, concurrency safety, webhook idempotency, refund logic, clean layered architecture.

---

## Table of Contents

1. [Tech Stack & Justification](#tech-stack--justification)
2. [Architecture Overview](#architecture-overview)
3. [Setup — Docker (recommended)](#setup--docker-recommended)
4. [Setup — Local Development](#setup--local-development)
5. [API Reference](#api-reference)
6. [High Traffic Scenario](#high-traffic-scenario)
7. [Bugs Found & Fixed](#bugs-found--fixed)
8. [Trade-offs](#trade-offs)

---

## Tech Stack & Justification

| Technology | Why |
|---|---|
| **Node.js + TypeScript** | Strict typing catches property-name bugs at compile time (demonstrated in Bug 1); async I/O suits an I/O-bound booking service |
| **Express v5** | Minimal, well-understood, async-error-friendly |
| **PostgreSQL 16** | Row-level locking (`SELECT FOR UPDATE`) is the correct primitive for seat inventory; ACID transactions for multi-step state changes; `ON CONFLICT DO NOTHING` for idempotency |
| **Prisma 7** | Type-safe ORM for standard CRUD; raw SQL via `$queryRaw`/`$executeRaw` for locking and bulk operations where ORM falls short |
| **Zod v4** | Schema validation at the HTTP boundary — errors stay out of the service layer |
| **Docker + docker-compose** | Reproducible environment; Postgres health check ensures app never starts before DB is ready |

**What was deliberately excluded:**
- Redis — not needed; all idempotency and locking is DB-native
- Message queue — overkill at this scale; the DB-level job pattern is sufficient
- ORM-only queries for locking — Prisma has no `FOR UPDATE` API, so raw SQL is used precisely where needed and ORM is used everywhere else

---

## Architecture Overview

```
HTTP Request
     │
     ▼
┌─────────────┐
│  Controller │  ← validates input (Zod), calls service, sends response
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Service   │  ← business logic, orchestrates transaction, throws AppError
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Repository  │  ← DB operations only; raw SQL where locking is needed
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  PostgreSQL │
└─────────────┘
```

### Folder structure

```
src/
  controllers/   HTTP layer only — no business logic
  services/      Business rules, transaction orchestration
  repositories/  DB operations — raw SQL or Prisma ORM
  routes/        Express router definitions
  middlewares/   Error handler
  jobs/          Auto-expiry background job
  db/            Prisma client singleton
  utils/         AppError, asyncHandler
  types/         Shared interfaces, state machine map
```

### Booking state machine

```
                    POST /bookings
                         │
                         ▼
                  PENDING_PAYMENT ──── 15 min ────► EXPIRED (seats released)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   webhook success  webhook failed  POST /cancel
          │              │              │
          ▼              ▼              ▼
      CONFIRMED        EXPIRED      CANCELLED
      (seats held)  (seats released)  │
          │                           ├─ before cutoff → refund + seats released
          │                           └─ after cutoff  → no refund, no seat release
          │
     POST /cancel
          │
     CANCELLED (before/after cutoff rules apply)
```

**Terminal states:** `CONFIRMED` (with cancel path), `CANCELLED`, `EXPIRED`
**Invalid transitions return 409.**

---

## Setup — Docker (recommended)

### Prerequisites
- Docker Desktop installed and running
- Node.js 22+ (for running migrations locally against the Docker DB)

### 1. Create environment file

```bash
cp .env.example .env
```

`.env.example` (defaults work out of the box with docker-compose):
```
DATABASE_URL="postgresql://gotyolo:gotyolo@localhost:5433/gotyolo?schema=public"
PORT=3000
NODE_ENV=development
```

> **Note:** Host port is `5433` (not `5432`) to avoid conflicts with a locally-running Postgres instance.

### 2. Build and start containers

```bash
docker compose up --build -d
```

This starts:
- `gotyolo_db` — PostgreSQL 16 on host port **5433** (container port 5432)
- `gotyolo_app` — Node.js API on port **3000**

The app waits for Postgres to pass its health check before starting.

### 3. Run migrations (first time only)

Migrations run locally against the Docker DB (the schema files are not bundled into the production image):

```bash
DATABASE_URL="postgresql://gotyolo:gotyolo@localhost:5433/gotyolo?schema=public" npx prisma migrate deploy
```

### 4. Seed the database (optional but recommended)

```bash
DATABASE_URL="postgresql://gotyolo:gotyolo@localhost:5433/gotyolo?schema=public" npm run db:seed
```

This creates 5 trips and 14 bookings in various states for testing.

### 5. Verify

```bash
curl http://localhost:3000/trips
# Should return 4 published trips
```

### Stop

```bash
docker compose down          # keep DB data
docker compose down -v       # wipe DB volume too
```

---

## Setup — Local Development

### Prerequisites
- Node.js 22+
- PostgreSQL 16 running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your local Postgres credentials
```

`.env.example`:
```
DATABASE_URL="postgresql://gotyolo:gotyolo@localhost:5432/gotyolo?schema=public"
PORT=3000
NODE_ENV=development
```

### 3. Create the database user and database

```bash
psql -U postgres -c "CREATE USER gotyolo WITH PASSWORD 'gotyolo';"
psql -U postgres -c "CREATE DATABASE gotyolo OWNER gotyolo;"
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Seed the database (optional)

```bash
npm run db:seed
```

### 6. Start dev server (hot reload)

```bash
npm run dev
```

Server starts on `http://localhost:3000`.

---

## API Reference

### Health

```
GET /health
→ 200 { status: "ok", timestamp: "..." }
```

---

### Trips

#### Create a trip

```
POST /trips
Content-Type: application/json

{
  "title": "Paris Explorer",
  "destination": "Paris, France",
  "start_date": "2026-06-01T00:00:00.000Z",
  "end_date": "2026-06-07T00:00:00.000Z",
  "price": 450.00,
  "max_capacity": 20,
  "refundable_until_days_before": 7,
  "cancellation_fee_percent": 10
}

→ 201 { trip: { id, title, destination, availableSeats: 20, status: "PUBLISHED", ... } }
```

#### Get a trip

```
GET /trips/:id
→ 200 { trip: { ... } }
→ 404 { error: "Trip not found" }
```

---

### Bookings

#### Create a booking

Idempotent. Send the same `idempotency_key` to safely retry — returns `200` with the original booking if already created, `201` on first creation.

```
POST /bookings
Content-Type: application/json

{
  "trip_id": "uuid",
  "user_id": "user_123",
  "num_seats": 2,
  "idempotency_key": "client-generated-unique-key"
}

→ 201 { booking: { id, tripId, userId, numSeats, state: "PENDING_PAYMENT", expiresAt, ... } }
→ 200 { booking: { ... } }          (idempotent replay)
→ 409 { error: "Only 1 seat(s) available" }    (insufficient seats)
→ 400 { error: "Trip has already departed" }
→ 404 { error: "Trip not found" }
```

#### Get a booking

```
GET /bookings/:id
→ 200 { booking: { ... } }
→ 404 { error: "Booking not found" }
```

#### Cancel a booking

```
POST /bookings/:id/cancel
Content-Type: application/json

{ "user_id": "user_123" }

→ 200 {
    booking: { ..., state: "CANCELLED", refundAmount: "405.00" },
    refund: {
      amount: "405.00",
      issued: true,
      seats_released: true
    }
  }
→ 409 { error: "Cannot cancel a booking with state 'EXPIRED'" }
→ 403 { error: "You do not own this booking" }
```

**Refund rules:**
- Before cutoff: `refund = price_per_seat × num_seats × (1 − cancellation_fee_percent / 100)`
- After cutoff: `refund = 0`, seats are **not** released

---

### Webhooks

#### Payment webhook

Always returns `200`. The response body indicates what action was taken.

```
POST /webhooks/payment
Content-Type: application/json

{
  "booking_id": "uuid",
  "status": "success",
  "idempotency_key": "payment-provider-event-id"
}

→ 200 { received: true, action: "confirmed" }
→ 200 { received: true, action: "expired" }     (status: "failed")
→ 200 { received: true, action: "duplicate" }   (idempotency_key already seen)
→ 200 { received: true, action: "skipped" }     (booking in terminal state)
```

**Idempotency guarantee:** `INSERT INTO webhook_events ... ON CONFLICT DO NOTHING` ensures exactly-once processing regardless of how many times the provider retries.

---

### Admin

#### Trip metrics

```
GET /admin/trips/:id/metrics
→ 200 {
    trip_id: "uuid",
    title: "Paris City Explorer",
    occupancy_percent: 70,
    total_seats: 20,
    booked_seats: 14,
    available_seats: 6,
    booking_summary: {
      confirmed: 12,
      pending_payment: 2,
      cancelled: 3,
      expired: 5
    },
    financial: {
      gross_revenue: 5400,
      refunds_issued: 405,
      net_revenue: 4995
    }
  }
→ 404 { error: "Trip not found" }
```

#### At-risk trips

Returns PUBLISHED trips departing within 7 days with occupancy below 50%.

```
GET /admin/trips/at-risk
→ 200 {
    at_risk_trips: [
      {
        trip_id: "uuid",
        title: "Bali Wellness Retreat",
        departure_date: "2026-03-01",
        occupancy_percent: 33,
        reason: "Low occupancy with imminent departure"
      }
    ]
  }
```

---

## High Traffic Scenario

**Scenario:** 500 concurrent `POST /bookings` for a trip with 100 seats.

### What happens at the DB level

```
All 500 requests reach:
  SELECT * FROM trips WHERE id = $1 FOR UPDATE

PostgreSQL queues 499 behind the first lock holder.
One transaction runs at a time per trip row.

Lock holder reads available_seats, checks, decrements, inserts booking, COMMITs.
Next transaction acquires lock, reads updated value.
...
When available_seats = 0, all remaining return 409.
```

### Throughput reality

If each transaction takes ~5ms on average, request #500 waits ~2.5 seconds. For a booking system (not a millisecond-latency feed), this is acceptable. The guarantee is worth the serialisation cost.

### Production mitigations

| Mitigation | Effect |
|---|---|
| **PgBouncer (transaction mode)** | Reduces DB connection count from 500 to the pool size (e.g. 20). Transactions still serialise, but connections don't pile up. Recommended first step. |
| **Connection pool in app** | Prisma has a built-in pool; tune `connection_limit` in the `DATABASE_URL` |
| **Read replica for GET endpoints** | Offloads non-locking reads from the primary |
| **Horizontal scaling** | Multiple app instances work correctly — the DB lock is the single arbiter |

### Why `available_seats` is denormalized

The alternative is to count confirmed bookings on each request:
```sql
SELECT max_capacity - COALESCE(SUM(num_seats), 0)
FROM bookings WHERE trip_id = $1 AND state = 'CONFIRMED'
```

Problems:
- Requires an aggregate scan on every booking attempt
- Cannot be cleanly locked with `FOR UPDATE` on a single row
- Query complexity grows as booking volume grows

With the denormalized column: one `SELECT FOR UPDATE` on a single trips row, one `UPDATE trips SET available_seats = available_seats - N`. Both are O(1) regardless of total booking count. The trade-off is keeping it in sync — every seat change must go through a transaction that updates both tables.

---

## Bugs Found & Fixed

See [BUGS.md](./BUGS.md) for the full analysis. Summary:

### Bug 1 — Overbooking (Missing Row Lock)

**File:** `src/services/bookingService.ts`

```diff
- const trip = await findTripById(data.trip_id);          // no lock — race condition
+ const trip = await findTripByIdForUpdate(data.trip_id, tx); // SELECT FOR UPDATE
```

**Corruption:** Two concurrent requests both read `available_seats = 1`, both pass the seat check, both decrement → `available_seats = -1` with 2 bookings issued for 1 available seat.

**Root cause:** Removed the `FOR UPDATE` lock. Without it, seat reads are not serialised.

**Prevention:** Any seat decrement must use `SELECT FOR UPDATE` on the trip row in the same transaction.

---

### Bug 2 — Refund Overcalculation

**File:** `src/services/cancellationService.ts`

```diff
- const keepFraction = new Prisma.Decimal(1).add(feePercent.div(100)); // BUG: adds fee
+ const keepFraction = new Prisma.Decimal(1).sub(feePercent.div(100)); // FIX: subtracts fee
```

**Corruption:** At 10% fee on a £200 booking, refund was £220 instead of £180. Customer receives more than they paid.

**Root cause:** `.add()` used instead of `.sub()` — a one-character sign error in the formula `1 − fee%`.

**Prevention:** Unit test `calculateRefund(100, 2, 10) === 180.00`; DB CHECK constraint `refund_amount <= price_at_booking * num_seats`.

---

## Trade-offs

### Row-level locking vs optimistic concurrency

**Chosen:** Pessimistic locking (`SELECT FOR UPDATE`)
**Alternative:** Optimistic locking — read without lock, retry on conflict

Pessimistic locking serialises all booking attempts for a given trip. It is simpler to reason about, never needs retry logic in the application, and guarantees correctness at the cost of queueing under load. For a booking system where users expect a definitive yes/no immediately, blocking is acceptable.

Optimistic locking would improve throughput for low-contention trips but adds retry complexity and can starve requests under high load.

---

### In-process expiry job vs external job queue

**Chosen:** `setInterval` in the app process
**Production alternative:** pg-boss or pg_cron

The in-process job is simple and requires no additional infrastructure. The risk is that it stops when the app restarts. For this assignment it is correct. In production, pg-boss (persistent Postgres-backed queue) or pg_cron (runs inside Postgres) would provide exactly-once semantics across restarts and multiple instances.

---

### Prisma ORM + raw SQL hybrid

**Chosen:** ORM for standard CRUD, raw SQL for `FOR UPDATE`, `ON CONFLICT DO NOTHING`, `SKIP LOCKED`, and bulk aggregations
**Alternative:** Pure raw SQL throughout

Prisma provides type safety and migration management. Raw SQL is used only where Prisma's API has no equivalent (`FOR UPDATE`, `ON CONFLICT`). This hybrid gives the best of both: type-safe day-to-day operations, and precise SQL where correctness demands it.

---

### `refund_amount` stored vs computed

**Chosen:** Stored at cancellation time
**Alternative:** Always compute from `price_at_booking × (1 − fee%)`

Storing it means the refund is immutable after cancellation — it cannot be silently changed by a future schema migration or fee-percent update. It also makes audit queries trivial: `SELECT refund_amount FROM bookings WHERE state = 'CANCELLED'`. The trade-off is the possibility of storing an incorrect value (as Bug 2 demonstrated), but the unit test and DB CHECK constraint prevent this.

---

### No authentication middleware

This system accepts `user_id` as a body parameter rather than deriving it from a JWT. In a production system, a middleware would verify a Bearer token and inject `req.user.id` into the route context. This was omitted to keep focus on the booking logic, not auth infrastructure.
