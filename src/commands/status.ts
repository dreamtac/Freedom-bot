import { MessageFlags, SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./types.js";

export const statusCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("봇의 현재 상태를 확인합니다."),

  async execute(interaction, context) {
    const realtimeStatus = context.realtimeStatusProvider?.getStatus();
    const overseasSubscriptions = realtimeStatus
      ? getOverseasSubscriptionSummary(realtimeStatus)
      : undefined;
    const kisStatus = realtimeStatus
      ? [
          `KIS 실시간: ${formatConnectionState(realtimeStatus.state)}`,
          `구독: ${realtimeStatus.confirmedSubscriptions}/${realtimeStatus.totalSubscriptions}`,
          `마지막 소켓 수신: ${formatLastMessageAt(realtimeStatus.lastMessageAt)}`,
          `국내 시세: ${formatLastMessageAt(realtimeStatus.lastTickAt?.domestic)}`,
          `미국 시세: ${formatLastMessageAt(realtimeStatus.lastTickAt?.overseas)}`,
          ...(overseasSubscriptions ? [overseasSubscriptions] : []),
          `야간선물 시세: ${formatLastMessageAt(realtimeStatus.lastTickAt?.nightFutures)}`,
          ...(realtimeStatus.lastError ? [`최근 오류: ${realtimeStatus.lastError}`] : []),
        ].join("\n")
      : "KIS 실시간: 비활성화";
    await interaction.reply({
      content: `Discord 응답 시간: ${interaction.client.ws.ping}ms\n${kisStatus}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

function formatConnectionState(state: "connecting" | "connected" | "disconnected" | "error"): string {
  if (state === "connected") return "연결됨";
  if (state === "connecting") return "연결 중";
  if (state === "error") return "오류";
  return "연결 안 됨";
}

function getOverseasSubscriptionSummary(status: {
  confirmedSubscriptionKeys?: readonly string[];
  subscriptionKeys?: readonly string[];
}): string | undefined {
  const subscriptions = status.subscriptionKeys?.filter((key) => key.startsWith("HDFSCNT0:")) ?? [];
  if (subscriptions.length === 0) {
    return undefined;
  }
  const confirmed = new Set(status.confirmedSubscriptionKeys ?? []);
  const confirmedSymbols = subscriptions
    .filter((key) => confirmed.has(key))
    .map((key) => key.split(":")[1]?.slice(4))
    .filter((symbol): symbol is string => Boolean(symbol));
  const visibleSymbols = confirmedSymbols.slice(0, 10).join(", ");
  const remainder = confirmedSymbols.length > 10 ? ` 외 ${confirmedSymbols.length - 10}개` : "";
  return `미국 구독: ${confirmedSymbols.length}/${subscriptions.length}${visibleSymbols ? ` (${visibleSymbols}${remainder})` : ""}`;
}

function formatLastMessageAt(lastMessageAt: number | undefined): string {
  if (!lastMessageAt) return "수신 이력 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(lastMessageAt));
}
