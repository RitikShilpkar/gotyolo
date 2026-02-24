import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

// ── Trip Metrics ──────────────────────────────────────────────────────────────

export type TripMetricsRow = {
  id: string;
  title: string;
  max_capacity: number;
  available_seats: number;
  confirmed_count: bigint;
  pending_count: bigint;
  cancelled_count: bigint;
  expired_count: bigint;
  // SUM returns numeric | null when there are no matching rows
  gross_revenue: Prisma.Decimal | null;
  refunds_issued: Prisma.Decimal | null;
};

export async function getTripMetricsRaw(
  tripId: string
): Promise<TripMetricsRow | null> {
  const rows = await prisma.$queryRaw<TripMetricsRow[]>`
    SELECT
      t.id,
      t.title,
      t.max_capacity,
      t.available_seats,

      COUNT(CASE WHEN b.state = 'CONFIRMED'       THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN b.state = 'PENDING_PAYMENT' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN b.state = 'CANCELLED'       THEN 1 END) AS cancelled_count,
      COUNT(CASE WHEN b.state = 'EXPIRED'         THEN 1 END) AS expired_count,

      -- Gross revenue: what CONFIRMED bookings paid (price × seats)
      SUM(
        CASE WHEN b.state = 'CONFIRMED'
          THEN b.price_at_booking * b.num_seats
        END
      ) AS gross_revenue,

      -- Refunds issued: what was returned on CANCELLED bookings
      SUM(
        CASE WHEN b.state = 'CANCELLED'
          THEN COALESCE(b.refund_amount, 0)
        END
      ) AS refunds_issued

    FROM trips t
    LEFT JOIN bookings b ON b.trip_id = t.id
    WHERE t.id = ${tripId}::uuid
    GROUP BY t.id, t.title, t.max_capacity, t.available_seats
  `;

  return rows[0] ?? null;
}

// ── At-Risk Trips ─────────────────────────────────────────────────────────────

export type AtRiskTripRow = {
  id: string;
  title: string;
  destination: string;
  start_date: Date;
  max_capacity: number;
  available_seats: number;
  occupancy_percent: number;
};

export async function getAtRiskTripsRaw(): Promise<AtRiskTripRow[]> {
  return prisma.$queryRaw<AtRiskTripRow[]>`
    SELECT
      t.id,
      t.title,
      t.destination,
      t.start_date,
      t.max_capacity,
      t.available_seats,
      ROUND(
        (t.max_capacity - t.available_seats)::numeric / t.max_capacity * 100,
        2
      ) AS occupancy_percent
    FROM trips t
    WHERE t.status = 'PUBLISHED'
      AND t.start_date >  NOW()
      AND t.start_date <= NOW() + INTERVAL '7 days'
      AND (t.max_capacity - t.available_seats)::numeric / t.max_capacity < 0.5
    ORDER BY t.start_date ASC
  `;
}
