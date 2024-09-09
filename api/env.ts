import { StringSession } from "telegram/sessions/index.js";
import { z } from "zod";

export const env = z
  .object({
    BOT_TOKEN: z.string(),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    API_ID: z.coerce.number({ message: "API_ID is required" }),
    API_HASH: z.string().min(1, "API_HASH is required"),
    STRING_SESSION: z
      .string()
      .min(1, "STRING_SESSION is required")
      .transform((value) => new StringSession(value)),
    DATABASE_URI: z.string(),
  })
  .parse(process.env);
