import { BookingState, TripStatus } from "@prisma/client";

// Re-export Prisma enums for use throughout the app without importing Prisma everywhere
export { BookingState, TripStatus };

// Valid state transitions — enforced in the service layer
export const VALID_TRANSITIONS: Record<BookingState, BookingState[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  CANCELLED: [],
  EXPIRED: [],
};

// Webhook payload shape (validated with zod in the controller)
export interface WebhookPayload {
  booking_id: string;
  status: "success" | "failed";
  idempotency_key: string;
}

// Create booking request body
export interface CreateBookingBody {
  trip_id: string;
  user_id: string;
  num_seats: number;
  idempotency_key: string;
}

// Cancel booking request body
export interface CancelBookingBody {
  user_id: string;
}
