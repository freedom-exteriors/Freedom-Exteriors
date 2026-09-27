import { test } from "node:test";
import assert from "node:assert/strict";
import { Crypter } from "../src/lib/crypto.js";
import { FeedError, isBlockedAddress, normalizeFeedUrl, safeLookup } from "../src/ingestion/safe-fetch.js";
import { TEST_KEY } from "./helpers.js";

test("credential encryption round-trips and detects tampering / wrong key", () => {
  const c = new Crypter(TEST_KEY);
  const blob = c.encrypt("hunter2");
  assert.ok(!Buffer.from(blob).toString("utf8").includes("hunter2"));
  assert.notDeepEqual(c.encrypt("hunter2"), blob, "random IV per value");
  assert.equal(c.decrypt(blob), "hunter2");
  const tampered = new Uint8Array(blob);
  tampered[tampered.length - 1]! ^= 1;
  assert.throws(() => c.decrypt(tampered));
  assert.throws(() => new Crypter(Buffer.alloc(32, 9).toString("base64")).decrypt(blob));
  assert.throws(() => new Crypter("dG9vIHNob3J0"), /32 bytes/);
});

test("SSRF: private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "142.250.72.14", "2607:f8b0:4009:80b::200e", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("feed URL normalization", () => {
  assert.equal(normalizeFeedUrl("webcal://example.com/cal.ics").toString(), "https://example.com/cal.ics");
  for (const bad of ["file:///etc/passwd", "ftp://x.com/a.ics", "http://127.0.0.1/cal.ics", "http://[::1]/c", "http://169.254.169.254/latest/meta-data", "http://localhost:3000/", "https://user:pw@example.com/c.ics", "not a url"]) {
    assert.throws(() => normalizeFeedUrl(bad), FeedError, bad);
  }
});

test("SSRF: hostnames that *resolve* to private IPs are refused at connect time", async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => safeLookup("localhost", {}, (e) => resolve(e)));
  assert.equal(err?.code, "EBLOCKED");
});
