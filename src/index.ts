import "dotenv/config";
import app from "./app";
import { prisma } from "./db/client";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.log("[DB] Connected to PostgreSQL");

  const server = app.listen(PORT, () => {
    console.log(`[Server] GoTyolo running on port ${PORT}`);
  });

  // Graceful shutdown — finish in-flight requests, close DB connections
  const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received — shutting down gracefully`);
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
