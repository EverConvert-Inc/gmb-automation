// Wires the real CallRail client and the real Drizzle store into the
// injected shape sync.ts expects. Importing THIS pulls in the db client;
// importing sync.ts alone does not, which is what keeps the orchestration
// testable without a database.

import {
  fetchCallsForCompany,
  fetchFormSubmissionsForCompany,
  listTrackerCompanyIds,
  probeTagFilterSemantics,
} from "./callrail-client";
import { drizzleLeadStore } from "./store";
import type { SyncDeps } from "./sync";

export function createSyncDeps(): SyncDeps {
  return {
    listCompanyIds: (opts) => listTrackerCompanyIds(opts),
    fetchCalls: (companyId, from, to, opts) =>
      fetchCallsForCompany(companyId, from, to, opts),
    fetchForms: (companyId, from, to, opts) =>
      fetchFormSubmissionsForCompany(companyId, from, to, opts),
    probeTagFilter: (kind, companyId, from, to, opts) =>
      probeTagFilterSemantics(kind, companyId, from, to, opts),
    store: drizzleLeadStore,
    now: () => new Date(),
  };
}
