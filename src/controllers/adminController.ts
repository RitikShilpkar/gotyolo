import { Request, Response } from "express";
import {
  getTripMetricsService,
  getAtRiskTripsService,
} from "../services/adminService";

export async function getTripMetricsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const tripId = String(req.params["id"]);
  const metrics = await getTripMetricsService(tripId);
  // Return metrics fields at top level to match spec
  res.json(metrics);
}

export async function getAtRiskTripsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const atRiskTrips = await getAtRiskTripsService();
  // Spec: { at_risk_trips: [...] }
  res.json({ at_risk_trips: atRiskTrips });
}
