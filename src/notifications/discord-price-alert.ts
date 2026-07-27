import { EmbedBuilder, type Client } from "discord.js";

import type { PriceAlertDirection } from "../storage/price-alert-store.js";
import type { OverseasExchange } from "../sources/overseas-stocks.js";
import type { RealtimeMarket } from "../sources/kis-realtime.js";

export interface StockPriceAlertNotification {
  code: string;
  assetType: "domestic" | "overseas" | "nightFutures";
  currency: "KRW" | "USD" | "POINT";
  currentPrice: number;
  direction: PriceAlertDirection;
  market: RealtimeMarket | OverseasExchange | "KRX_NIGHT_FUTURES";
  name: string;
  openingPrice: number;
  referenceLabel?: string;
  rate: number;
  threshold: number;
}

export async function sendStockPriceAlert(
  client: Client,
  channelId: string,
  alert: StockPriceAlertNotification,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`메시지를 전송할 수 없는 채널입니다: ${channelId}`);
  }

  const directionText = alert.direction === "up" ? "상승" : "하락";
  const sign = alert.direction === "up" ? "+" : "-";
  const referenceLabel = alert.referenceLabel ?? "시가";
  const marketLabel =
    alert.market === "KRX_NIGHT_FUTURES" ? "KRX 야간장" : alert.market;
  const fields = [
    {
      name: "현재가",
      value: formatPrice(alert.currentPrice, alert.currency),
      inline: true,
    },
    {
      name: referenceLabel,
      value: formatPrice(alert.openingPrice, alert.currency),
      inline: true,
    },
    ...(alert.assetType === "nightFutures"
      ? []
      : [
          {
            name: "종목",
            value: `${alert.code}`,
            inline: true,
          },
        ]),
    {
      name: "시장",
      value: marketLabel,
      inline: true,
    },
  ];
  const embed = new EmbedBuilder()
    .setColor(alert.direction === "up" ? 0xd92d20 : 0x1570ef)
    .setTitle(`${alert.name} ${referenceLabel} 대비 ${sign}${alert.threshold}% ${directionText}`)
    .setDescription(`**현재 ${referenceLabel} 대비 ${sign}${Math.abs(alert.rate).toFixed(2)}%**`)
    .addFields(fields)
    .setFooter({ text: `KIS WebSocket · ${referenceLabel} 대비 변동 알림` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

function formatPrice(value: number, currency: StockPriceAlertNotification["currency"]): string {
  if (currency === "USD") {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value)}`;
  }
  if (currency === "POINT") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value)}pt`;
  }
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}
