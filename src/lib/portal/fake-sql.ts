// TEST HELPER ONLY — imported by the portal's *.test.ts files, never by app
// code. A stand-in for a postgres.js `sql` tag that records the final SQL text
// and bound parameters of every query it runs, including nested fragments and
// sql.unsafe() pieces, and answers with whatever rows the test supplies.

export type FakeCall = { text: string; params: unknown[] };

class Fragment {
  constructor(
    readonly strings: readonly string[],
    readonly values: readonly unknown[],
  ) {}
}
class Raw {
  constructor(readonly text: string) {}
}

function flatten(f: Fragment, params: unknown[]): string {
  let text = f.strings[0];
  f.values.forEach((value, i) => {
    if (value instanceof Fragment) text += flatten(value, params);
    else if (value instanceof Raw) text += value.text;
    else {
      params.push(value);
      text += `$${params.length}`;
    }
    text += f.strings[i + 1];
  });
  return text;
}

export function makeFakeSql(respond: (call: FakeCall) => unknown[] | Promise<unknown[]>) {
  const calls: FakeCall[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment = new Fragment(strings, values);
    // Lazy like postgres.js: a fragment only runs if it is awaited as the
    // outer query. Nested fragments are inlined, never executed.
    return Object.assign(fragment, {
      then(resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) {
        const params: unknown[] = [];
        const text = flatten(fragment, params).replace(/\s+/g, " ").trim();
        const call = { text, params };
        calls.push(call);
        return Promise.resolve()
          .then(() => respond(call))
          .then(resolve, reject);
      },
    });
  }) as unknown as ((...args: unknown[]) => unknown) & { unsafe: (t: string) => Raw };
  sql.unsafe = (text: string) => new Raw(text);
  return { sql, calls };
}
