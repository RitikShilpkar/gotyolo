import "dotenv/config";
import { PrismaClient, BookingState } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ── Trips ──────────────────────────────────────────────────────────────────
  const trips = await Promise.all([
    prisma.trip.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        title: "Paris City Explorer",
        destination: "Paris, France",
        startDate: new Date("2026-07-15T08:00:00Z"),
        endDate: new Date("2026-07-22T20:00:00Z"),
        price: new Prisma.Decimal(450),
        maxCapacity: 20,
        availableSeats: 6,       // 14 seats already sold
        status: "PUBLISHED",
        refundableUntilDaysBefore: 7,
        cancellationFeePercent: new Prisma.Decimal(10),
      },
    }),

    prisma.trip.upsert({
      where: { id: "00000000-0000-0000-0000-000000000002" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000002",
        title: "Tokyo Cherry Blossom Tour",
        destination: "Tokyo, Japan",
        startDate: new Date("2026-04-01T08:00:00Z"),
        endDate: new Date("2026-04-10T20:00:00Z"),
        price: new Prisma.Decimal(1200),
        maxCapacity: 15,
        availableSeats: 13,      // 2 seats sold — at-risk candidate
        status: "PUBLISHED",
        refundableUntilDaysBefore: 14,
        cancellationFeePercent: new Prisma.Decimal(15),
      },
    }),

    prisma.trip.upsert({
      where: { id: "00000000-0000-0000-0000-000000000003" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000003",
        title: "Rome & Amalfi Coast",
        destination: "Rome, Italy",
        startDate: new Date("2026-09-10T08:00:00Z"),
        endDate: new Date("2026-09-17T20:00:00Z"),
        price: new Prisma.Decimal(699),
        maxCapacity: 25,
        availableSeats: 25,      // fully available, draft → published
        status: "PUBLISHED",
        refundableUntilDaysBefore: 10,
        cancellationFeePercent: new Prisma.Decimal(20),
      },
    }),

    prisma.trip.upsert({
      where: { id: "00000000-0000-0000-0000-000000000004" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000004",
        title: "Bali Wellness Retreat",
        destination: "Bali, Indonesia",
        startDate: new Date("2026-03-01T08:00:00Z"),
        endDate: new Date("2026-03-08T20:00:00Z"),
        price: new Prisma.Decimal(875),
        maxCapacity: 12,
        availableSeats: 8,       // 4 seats sold — imminent, potentially at-risk
        status: "PUBLISHED",
        refundableUntilDaysBefore: 5,
        cancellationFeePercent: new Prisma.Decimal(0),
      },
    }),

    prisma.trip.upsert({
      where: { id: "00000000-0000-0000-0000-000000000005" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000005",
        title: "New York Long Weekend",
        destination: "New York, USA",
        startDate: new Date("2026-05-22T08:00:00Z"),
        endDate: new Date("2026-05-25T20:00:00Z"),
        price: new Prisma.Decimal(320),
        maxCapacity: 30,
        availableSeats: 30,
        status: "DRAFT",         // not yet published
        refundableUntilDaysBefore: 3,
        cancellationFeePercent: new Prisma.Decimal(5),
      },
    }),
  ]);

  console.log(`✅ Created ${trips.length} trips`);

  // ── Bookings ───────────────────────────────────────────────────────────────
  const now = new Date();
  const in15Min = new Date(now.getTime() + 15 * 60 * 1000);
  const expired15MinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const bookings: Array<{
    id: string;
    tripId: string;
    userId: string;
    numSeats: number;
    state: BookingState;
    priceAtBooking: Prisma.Decimal;
    expiresAt: Date;
    idempotencyKey: string;
    paymentReference?: string;
    refundAmount?: Prisma.Decimal;
    cancelledAt?: Date;
  }> = [
    // Trip 1 — Paris: 14 booked seats (5×CONFIRMED + 2×PENDING + 7×other)
    {
      id: "10000000-0000-0000-0000-000000000001",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-alice",
      numSeats: 2,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(900), // 450 × 2
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-alice",
      paymentReference: "pay_ref_001",
    },
    {
      id: "10000000-0000-0000-0000-000000000002",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-bob",
      numSeats: 3,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(1350), // 450 × 3
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-bob",
      paymentReference: "pay_ref_002",
    },
    {
      id: "10000000-0000-0000-0000-000000000003",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-carol",
      numSeats: 2,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(900),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-carol",
      paymentReference: "pay_ref_003",
    },
    {
      id: "10000000-0000-0000-0000-000000000004",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-dave",
      numSeats: 1,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(450),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-dave",
      paymentReference: "pay_ref_004",
    },
    {
      id: "10000000-0000-0000-0000-000000000005",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-eve",
      numSeats: 2,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(900),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-eve",
      paymentReference: "pay_ref_005",
    },
    {
      id: "10000000-0000-0000-0000-000000000006",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-frank",
      numSeats: 1,
      state: "PENDING_PAYMENT",
      priceAtBooking: new Prisma.Decimal(450),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-frank",
    },
    {
      id: "10000000-0000-0000-0000-000000000007",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-grace",
      numSeats: 1,
      state: "PENDING_PAYMENT",
      priceAtBooking: new Prisma.Decimal(450),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-grace",
    },
    {
      id: "10000000-0000-0000-0000-000000000008",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-henry",
      numSeats: 1,
      state: "CANCELLED",
      priceAtBooking: new Prisma.Decimal(450),
      expiresAt: in15Min,
      idempotencyKey: "idem-paris-henry",
      refundAmount: new Prisma.Decimal(405), // 450 × 0.90 (10% fee)
      cancelledAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      id: "10000000-0000-0000-0000-000000000009",
      tripId: "00000000-0000-0000-0000-000000000001",
      userId: "user-irene",
      numSeats: 2,
      state: "EXPIRED",
      priceAtBooking: new Prisma.Decimal(900),
      expiresAt: expired15MinAgo,
      idempotencyKey: "idem-paris-irene",
    },

    // Trip 2 — Tokyo: 2 booked seats
    {
      id: "10000000-0000-0000-0000-000000000010",
      tripId: "00000000-0000-0000-0000-000000000002",
      userId: "user-alice",
      numSeats: 1,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(1200),
      expiresAt: in15Min,
      idempotencyKey: "idem-tokyo-alice",
      paymentReference: "pay_ref_010",
    },
    {
      id: "10000000-0000-0000-0000-000000000011",
      tripId: "00000000-0000-0000-0000-000000000002",
      userId: "user-bob",
      numSeats: 1,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(1200),
      expiresAt: in15Min,
      idempotencyKey: "idem-tokyo-bob",
      paymentReference: "pay_ref_011",
    },

    // Trip 4 — Bali: 4 booked seats
    {
      id: "10000000-0000-0000-0000-000000000012",
      tripId: "00000000-0000-0000-0000-000000000004",
      userId: "user-carol",
      numSeats: 2,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(1750), // 875 × 2
      expiresAt: in15Min,
      idempotencyKey: "idem-bali-carol",
      paymentReference: "pay_ref_012",
    },
    {
      id: "10000000-0000-0000-0000-000000000013",
      tripId: "00000000-0000-0000-0000-000000000004",
      userId: "user-dave",
      numSeats: 1,
      state: "CONFIRMED",
      priceAtBooking: new Prisma.Decimal(875),
      expiresAt: in15Min,
      idempotencyKey: "idem-bali-dave",
      paymentReference: "pay_ref_013",
    },
    {
      id: "10000000-0000-0000-0000-000000000014",
      tripId: "00000000-0000-0000-0000-000000000004",
      userId: "user-eve",
      numSeats: 1,
      state: "EXPIRED",
      priceAtBooking: new Prisma.Decimal(875),
      expiresAt: expired15MinAgo,
      idempotencyKey: "idem-bali-eve",
    },
  ];

  let created = 0;
  for (const b of bookings) {
    await prisma.booking.upsert({
      where: { id: b.id },
      update: {},
      create: b,
    });
    created++;
  }

  console.log(`✅ Created ${created} bookings`);
  console.log("🎉 Seed complete — app is ready to use");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
