import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

// Raw DB row shape — $queryRaw returns snake_case column names, not Prisma's camelCase
type TripRow = {
  id: string;
  title: string;
  destination: string;
  start_date: Date;
  end_date: Date;
  price: Prisma.Decimal;
  max_capacity: number;
  available_seats: number;
  status: string;
  refundable_until_days_before: number;
  cancellation_fee_percent: Prisma.Decimal;
  created_at: Date;
  updated_at: Date;
};

type TxClient = Prisma.TransactionClient;

// SELECT FOR UPDATE — acquires an exclusive row-level lock.
// All concurrent transactions trying to lock the same row will BLOCK
// until this transaction commits or rolls back.
// Must be called inside a transaction; tx is required.
export async function findTripByIdForUpdate(
  tripId: string,
  tx: TxClient
): Promise<TripRow | null> {
  const rows = await tx.$queryRaw<TripRow[]>`
    SELECT * FROM trips WHERE id = ${tripId}::uuid FOR UPDATE
  `;
  return rows[0] ?? null;
}

// Atomic decrement — runs inside the same transaction as the lock
export async function decrementAvailableSeats(
  tripId: string,
  numSeats: number,
  tx: TxClient
): Promise<void> {
  await tx.$executeRaw`
    UPDATE trips
    SET available_seats = available_seats - ${numSeats},
        updated_at = NOW()
    WHERE id = ${tripId}::uuid
  `;
}

// Seat release — used on expiry and cancellation (before cutoff only)
export async function incrementAvailableSeats(
  tripId: string,
  numSeats: number,
  tx: TxClient
): Promise<void> {
  await tx.$executeRaw`
    UPDATE trips
    SET available_seats = available_seats + ${numSeats},
        updated_at = NOW()
    WHERE id = ${tripId}::uuid
  `;
}

// Plain read — no lock, used for validation and response shaping
export async function findTripById(tripId: string) {
  return prisma.trip.findUnique({ where: { id: tripId } });
}

export async function listPublishedTrips() {
  return prisma.trip.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { startDate: "asc" },
  });
}

export async function createTrip(data: {
  title: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  price: number;
  maxCapacity: number;
  refundableUntilDaysBefore: number;
  cancellationFeePercent: number;
}) {
  return prisma.trip.create({
    data: {
      ...data,
      availableSeats: data.maxCapacity, // starts fully open
      price: new Prisma.Decimal(data.price),
      cancellationFeePercent: new Prisma.Decimal(data.cancellationFeePercent),
      status: "PUBLISHED",
    },
  });
}
