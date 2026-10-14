import { describe, expect, it } from "vitest";
import {
  declaredPersonCount,
  findPhoneNumbers,
  normalizePhoneDigits,
  parseNote,
  splitSharedNote,
  toTitleCase,
  type ParseFailureReason,
  type ParseNoteOptions,
} from "./parse-note";

// --------------------------------------------------------------------------
// Phone detection — the foundation every other rule rests on
// --------------------------------------------------------------------------

describe("findPhoneNumbers", () => {
  const accepted: Array<[string, string, string]> = [
    // input                         expected raw (as written)   expected digits
    ["5551234567", "5551234567", "5551234567"],
    ["555-123-4567", "555-123-4567", "5551234567"],
    ["555.123.4567", "555.123.4567", "5551234567"],
    ["555 123 4567", "555 123 4567", "5551234567"],
    ["(555) 123-4567", "(555) 123-4567", "5551234567"],
    ["(555)123-4567", "(555)123-4567", "5551234567"],
    ["1-555-123-4567", "1-555-123-4567", "5551234567"],
    ["+1 555-123-4567", "+1 555-123-4567", "5551234567"],
    ["+1 (555) 123-4567", "+1 (555) 123-4567", "5551234567"],
  ];
  it.each(accepted)("matches %s and keeps it as written", (input, raw, digits) => {
    const found = findPhoneNumbers(input);
    expect(found).toHaveLength(1);
    expect(found[0].raw).toBe(raw);
    expect(found[0].digits).toBe(digits);
  });

  // The malformed digit-run case. A run longer or shorter than a real US
  // number must match NOTHING — not its first or last 10 digits.
  const rejected: string[] = [
    "1234567", // 7 digits
    "123456789", // 9
    "55512345678", // 11 with no country code
    "555123456789", // 12
    "55512345678901", // 14 — e.g. an account number
    "0000", // short run
  ];
  it.each(rejected)("finds no phone in the malformed digit run %s", (input) => {
    expect(findPhoneNumbers(input)).toEqual([]);
  });

  it("does not pick a number out of the middle of a longer digit run", () => {
    expect(findPhoneNumbers("ref 9995551234567")).toEqual([]);
    expect(findPhoneNumbers("ref 99955512345")).toEqual([]);
  });

  it("finds several numbers in one string, in order", () => {
    const found = findPhoneNumbers("A 555-111-2222 B 555-333-4444");
    expect(found.map((p) => p.digits)).toEqual(["5551112222", "5553334444"]);
  });

  describe("extensions", () => {
    const withExt: Array<[string, string]> = [
      ["555-123-4567 ext 12", "555-123-4567 ext 12"],
      ["555-123-4567 ext. 12", "555-123-4567 ext. 12"],
      ["555-123-4567 x12", "555-123-4567 x12"],
      ["555-123-4567x12", "555-123-4567x12"],
      ["555-123-4567 extension 4455", "555-123-4567 extension 4455"],
      ["555-123-4567 #88", "555-123-4567 #88"],
    ];
    it.each(withExt)("keeps the extension in the raw match for %s", (input, raw) => {
      const found = findPhoneNumbers(input);
      expect(found).toHaveLength(1);
      expect(found[0].raw).toBe(raw);
    });

    it("strips the extension when comparing numbers", () => {
      expect(normalizePhoneDigits("555-123-4567 ext 12")).toBe("5551234567");
      expect(normalizePhoneDigits("555-123-4567 x99")).toBe("5551234567");
      expect(normalizePhoneDigits("+1 (555) 123-4567")).toBe("5551234567");
      // Which is what makes the same line written two ways compare equal.
      expect(normalizePhoneDigits("555-123-4567 ext 12")).toBe(
        normalizePhoneDigits("5551234567"),
      );
    });
  });
});

