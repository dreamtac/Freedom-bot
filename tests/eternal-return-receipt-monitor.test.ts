import { describe, expect, it, vi } from "vitest";

import { EternalReturnReceiptMonitor } from "../src/monitor/eternal-return-receipt-monitor.js";
import { buildReceiptPlayerView, buildReceiptView } from "../src/services/eternal-return-receipt.js";
import { createEmptyReferenceData } from "../src/sources/eternal-return-reference.js";
import type { EternalReturnGameReceipt, StoredEternalReturnGame } from "../src/storage/eternal-return-store.js";

const references = createEmptyReferenceData();

describe("EternalReturnReceiptMonitor", () => {
  it("오래된 pending 결과를 DB 스냅샷으로 저장한 뒤 Discord에 보내고 완료 처리한다", async () => {
    const receipt = pendingReceipt();
    const view = receiptView();
    const events: string[] = [];
    const send = vi.fn(async (payload: unknown) => {
      events.push("send");
      expect(JSON.stringify(payload)).toContain(`er:r:${receipt.receiptId}:combat`);
      return { id: "discord-message" };
    });
    const store = {
      retryFailedGameReceipts: vi.fn().mockReturnValue(0),
      claimNextPendingGameReceipt: vi.fn()
        .mockReturnValueOnce({ ...receipt, status: "sending", attemptCount: 1 })
        .mockReturnValueOnce(undefined),
      putGameReceiptDetails: vi.fn(() => events.push("snapshot")),
      markGameReceiptSent: vi.fn(() => events.push("sent")),
      markGameReceiptFailed: vi.fn(),
    };
    const monitor = new EternalReturnReceiptMonitor({
      client: { channels: { fetch: vi.fn(async () => ({ isSendable: () => true, send })) } } as never,
      store: store as never,
      builder: { build: vi.fn().mockResolvedValue(view) },
      loadReferences: vi.fn().mockResolvedValue(references),
    });

    await expect(monitor.checkNow()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(events).toEqual(["snapshot", "send", "sent"]);
    expect(store.markGameReceiptSent).toHaveBeenCalledWith(receipt.receiptId, "discord-message");
    expect(store.markGameReceiptFailed).not.toHaveBeenCalled();
  });

  it("권한 없는 채널은 실패 상태로 저장하고 다음 결과 처리를 계속한다", async () => {
    const receipts = [pendingReceipt("first"), pendingReceipt("second")];
    const store = {
      retryFailedGameReceipts: vi.fn().mockReturnValue(0),
      claimNextPendingGameReceipt: vi.fn()
        .mockReturnValueOnce({ ...receipts[0], status: "sending", attemptCount: 1 })
        .mockReturnValueOnce({ ...receipts[1], status: "sending", attemptCount: 1 })
        .mockReturnValueOnce(undefined),
      putGameReceiptDetails: vi.fn(),
      markGameReceiptSent: vi.fn(),
      markGameReceiptFailed: vi.fn(),
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const monitor = new EternalReturnReceiptMonitor({
      client: { channels: { fetch: vi.fn(async () => ({ isSendable: () => false })) } } as never,
      store: store as never,
      builder: { build: vi.fn().mockResolvedValue(receiptView()) },
      loadReferences: vi.fn().mockResolvedValue(references),
      maxPerCycle: 2,
      logger,
    });

    await expect(monitor.checkNow()).resolves.toEqual({ sent: 0, failed: 2 });
    expect(store.markGameReceiptFailed).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

function pendingReceipt(receiptId = "receipt-id"): EternalReturnGameReceipt {
  return {
    receiptId, gameId: 123, channelId: "12345678901234567", status: "pending",
    detectedAt: new Date(0), attemptCount: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
}

function receiptView() {
  const game: StoredEternalReturnGame = {
    userId: "uid", gameId: 123, matchingMode: 3, matchingTeamMode: 3,
    characterNum: 1, gameRank: 2, playerKill: 3, playerDeaths: 1, playerAssistant: 4,
    teamKill: 7, damageToPlayer: 10_000, damageFromPlayer: 5_000, damageToMonster: 8_000,
    startDtm: "2026-09-24T10:00:00Z", duration: 1_200,
    collectedAt: new Date(0), updatedAt: new Date(0), optional: {},
  };
  return buildReceiptView([
    buildReceiptPlayerView({ userId: "uid", nickname: "홉빵맨", game }, references),
  ]);
}
