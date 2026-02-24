export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    // Operational errors are expected (bad input, conflict, not found).
    // Non-operational errors (programmer mistakes) bubble up as 500s.
    this.isOperational = true;

    // Maintain proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
