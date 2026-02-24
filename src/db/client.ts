import { PrismaClient } from "@prisma/client";

// In development, ts-node-dev re-executes modules on each file change.
// Without this guard, every reload creates a new PrismaClient and leaks
// database connections. The global object persists across module reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  // Prisma 7: DATABASE_URL is read from the environment automatically.
  // The prisma.config.ts handles CLI commands; the runtime reads env vars.
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
