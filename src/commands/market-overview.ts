import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { KisApiError, KisClient } from "../sources/kis.js";
import type { KisIndexQuote } from "../sources/kis.js";
import { MARKET_INDEXES } from "../sources/market-indexes.js";
import type { MarketIndexDefinition } from "../sources/market-indexes.js";
import type { BotCommand } from "./types.js";

interface MarketIndexResult extends MarketIndexDefinition {
  quote: KisIndexQuote;
}

export const marketOverviewCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("시장현황")
    .setDescription("한국과 미국의 주요 지수 현황을 조회합니다."),

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
      const client = new KisClient(context.kis);
      const results = await Promise.allSettled(
        MARKET_INDEXES.map(async (index): Promise<MarketIndexResult> => ({
          ...index,
          quote: index.market === "domestic"
            ? await client.fetchDomesticIndexQuote(index.code)
            : await client.fetchOverseasIndexQuote(index.code),
        })),
      );
      const quotes = results
        .filter((result): result is PromiseFulfilledResult<MarketIndexResult> =>
          result.status === "fulfilled",
        )
        .map((result) => result.value);

      if (quotes.length === 0) {
        const firstError = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        throw firstError?.reason instanceof KisApiError
          ? firstError.reason
          : new KisApiError("주요 지수 데이터를 가져오지 못했습니다.");
      }

      await interaction.editReply({
        embeds: [buildMarketOverviewEmbed(quotes, quotes.length !== MARKET_INDEXES.length)],
      });
    } catch (error: unknown) {
      const message = error instanceof KisApiError
        ? error.message
        : "시장 현황을 조회하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

export function buildMarketOverviewEmbed(
  indexes: readonly MarketIndexResult[],
  hasUnavailableIndex = false,
): EmbedBuilder {
  const requestedAt = indexes.reduce(
    (latest, index) =>
      index.quote.requestedAt > latest ? index.quote.requestedAt : latest,
    indexes[0]?.quote.requestedAt ?? new Date(),
  );
  const domesticIndexes = indexes.filter((index) => index.market === "domestic");
  const overseasIndexes = indexes.filter((index) => index.market === "overseas");
  const fields = [
    domesticIndexes.length > 0
      ? {
          name: "한국 시장 · KRX",
          value: domesticIndexes.map(formatIndexLine).join("\n\n"),
          inline: false,
        }
      : undefined,
    overseasIndexes.length > 0
      ? {
          name: "미국 시장 · 주요 지수",
          value: overseasIndexes.map(formatIndexLine).join("\n\n"),
          inline: false,
        }
      : undefined,
    buildDomesticMarketBreadthField(domesticIndexes),
  ].filter((field): field is { name: string; value: string; inline: boolean } =>
    field !== undefined,
  );
  const description = hasUnavailableIndex
    ? "전일 대비와 장중 범위입니다. 일부 지수는 현재 조회하지 못했습니다."
    : "전일 대비와 장중 범위입니다.";

  return new EmbedBuilder()
    .setColor(0x1570ef)
    .setTitle("주요 시장 현황")
    .setDescription(description)
    .addFields(fields)
    .setFooter({ text: `KIS Open API · ${formatDate(requestedAt)}` });
}

function formatIndexLine(index: MarketIndexResult): string {
  const { quote } = index;
  const prefix = quote.changeDirection === "up"
    ? "+"
    : quote.changeDirection === "down"
      ? "-"
      : "";
  const range = quote.low !== undefined && quote.high !== undefined
    ? ` · 장중 ${formatNumber(quote.low)} - ${formatNumber(quote.high)}`
    : "";
  return [
    `**${index.name}**  **${formatNumber(quote.price)}**`,
    `전일 대비 ${prefix}${formatNumber(Math.abs(quote.change))} (${prefix}${Math.abs(quote.changeRate).toFixed(2)}%)${range}`,
  ].join("\n");
}

function buildDomesticMarketBreadthField(
  indexes: readonly MarketIndexResult[],
): { name: string; value: string; inline: boolean } | undefined {
  const values = indexes.flatMap((index) => {
    const { advancingIssues, flatIssues, decliningIssues } = index.quote;
    if (
      advancingIssues === undefined ||
      flatIssues === undefined ||
      decliningIssues === undefined
    ) {
      return [];
    }
    return [
      `**${index.name}**  상승 ${formatNumber(advancingIssues)} · 보합 ${formatNumber(flatIssues)} · 하락 ${formatNumber(decliningIssues)}`,
    ];
  });
  if (values.length === 0) {
    return undefined;
  }
  return {
    name: "국내 시장 폭",
    value: values.join("\n"),
    inline: false,
  };
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
