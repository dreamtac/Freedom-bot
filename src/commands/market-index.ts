import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { KisApiError, KisClient } from "../sources/kis.js";
import type { KisIndexQuote } from "../sources/kis.js";
import { getMarketIndex } from "../sources/market-indexes.js";
import type { MarketIndexDefinition } from "../sources/market-indexes.js";
import type { BotCommand } from "./types.js";

export const marketIndexCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("지수")
    .setDescription("주요 지수의 상세 현황을 조회합니다.")
    .addStringOption((option) =>
      option
        .setName("지수")
        .setDescription("조회할 지수입니다.")
        .setRequired(true)
        .addChoices(
          { name: "KOSPI", value: "kospi" },
          { name: "KOSDAQ", value: "kosdaq" },
          { name: "NASDAQ 종합", value: "nasdaq-composite" },
          { name: "S&P 500", value: "sp500" },
        ),
    ),

  async execute(interaction, context) {
    if (!context.kis) {
      await interaction.reply({
        content:
          "KIS API 키가 아직 설정되지 않았습니다. `.env`에 `KIS_APP_KEY`와 `KIS_APP_SECRET`을 추가한 뒤 봇을 재시작해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString("지수", true);
    const index = getMarketIndex(key);
    if (!index) {
      await interaction.reply({
        content: "지원하지 않는 지수입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    try {
      const client = new KisClient(context.kis);
      const quote = index.market === "domestic"
        ? await client.fetchDomesticIndexQuote(index.code)
        : await client.fetchOverseasIndexQuote(index.code);
      await interaction.editReply({
        embeds: [buildMarketIndexEmbed(index, quote)],
      });
    } catch (error: unknown) {
      const message = error instanceof KisApiError
        ? error.message
        : "지수 현황을 조회하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

export function buildMarketIndexEmbed(
  index: MarketIndexDefinition,
  quote: KisIndexQuote,
): EmbedBuilder {
  const prefix = quote.changeDirection === "up"
    ? "+"
    : quote.changeDirection === "down"
      ? "-"
      : "";
  const fields = [
    {
      name: "장중 범위",
      value: [
        `시가 ${formatOptionalNumber(quote.open)}`,
        `고가 ${formatOptionalNumber(quote.high)}`,
        `저가 ${formatOptionalNumber(quote.low)}`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "전일 종가",
      value: formatNumber(quote.previousClose ?? quote.price - quote.change),
      inline: true,
    },
    buildMarketBreadthField(index, quote),
  ].filter((field): field is { name: string; value: string; inline: boolean } =>
    field !== undefined,
  );

  return new EmbedBuilder()
    .setColor(getQuoteColor(quote))
    .setTitle(`${index.name} 지수`)
    .setDescription([
      `**${formatNumber(quote.price)}**`,
      `전일 대비 ${prefix}${formatNumber(Math.abs(quote.change))} (${prefix}${Math.abs(quote.changeRate).toFixed(2)}%)`,
    ].join("\n"))
    .addFields(fields)
    .setFooter({ text: `KIS Open API · ${formatDate(quote.requestedAt)}` });
}

function buildMarketBreadthField(
  index: MarketIndexDefinition,
  quote: KisIndexQuote,
): { name: string; value: string; inline: boolean } | undefined {
  if (
    index.market !== "domestic" ||
    quote.advancingIssues === undefined ||
    quote.flatIssues === undefined ||
    quote.decliningIssues === undefined
  ) {
    return undefined;
  }
  return {
    name: "국내 시장 폭",
    value: `상승 ${formatNumber(quote.advancingIssues)} · 보합 ${formatNumber(quote.flatIssues)} · 하락 ${formatNumber(quote.decliningIssues)}`,
    inline: false,
  };
}

function getQuoteColor(quote: KisIndexQuote): number {
  if (quote.changeDirection === "up") return 0xd92d20;
  if (quote.changeDirection === "down") return 0x1570ef;
  return 0x667085;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "-" : formatNumber(value);
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
