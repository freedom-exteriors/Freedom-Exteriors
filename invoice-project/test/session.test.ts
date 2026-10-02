import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/lib/session";

beforeEach(() => {
  process.env.SESSION_SECRET = "s".repeat(40);
  process.env.APP_PASSWORD = "correct horse battery";
});

describe("session", () => {
  it("accepts a fresh token", async () => {
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });
  it("rejects tampered, expired, and garbage tokens", async () => {
    const t = await createSessionToken();
    expect(await verifySessionToken(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(await verifySessionToken(await createSessionToken(Date.now() - 15 * 86_400_000))).toBe(false);
    expect(await verifySessionToken("abc")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });
  it("changing the password logs everyone out", async () => {
    const t = await createSessionToken();
    process.env.APP_PASSWORD = "a new password";
    expect(await verifySessionToken(t)).toBe(false);
  });
  it("changing SESSION_SECRET logs everyone out", async () => {
    const t = await createSessionToken();
    process.env.SESSION_SECRET = "t".repeat(40);
    expect(await verifySessionToken(t)).toBe(false);
  });
  it("checks the password", async () => {
    expect(await passwordMatches("correct horse battery")).toBe(true);
    expect(await passwordMatches("wrong")).toBe(false);
  });
  it("refuses to work with a weak setup", async () => {
    process.env.SESSION_SECRET = "short";
    expect(await passwordMatches("correct horse battery")).toBe(false);
  });
});
