import type { z } from "zod";
import { HttpError } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, "invalid_input", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input");
  }
  return r.data;
}
