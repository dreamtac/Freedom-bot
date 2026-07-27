import { EmbedBuilder, type Client } from "discord.js";

import type { StockMasterSyncResult } from "../storage/stock-store.js";
import type { StockMasterChange } from "../storage/stock-store.js";

const MAX_CHANGES_PER_FIELD = 12;

export async function sendStockMasterRefreshSummary(
  client: Client,
  channelId: string,
  result: {
    domestic: StockMasterSyncResult;
    overseas: StockMasterSyncResult;
  },
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`메시지를 전송할 수 없는 채널입니다: ${channelId}`);
  }

  const fields = [
    buildChangeField("국내 추가", result.domestic.addedStocks),
    buildChangeField("국내 제외", result.domestic.removedStocks),
    buildChangeField("미국 추가", result.overseas.addedStocks),
    buildChangeField("미국 제외", result.overseas.removedStocks),
  ].filter((field): field is { name: string; value: string; inline: boolean } =>
    field !== undefined,
  );
  const embed = new EmbedBuilder()
    .setColor(0x1570ef)
    .setTitle("종목 검색 목록 갱신")
    .setDescription("국내·미국 상장 종목 목록의 변경 사항입니다.")
    .addFields(fields)
    .setFooter({ text: "자동 종목 마스터 갱신" })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export async function sendStockMasterRefreshFailure(
  client: Client,
  channelId: string,
  error: unknown,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`메시지를 전송할 수 없는 채널입니다: ${channelId}`);
  }

  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  const embed = new EmbedBuilder()
    .setColor(0xd92d20)
    .setTitle("종목 검색 목록 갱신 실패")
    .setDescription(message.slice(0, 1_000))
    .setFooter({ text: "기존 검색 목록은 유지됩니다." })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

function buildChangeField(
  name: string,
  changes: readonly StockMasterChange[],
): { name: string; value: string; inline: boolean } | undefined {
  if (changes.length === 0) {
    return undefined;
  }
  const listedChanges = changes
    .slice(0, MAX_CHANGES_PER_FIELD)
    .map(formatChange);
  if (changes.length > MAX_CHANGES_PER_FIELD) {
    listedChanges.push(`외 ${formatNumber(changes.length - MAX_CHANGES_PER_FIELD)}개`);
  }
  return {
    name: `${name} ${formatNumber(changes.length)}개`,
    value: listedChanges.join("\n"),
    inline: false,
  };
}

function formatChange(change: StockMasterChange): string {
  const market = change.market ? ` · ${formatMarket(change.market)}` : "";
  return `• ${change.name} (${change.code}${market})`;
}

function formatMarket(market: string): string {
  if (market === "NAS") return "NASDAQ";
  if (market === "NYS") return "NYSE";
  if (market === "AMS") return "AMEX";
  return market;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}
