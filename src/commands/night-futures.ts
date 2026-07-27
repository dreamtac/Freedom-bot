import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { getCurrentKospi200NightFuturesContract } from "../sources/krx-night-futures.js";
import { KisClient } from "../sources/kis.js";
import type { KisFuturesQuote } from "../sources/kis.js";
import type { BotCommand } from "./types.js";

export const nightFuturesCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("야간선물")
    .setDescription("KOSPI 야간선물 최근월물 시세를 조회합니다."),

  async execute(interaction, context) {
    if (!context.kis) {
      await interaction.reply({
        content:
          "KIS API 키가 아직 설정되지 않았습니다. `.env`에 `KIS_APP_KEY`와 `KIS_APP_SECRET`을 추가한 뒤 봇을 재시작해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    try {
      const contract = await getCurrentKospi200NightFuturesContract();
      const quote = await new KisClient(context.kis).fetchKrxNightFuturesQuote(
        contract.code,
      );
      await interaction.editReply({
        embeds: [buildNightFuturesEmbed(quote)],
      });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : "KOSPI200 야간선물 시세를 조회하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

export function buildNightFuturesEmbed(
  quote: KisFuturesQuote,
): EmbedBuilder {
  const prefix = quote.changeDirection === "up" ? "+" : quote.changeDirection === "down" ? "-" : "";
  const change = Math.abs(quote.change);
  const changeRate = Math.abs(quote.changeRate);

  return new EmbedBuilder()
    .setColor(getQuoteColor(quote))
    .setTitle("KOSPI 야간선물")
    .setDescription([
      `**현재가 ${formatNumber(quote.price)}**`,
      `전일 대비 ${prefix}${formatNumber(change)} (${prefix}${changeRate.toFixed(2)}%)`,
    ].join("\n"))
    .addFields(
      {
        name: "장중 범위",
        value: [
          `시가 ${quote.open === undefined ? "-" : formatNumber(quote.open)}`,
          `고가 ${quote.high === undefined ? "-" : formatNumber(quote.high)}`,
          `저가 ${quote.low === undefined ? "-" : formatNumber(quote.low)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "거래 정보",
        value: [
          `전일 종가 ${quote.previousClose === undefined ? "-" : formatNumber(quote.previousClose)}`,
          `누적 거래량 ${quote.volume === undefined ? "-" : formatNumber(quote.volume)}계약`,
        ].join("\n"),
        inline: true,
      },
    )
    .setFooter({ text: `KIS Open API · KRX 야간장 · ${formatDate(quote.requestedAt)}` });
}

function getQuoteColor(quote: KisFuturesQuote): number {
  if (quote.changeDirection === "up") return 0xd92d20;
  if (quote.changeDirection === "down") return 0x1570ef;
  return 0x667085;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}
