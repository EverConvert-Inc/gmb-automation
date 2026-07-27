// The 8 tags the team currently uses in real CallRail tagging practice.
// Seeded for every existing PPC/LSA client by migration 0016 (original 5),
// 0018 (Wrong Number), 0019 (Opportunity), 0027 (Client), and 0028
// (Marketing); new clients get the same defaults from the client-creation
// API routes. Editable per client afterward — this is just the starting
// point, not a fixed list.
//
// "Signed" was removed as a default by migration 0029 — "Opportunity" is
// now the sole real-rollup tag going forward. This is unrelated to
// ppc_clients/lsa_clients.signed_case_tag and signed_case_name_filters,
// which power the separate "Signed Cases" KPI on /ppc, /lsa, and PDFs.
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
    label: "Opportunity",
    callrailTagName: "Opportunity",
    rollup: "real",
    sortOrder: 6,
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
