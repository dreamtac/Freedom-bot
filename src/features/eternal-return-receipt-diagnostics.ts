import { PermissionFlagsBits, type Client } from "discord.js";

export interface EternalReturnReceiptChannelDiagnostic {
  ok: boolean;
  issues: readonly string[];
}

export async function diagnoseEternalReturnReceiptChannel(
  client: Pick<Client, "channels" | "user">,
  channelId: string,
): Promise<EternalReturnReceiptChannelDiagnostic> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return failure(`게임 결과 채널을 찾을 수 없습니다: ${channelId}`);
    if (!channel.isSendable()) return failure(`게임 결과 채널에 메시지를 보낼 수 없습니다: ${channelId}`);
    if (!client.user) return failure("Discord 봇 사용자 정보가 준비되지 않았습니다.");
    if (!("permissionsFor" in channel) || typeof channel.permissionsFor !== "function") {
      return failure(`게임 결과 채널 권한을 확인할 수 없습니다: ${channelId}`);
    }
    const permissions = channel.permissionsFor(client.user);
    if (!permissions) return failure(`게임 결과 채널의 봇 권한을 확인할 수 없습니다: ${channelId}`);
    const missing = [
      [PermissionFlagsBits.ViewChannel, "채널 보기"],
      [PermissionFlagsBits.SendMessages, "메시지 보내기"],
      [PermissionFlagsBits.EmbedLinks, "링크 첨부(Embed Links)"],
    ] as const;
    const issues = missing
      .filter(([permission]) => !permissions.has(permission))
      .map(([, label]) => `게임 결과 채널에 '${label}' 권한이 없습니다: ${channelId}`);
    return { ok: issues.length === 0, issues };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 Discord 오류";
    return failure(`게임 결과 채널에 접근하지 못했습니다: ${channelId} (${message.slice(0, 200)})`);
  }
}

function failure(issue: string): EternalReturnReceiptChannelDiagnostic {
  return { ok: false, issues: [issue] };
}
