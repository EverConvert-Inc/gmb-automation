import { describe, expect, it } from "vitest";
import { buildLeadFieldEntries, extractStandardFields } from "./facebook-leads";
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
