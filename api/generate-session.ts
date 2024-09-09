import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { input } from "@inquirer/prompts";

const apiId = await input({ message: "Enter your API ID" });
const apiHash = await input({ message: "Enter your API Hash" });
const stringSession = new StringSession("");

const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () =>
    await input({ message: "Enter your phone number with country code" }),
  password: async () => await input({ message: "Enter your password" }),
  phoneCode: async () =>
    await input({ message: "Enter the code that you recieved" }),
  onError: (err) => console.error(err),
});

console.log("You should now be connected.");
console.log(client.session.save());
process.exit(0);
