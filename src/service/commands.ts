import axios from "axios";
import dayjs from "dayjs";
import { Markup } from "telegraf";
import Bot from "../Bot";
import config from "../config";
import logger from "../utils/logger";
import {
  sendPollTokenChooser,
  extractBackendErrorMessage,
  pollBuildResponse,
  initPoll,
  markdownEscape
} from "../utils/utils";
import pollStorage from "./pollStorage";
import { Ctx } from "./types";
import Main from "../Main";

const helpCommand = async (ctx: Ctx): Promise<void> => {
  try {
    const helpHeader =
      "Hello there! I'm the Guild bot.\n" +
      "I'm part of the [Guild](https://docs.guild.xyz/) project and " +
      "I am your personal assistant.\n" +
      "I will always let you know whether you can join a guild or " +
      "whether you were kicked from a guild.\n";

    let commandsList =
      "/help - show instructions\n" +
      "/ping - check if I'm alive\n" +
      "/status - update your roles on every community\n";

    const helpFooter =
      "For more details about me read the documentation on " +
      "[github](https://github.com/agoraxyz/telegram-runner).";

    // DM
    if (ctx.message.chat.id >= 0) {
      commandsList +=
        "/list - get a list of your communities' websites\n" +
        "/leave - you have to choose which community you want " +
        "to leave and I'll do the rest\n";
    }
    // group chat
    else {
      commandsList += "/groupid - shows the ID of the group";
    }

    await ctx.replyWithMarkdownV2(
      markdownEscape(`${helpHeader}\n${commandsList}\n${helpFooter}`),
      {
        disable_web_page_preview: true
      }
    );
  } catch (error) {
    logger.error(`helpCommand error - ${error.message}`);
  }
};

const startCommand = async (ctx: Ctx): Promise<void> => {
  try {
    await ctx.replyWithMarkdownV2(
      markdownEscape(
        "Visit the [Guild website](https://guild.xyz) to join guilds"
      )
    );
  } catch (error) {
    logger.error(`startCommand error - ${error.message}`);
  }
};

const pingCommand = async (ctx: Ctx): Promise<void> => {
  const { message } = ctx.update;
  const messageTime = new Date(message.date * 1000).getTime();
  const platformUserId = message.from.id;

  const currTime = new Date().getTime();

  try {
    const sender = await Bot.client.getChatMember(
      platformUserId,
      platformUserId
    );

    await ctx.replyWithMarkdownV2(
      markdownEscape(
        `Pong. @${sender.user.username} latency is ${
          currTime - messageTime
        }ms. API latency is ${new Date().getTime() - currTime}ms.`
      )
    );
  } catch (err) {
    logger.error(err.message);
  }
};

const statusUpdateCommand = async (ctx: Ctx): Promise<void> => {
  const { message } = ctx.update;
  const platformUserId = message.from.id;

  try {
    await ctx.reply(
      "I'll update your community accesses as soon as possible. (It could take up to 1 minute.)"
    );

    const statusResponse = await Main.platform.user.status(
      platformUserId.toString()
    );

    let replyMsg: string;
    if (statusResponse?.length === 0) {
      replyMsg =
        "It looks like you haven't joined any guilds that gate Telegram.";
    } else {
      replyMsg = `Currently you should have access to these groups:\n${statusResponse
        .map((sr) => sr.platformGuildName || sr.platformGuildName)
        .join("\n")}`;
    }

    await ctx.reply(replyMsg);
  } catch (err) {
    ctx
      .reply(`Cannot update your status. (${err.message})\nJoined any guilds?`)
      .catch(() => {});
    logger.error(err.message);
  }
};

const groupIdCommand = async (ctx: Ctx): Promise<void> => {
  try {
    await ctx.replyWithMarkdownV2(
      markdownEscape(`\`${ctx.update.message.chat.id}\``),
      {
        reply_to_message_id: ctx.update.message.message_id
      }
    );
  } catch (error) {
    logger.error(`groupIdCommand error - ${error.message}`);
  }
};

