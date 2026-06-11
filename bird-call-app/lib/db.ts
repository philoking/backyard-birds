import postgres from "postgres";

export { LOCAL_TZ } from "./tz";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  global.__sql ??
  postgres({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    ssl: "prefer",
  });

if (process.env.NODE_ENV !== "production") global.__sql = sql;
