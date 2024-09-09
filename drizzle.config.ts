import { defineConfig } from "drizzle-kit";

import { env } from "./api/env";

export default defineConfig({
  schema: "./api/drizzle/schema.ts",
  out: "./api/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URI,
  },
  verbose: env.NODE_ENV === "development",
  strict: true,
});
