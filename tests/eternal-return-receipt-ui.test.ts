import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { handleEternalReturnReceiptComponent } from "../src/commands/eternal-return-receipt-ui.js";
import { buildReceiptPlayerView, buildReceiptView } from "../src/services/eternal-return-receipt.js";
import { createEmptyReferenceData } from "../src/sources/eternal-return-reference.js";
import type { StoredEternalReturnGame } from "../src/storage/eternal-return-store.js";

describe("게임 결과 상세 컴포넌트", () => {
  it("유저별 선택을 분리하고 공개 메시지를 수정하지 않은 채 DB 스냅샷으로만 임시 응답한다", async () => {
    const view = teamView();
    const store = {
      getGameReceipt: vi.fn().mockReturnValue({ receiptId: "receipt", status: "sent" }),
      getGameReceiptDetails: vi.fn().mockReturnValue(view),
    };
    const select = component("er:r:receipt:player", "viewer-a", ["1"], true);
    await handleEternalReturnReceiptComponent(select as unknown as StringSelectMenuInteraction, {
      eternalReturnStore: store as never,
    });
    expect(replyTitle(select)).toContain("홍어심슨");

    const sameViewer = component("er:r:receipt:credits", "viewer-a");
    await handleEternalReturnReceiptComponent(sameViewer as unknown as ButtonInteraction, {
      eternalReturnStore: store as never,
    });
    expect(replyTitle(sameViewer)).toContain("홍어심슨");

    const otherViewer = component("er:r:receipt:credits", "viewer-b");
    await handleEternalReturnReceiptComponent(otherViewer as unknown as ButtonInteraction, {
      eternalReturnStore: store as never,
    });
    expect(replyTitle(otherViewer)).toContain("홉빵맨");
    expect(otherViewer.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(store.getGameReceiptDetails).toHaveBeenCalledTimes(3);
  });

  it("DB에서 결과가 삭제된 버튼에는 만료 안내를 보낸다", async () => {
    const target = component("er:r:deleted:combat", "viewer");
    await handleEternalReturnReceiptComponent(target as unknown as ButtonInteraction, {
      eternalReturnStore: {
        getGameReceipt: vi.fn().mockReturnValue(undefined),
        getGameReceiptDetails: vi.fn().mockReturnValue(undefined),
      } as never,
    });
    expect(target.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("찾을 수 없습니다") }));
  });
});

function component(customId: string, userId: string, values: string[] = [], select = false) {
  return {
    customId,
    user: { id: userId },
    values,
    isStringSelectMenu: () => select,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function replyTitle(target: ReturnType<typeof component>): string {
  const payload = target.reply.mock.calls[0]?.[0] as { embeds: Array<{ data: { title?: string } }> };
  return payload.embeds[0]?.data.title ?? "";
}

function teamView() {
  const references = createEmptyReferenceData();
  const game = (userId: string): StoredEternalReturnGame => ({
    userId, gameId: 123, matchingMode: 3, matchingTeamMode: 3, teamNumber: 1,
    characterNum: 1, gameRank: 2, playerKill: 3, playerDeaths: 1, playerAssistant: 4,
    collectedAt: new Date(0), updatedAt: new Date(0), optional: {},
  });
  return buildReceiptView([
    buildReceiptPlayerView({ userId: "a", nickname: "홉빵맨", game: game("a") }, references),
    buildReceiptPlayerView({ userId: "b", nickname: "홍어심슨", game: game("b") }, references),
  ]);
}
