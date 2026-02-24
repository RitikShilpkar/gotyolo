import { Booking, BookingState, Prisma } from "@prisma/client";
import { prisma } from "../db/client";

type TxClient = Prisma.TransactionClient;

// ── Read ──────────────────────────────────────────────────────────────────────

export async function findBookingById(id: string): Promise<Booking | null> {
  return prisma.booking.findUnique({ where: { id } });
}

// Used for idempotency check — find a booking by the composite unique key
export async function findBookingByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
  tx?: TxClient
): Promise<Booking | null> {
  const client = tx ?? prisma;
  return client.booking.findUnique({
    where: { uq_booking_idempotency: { userId, idempotencyKey } },
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createBooking(
  data: {
    tripId: string;
    userId: string;
    numSeats: number;
    priceAtBooking: Prisma.Decimal;
    expiresAt: Date;
    idempotencyKey: string;
  },
  tx: TxClient
): Promise<Booking> {
  return tx.booking.create({ data });
}

// Generic state transition update — used by webhook, expiry job, and cancellation
export async function updateBookingState(
  id: string,
  state: BookingState,
  extras: Partial<Pick<Booking, "refundAmount" | "paymentReference" | "cancelledAt">>,
  tx?: TxClient
): Promise<Booking> {
  const client = tx ?? prisma;
  return client.booking.update({
    where: { id },
    data: { state, ...extras },
  });
}

// Bulk expiry — returns the affected bookings so the job can release seats
export async function findExpiredPendingBookings(
  tx: TxClient
): Promise<Array<Pick<Booking, "id" | "tripId" | "numSeats">>> {
  // SKIP LOCKED: if another job instance is already processing a row, skip it.
  // This is safe here — we want exactly-once processing across instances,
  // not blocking (unlike booking creation where every request must be serialised).
  return tx.$queryRaw<Array<Pick<Booking, "id" | "tripId" | "numSeats">>>`
    SELECT id, trip_id AS "tripId", num_seats AS "numSeats"
    FROM bookings
    WHERE state = 'PENDING_PAYMENT'
      AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED
  `;
}

export async function bulkExpireBookings(
  ids: string[],
  tx: TxClient
): Promise<void> {
  await tx.$executeRaw`
    UPDATE bookings
    SET state = 'EXPIRED', updated_at = NOW()
    WHERE id::text = ANY(${ids})
  `;
}
