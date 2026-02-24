import express from "express";
import { errorHandler } from "./middlewares/errorHandler";
import tripRoutes from "./routes/tripRoutes";
import bookingRoutes from "./routes/bookingRoutes";
import webhookRoutes from "./routes/webhookRoutes";

const app = express();

// ── Core middleware ──────────────────────────────────────────────────────────
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/trips", tripRoutes);
app.use("/bookings", bookingRoutes);
app.use("/webhooks", webhookRoutes);
// app.use("/admin", adminRoutes);        — added in Step 8

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

export default app;
