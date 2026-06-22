import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./types.js";

export const statusCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("봇의 현재 상태를 확인합니다."),

  async execute(interaction) {
    await interaction.reply({
      content: `정상 작동 중입니다. 응답 시간: ${interaction.client.ws.ping}ms`,
      ephemeral: true,
    });
  },
};
