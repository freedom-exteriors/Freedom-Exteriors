export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = "Sign in required") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, "forbidden", message);
/** Also used for "exists but you're not a member", so workspace IDs can't be probed. */
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
