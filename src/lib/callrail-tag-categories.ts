// The 8 tags the team currently uses in real CallRail tagging practice.
// Seeded for every existing PPC/LSA client by migration 0016 (original 5),
// 0018 (Wrong Number), 0019 (Opportunity), 0027 (Client), 0028
// (Marketing), and 0030 (reverted 0029's Signed/Opportunity swap — Signed
// is back, Opportunity is gone); new clients get the same defaults from
// the client-creation API routes. Editable per client afterward — this is
// just the starting point, not a fixed list.
//
// "Outside Practice Area"/"Outside Service Area" (no "of") match the
// actual CallRail tag names in use — migration 0020 fixed an earlier
// "Outside of ..." mismatch that caused those tagged calls to fall into
// Unclassified instead of Junk.
export const DEFAULT_CALLRAIL_TAG_CATEGORIES: Array<{
  label: string;
  callrailTagName: string;
  rollup: "real" | "junk";
  sortOrder: number;
}> = [
  { label: "Signed", callrailTagName: "Signed", rollup: "real", sortOrder: 0 },
  { label: "Pending", callrailTagName: "Pending", rollup: "real", sortOrder: 1 },
  { label: "Spam", callrailTagName: "Spam", rollup: "junk", sortOrder: 2 },
  {
    label: "Outside Practice Area",
    callrailTagName: "Outside Practice Area",
    rollup: "junk",
    sortOrder: 3,
  },
  {
    label: "Outside Service Area",
    callrailTagName: "Outside Service Area",
    rollup: "junk",
    sortOrder: 4,
  },
  {
    label: "Wrong Number",
    callrailTagName: "Wrong Number",
    rollup: "junk",
    sortOrder: 5,
  },
  {
    label: "Client",
    callrailTagName: "Client",
    rollup: "junk",
    sortOrder: 7,
  },
  {
    label: "Marketing",
    callrailTagName: "Marketing",
    rollup: "junk",
    sortOrder: 8,
  },
];
