import "dotenv/config";
import app from "./app";
import { prisma } from "./db/client";
import { startExpiryJob, stopExpiryJob } from "./jobs/expiryJob";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.log("[DB] Connected to PostgreSQL");

  const server = app.listen(PORT, () => {
    console.log(`[Server] GoTyolo running on port ${PORT}`);
  });

  // Start background jobs after the server is listening
  startExpiryJob();

  // Graceful shutdown — stop jobs, finish in-flight requests, close DB connections
  const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received — shutting down gracefully`);
    stopExpiryJob();
    server.close(async () => {
      await prisma.$disconnect();
      console.log("[DB] Disconnected. Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[Fatal] Failed to start server:", err);
  process.exit(1);
});
