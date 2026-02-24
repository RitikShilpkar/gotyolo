import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// In development, ts-node-dev re-executes modules on each file change.
// Without this guard, every reload creates a new PrismaClient and leaks
// database connections. The global object persists across module reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7 uses the "client" engine (WASM-based) by default, which requires
// a database adapter. PrismaPg wraps the pg driver for direct connections.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
