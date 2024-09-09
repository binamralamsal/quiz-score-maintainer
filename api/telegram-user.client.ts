import { TelegramClient } from "telegram";
import { env } from "./env.js";
import { LogLevel } from "telegram/extensions/Logger";

export const client = new TelegramClient(
  env.STRING_SESSION,
  env.API_ID,
  env.API_HASH,
  {
    connectionRetries: 5,
  }
);

client.setLogLevel(
  env.NODE_ENV === "development" ? LogLevel.ERROR : LogLevel.NONE
);
