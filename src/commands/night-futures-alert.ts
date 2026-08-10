import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { NIGHT_FUTURES_ALERT_THRESHOLDS } from "../storage/price-alert-store.js";
import type { BotCommand } from "./types.js";

export const nightFuturesAlertCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("야간선물알림")
    .setDescription("KOSPI 야간선물 기준가격 대비 실시간 알림을 관리합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("켜기")
        .setDescription("KOSPI 야간선물 +/-1%부터 8% 알림을 켭니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("끄기")
        .setDescription("KOSPI 야간선물 실시간 알림을 끕니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("상태")
        .setDescription("KOSPI 야간선물 실시간 알림 상태를 확인합니다."),
    ),

  async execute(interaction, context) {
    if (!context.priceAlertStore) {
      await interaction.reply({
        content: "야간선물 알림 저장소를 열지 못했습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === "상태") {
      const enabled = context.priceAlertStore.isNightFuturesAlertEnabled();
      await interaction.reply({
        embeds: [buildNightFuturesAlertStatusEmbed(enabled)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "켜기") {
      if (!context.kis || !context.notificationChannelId) {
        await interaction.reply({
          content:
            "실시간 야간선물 알림에는 KIS API 키와 `DISCORD_NOTIFICATION_CHANNEL_ID` 설정이 모두 필요합니다.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const enabled = context.priceAlertStore.setNightFuturesAlertEnabled(true);
      if (!enabled) {
        await interaction.reply({
          content:
            "실시간 주가 알림 종목이 40개 등록되어 있습니다. KOSPI 야간선물 알림을 켜려면 종목 알림을 최소 1개 제거해 주세요.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      context.priceAlertMonitor?.refresh();
      await interaction.reply({
        content:
          "KOSPI 야간선물 실시간 알림을 켰습니다. KRX 야간장(18:00~06:00)에서 기준가격 대비 +/-1%부터 8%까지 각 구간을 세션당 한 번씩 알립니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    context.priceAlertStore.setNightFuturesAlertEnabled(false);
    context.priceAlertMonitor?.refresh();
    await interaction.reply({
      content: "KOSPI 야간선물 실시간 알림을 껐습니다.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

function buildNightFuturesAlertStatusEmbed(enabled: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(enabled ? 0xd92d20 : 0x667085)
    .setTitle("KOSPI 야간선물 실시간 알림")
    .addFields(
      {
        name: "상태",
        value: enabled ? "켜짐" : "꺼짐",
        inline: true,
      },
      {
        name: "감시 구간",
        value: NIGHT_FUTURES_ALERT_THRESHOLDS.map((threshold) => `+/-${threshold}%`).join(" · "),
        inline: false,
      },
    )
    .setFooter({ text: "KRX 야간장 18:00~06:00 · 기준가격 대비" });
}
