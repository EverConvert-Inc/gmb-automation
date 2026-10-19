// Every select in the admin is AdminSelect: the shared Select with the
// native arrow replaced by a chevron. No bare <select>, and no direct use of
// the shared Select, anywhere under the admin's files.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminSelect } from "@/components/leads/admin-select";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });

const ADMIN_FILES = [...walk("src/app/admin"), ...walk("src/components/leads")].filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
);
const SELECT_HOME = "src/components/leads/admin-select.tsx";

describe("admin selects", () => {
  it("finds the admin files", () => {
    expect(ADMIN_FILES).toContain("src/components/leads/admin-leads-filters.tsx");
    expect(ADMIN_FILES).toContain("src/components/leads/admin-lead-drawer.tsx");
    expect(ADMIN_FILES).toContain(SELECT_HOME);
  });

  it.each(ADMIN_FILES)("%s: no bare <select>", (f) => {
    expect(read(f)).not.toMatch(/<select\b/);
  });

  it.each(ADMIN_FILES.filter((f) => f !== SELECT_HOME))("%s: no direct shared Select", (f) => {
    expect(read(f)).not.toMatch(/<Select\b/);
    expect(read(f)).not.toMatch(/import \{[^}]*\bSelect\b[^}]*\} from "@\/components\/ui\/form"/);
  });

  it("the filters and the drawer use it: month, firm, status, opportunity", () => {
    expect(read("src/components/leads/admin-leads-filters.tsx").match(/<AdminSelect\b/g)).toHaveLength(2);
    expect(read("src/components/leads/admin-lead-drawer.tsx").match(/<AdminSelect\b/g)).toHaveLength(2);
  });
});

describe("AdminSelect", () => {
  const html = renderToStaticMarkup(
    createElement(AdminSelect, { id: "s", defaultValue: "b", "aria-label": "Pick" },
      createElement("option", { value: "a" }, "A"),
      createElement("option", { value: "b" }, "B"),
    ),
  );
  const select = html.match(/<select[^>]*>/)![0];
  const icon = html.match(/<svg[^>]*>/)![0];

  it("is still a native select, with its props passed through", () => {
    expect(select).toContain('id="s"');
    expect(select).toContain('aria-label="Pick"');
    expect(html).toContain('<option value="b" selected="">B</option>');
  });

  it("drops the native arrow and leaves room for the chevron", () => {
    expect(select).toContain("appearance-none");
    expect(select).toContain("pr-9");
  });

  it("keeps the shared input height, border, radius and focus ring", () => {
    for (const c of ["h-9", "rounded-md", "border-input", "focus-visible:ring-ring"]) expect(select).toContain(c);
  });

  it("the chevron: 12px from the right, centred, muted, decorative, click-through", () => {
    for (const c of ["right-3", "top-1/2", "-translate-y-1/2", "text-muted-foreground", "pointer-events-none"]) {
      expect(icon).toContain(c);
    }
    expect(icon).toContain('aria-hidden="true"');
    expect(html.indexOf("<select")).toBeLessThan(html.indexOf("<svg")); // after the select, for peer-disabled
  });
});
