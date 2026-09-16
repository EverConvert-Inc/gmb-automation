import { describe, expect, it } from "vitest";
import { costPerSignedCase, groupByState, pickDefaultExpandedState, UNASSIGNED_STATE } from "./report-grouping";

type Client = { id: string; state: string | null; signedCases: number };

function client(id: string, state: string | null, signedCases = 0): Client {
  return { id, state, signedCases };
}

const zero = () => ({ count: 0, signedCases: 0 });
const add = (acc: { count: number; signedCases: number }, c: Client) => ({
  count: acc.count + 1,
  signedCases: acc.signedCases + c.signedCases,
});

describe("groupByState", () => {
  it("buckets a client whose state is in STATE_ORDER under that state", () => {
    const groups = groupByState([client("a", "GA")], zero, add);
    expect(groups).toHaveLength(1);
    expect(groups[0].state).toBe("GA");
    expect(groups[0].clients.map((c) => c.id)).toEqual(["a"]);
  });

  it("buckets a null-state client as Unassigned", () => {
    const groups = groupByState([client("a", null)], zero, add);
    expect(groups).toHaveLength(1);
    expect(groups[0].state).toBe(UNASSIGNED_STATE);
  });

  // The bug this guards: a valid US state outside the 5-state STATE_ORDER
  // (e.g. FL, now allowed by the DB CHECK constraint) used to keep its own
  // literal bucket key, which the STATE_ORDER/Unassigned scan never reads
  // back out — the client silently vanished from stateGroups entirely
  // instead of landing in Unassigned.
  it("folds a valid state outside STATE_ORDER into Unassigned instead of dropping it", () => {
    const groups = groupByState([client("a", "FL")], zero, add);
    expect(groups).toHaveLength(1);
    expect(groups[0].state).toBe(UNASSIGNED_STATE);
    expect(groups[0].clients.map((c) => c.id)).toEqual(["a"]);
  });

  it("mixes a real state and an out-of-scope state into the same Unassigned bucket", () => {
    const groups = groupByState(
      [client("a", null), client("b", "FL"), client("c", "GA")],
      zero,
      add,
    );
    const byState = new Map(groups.map((g) => [g.state, g]));
    expect(byState.get("GA")?.clients.map((c) => c.id)).toEqual(["c"]);
    expect(byState.get(UNASSIGNED_STATE)?.clients.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("omits a state with zero clients rather than rendering an empty group", () => {
    const groups = groupByState([client("a", "GA")], zero, add);
    expect(groups.some((g) => g.state === "NC")).toBe(false);
  });

  it("orders groups GA, NC, SC, TN, TX, then Unassigned", () => {
    const groups = groupByState(
      [
        client("a", "TX"),
        client("b", null),
        client("c", "GA"),
        client("d", "TN"),
      ],
      zero,
      add,
    );
    expect(groups.map((g) => g.state)).toEqual(["GA", "TN", "TX", UNASSIGNED_STATE]);
  });
});

describe("pickDefaultExpandedState", () => {
  it("picks the real state with the most signed cases", () => {
    const groups = groupByState(
      [client("a", "GA", 2), client("b", "NC", 9), client("c", "TX", 5)],
      zero,
      add,
    );
    expect(pickDefaultExpandedState(groups)).toBe("NC");
  });

  it("never picks Unassigned over a real state, even with more signed cases", () => {
    const groups = groupByState(
      [client("a", "GA", 1), client("b", null, 999)],
      zero,
      add,
    );
    expect(pickDefaultExpandedState(groups)).toBe("GA");
  });

  it("ties break by STATE_ORDER (alphabetical by full name)", () => {
    const groups = groupByState(
      [client("a", "TX", 5), client("b", "GA", 5)],
      zero,
      add,
    );
    expect(pickDefaultExpandedState(groups)).toBe("GA");
  });

  it("falls back to Unassigned only when there are no real-state groups at all", () => {
    const groups = groupByState([client("a", null, 3)], zero, add);
    expect(pickDefaultExpandedState(groups)).toBe(UNASSIGNED_STATE);
  });

  it("returns null for an empty report", () => {
    expect(pickDefaultExpandedState([])).toBeNull();
  });
});

describe("costPerSignedCase", () => {
  it("divides cost by signed cases", () => {
    expect(costPerSignedCase(500_000_000n, 5)).toBe(100);
  });

  it("returns null when there are no signed cases", () => {
    expect(costPerSignedCase(500_000_000n, 0)).toBeNull();
  });
});