describe("toTitleCase", () => {
  it.each([
    ["jane doe", "Jane Doe"],
    ["JANE DOE", "Jane Doe"],
    ["jAnE dOe", "Jane Doe"],
    ["No Name", "No Name"],
  ])("%s -> %s", (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});

describe("splitSharedNote", () => {
  it("splits on the FIRST bar and keeps later bars inside the shared note", () => {
    expect(splitSharedNote("a, 555-123-4567 | one | two")).toEqual({
      body: "a, 555-123-4567 ",
      sharedNote: "one | two",
    });
  });
  it("returns a null shared note when there is no bar", () => {
    expect(splitSharedNote("a, 555-123-4567")).toEqual({
      body: "a, 555-123-4567",
      sharedNote: null,
    });
  });
  it("returns a null shared note when the bar is trailing and empty", () => {
    expect(splitSharedNote("a, 555-123-4567 |  ").sharedNote).toBeNull();
  });
});

describe("declaredPersonCount", () => {
  it.each([
    [["2 Person"], 2],
    [["3 person"], 3],
    [["2 Persons"], 2],
    [["2Person"], 2],
    [["Signed", "4 Person", "Opportunity"], 4],
    [["1 Person"], 1],
  ])("%s -> %s", (tags, expected) => {
    expect(declaredPersonCount(tags as string[])).toBe(expected);
  });

  it.each([[["Signed"]], [[]], [["Person"]], [["Two Person"]], [null]])(
    "%s -> null",
    (tags) => {
      expect(declaredPersonCount(tags as string[] | null)).toBeNull();
    },
  );
});

// --------------------------------------------------------------------------
// Single-person rules, in spec order
// --------------------------------------------------------------------------

type OkCase = {
  label: string;
  note: string;
  options?: ParseNoteOptions;
  name: string;
  phone: string | null;
  sharedNote?: string | null;
};

describe("parseNote — single person, successes", () => {
  const cases: OkCase[] = [
    // Rule 1
    {
      label: 'rule 1: exactly "No Name, No Number"',
      note: "No Name, No Number",
      name: "No Name",
      phone: "No Number",
    },
    {
      label: "rule 1 is case- and whitespace-insensitive",
      note: "  no name,   NO NUMBER  ",
      name: "No Name",
      phone: "No Number",
    },
    // Rule 2
    {
      label: "rule 2: name and phone from the note",
      note: "Jane Doe, 555-123-4567",
      name: "Jane Doe",
      phone: "555-123-4567",
    },
    {
      label: "rule 2: phone is kept exactly as written",
      note: "Jane Doe, (555) 123-4567",
      name: "Jane Doe",
      phone: "(555) 123-4567",
    },
    {
      label: "rule 2: name is title-cased",
      note: "jANE dOE, 5551234567",
      name: "Jane Doe",
      phone: "5551234567",
    },
    {
      label: "rule 2: phone before the name still parses",
      note: "555-123-4567 Jane Doe",
      name: "Jane Doe",
      phone: "555-123-4567",
    },
    {
      label: "rule 2: an extension is part of the phone, not the name",
      note: "Jane Doe, 555-123-4567 ext 12",
      name: "Jane Doe",
      phone: "555-123-4567 ext 12",
    },
    {
      label: "rule 2: the SAME number twice is fine — first spelling wins",
      note: "Jane Doe, 555-123-4567, 555.123.4567",
      name: "Jane Doe",
      phone: "555-123-4567",
    },
    {
      label: "rule 2: same number, one with an extension, is still one number",
      note: "Jane Doe, 555-123-4567, 5551234567 ext 9",
      name: "Jane Doe",
      phone: "555-123-4567",
    },
    // Rule 3
    {
      label: "rule 3: name only, trailing comma, phone from caller ID",
      note: "Jane Doe,",
      options: { callerIdPhone: "+15559998888" },
      name: "Jane Doe",
      phone: "+15559998888",
    },
    {
      label: "rule 3: name only with no caller ID is still a SUCCESS",
      note: "Jane Doe,",
      name: "Jane Doe",
      phone: null,
    },
    {
      label: "rule 3: blank caller ID is treated as absent, not as a phone",
      note: "Jane Doe,",
      options: { callerIdPhone: "   " },
      name: "Jane Doe",
      phone: null,
    },
    // Shared note
    {
      label: "a | shared note is stripped before the name is read",
      note: "Jane Doe, 555-123-4567 | called twice, left voicemail",
      name: "Jane Doe",
      phone: "555-123-4567",
      sharedNote: "called twice, left voicemail",
    },
  ];

  it.each(cases)("$label", ({ note, options, name, phone, sharedNote }) => {
    const result = parseNote(note, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMultiPerson).toBe(false);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toEqual({
      personSuffix: "p1",
      name,
      phone,
      statusText: null,
    });
    expect(result.sharedNote).toBe(sharedNote ?? null);
  });
});

describe("parseNote — single person, failures", () => {
  const cases: Array<{
    label: string;
    note: string | null | undefined;
    options?: ParseNoteOptions;
    reason: ParseFailureReason;
  }> = [
    { label: "empty string", note: "", reason: "empty_note" },
    { label: "whitespace only", note: "   \n ", reason: "empty_note" },
    { label: "null", note: null, reason: "empty_note" },
    { label: "undefined", note: undefined, reason: "empty_note" },
    {
      label: "TWO DIFFERENT numbers fails",
      note: "Jane Doe 555-123-4567 and John Roe 555-999-8888",
      reason: "multiple_phone_numbers",
    },
    {
      label: "two different numbers fails even when written identically",
      note: "Jane Doe, 5551234567, 5559998888",
      reason: "multiple_phone_numbers",
    },
    {
      label: "a digit run left over beside a real phone fails",
      note: "Jane Doe 12345, 555-123-4567",
      reason: "name_contains_digits",
    },
    {
      label: "a phone with nothing else has no name",
      note: "555-123-4567",
      reason: "no_name",
    },
    {
      label: "no phone and no trailing comma is unparseable",
      note: "Jane Doe",
      reason: "unparseable",
    },
    {
      label: "malformed digit run, no trailing comma, is unparseable",
      note: "Jane Doe, 55512345678901",
      reason: "unparseable",
    },
    {
      label: "trailing comma but containing digits does NOT take rule 3",
      note: "Jane Doe 55512345678901,",
      reason: "unparseable",
    },
    {
      label: "two comma-separated pieces are not a single piece (rule 3)",
      note: "Jane Doe, Acme Corp,",
      reason: "unparseable",
    },
    {
      label: "punctuation only has no name",
      note: "---, 555-123-4567",
      reason: "no_name",
    },
  ];

  it.each(cases)("$label", ({ note, options, reason }) => {
    const result = parseNote(note, options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(reason);
  });

  it("reports both numbers in the detail when two different ones are found", () => {
    const result = parseNote("Jane 555-123-4567 John 555-999-8888");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toBe("5551234567, 5559998888");
  });

  it("keeps the shared note on a failure, so the admin queue still shows it", () => {
    const result = parseNote("Jane Doe | referred by Acme");
    expect(result.ok).toBe(false);
    expect(result.sharedNote).toBe("referred by Acme");
  });
});

// --------------------------------------------------------------------------
// Multi-person
// --------------------------------------------------------------------------

describe("parseNote — multi person", () => {
  const twoPeople =
    "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending";

  it('splits on an "N Person" tag', () => {
    const result = parseNote(twoPeople, { tags: ["2 Person", "Signed"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMultiPerson).toBe(true);
    expect(result.people).toEqual([
      { personSuffix: "p1", name: "Jane Doe", phone: "555-111-2222", statusText: "Signed" },
      { personSuffix: "p2", name: "John Roe", phone: "555-333-4444", statusText: "Pending" },
    ]);
  });

  it("splits WITHOUT any tag when 2+ segments each yield a name and a real phone", () => {
    const result = parseNote(twoPeople);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMultiPerson).toBe(true);
    expect(result.people.map((p) => p.personSuffix)).toEqual(["p1", "p2"]);
    expect(result.people.map((p) => p.name)).toEqual(["Jane Doe", "John Roe"]);
  });

  it("carries the | shared note alongside every person", () => {
    const result = parseNote(`${twoPeople} | both referred by Acme`, {
      tags: ["2 Person"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sharedNote).toBe("both referred by Acme");
    expect(result.people).toHaveLength(2);
  });

  it("handles three people and keeps per-person status text", () => {
    const result = parseNote(
      "A One, 555-111-1111, Signed; B Two, 555-222-2222, Lost; C Three, 555-333-3333, Opportunity",
      { tags: ["3 Person"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people.map((p) => p.statusText)).toEqual([
      "Signed",
      "Lost",
      "Opportunity",
    ]);
  });

  it("allows a person with no status field", () => {
    const result = parseNote("A One, 555-111-1111; B Two, 555-222-2222", {
      tags: ["2 Person"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people.map((p) => p.statusText)).toEqual([null, null]);
  });

  it("title-cases each person's name and keeps each phone as written", () => {
    const result = parseNote(
      "jane doe, (555) 111-2222, Signed; JOHN ROE, 555.333.4444, Pending",
      { tags: ["2 Person"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people.map((p) => p.name)).toEqual(["Jane Doe", "John Roe"]);
    expect(result.people.map((p) => p.phone)).toEqual([
      "(555) 111-2222",
      "555.333.4444",
    ]);
  });

  it("fails when a declaring tag is present but only one person is in the note", () => {
    const result = parseNote("Jane Doe, 555-111-2222", { tags: ["2 Person"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("person_missing_name_or_phone");
  });

  it("fails when the declared count does not match what the note yields", () => {
    const result = parseNote(twoPeople, { tags: ["3 Person"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("declared_person_count_mismatch");
    expect(result.detail).toBe("tag declared 3, note yielded 2");
  });

  it("fails when a declared person has no usable phone", () => {
    const result = parseNote("Jane Doe, 555-111-2222; John Roe, no number", {
      tags: ["2 Person"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("person_missing_name_or_phone");
  });

  it("fails when a declared person's phone field holds more than the number", () => {
    const result = parseNote(
      "Jane Doe, 555-111-2222; John Roe, call 555-333-4444 after 6",
      { tags: ["2 Person"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("person_missing_name_or_phone");
  });

  it("fails when a declared person's name holds digits", () => {
    const result = parseNote(
      "Jane Doe 2, 555-111-2222; John Roe, 555-333-4444",
      { tags: ["2 Person"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("name_contains_digits");
  });

  it("a single-person note containing a semicolon still parses as one person", () => {
    const result = parseNote("Jane Doe; maiden name Smith, 555-123-4567");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMultiPerson).toBe(false);
    expect(result.people).toHaveLength(1);
  });

  // Documents a real consequence of the untagged fall-through rather than
  // hiding it: with no "N Person" tag and a second segment that has no
  // phone, the note is NOT multi-person, so rule 2 runs over the whole body
  // and both names end up in one name field. Flagged in the Phase 2
  // hand-off as a question.
  it("DOCUMENTED: untagged, second segment lacking a phone merges the names", () => {
    const result = parseNote("Jane Doe, 555-111-2222; John Roe");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMultiPerson).toBe(false);
    expect(result.people[0].name).toBe("Jane Doe John Roe");
  });

  // Likewise: the ported rule says punctuation becomes spaces, which also
  // splits intra-word punctuation. Flagged as a question.
  it("DOCUMENTED: punctuation->spaces also splits apostrophes and hyphens", () => {
    const result = parseNote("mary-jane o'brien, 555-123-4567");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people[0].name).toBe("Mary Jane O Brien");
  });

  // Likewise: rule 2 has no status field, so a trailing status on a
  // single-person note is absorbed into the name. Flagged as a question.
  it("DOCUMENTED: a trailing status on a single-person note lands in the name", () => {
    const result = parseNote("Jane Doe, 555-123-4567, Signed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people[0].name).toBe("Jane Doe Signed");
  });
});
