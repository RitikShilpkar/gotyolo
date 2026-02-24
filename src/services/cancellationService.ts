import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { incrementAvailableSeats } from "../repositories/tripRepository";
import { updateBookingState } from "../repositories/bookingRepository";
import { VALID_TRANSITIONS } from "../types";
import { AppError } from "../utils/AppError";

// Raw JOIN result — we need trip fields alongside booking fields in one locked read
type BookingWithTripRow = {
  id: string;
  trip_id: string;
  user_id: string;
  num_seats: number;
  state: string;
  price_at_booking: Prisma.Decimal;
  start_date: Date;
  refundable_until_days_before: number;
  cancellation_fee_percent: Prisma.Decimal;
};

export interface CancellationResult {
  refundAmount: Prisma.Decimal;
  seatsReleased: boolean;
  isBeforeCutoff: boolean;
}

// Refund = price_at_booking × (1 − fee%)
// price_at_booking is already the total paid (price per seat × num_seats)
// Uses Prisma.Decimal for exact arithmetic — never use floating point for money
function calculateRefund(
  priceAtBooking: Prisma.Decimal,
  cancellationFeePercent: Prisma.Decimal
): Prisma.Decimal {
  const keepFraction = new Prisma.Decimal(1).sub(
    cancellationFeePercent.div(100)
  );
  return priceAtBooking.mul(keepFraction).toDecimalPlaces(2);
}

export async function cancelBookingService(
  bookingId: string,
  userId: string
): Promise<CancellationResult> {
  return prisma.$transaction(async (tx) => {
    // ── Step 1: Lock both booking + trip data in a single query ──────────────
    // Locking the booking row prevents two simultaneous cancellation requests
    // from both passing the state check and double-cancelling.
    const rows = await tx.$queryRaw<BookingWithTripRow[]>`
      SELECT
        b.id,
        b.trip_id,
        b.user_id,
        b.num_seats,
        b.state,
        b.price_at_booking,
        t.start_date,
        t.refundable_until_days_before,
        t.cancellation_fee_percent
      FROM bookings b
      JOIN trips t ON t.id = b.trip_id
      WHERE b.id = ${bookingId}::uuid
      FOR UPDATE OF b
    `;

    const row = rows[0];

    if (!row) {
      throw new AppError("Booking not found", 404);
    }

    if (row.user_id !== userId) {
      throw new AppError("You do not own this booking", 403);
    }

    // ── Step 2: State machine guard ───────────────────────────────────────────
    const currentState = row.state as keyof typeof VALID_TRANSITIONS;
    if (!VALID_TRANSITIONS[currentState].includes("CANCELLED")) {
      throw new AppError(
        `Cannot cancel a booking with state '${row.state}'`,
        409
      );
    }

    // ── Step 3: Cutoff determination ──────────────────────────────────────────
    // cutoff_date = trip.start_date − refundable_until_days_before days
    const cutoffDate = new Date(row.start_date);
    cutoffDate.setDate(
      cutoffDate.getDate() - row.refundable_until_days_before
    );
    const isBeforeCutoff = new Date() < cutoffDate;

    // Spec: after the cutoff only CONFIRMED bookings may be cancelled.
    // A PENDING_PAYMENT booking past the cutoff will auto-expire — the user
    // cannot explicitly cancel it (no payment has been made to refund).
    if (!isBeforeCutoff && row.state !== "CONFIRMED") {
      throw new AppError(
        "Only confirmed bookings can be cancelled after the refund cutoff date",
        409
      );
    }

    // ── Step 4: Refund calculation ────────────────────────────────────────────
    const refundAmount = isBeforeCutoff
      ? calculateRefund(
          new Prisma.Decimal(row.price_at_booking),
          new Prisma.Decimal(row.cancellation_fee_percent)
        )
      : new Prisma.Decimal(0);

    // ── Step 5: Persist the cancellation ─────────────────────────────────────
    await updateBookingState(
      bookingId,
      "CANCELLED",
      { refundAmount, cancelledAt: new Date() },
      tx
    );

    // ── Step 6: Conditional seat release ─────────────────────────────────────
    // After the cutoff the operator has committed that capacity.
    // The business decision is: no refund AND no seat release.
    // Before the cutoff: seats go back into the pool immediately.
    if (isBeforeCutoff) {
      await incrementAvailableSeats(row.trip_id, row.num_seats, tx);
    }

    return {
      refundAmount,
      seatsReleased: isBeforeCutoff,
      isBeforeCutoff,
    };
  });
}