const addCommand = async (ctx: Ctx): Promise<void> => {
  try {
    await ctx.replyWithMarkdownV2(
      "Click to add Guild bot to your group",
      Markup.inlineKeyboard([
        Markup.button.url(
          "Add Guild bot",
          `https://t.me/${Bot.info.username}?startgroup=true`
        )
      ])
    );
  } catch (error) {
    logger.error(`addCommand error - ${error.message}`);
  }
};

const pollCommand = async (ctx: Ctx): Promise<void> => {
  initPoll(ctx);
};

const enoughCommand = async (ctx: Ctx): Promise<void> => {
  const msg = ctx.message;
  const userId = msg.from.id;

  try {
    if (msg.chat.type === "private") {
      const poll = pollStorage.getPoll(userId);

      if (poll) {
        if (pollStorage.getUserStep(userId) === 3 && poll.options.length >= 2) {
          pollStorage.setUserStep(userId, 4);

          await ctx.reply(
            "Please give me the duration of the poll in the DD:HH:mm format (days:hours:minutes)"
          );
        } else {
          await ctx.reply("You didn't finish the previous steps.");
        }
      } else {
        await ctx.reply("You don't have an active poll creation process.");
      }
    } else {
      await ctx.reply("Please use this command in private");
    }
  } catch (error) {
    logger.error(`enoughCommand error - ${error.message}`);
  }
};

const doneCommand = async (ctx: Ctx): Promise<void> => {
  const userId = ctx.message.from.id;

  try {
    if (ctx.message.chat.type !== "private") {
      return;
    }

    if (await pollBuildResponse(userId)) {
      return;
    }

    const poll = pollStorage.getPoll(userId);

    if (poll) {
      const startDate = dayjs().unix();

      await axios.post(
        `${config.backendUrl}/poll`,
        {
          platform: config.platform,
          startDate,
          ...poll
        },
        { timeout: 150000 }
      );

      pollStorage.deleteMemory(userId);

      await Bot.client.sendMessage(userId, "The poll has been created.");
    } else {
      ctx.reply("You don't have an active poll creation process.");
    }
  } catch (err) {
    pollStorage.deleteMemory(userId);

    try {
      await Bot.client.sendMessage(
        userId,
        "There was an error while creating the poll."
      );

      const errorMessage = extractBackendErrorMessage(err);

      if (errorMessage === "Poll can't be created for this guild.") {
        await Bot.client.sendMessage(userId, errorMessage);
      }
    } catch (error) {
      logger.error(error.message);
    }

    logger.error(err.message);
  }
};

const resetCommand = async (ctx: Ctx): Promise<void> => {
  const userId = ctx.message.from.id;

  try {
    if (pollStorage.getUserStep(userId) > 0) {
      const { platformGuildId } = pollStorage.getPoll(userId);

      pollStorage.deleteMemory(userId);
      pollStorage.initPoll(userId, platformGuildId);
      pollStorage.setUserStep(userId, 1);

      const guildIdRes = await axios.get(
        `${config.backendUrl}/guild/platform/${config.platform}/${platformGuildId}`
      );

      if (!guildIdRes?.data) {
        await ctx.reply("Please use this command in a guild.");

        return;
      }

      await Bot.client.sendMessage(
        userId,
        "The current poll creation procedure has been restarted."
      );

      await sendPollTokenChooser(ctx, userId, guildIdRes.data.id);
    } else {
      await Bot.client.sendMessage(
        userId,
        "You don't have an active poll creation process."
      );
    }
  } catch (err) {
    logger.error(err.message);
  }
};

const cancelCommand = async (ctx: Ctx): Promise<void> => {
  const userId = ctx.message.from.id;

  try {
    if (pollStorage.getPoll(userId)) {
      pollStorage.deleteMemory(userId);

      await Bot.client.sendMessage(
        userId,
        "The current poll creation process has been cancelled."
      );
    } else {
      await Bot.client.sendMessage(
        userId,
        "You don't have an active poll creation process."
      );
    }
  } catch (err) {
    logger.error(err.message);
  }
};

export {
  helpCommand,
  startCommand,
  pingCommand,
  statusUpdateCommand,
  groupIdCommand,
  addCommand,
  pollCommand,
  enoughCommand,
  doneCommand,
  resetCommand,
  cancelCommand
};
