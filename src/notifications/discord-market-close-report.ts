import { EmbedBuilder, type Client } from "discord.js";

import type { MarketCloseReportMarket } from "../storage/price-alert-store.js";

export interface MarketCloseIndexResult {
  name: string;
  changeRate: number;
}

export interface MarketCloseStockResult {
  code: string;
  name: string;
  changeRate: number;
}

export interface MarketCloseReportNotification {
  market: MarketCloseReportMarket;
  tradingDate: string;
  indexes: readonly MarketCloseIndexResult[];
  stocks: readonly MarketCloseStockResult[];
}

export async function sendMarketCloseReport(
  client: Client,
  channelId: string,
  report: MarketCloseReportNotification,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`메시지를 전송할 수 없는 채널입니다: ${channelId}`);
  }

  await channel.send({ embeds: [buildMarketCloseReportEmbed(report)] });
}

export function buildMarketCloseReportEmbed(
  report: MarketCloseReportNotification,
): EmbedBuilder {
  const rising = report.stocks.filter((stock) => stock.changeRate > 0).length;
  const falling = report.stocks.filter((stock) => stock.changeRate < 0).length;
  const flat = report.stocks.length - rising - falling;
  const marketLabel = report.market === "domestic" ? "한국 시장" : "미국 시장";
  const primaryRate = report.indexes[0]?.changeRate ?? 0;
  const stockFields = chunkLines(
    report.stocks.map(
      (stock, index) =>
        `${index + 1}. **${stock.name}**  ${formatRate(stock.changeRate)}`,
    ),
  ).map((value, index) => ({
    name: index === 0
      ? `관심 종목 · ${report.stocks.length}개`
      : "관심 종목 · 계속",
    value,
    inline: false,
  }));

  return new EmbedBuilder()
    .setColor(primaryRate > 0 ? 0xd92d20 : primaryRate < 0 ? 0x1570ef : 0x667085)
    .setTitle(`${marketLabel} 마감`)
    .addFields(
      {
        name: "주요 지수",
        value: report.indexes
          .map((index) => `**${index.name}**  ${formatRate(index.changeRate)}`)
          .join("\n"),
        inline: false,
      },
      ...stockFields,
      {
        name: "종목 요약",
        value: `상승 ${rising}종목 · 보합 ${flat}종목 · 하락 ${falling}종목`,
        inline: false,
      },
    )
    .setFooter({
      text: `KIS Open API · ${formatTradingDate(report.tradingDate)} 정규장 마감 기준`,
    })
    .setTimestamp();
}

function formatRate(rate: number): string {
  const sign = rate > 0 ? "+" : "";
  return `${sign}${rate.toFixed(2)}%`;
}

function formatTradingDate(tradingDate: string): string {
  return `${tradingDate.slice(0, 4)}. ${Number(tradingDate.slice(4, 6))}. ${Number(tradingDate.slice(6, 8))}.`;
}

function chunkLines(lines: readonly string[], maximumLength = 1_024): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maximumLength) {
      current = next;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    current = line.slice(0, maximumLength);
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}
