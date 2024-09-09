import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db } from "./db";

async function main() {
  await migrate(db, { migrationsFolder: "./api/drizzle/migrations" });
  process.exit(0);
}

main();
