import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  isTagChangeEvent,
  resolveCallIsReal,
  verifyCallrailWebhookSignature,
} from "./callrail-webhook";

// The exact signature captured from a real "Call Modified" webhook
// delivery. Its base64-decoded length (20 bytes / 160 bits) is what
// established the algorithm is HMAC-SHA1, not HMAC-SHA256 (32 bytes / 44
// base64 chars) as an earlier doc-only guess assumed — this is arithmetic,
// independent of the (still-unknown) real secret.
const REAL_CAPTURED_SIGNATURE = "nM+9oKWvdybRMwdT+zfzL4aVPL4=";

describe("verifyCallrailWebhookSignature", () => {
  it("the real captured signature decodes to exactly 20 bytes (HMAC-SHA1's output size, not SHA-256's 32)", () => {
    expect(Buffer.from(REAL_CAPTURED_SIGNATURE, "base64").length).toBe(20);
  });

  it("accepts a signature this implementation itself produced (self-consistency — the real secret is not available in this sandbox to test against the captured signature directly)", () => {
    const secret = "test-secret";
    const rawBody = '{"resource_id":"CAL1","company_resource_id":"COM1"}';
    const signature = createHmac("sha1", secret).update(rawBody, "utf8").digest("base64");
    expect(verifyCallrailWebhookSignature(rawBody, signature, secret)).toBe(true);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const secret = "test-secret";
    const rawBody = '{"resource_id":"CAL1","company_resource_id":"COM1"}';
    const signature = createHmac("sha1", secret).update(rawBody, "utf8").digest("base64");
    const tamperedBody = '{"resource_id":"CAL2","company_resource_id":"COM1"}';
    expect(verifyCallrailWebhookSignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejects when the secret is wrong", () => {
    const rawBody = '{"resource_id":"CAL1","company_resource_id":"COM1"}';
    const signature = createHmac("sha1", "correct-secret").update(rawBody, "utf8").digest("base64");
    expect(verifyCallrailWebhookSignature(rawBody, signature, "wrong-secret")).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyCallrailWebhookSignature("{}", null, "secret")).toBe(false);
    expect(verifyCallrailWebhookSignature("{}", undefined, "secret")).toBe(false);
  });
});

describe("isTagChangeEvent", () => {
  it("true for the real captured payload's changes array", () => {
    expect(isTagChangeEvent(["tag", "tags"])).toBe(true);
  });

  it("true for either 'tag' or 'tags' alone, case-insensitively", () => {
    expect(isTagChangeEvent(["Tag"])).toBe(true);
    expect(isTagChangeEvent(["TAGS"])).toBe(true);
  });

  it("false when tags aren't among the changed fields", () => {
    expect(isTagChangeEvent(["note", "value"])).toBe(false);
  });

  it("false for an empty or missing changes array", () => {
    expect(isTagChangeEvent([])).toBe(false);
    expect(isTagChangeEvent(null)).toBe(false);
    expect(isTagChangeEvent(undefined)).toBe(false);
  });
});

const TAG_CATEGORIES = [
  { label: "Signed", callrailTagName: "Signed", rollup: "real" as const },
  { label: "Spam", callrailTagName: "Spam", rollup: "junk" as const },
];

describe("resolveCallIsReal", () => {
  it("real for the exact real captured payload's shape (LSA 4674 Charlotte, tags include Signed)", () => {
    expect(
      resolveCallIsReal(
        "LSA 4674 Charlotte",
        ["Schuerger Shunnarah NC", "Opportunity", "MVA", "Carlos", "Already Has Chiro", "Signed"],
        ["LSA"],
        TAG_CATEGORIES,
      ),
    ).toBe(true);
  });

  it("false when the tracker name doesn't match this client's name filters", () => {
    expect(
      resolveCallIsReal("PPC - Brand", ["Signed"], ["LSA"], TAG_CATEGORIES),
    ).toBe(false);
  });

  it("false when tags don't include a configured real category", () => {
    expect(
      resolveCallIsReal("LSA 4674 Charlotte", ["Opportunity"], ["LSA"], TAG_CATEGORIES),
    ).toBe(false);
  });

  it("false (Junk wins) when tags include both a real and junk category", () => {
    expect(
      resolveCallIsReal("LSA 4674 Charlotte", ["Signed", "Spam"], ["LSA"], TAG_CATEGORIES),
    ).toBe(false);
  });

  it("is case-insensitive on tags and tracker name", () => {
    expect(
      resolveCallIsReal("lsa 4674 charlotte", ["signed"], ["LSA"], TAG_CATEGORIES),
    ).toBe(true);
  });
});
