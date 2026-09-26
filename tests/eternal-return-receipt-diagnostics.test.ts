import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { diagnoseEternalReturnReceiptChannel } from "../src/features/eternal-return-receipt-diagnostics.js";

describe("게임 결과 채널 시작 진단", () => {
  it("채널 보기·메시지·Embed 권한이 모두 있으면 통과한다", async () => {
    const has = vi.fn().mockReturnValue(true);
    const result = await diagnoseEternalReturnReceiptChannel({
      user: { id: "bot" },
      channels: { fetch: vi.fn(async () => ({
        isSendable: () => true,
        permissionsFor: () => ({ has }),
      })) },
    } as never, "12345678901234567");
    expect(result).toEqual({ ok: true, issues: [] });
    expect(has).toHaveBeenCalledWith(PermissionFlagsBits.EmbedLinks);
  });

  it("Embed 권한 누락을 전송 전에 구체적으로 진단한다", async () => {
    const result = await diagnoseEternalReturnReceiptChannel({
      user: { id: "bot" },
      channels: { fetch: vi.fn(async () => ({
        isSendable: () => true,
        permissionsFor: () => ({ has: (permission: bigint) => permission !== PermissionFlagsBits.EmbedLinks }),
      })) },
    } as never, "12345678901234567");
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toContain("Embed Links");
  });

  it("삭제됐거나 접근할 수 없는 채널과 전송 불가 채널을 실패로 반환한다", async () => {
    const inaccessible = await diagnoseEternalReturnReceiptChannel({
      user: { id: "bot" }, channels: { fetch: vi.fn().mockRejectedValue(new Error("Missing Access")) },
    } as never, "12345678901234567");
    expect(inaccessible.issues[0]).toContain("접근하지 못했습니다");

    const unsendable = await diagnoseEternalReturnReceiptChannel({
      user: { id: "bot" }, channels: { fetch: vi.fn(async () => ({ isSendable: () => false })) },
    } as never, "12345678901234567");
    expect(unsendable.issues[0]).toContain("메시지를 보낼 수 없습니다");
  });
});
