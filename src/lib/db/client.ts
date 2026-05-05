import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __pgClient: ReturnType<typeof postgres> | undefined;
  var __drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (globalThis.__drizzleDb) return globalThis.__drizzleDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client =
    globalThis.__pgClient ?? postgres(connectionString, { max: 5, prepare: false });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__pgClient = client;
  }

  const instance = drizzle(client, { schema });
  globalThis.__drizzleDb = instance;
  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const real = getDb();
    return Reflect.get(real, prop, receiver);
  },
});

export { schema };
