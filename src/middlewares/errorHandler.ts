import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  // Prisma unique constraint violation — treat as 409
  // P2002 is Prisma's error code for unique constraint failures
  if ((err as { code?: string }).code === "P2002") {
    res.status(409).json({
      error: "A record with this key already exists.",
    });
    return;
  }

  // Unexpected error — log it, hide details from client in production
  console.error("[Unhandled Error]", err);

  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
}
