export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false, public details?: unknown) { super(message); }
}
