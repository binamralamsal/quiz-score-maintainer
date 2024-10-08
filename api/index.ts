import crypto from "crypto";
import express from "express";
import { Bot, webhookCallback } from "grammy";
import type { Request, Response } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { env } from "./env.js";
import { db } from "./drizzle/db.js";
import { client } from "./telegram-user.client.js";
import { quizzes, scores, users } from "./drizzle/schema.js";

const bot = new Bot(env.BOT_TOKEN);

const QUIZ_BOT_ID = 983000232;

bot.command("start", (ctx) => {
  ctx.reply("Hey");
});

bot.command("addscore", async (ctx) => {
  if (!ctx.message) return;

  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const chatMember = await ctx.api.getChatMember(
      ctx.chat.id,
      ctx.message.from.id
    );

    if (
      chatMember.status !== "administrator" &&
      chatMember.status !== "creator"
    ) {
      return ctx.reply("Only admins of the group can use this command.");
    }
  }

  const quizTag = ctx.match ? ctx.match.toLowerCase() : null;
  const replyToMessage = ctx.message?.reply_to_message;
  const chatId = ctx.chat.id;

  if (!replyToMessage) {
    return ctx.reply(
      "Please reply to a message including quiz scores of quizbot."
    );
  }

  const messageUserId = replyToMessage.from?.id;
  let forwardSenderUserId = 0; // Temporary value

  const forwardOrigin = replyToMessage.forward_origin;
  if (forwardOrigin && forwardOrigin.type === "user") {
    forwardSenderUserId = forwardOrigin.sender_user.id;
  }

  if (messageUserId !== QUIZ_BOT_ID) {
    if (forwardSenderUserId !== QUIZ_BOT_ID) {
      return ctx.reply("Please reply to a message from quizbot.");
    }
  }

  const messageText = replyToMessage.text;
  if (!messageText) {
    return;
  }

  const md5Hash = crypto.createHash("md5").update(messageText).digest("hex");
  const quizExists = await db.query.quizzes.findFirst({
    where: and(
      eq(quizzes.resultsHash, md5Hash),
      eq(quizzes.chatId, chatId.toString())
    ),
  });

  if (quizExists) {
    return ctx.reply("This quiz has already been added.");
  }

  const updateMessage = await ctx.reply("Scanning all participants...");

  const quizName =
    messageText.match(/The quiz '(.+?)' has finished!/)?.[1] || "";

  const results: {
    username?: string;
    userId?: string;
    name: string;
    score: number;
  }[] = [];

  const userPattern = /(?:🥇|🥈|🥉|\d+\.)\s*(.+?)\s*–\s*(\d+)/g;
  let match;

  while ((match = userPattern.exec(messageText)) !== null) {
    const user = match[1];
    const score = parseInt(match[2]);

    if (user.includes("@")) {
      try {
        await client.connect();
        const userDetails = await client.getEntity(user.trim());
        // @ts-expect-error
        const firstName = userDetails.firstName;
        // @ts-expect-error
        const lastName = userDetails.lastName;
        const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`;
        const userId = userDetails.id.toString();

        results.push({
          username: user.trim(),
          name: fullName,
          score,
          userId,
        });
      } catch {
        continue;
      }
    } else {
      results.push({ name: user.trim(), score });
    }
  }

  ctx.api.editMessageText(
    chatId,
    updateMessage.message_id,
    "Inserting scores of all users in database..."
  );

  await db.transaction(async (tx) => {
    const [quiz] = await tx
      .insert(quizzes)
      .values({
        chatId: chatId.toString(),
        title: quizName,
        resultsHash: md5Hash,
        quizTag: quizTag,
      })
      .returning({ id: quizzes.id });

    const usersWithId = results.filter((score) => score.userId);
    const usersWithoutId = results.filter((score) => !score.userId);

    const insertedUsersWithId = await tx
      .insert(users)
      .values(
        usersWithId.map((score) => ({
          name: score.name,
          username: score.username,
          userId: score.userId,
        }))
      )
      .onConflictDoUpdate({
        target: users.userId,
        set: {
          name: sql`excluded.name`,
          username: sql`excluded.username`,
        },
      })
      .returning({ id: users.id, userId: users.userId, name: users.name });

    const insertedUsersWithoutId = await Promise.all(
      usersWithoutId.map(async (score) => {
        const [existingUser] = await tx
          .select()
          .from(users)
          .where(eq(users.name, score.name))
          .limit(1);

        if (existingUser) {
          return existingUser;
        } else {
          const [newUser] = await tx
            .insert(users)
            .values({
              name: score.name,
              username: score.username,
            })
            .returning({
              id: users.id,
              userId: users.userId,
              name: users.name,
            });
          return newUser;
        }
      })
    );

    const insertedUsers = [...insertedUsersWithId, ...insertedUsersWithoutId];

    const scoreValues = insertedUsers.map((user) => ({
      userId: user.id,
      quizId: quiz.id,
      score:
        results.find((r) => r.userId === user.userId || r.name === user.name)
          ?.score ?? 0,
    }));

    await tx.insert(scores).values(scoreValues);
  });

  return ctx.api.editMessageText(
    chatId,
    updateMessage.message_id,
    "All scores from given quiz added successfully"
  );
});

bot.command("quizzes", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const quizTag = ctx.match ? ctx.match.toLowerCase() : null;

  const quizzesForChatWithTag = await db
    .select({
      title: quizzes.title,
    })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.chatId, chatId),
        quizTag ? eq(quizzes.quizTag, quizTag) : undefined
      )
    );

  return ctx.reply(`<blockquote>All Quizzes Part of this group</blockquote>
    
${quizzesForChatWithTag
  .map((quiz, index) => `${index + 1}. ${quiz.title}`)
  .join("\n")}`);
});

bot.command("quizboard", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const quizTag = ctx.match ? ctx.match.toLowerCase() : null;

  if (quizTag) {
    const quizExists = await db.query.quizzes.findFirst({
      where: eq(quizzes.quizTag, quizTag),
    });

    if (!quizExists) {
      return ctx.reply("No quizzes of given tag exists.");
    }
  }

  const userScores = await db
    .select({
      username: users.username,
      name: users.name,
      userId: users.userId,
      totalScore: sql<number>`sum(${scores.score})`,
    })
    .from(users)
    .innerJoin(scores, eq(users.id, scores.userId))
    .innerJoin(quizzes, eq(scores.quizId, quizzes.id))
    .where(
      and(
        eq(quizzes.chatId, chatId),
        quizTag ? eq(quizzes.quizTag, quizTag) : undefined
      )
    )
    .groupBy(users.id, users.username, users.name, users.userId)
    .orderBy(desc(sql`sum(${scores.score})`))
    .limit(30);

  ctx.reply(formatLeaderboardMessage(userScores, quizTag), {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
  });
});

type LeaderboardEntry = {
  userId: string | null;
  name: string;
  username: string | null;
  totalScore: number;
};

function formatLeaderboardMessage(
  data: LeaderboardEntry[],
  quizTag: string | null
) {
  const blocks = data.reduce((acc, entry, index) => {
    const rank = index < 3 ? ["🥇", "🥈", "🥉"][index] : "🔅";

    let usernameLink = entry.name;
    if (entry.username) {
      usernameLink = `<a href="t.me/${entry.username.replace("@", "")}">${
        entry.name
      }</a>`;
    }

    const line = `${rank}${usernameLink} - ${entry.totalScore} pts`;

    if (index === 0 || index === 3 || (index > 3 && (index - 3) % 10 === 0)) {
      acc.push([]);
    }
    acc[acc.length - 1].push(line);

    return acc;
  }, [] as string[][]);

  const formattedEntries = blocks
    .map((block) => `<blockquote>${block.join("\n")}</blockquote>`)
    .join("\n");

  return `<blockquote>🏆 Game Leaderboard${
    quizTag ? ` of #<code>${quizTag}</code>` : ""
  } 🏆</blockquote>\n\n${formattedEntries}\n\n<blockquote>Proudly built with ❤️ by Binamra Lamsal @BinamraBots.</blockquote>`;
}

bot.command("quiztags", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const quizTags = await db
    .selectDistinct({
      quizTag: quizzes.quizTag,
    })
    .from(quizzes)
    .where(and(eq(quizzes.chatId, chatId), isNotNull(quizzes.quizTag)));

  if (quizTags.length === 0) {
    return ctx.reply("No quizzes with quiztag found in this group.");
  }

  await ctx.reply(
    `<blockquote>${quizTags
      .map((tag) => `<code>${tag.quizTag}</code>`)
      .join("\n")}</blockquote>`,
    {
      parse_mode: "HTML",
    }
  );
});

bot.command("removescore", async (ctx) => {
  if (!ctx.message) return;

  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const chatMember = await ctx.api.getChatMember(
      ctx.chat.id,
      ctx.message.from.id
    );

    if (
      chatMember.status !== "administrator" &&
      chatMember.status !== "creator"
    ) {
      return ctx.reply("Only admins of the group can use this command.");
    }
  }

  const replyToMessage = ctx.message?.reply_to_message;
  const chatId = ctx.chat.id.toString();

  if (!replyToMessage) {
    return ctx.reply(
      "Please reply to a message including quiz scores of quizbot."
    );
  }

  const messageText = replyToMessage.text;
  if (!messageText) {
    return;
  }

  const md5Hash = crypto.createHash("md5").update(messageText).digest("hex");

  await db
    .delete(quizzes)
    .where(and(eq(quizzes.resultsHash, md5Hash), eq(quizzes.chatId, chatId)));

  return ctx.reply("Scores of mentioned quiz removed successfully!.");
});

if (env.NODE_ENV === "development") {
  bot.start({
    onStart: () => console.log("Bot started"),
  });
}

async function init() {
  await bot.api.setMyCommands([
    { command: "addscore", description: "Add score of a quiz." },
    { command: "quizboard", description: "Show leaderboard of quiz." },
    { command: "quiztags", description: "Show quiztags of quiz." },
    { command: "removescore", description: "Remove score of a quiz." },
  ]);
}

init();

const app = express();
app.use(express.json());
app.use(webhookCallback(bot, "express"));

app.get("/", (req: Request, res: Response) => {
  res.send("Bot is running!");
});

export default app;
