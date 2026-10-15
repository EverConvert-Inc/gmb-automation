import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/lib/db/migrations/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Client portal isolation. Portal code reaches the database only through
  // src/lib/portal/db.ts. src/lib/portal/isolation.test.ts enforces the same
  // rule transitively; this catches it in the editor as it is written.
  {
    files: ["src/lib/portal/**", "src/app/(portal)/**", "src/app/api/portal/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/db/client",
                "@/lib/queries",
                "@/lib/queries-*",
                "@/lib/leads/queries-admin",
                "@/lib/leads/store",
              ],
              message:
                "Portal code must use src/lib/portal/db.ts, never the shared db client or admin queries.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
