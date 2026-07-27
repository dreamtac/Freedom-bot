import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { sendNewsPost } from "../notifications/discord-news.js";
import type { NewsPost } from "../sources/types.js";
import type { BotCommand } from "./types.js";

export const testNotificationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("test-notification")
    .setDescription("설정된 공지 채널로 테스트 알림을 전송합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction, context) {
    if (!context.notificationChannelId) {
      await interaction.reply({
        content: "DISCORD_NOTIFICATION_CHANNEL_ID가 설정되지 않았습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const testPost: NewsPost = {
      id: "test-notification",
      sourceKey: "endfield",
      source: "명일방주: 엔드필드",
      category: "notices",
      title: "테스트 알림입니다",
      summary:
        "공지 감지 봇이 이 채널에 메시지를 정상적으로 보낼 수 있습니다. 실제 새 공지가 발견되면 같은 형식으로 전송됩니다.",
      publishedAt: new Date(),
      url: "https://endfield.gryphline.com/ko-kr/news",
      imageUrl:
        "https://web-static.hg-cdn.com/endfield/official-v4/_next/static/media/share-oversea.6f430b84.jpg",
    };

    try {
      await sendNewsPost(
        interaction.client,
        context.notificationChannelId,
        testPost,
      );
    } catch (error: unknown) {
      if (isMissingAccessError(error)) {
        await interaction.editReply(
          "봇이 설정된 채널에 접근할 수 없습니다. 봇을 서버에 Guild Install했는지와 채널의 `채널 보기`, `메시지 보내기`, `링크 첨부` 권한을 확인해 주세요.",
        );
        return;
      }

      throw error;
    }

    await interaction.editReply(
      `<#${context.notificationChannelId}> 채널로 테스트 알림을 전송했습니다.`,
    );
  },
};

function isMissingAccessError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  const code = (error as Error & { code: unknown }).code;
  return code === 50_001 || code === 50_013;
}
