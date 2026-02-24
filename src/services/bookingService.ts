import { Booking, Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import {
  findTripByIdForUpdate,
  decrementAvailableSeats,
  findTripById,
} from "../repositories/tripRepository";
import {
  createBooking,
  findBookingById,
  findBookingByIdempotencyKey,
} from "../repositories/bookingRepository";
import { AppError } from "../utils/AppError";
import { CreateBookingBody } from "../types";

const BOOKING_EXPIRY_MINUTES = 15;

export interface CreateBookingResult {
  booking: Booking;
  alreadyExisted: boolean;
}

export async function createBookingService(
  data: CreateBookingBody
): Promise<CreateBookingResult> {
  // ── Fast-path idempotency check (outside transaction, no lock) ────────────
  // If this client already created this booking, return it immediately.
  // The unique constraint is still the authoritative guard — this is an
  // optimisation to avoid acquiring a row lock unnecessarily.
  const existingBooking = await findBookingByIdempotencyKey(
    data.user_id,
    data.idempotency_key
  );
  if (existingBooking) {
    return { booking: existingBooking, alreadyExisted: true };
  }

  // ── Main transaction — everything below is atomic ─────────────────────────
  const booking = await prisma.$transaction(async (tx) => {
    // Step 1: Acquire exclusive row lock on the trip.
    // ─────────────────────────────────────────────────────────────────────────
    // Any concurrent booking for the same trip will BLOCK here until this
    // transaction commits or rolls back. This serialises all seat changes for
    // a given trip, making available_seats accurate under high concurrency.
    const trip = await findTripByIdForUpdate(data.trip_id, tx);

    if (!trip) {
      throw new AppError("Trip not found", 404);
    }

    if (trip.status !== "PUBLISHED") {
      throw new AppError("Trip is not available for booking", 400);
    }

    if (new Date(trip.start_date) <= new Date()) {
      throw new AppError("Trip has already departed", 400);
    }

    // Step 2: Check seat availability — safe to read because we hold the lock
    if (trip.available_seats < data.num_seats) {
      throw new AppError(
        `Only ${trip.available_seats} seat(s) available`,
        409
      );
    }

    // Step 3: Re-check idempotency inside the transaction.
    // Handles the race where two identical requests both passed the fast-path
    // check, both acquired the lock (sequentially), and the second one should
    // now find the booking inserted by the first.
    const duplicateBooking = await findBookingByIdempotencyKey(
      data.user_id,
      data.idempotency_key,
      tx
    );
    if (duplicateBooking) {
      return duplicateBooking;
    }

    // Step 4: Decrement seats atomically — still inside the lock
    await decrementAvailableSeats(data.trip_id, data.num_seats, tx);

    // Step 5: Insert the booking
    const expiresAt = new Date(
      Date.now() + BOOKING_EXPIRY_MINUTES * 60 * 1000
    );

    return createBooking(
      {
        tripId: data.trip_id,
        userId: data.user_id,
        numSeats: data.num_seats,
        priceAtBooking: new Prisma.Decimal(trip.price),
        expiresAt,
        idempotencyKey: data.idempotency_key,
      },
      tx
    );
  });

  return { booking, alreadyExisted: false };
}

export async function getBookingService(id: string): Promise<Booking> {
  const booking = await findBookingById(id);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
}
