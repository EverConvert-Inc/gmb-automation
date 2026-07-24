// The 5 tags the team currently uses in real CallRail tagging practice.
// Seeded for every existing PPC/LSA client by migration 0016; new clients
// get the same defaults from the client-creation API routes. Editable per
// client afterward — this is just the starting point, not a fixed list.
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
    label: "Outside of Practice Area",
    callrailTagName: "Outside of Practice Area",
    rollup: "junk",
    sortOrder: 3,
  },
  {
    label: "Outside of Service Area",
    callrailTagName: "Outside of Service Area",
    rollup: "junk",
    sortOrder: 4,
  },
];
