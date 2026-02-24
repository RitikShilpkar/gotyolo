import { prisma } from "../db/client";
import {
  findExpiredPendingBookings,
} from "../repositories/bookingRepository";
import { incrementAvailableSeats } from "../repositories/tripRepository";

const JOB_INTERVAL_MS = 60 * 1000; // 1 minute

let jobTimer: NodeJS.Timeout | null = null;
// Prevent overlapping runs if a single tick takes longer than the interval
let isRunning = false;

export async function runExpiryJob(): Promise<void> {
  if (isRunning) {
    console.warn("[ExpiryJob] Previous run still in progress — skipping tick");
    return;
  }

  isRunning = true;

  try {
    await prisma.$transaction(async (tx) => {
      // ── Step 1: Find expired rows and lock them ─────────────────────────────
      // FOR UPDATE SKIP LOCKED: if another job instance (e.g. horizontal scale)
      // is already processing a row, we skip it rather than waiting.
      // This guarantees each booking is expired exactly once across all instances.
      const expiredBookings = await findExpiredPendingBookings(tx);

      if (expiredBookings.length === 0) {
        return; // nothing to do this tick
      }

      const ids = expiredBookings.map((b) => b.id);

      // ── Step 2: Bulk-update state to EXPIRED ────────────────────────────────
      // Rows are already locked above, so this ORM call is safe.
      // Using updateMany avoids N individual UPDATE statements.
      await tx.booking.updateMany({
        where: { id: { in: ids } },
        data: { state: "EXPIRED" },
      });

      // ── Step 3: Release seats — grouped by trip to minimise UPDATE statements
      const seatsByTrip = new Map<string, number>();
      for (const booking of expiredBookings) {
        const current = seatsByTrip.get(booking.tripId) ?? 0;
        seatsByTrip.set(booking.tripId, current + booking.numSeats);
      }

      for (const [tripId, numSeats] of seatsByTrip) {
        await incrementAvailableSeats(tripId, numSeats, tx);
      }

      console.log(
        `[ExpiryJob] Expired ${expiredBookings.length} booking(s) across ` +
          `${seatsByTrip.size} trip(s)`
      );
    });
  } catch (err) {
    // Log and swallow — a job failure must not crash the server process.
    // The next tick will retry the same rows (they remain PENDING_PAYMENT).
    console.error("[ExpiryJob] Error during expiry run:", err);
  } finally {
    isRunning = false;
  }
}

export function startExpiryJob(): void {
  console.log(
    `[ExpiryJob] Starting — runs every ${JOB_INTERVAL_MS / 1000}s`
  );

  // Run once immediately on startup to catch any backlog from downtime
  void runExpiryJob();

  jobTimer = setInterval(() => {
    void runExpiryJob();
  }, JOB_INTERVAL_MS);

  // Prevent the timer from keeping the Node process alive on shutdown
  jobTimer.unref();
}

export function stopExpiryJob(): void {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    console.log("[ExpiryJob] Stopped");
  }
}
