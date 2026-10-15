import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// The scanner. Follows every import, direct AND transitive, from each portal
// file, and reports any path that reaches a forbidden module. Stricter than
// the ESLint rule, which only sees the import written in the file itself.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");

export const FORBIDDEN: Array<{ label: string; test: (file: string) => boolean }> = [
  { label: "@/lib/db/client", test: (f) => f === join(SRC, "lib", "db", "client.ts") },
  {
    label: "@/lib/queries*",
    test: (f) => dirname(f) === join(SRC, "lib") && /^queries[^/\\]*\.tsx?$/.test(f.split(sep).pop()!),
  },
  { label: "@/lib/leads/queries-admin", test: (f) => f === join(SRC, "lib", "leads", "queries-admin.ts") },
  { label: "@/lib/leads/store", test: (f) => f === join(SRC, "lib", "leads", "store.ts") },
];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

export type Fs = { read: (f: string) => string; exists: (f: string) => boolean };

const realFs: Fs = {
  read: (f) => readFileSync(f, "utf8"),
  exists: (f) => existsSync(f) && statSync(f).isFile(),
};

function resolveImport(from: string, spec: string, fs: Fs): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package, not our code
  for (const ext of ["", ".ts", ".tsx", `${sep}index.ts`, `${sep}index.tsx`]) {
    if (fs.exists(base + ext)) return base + ext;
  }
  return null;
}

export function findForbiddenImports(entries: string[], fs: Fs = realFs): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const seen = new Set<string>();
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const hit = FORBIDDEN.find((f) => f.test(file));
      if (hit) {
        problems.push(`${[...chain, file].map((f) => relative(process.cwd(), f)).join(" -> ")}  [${hit.label}]`);
        return;
      }
      for (const m of fs.read(file).matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3];
        const target = resolveImport(file, spec, fs);
        if (target) walk(target, [...chain, file]);
      }
    };
    walk(entry, []);
  }
  return problems;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const PORTAL_DIRS = [
  join(SRC, "lib", "portal"),
  join(SRC, "app", "(portal)"),
  join(SRC, "app", "api", "portal"),
];

const portalFiles = PORTAL_DIRS.flatMap(filesUnder).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
);

describe("portal code cannot reach the shared database or admin queries", () => {
  it("found the portal files to scan", () => {
    expect(portalFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(PORTAL_DIRS)("scans files in %s", (dir) => {
    expect(portalFiles.filter((f) => f.startsWith(dir + sep)).length).toBeGreaterThan(0);
  });

  it("no portal file imports a forbidden module, directly or transitively", () => {
    expect(findForbiddenImports(portalFiles)).toEqual([]);
  });

  // The scanner has to be able to fail, or the test above proves nothing.
  describe("the scanner itself", () => {
    const fake = (files: Record<string, string>): Fs => ({
      read: (f) => files[f] ?? "",
      exists: (f) => f in files,
    });
    const P = (...p: string[]) => join(SRC, ...p);

    it("catches a DIRECT import", () => {
      const fs = fake({ [P("lib/portal/a.ts")]: `import { db } from "@/lib/db/client";`, [P("lib/db/client.ts")]: "" });
      expect(findForbiddenImports([P("lib/portal/a.ts")], fs)).toHaveLength(1);
    });

    it("catches a TRANSITIVE import two files away", () => {
      const fs = fake({
        [P("lib/portal/a.ts")]: `import { x } from "../leads/helper";`,
        [P("lib/leads/helper.ts")]: `export * from "./store";`,
        [P("lib/leads/store.ts")]: "",
      });
      const found = findForbiddenImports([P("lib/portal/a.ts")], fs);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("helper.ts -> src/lib/leads/store.ts");
    });

    it.each([
      [`import { getPpcReport } from "@/lib/queries";`, "lib/queries.ts"],
      [`import { x } from "@/lib/queries-lsa";`, "lib/queries-lsa.ts"],
      [`import type { AdminLeadRow } from "@/lib/leads/queries-admin";`, "lib/leads/queries-admin.ts"],
      [`const m = await import("@/lib/db/client");`, "lib/db/client.ts"],
    ])("catches %s", (code, target) => {
      const fs = fake({ [P("lib/portal/a.ts")]: code, [P(target)]: "" });
      expect(findForbiddenImports([P("lib/portal/a.ts")], fs)).toHaveLength(1);
    });

    it("does not flag allowed modules", () => {
      const fs = fake({
        [P("lib/portal/a.ts")]: `import { toIsoDateEastern } from "@/lib/date-utils";\nimport postgres from "postgres";`,
        [P("lib/date-utils.ts")]: "",
      });
      expect(findForbiddenImports([P("lib/portal/a.ts")], fs)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// The service-role key may be read in exactly one place.
// ---------------------------------------------------------------------------

describe("the service-role key", () => {
  // Assembled so this file does not itself contain the name it searches for.
  const NAME = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
  const ALLOWED = join(SRC, "lib", "portal", "provision.ts");

  it("appears in no file under src/ other than src/lib/portal/provision.ts", () => {
    const offenders = filesUnder(SRC)
      .filter((f) => f !== ALLOWED && /\.(ts|tsx|js|mjs|cjs|json)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes(NAME))
      .map((f) => relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });
});
