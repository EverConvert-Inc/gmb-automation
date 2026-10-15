// Scans the BUILT browser chunks (.next/static) for the service-role key's
// variable name and for this phase's server-only module. Meaningful only
// after `next build`; skipped when there is no build output.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STATIC = join(process.cwd(), ".next", "static");
const NAME = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe.skipIf(!existsSync(STATIC))("built client chunks", () => {
  const chunks = existsSync(STATIC) ? files(STATIC).filter((f) => f.endsWith(".js")) : [];

  it("exist", () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("never mention the service-role key's name or the provisioning functions", () => {
    const hits = chunks.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes(NAME) || src.includes("generateTemporaryPassword") || src.includes("serviceRoleAuth");
    });
    expect(hits).toEqual([]);
  });
});
