import { EmbedBuilder, type Client } from "discord.js";

import type { MarketCloseReportMarket } from "../storage/price-alert-store.js";

export interface MarketCloseIndexResult {
  name: string;
  price: number;
  changeRate: number;
}

export interface MarketCloseStockResult {
  code: string;
  name: string;
  price: number;
  changeRate: number;
}

export interface MarketCloseReferenceResult {
  name: string;
  price: number;
  changeRate: number;
  valuePrefix?: string;
  valueSuffix?: string;
}

export interface MarketCloseReportNotification {
  market: MarketCloseReportMarket;
  tradingDate: string;
  indexes: readonly MarketCloseIndexResult[];
  references?: readonly MarketCloseReferenceResult[];
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
        `${index + 1}. **${stock.name}**  ${formatStockPrice(stock.price, report.market)}  ${formatRate(stock.changeRate)}`,
    ),
  ).map((value, index) => ({
    name: index === 0
      ? `관심 종목 · ${report.stocks.length}개`
      : "관심 종목 · 계속",
    value,
    inline: false,
  }));
  const referenceFields = report.references && report.references.length > 0
    ? [{
        name: "아침 시장 지표 · 오전 7시 기준",
        value: report.references
          .map((reference) =>
            `**${reference.name}**  ${formatReferenceValue(reference)}  ${formatRate(reference.changeRate)}`
          )
          .join("\n"),
        inline: false,
      }]
    : [];

  return new EmbedBuilder()
    .setColor(primaryRate > 0 ? 0xd92d20 : primaryRate < 0 ? 0x1570ef : 0x667085)
    .setTitle(`${marketLabel} 마감`)
    .addFields(
      {
        name: "주요 지수",
        value: report.indexes
          .map((index) =>
            `**${index.name}**  ${formatIndexPrice(index.price)}  ${formatRate(index.changeRate)}`
          )
          .join("\n"),
        inline: false,
      },
      ...referenceFields,
      ...stockFields,
      {
        name: "종목 요약",
        value: `상승 ${rising}종목 · 보합 ${flat}종목 · 하락 ${falling}종목`,
        inline: false,
      },
    )
    .setFooter({
      text: report.market === "overseas" && referenceFields.length > 0
        ? `KIS Open API · ${formatTradingDate(report.tradingDate)} 미국 정규장 마감 · 부가 지표 오전 7시 최신값`
        : `KIS Open API · ${formatTradingDate(report.tradingDate)} 정규장 마감 기준`,
    })
    .setTimestamp();
}

function formatReferenceValue(reference: MarketCloseReferenceResult): string {
  const value = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(reference.price);
  return `${reference.valuePrefix ?? ""}${value}${reference.valueSuffix ?? ""}`;
}

function formatIndexPrice(price: number): string {
  return `${formatNumber(price, 2, 2)}pt`;
}

function formatStockPrice(
  price: number,
  market: MarketCloseReportMarket,
): string {
  return market === "domestic"
    ? `${formatNumber(price, 0, 0)}원`
    : `$${formatNumber(price, 2, 4)}`;
}

function formatNumber(
  value: number,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
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
