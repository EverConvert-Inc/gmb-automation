import { describe, expect, it } from "vitest";
import {
  FORM_NAME_FIELDS,
  FORM_PHONE_FIELDS,
  resolveContact,
} from "./form-fallbacks";

const NOTHING = {} as const;

describe("field name constants", () => {
  // Pinned because CallRail rejects a whole request on an unknown field
  // name, and these are UNVERIFIED against a live form submission.
  it("are the documented form_data keys, in fallback order", () => {
    expect([...FORM_NAME_FIELDS]).toEqual(["name", "full_name"]);
    expect([...FORM_PHONE_FIELDS]).toEqual(["phone", "phone_number"]);
  });
});

describe("the note always wins", () => {
  it("uses the note's name and phone and ignores every fallback", () => {
    expect(
      resolveContact(
        { name: "Jane Doe", phone: "555-123-4567" },
        {
          customerName: "Wrong Name",
          customerPhoneNumber: "555-999-8888",
          formData: { name: "Also Wrong", phone: "555-000-0000" },
        },
      ),
    ).toEqual({
      name: "Jane Doe",
      phone: "555-123-4567",
      nameSource: "note",
      phoneSource: "note",
    });
  });
});

describe("name fallback order", () => {
  it.each([
    [
      "customer_name first",
      { customerName: "From Customer", formData: { name: "From Form" } },
      "From Customer",
      "customer_name",
    ],
    [
      "form_data.name when customer_name is absent",
      { formData: { name: "From Form" } },
      "From Form",
      "form_data",
    ],
    [
      "form_data.full_name when form_data.name is absent",
      { formData: { full_name: "From Full Name" } },
      "From Full Name",
      "form_data",
    ],
    [
      "form_data.name wins over full_name",
      { formData: { name: "Short", full_name: "Long" } },
      "Short",
      "form_data",
    ],
  ])("%s", (_label, source, expected, expectedSource) => {
    const r = resolveContact({ name: null, phone: null }, source);
    expect(r.name).toBe(expected);
    expect(r.nameSource).toBe(expectedSource);
  });

  it("is null with source 'none' when nothing supplies a name", () => {
    const r = resolveContact({ name: null, phone: null }, NOTHING);
    expect(r.name).toBeNull();
    expect(r.nameSource).toBe("none");
  });
});

describe("phone fallback order", () => {
  it.each([
    [
      "customer_phone_number first",
      { customerPhoneNumber: "555-111-1111", formData: { phone: "555-222-2222" } },
      "555-111-1111",
      "customer_phone_number",
    ],
    [
      "form_data.phone when customer_phone_number is absent",
      { formData: { phone: "555-222-2222" } },
      "555-222-2222",
      "form_data",
    ],
    [
      "form_data.phone_number when form_data.phone is absent",
      { formData: { phone_number: "555-333-3333" } },
      "555-333-3333",
      "form_data",
    ],
    [
      "form_data.phone wins over phone_number",
      { formData: { phone: "555-222-2222", phone_number: "555-333-3333" } },
      "555-222-2222",
      "form_data",
    ],
  ])("%s", (_label, source, expected, expectedSource) => {
    const r = resolveContact({ name: null, phone: null }, source);
    expect(r.phone).toBe(expected);
    expect(r.phoneSource).toBe(expectedSource);
  });

  it("is null with source 'none' when nothing supplies a phone", () => {
    const r = resolveContact({ name: null, phone: null }, NOTHING);
    expect(r.phone).toBeNull();
    expect(r.phoneSource).toBe("none");
  });
});

describe("name and phone resolve independently", () => {
  // The case the name-only parse rule produces: a note gave a name but no
  // number. The name must survive while only the phone falls back.
  it("keeps the note's name and falls back for the phone only", () => {
    expect(
      resolveContact(
        { name: "Jane Doe", phone: null },
        { customerName: "Wrong", customerPhoneNumber: "555-999-8888" },
      ),
    ).toEqual({
      name: "Jane Doe",
      phone: "555-999-8888",
      nameSource: "note",
      phoneSource: "customer_phone_number",
    });
  });

  it("keeps the note's phone and falls back for the name only", () => {
    expect(
      resolveContact(
        { name: null, phone: "555-123-4567" },
        { customerName: "From Customer" },
      ),
    ).toEqual({
      name: "From Customer",
      phone: "555-123-4567",
      nameSource: "customer_name",
      phoneSource: "note",
    });
  });

  it("can take name and phone from two different fallback levels", () => {
    const r = resolveContact(
      { name: null, phone: null },
      { customerName: "From Customer", formData: { phone: "555-222-2222" } },
    );
    expect(r.nameSource).toBe("customer_name");
    expect(r.phoneSource).toBe("form_data");
  });
});

describe("hygiene", () => {
  it.each([["", "empty string"], ["   ", "whitespace"]])(
    "treats a %s value as absent (%s)",
    (blank) => {
      const r = resolveContact(
        { name: blank, phone: blank },
        { customerName: blank, customerPhoneNumber: "555-111-1111" },
      );
      expect(r.name).toBeNull();
      expect(r.phone).toBe("555-111-1111");
    },
  );

  it("trims the values it returns", () => {
    const r = resolveContact(
      { name: null, phone: null },
      { customerName: "  Jane Doe  ", customerPhoneNumber: "  555-111-1111 " },
    );
    expect(r.name).toBe("Jane Doe");
    expect(r.phone).toBe("555-111-1111");
  });

  it("ignores non-string form_data values instead of coercing them", () => {
    const r = resolveContact(
      { name: null, phone: null },
      { formData: { name: 42, full_name: null, phone: { x: 1 }, phone_number: true } },
    );
    expect(r.name).toBeNull();
    expect(r.phone).toBeNull();
  });

  it.each([[null], [undefined]])("survives form_data being %s", (formData) => {
    const r = resolveContact(
      { name: null, phone: null },
      { formData: formData as Record<string, unknown> | null | undefined },
    );
    expect(r).toEqual({
      name: null,
      phone: null,
      nameSource: "none",
      phoneSource: "none",
    });
  });

  it("does not read a field that is not in the allowed list", () => {
    const r = resolveContact(
      { name: null, phone: null },
      { formData: { first_name: "Jane", mobile: "555-111-1111" } },
    );
    expect(r.name).toBeNull();
    expect(r.phone).toBeNull();
  });
});
