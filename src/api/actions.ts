import axios from "axios";
import { getGroupName } from "../service/common";
import Bot from "../Bot";
import { IsInResult } from "./types";
import logger from "../utils/logger";
import config from "../config";

const isMember = async (
  groupId: string,
  platformUserId: number
): Promise<boolean> => {
  logger.verbose({ message: "isMember", meta: { groupId, platformUserId } });

  try {
    if (!platformUserId) {
      throw new Error(`PlatformUserId doesn't exists for ${platformUserId}.`);
    }

    const member = await Bot.client.getChatMember(groupId, +platformUserId);

    return member !== undefined && member.status === "member";
  } catch (_) {
    return false;
  }
};

const isIn = async (groupId: number): Promise<IsInResult> => {
  try {
    const chat = await Bot.client.getChat(groupId);

    if (!["supergroup", "channel"].includes(chat.type)) {
      return {
        ok: false,
        message:
          "This is not a Supergroup!\n" +
          "Please convert this group into a Supergroup first!"
      };
    }

    const botId = (await Bot.client.getMe()).id;
    const membership = await Bot.client.getChatMember(groupId, botId);

    if (membership.status !== "administrator") {
      return {
        ok: false,
        message: "It seems like our Bot hasn't got the right permissions."
      };
    }

    if (chat?.photo?.small_file_id) {
      try {
        const fileInfo = await axios.get(
          `https://api.telegram.org/bot${config.telegramToken}/getFile?file_id=${chat.photo.small_file_id}`
        );

        if (!fileInfo.data.ok) {
          throw Error("cannot fetch file info");
        }

        const blob = await axios.get(
          `https://api.telegram.org/file/bot${config.telegramToken}/${fileInfo.data.result.file_path}`,
          { responseType: "arraybuffer" }
        );

        return {
          ok: true,
          groupName: (chat as any).title,
          groupIcon: `data:image/jpeg;base64,${blob.data.toString("base64")}`
        };
      } catch {
        return {
          ok: true,
          groupName: (chat as any).title,
          groupIcon: ""
        };
      }
    }

    return {
      ok: true,
      groupName: (chat as any).title,
      groupIcon: ""
    };
  } catch (err) {
    return {
      ok: false,
      message: `You have to add @${Bot.info.username} to your Telegram group/channel to continue!`
    };
  }
};

const getUser = async (platformUserId: number) => {
  logger.verbose({ message: "getUser", meta: { platformUserId } });

  const chat = await Bot.client.getChat(platformUserId);

  if (chat?.photo?.small_file_id) {
    const fileInfo = await axios.get(
      `https://api.telegram.org/bot${config.telegramToken}/getFile?file_id=${chat.photo.small_file_id}`
    );

    if (!fileInfo.data.ok) {
      throw Error("cannot fetch file info");
    }

    const blob = await axios.get(
      `https://api.telegram.org/file/bot${config.telegramToken}/${fileInfo.data.result.file_path}`,
      { responseType: "arraybuffer" }
    );

    return {
      username: (chat as any).username,
      avatar: `data:image/jpeg;base64,${blob.data.toString("base64")}`
    };
  }

  return {
    username: (chat as any).username
  };
};

export { getGroupName, isMember, isIn, getUser };
