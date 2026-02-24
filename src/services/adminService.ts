import {
  getTripMetricsRaw,
  getAtRiskTripsRaw,
} from "../repositories/adminRepository";
import { findTripById } from "../repositories/tripRepository";
import { AppError } from "../utils/AppError";
import { Prisma } from "@prisma/client";

// ── Trip Metrics ──────────────────────────────────────────────────────────────
// Response shape matches spec exactly
export interface TripMetrics {
  trip_id: string;
  title: string;
  occupancy_percent: number;
  total_seats: number;
  booked_seats: number;
  available_seats: number;
  booking_summary: {
    confirmed: number;
    pending_payment: number;
    cancelled: number;
    expired: number;
  };
  financial: {
    gross_revenue: number;
    refunds_issued: number;
    net_revenue: number;
  };
}

// ── At-Risk Trips ─────────────────────────────────────────────────────────────
export interface AtRiskTrip {
  trip_id: string;
  title: string;
  departure_date: string;
  occupancy_percent: number;
  reason: string;
}

export async function getTripMetricsService(
  tripId: string
): Promise<TripMetrics> {
  const trip = await findTripById(tripId);
  if (!trip) throw new AppError("Trip not found", 404);

  const row = await getTripMetricsRaw(tripId);

  if (!row) {
    return buildEmptyMetrics(trip);
  }

  const confirmed = Number(row.confirmed_count);
  const pending = Number(row.pending_count);
  const cancelled = Number(row.cancelled_count);
  const expired = Number(row.expired_count);

  const bookedSeats = row.max_capacity - row.available_seats;
  const occupancyPercent =
    row.max_capacity > 0
      ? Math.round((bookedSeats / row.max_capacity) * 100)
      : 0;

  const gross = new Prisma.Decimal(row.gross_revenue ?? 0);
  const refunds = new Prisma.Decimal(row.refunds_issued ?? 0);
  const net = gross.sub(refunds);

  return {
    trip_id: row.id,
    title: row.title,
    occupancy_percent: occupancyPercent,
    total_seats: row.max_capacity,
    booked_seats: bookedSeats,
    available_seats: row.available_seats,
    booking_summary: {
      confirmed,
      pending_payment: pending,
      cancelled,
      expired,
    },
    financial: {
      gross_revenue: parseFloat(gross.toFixed(2)),
      refunds_issued: parseFloat(refunds.toFixed(2)),
      net_revenue: parseFloat(net.toFixed(2)),
    },
  };
}

function buildEmptyMetrics(
  trip: NonNullable<Awaited<ReturnType<typeof findTripById>>>
): TripMetrics {
  const bookedSeats = trip.maxCapacity - trip.availableSeats;
  return {
    trip_id: trip.id,
    title: trip.title,
    occupancy_percent: 0,
    total_seats: trip.maxCapacity,
    booked_seats: bookedSeats,
    available_seats: trip.availableSeats,
    booking_summary: { confirmed: 0, pending_payment: 0, cancelled: 0, expired: 0 },
    financial: { gross_revenue: 0, refunds_issued: 0, net_revenue: 0 },
  };
}

export async function getAtRiskTripsService(): Promise<AtRiskTrip[]> {
  const rows = await getAtRiskTripsRaw();

  return rows.map((row) => ({
    trip_id: row.id,
    title: row.title,
    departure_date: new Date(row.start_date).toISOString().split("T")[0],
    occupancy_percent: Math.round(Number(row.occupancy_percent)),
    reason: "Low occupancy with imminent departure",
  }));
}
