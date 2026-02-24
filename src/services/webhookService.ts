import { prisma } from "../db/client";
import { incrementAvailableSeats } from "../repositories/tripRepository";
import { updateBookingState } from "../repositories/bookingRepository";
import { VALID_TRANSITIONS, WebhookPayload } from "../types";
import { BookingState } from "@prisma/client";

export interface WebhookResult {
  alreadyProcessed: boolean;
  action: "confirmed" | "expired" | "skipped" | "duplicate";
}

export async function processWebhookService(
  payload: WebhookPayload
): Promise<WebhookResult> {
  const { booking_id, status, idempotency_key } = payload;

  return prisma.$transaction(async (tx) => {
    // ── Step 1: Idempotency gate ───────────────────────────────────────────
    // INSERT ... ON CONFLICT DO NOTHING is atomic.
    // If two identical webhooks arrive simultaneously:
    //   - One transaction inserts the row (rowCount = 1) and proceeds
    //   - The other gets rowCount = 0 and returns immediately
    // No double-processing is possible.
    const rowCount = await tx.$executeRaw`
      INSERT INTO webhook_events (id, idempotency_key, booking_id, status)
      VALUES (gen_random_uuid(), ${idempotency_key}, ${booking_id}, ${status})
      ON CONFLICT (idempotency_key) DO NOTHING
    `;

    if (rowCount === 0) {
      // This webhook has already been processed — return 200 silently
      return { alreadyProcessed: true, action: "duplicate" as const };
    }

    // ── Step 2: Load the booking ───────────────────────────────────────────
    const booking = await tx.booking.findUnique({ where: { id: booking_id } });

    if (!booking) {
      // Webhook arrived for a booking we don't recognise.
      // Still return success — we've recorded the event.
      console.warn(`[Webhook] Booking ${booking_id} not found — event logged`);
      return { alreadyProcessed: false, action: "skipped" as const };
    }

    // ── Step 3: Validate the state transition ─────────────────────────────
    const targetState: BookingState =
      status === "success" ? "CONFIRMED" : "EXPIRED";

    const allowed = VALID_TRANSITIONS[booking.state];

    if (!allowed.includes(targetState)) {
      // Booking is in a terminal state — webhook is stale, do nothing.
      // Still 200 — we recorded the event and there's nothing actionable.
      console.warn(
        `[Webhook] Stale webhook for booking ${booking_id}: ` +
          `${booking.state} → ${targetState} is not a valid transition`
      );
      return { alreadyProcessed: false, action: "skipped" as const };
    }

    // ── Step 4: Apply the transition ──────────────────────────────────────
    if (status === "success") {
      await updateBookingState(booking_id, "CONFIRMED", {}, tx);
      return { alreadyProcessed: false, action: "confirmed" as const };
    }

    // status === "failed" → EXPIRED + release seats
    await updateBookingState(booking_id, "EXPIRED", {}, tx);
    await incrementAvailableSeats(booking.tripId, booking.numSeats, tx);

    return { alreadyProcessed: false, action: "expired" as const };
  });
}
