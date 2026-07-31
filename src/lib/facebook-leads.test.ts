import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLeadFieldEntries,
  extractStandardFields,
  verifyFacebookSignature,
} from "./facebook-leads";
import type { FieldDataEntry } from "./facebook-leads";

describe("buildLeadFieldEntries", () => {
  it("maps field_data to labels from the form's question list, preserving order", () => {
    const fieldData: FieldDataEntry[] = [
      { name: "full_name", values: ["Jane Doe"] },
      { name: "best_time_to_call", values: ["Afternoon"] },
    ];
    const labels = new Map([
      ["full_name", "Full Name"],
      ["best_time_to_call", "What's the best time to call you?"],
    ]);

    expect(buildLeadFieldEntries(fieldData, labels)).toEqual([
      { key: "full_name", label: "Full Name", value: "Jane Doe" },
      {
        key: "best_time_to_call",
        label: "What's the best time to call you?",
        value: "Afternoon",
      },
    ]);
  });

  it("falls back to a humanized field key when no label is available", () => {
    const fieldData: FieldDataEntry[] = [{ name: "preferred_service_type", values: ["Roofing"] }];

    expect(buildLeadFieldEntries(fieldData, new Map())).toEqual([
      { key: "preferred_service_type", label: "Preferred Service Type", value: "Roofing" },
    ]);
  });

  it("joins multi-value answers (e.g. checkboxes) with a comma", () => {
    const fieldData: FieldDataEntry[] = [
      { name: "services_interested", values: ["Roofing", "Gutters"] },
    ];

    expect(buildLeadFieldEntries(fieldData, new Map())[0].value).toBe("Roofing, Gutters");
  });
});

describe("extractStandardFields", () => {
  it("pulls the known Meta contact fields out of field_data by key", () => {
    const fieldData: FieldDataEntry[] = [
      { name: "full_name", values: ["Jane Doe"] },
      { name: "email", values: ["jane@example.com"] },
      { name: "phone_number", values: ["555-1234"] },
      { name: "state", values: ["GA"] },
      { name: "custom_question", values: ["Answer"] },
    ];

    expect(extractStandardFields(fieldData)).toEqual({
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "555-1234",
      state: "GA",
    });
  });

  it("returns null for any standard field missing from the form", () => {
    const fieldData: FieldDataEntry[] = [{ name: "full_name", values: ["Jane Doe"] }];

    expect(extractStandardFields(fieldData)).toEqual({
      fullName: "Jane Doe",
      email: null,
      phone: null,
      state: null,
    });
  });
});

describe("verifyFacebookSignature", () => {
  const appSecret = "test-app-secret";
  const rawBody = JSON.stringify({ object: "page", entry: [{ id: "123" }] });

  function sign(body: string, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  }

  it("accepts a signature computed over the exact raw body with the correct secret", () => {
    const header = sign(rawBody, appSecret);
    expect(verifyFacebookSignature(rawBody, header, appSecret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const header = sign(rawBody, "some-other-secret");
    expect(verifyFacebookSignature(rawBody, header, appSecret)).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const header = sign(rawBody, appSecret);
    const tamperedBody = JSON.stringify({ object: "page", entry: [{ id: "456" }] });
    expect(verifyFacebookSignature(tamperedBody, header, appSecret)).toBe(false);
  });

  it("rejects when the header is missing", () => {
    expect(verifyFacebookSignature(rawBody, null, appSecret)).toBe(false);
  });

  it("rejects when the header doesn't have the sha256= prefix", () => {
    const bareHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    expect(verifyFacebookSignature(rawBody, bareHex, appSecret)).toBe(false);
  });
});
