import { env } from "../env";
import * as schema from "./schema";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres(env.DATABASE_URI);

export const db = drizzle(client, {
  schema,
  logger: env.NODE_ENV === "development",
});
