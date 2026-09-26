import { afterEach, describe, expect, it, vi } from "vitest";

import { EternalReturnMonitor } from "../src/monitor/eternal-return-monitor.js";
import type { EternalReturnCollectionResult } from "../src/services/eternal-return-collector.js";

afterEach(() => vi.useRealTimers());

function result(userId: string, storedGames = 0): EternalReturnCollectionResult {
  return {
    userId, nickname: userId, games: [], pagesFetched: 1, recordsSeen: storedGames,
    storedGames, newGameIds: [], reachedBoundary: true, exhausted: false,
  };
}

describe("EternalReturnMonitor", () => {
  it("시작 직후 확인하고 설정 주기마다 독립적으로 반복한다", async () => {
    vi.useFakeTimers();
    const refreshNickname = vi.fn().mockResolvedValue(result("uid", 1));
    const monitor = new EternalReturnMonitor({
      store: monitorStore([{ userId: "uid", nickname: "홉빵맨" }]),
      collector: { refreshNickname, backfill: vi.fn() }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await monitor.start();
    expect(refreshNickname).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refreshNickname).toHaveBeenCalledTimes(2);
    await monitor.stop();
  });

  it("한 사용자의 실패가 다음 사용자의 갱신을 막지 않는다", async () => {
    const refreshNickname = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(result("b", 2));
    const users = [receiptUser("a", "A"), receiptUser("b", "B")];
    const enqueueGameReceiptBatch = vi.fn().mockReturnValue(1);
    const monitor = new EternalReturnMonitor({
      store: monitorStore(users, {
        listReceiptEnabledUsers: () => users,
        listUnqueuedReceiptGames: vi.fn((userId: string) => userId === "b" ? [storedGame(700, 2)] : []),
        enqueueGameReceiptBatch,
      }),
      collector: { refreshNickname, backfill: vi.fn() }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(monitor.checkNow()).resolves.toEqual({
      users: 2, succeeded: 1, failed: 1, storedGames: 2, queuedReceipts: 1,
    });
    expect(refreshNickname).toHaveBeenCalledTimes(2);
    expect(enqueueGameReceiptBatch).toHaveBeenCalledTimes(1);
  });

  it("진행 중인 주기 확인은 같은 작업을 공유한다", async () => {
    let finish!: (value: EternalReturnCollectionResult) => void;
    const refreshNickname = vi.fn(() => new Promise<EternalReturnCollectionResult>(resolve => { finish = resolve; }));
    const monitor = new EternalReturnMonitor({
      store: monitorStore([{ userId: "uid", nickname: "홉빵맨" }]),
      collector: { refreshNickname, backfill: vi.fn() }, intervalMs: 300_000,
    });
    const first = monitor.checkNow();
    const second = monitor.checkNow();
    expect(first).toBe(second);
    finish(result("uid"));
    await first;
    expect(refreshNickname).toHaveBeenCalledTimes(1);
  });

  it("닉네임의 UID가 바뀌면 자동 갱신 대상을 이전하고 최근 100경기를 채운다", async () => {
    const setAutoRefresh = vi.fn();
    const backfill = vi.fn().mockResolvedValue(result("new-uid", 40));
    const refreshNickname = vi.fn().mockResolvedValue(result("new-uid", 1));
    const store = monitorStore([{ userId: "old-uid", nickname: "재자명지" }], {
      setAutoRefresh,
      countGames: vi.fn().mockReturnValue(60),
      getCollectionState: vi.fn().mockReturnValue({ cursor: "next", status: "idle" }),
    });
    const monitor = new EternalReturnMonitor({
      store, collector: { refreshNickname, backfill }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(monitor.checkNow()).resolves.toEqual({
      users: 1, succeeded: 1, failed: 0, storedGames: 41, queuedReceipts: 0,
    });
    expect(refreshNickname).toHaveBeenCalledWith("재자명지", "refresh");
    expect(setAutoRefresh).toHaveBeenCalledWith("new-uid", true);
    expect(setAutoRefresh).toHaveBeenCalledWith("old-uid", false);
    expect(backfill).toHaveBeenCalledWith("new-uid", { targetGames: 100 });
  });

  it("수집기가 같은 닉네임의 이전 토큰을 이미 통합했으면 삭제된 토큰을 다시 갱신하지 않는다", async () => {
    const setAutoRefresh = vi.fn();
    const store = monitorStore([{ userId: "old-token", nickname: "홉빵맨" }], {
      setAutoRefresh,
      getUser: vi.fn((userId: string) => userId === "new-token" ? { userId } : undefined),
    });
    const monitor = new EternalReturnMonitor({
      store,
      collector: { refreshNickname: vi.fn().mockResolvedValue(result("new-token")), backfill: vi.fn() },
      intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(monitor.checkNow()).resolves.toEqual({
      users: 1, succeeded: 1, failed: 0, storedGames: 0, queuedReceipts: 0,
    });
    expect(setAutoRefresh).toHaveBeenCalledTimes(1);
    expect(setAutoRefresh).toHaveBeenCalledWith("new-token", true);
  });

  it("같은 주기의 같은 매치 유저와 별도 솔로 경기를 두 게임 결과로 묶고 팀 번호를 보존한다", async () => {
    const receiptUsers = [
      receiptUser("a", "홉빵맨"), receiptUser("b", "홍어심슨"),
      receiptUser("c", "재자명지"), receiptUser("d", "방찌"),
    ];
    const enqueueGameReceiptBatch = vi.fn().mockReturnValue(2);
    const store = monitorStore(receiptUsers, {
      listReceiptEnabledUsers: () => receiptUsers,
      listUnqueuedReceiptGames: vi.fn((userId: string) => userId === "d"
        ? [storedGame(600, 9)]
        : [storedGame(500, userId === "c" ? 5 : 4)]),
      enqueueGameReceiptBatch,
    });
    const monitor = new EternalReturnMonitor({
      store,
      collector: {
        refreshNickname: vi.fn((nickname: string) => Promise.resolve(result(
          receiptUsers.find(user => user.nickname === nickname)!.userId, 1,
        ))),
        backfill: vi.fn(),
      },
      intervalMs: 300_000,
    });

    await expect(monitor.checkNow()).resolves.toMatchObject({ queuedReceipts: 2 });
    const inputs = enqueueGameReceiptBatch.mock.calls[0]?.[0] as Array<{
      gameId: number; channelId: string; players: Array<{ userId: string; teamNumber: number }>;
    }>;
    expect(inputs).toHaveLength(2);
    expect(inputs.find(input => input.gameId === 500)).toMatchObject({
      channelId: "receipt-channel",
      players: [
        { userId: "a", teamNumber: 4 },
        { userId: "b", teamNumber: 4 },
        { userId: "c", teamNumber: 5 },
      ],
    });
    expect(inputs.find(input => input.gameId === 600)).toMatchObject({
      channelId: "receipt-channel",
      players: [{ userId: "d", teamNumber: 9 }],
    });
  });

  it("게임 결과 발송 오류가 자동 전적 수집 주기를 실패시키지 않는다", async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const dispatchReceipts = vi.fn().mockRejectedValue(new Error("Discord unavailable"));
    const monitor = new EternalReturnMonitor({
      store: monitorStore([{ userId: "uid", nickname: "홉빵맨" }]),
      collector: { refreshNickname: vi.fn().mockResolvedValue(result("uid", 2)), backfill: vi.fn() },
      intervalMs: 300_000,
      receiptsEnabled: true,
      dispatchReceipts,
      logger,
    });
    await expect(monitor.checkNow()).resolves.toEqual({
      users: 1, succeeded: 1, failed: 0, storedGames: 2, queuedReceipts: 0,
    });
    expect(dispatchReceipts).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("게임 결과 발송"), expect.any(Error));
  });

  it("게임 결과 기능이 꺼져 있으면 구독 DB와 발송기를 전혀 호출하지 않는다", async () => {
    const listReceiptEnabledUsers = vi.fn();
    const enqueueGameReceiptBatch = vi.fn();
    const dispatchReceipts = vi.fn();
    const monitor = new EternalReturnMonitor({
      store: monitorStore([{ userId: "uid", nickname: "홉빵맨" }], {
        listReceiptEnabledUsers, enqueueGameReceiptBatch,
      }),
      collector: { refreshNickname: vi.fn().mockResolvedValue(result("uid")), backfill: vi.fn() },
      intervalMs: 300_000,
      receiptsEnabled: false,
      dispatchReceipts,
    });
    await monitor.checkNow();
    expect(listReceiptEnabledUsers).not.toHaveBeenCalled();
    expect(enqueueGameReceiptBatch).not.toHaveBeenCalled();
    expect(dispatchReceipts).not.toHaveBeenCalled();
  });
});

function monitorStore(
  users: Array<{ userId: string; nickname: string }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    listAutoRefreshUsers: () => users,
    listReceiptEnabledUsers: () => [],
    listUnqueuedReceiptGames: vi.fn().mockReturnValue([]),
    enqueueGameReceiptBatch: vi.fn().mockReturnValue(0),
    getUser: (userId: string) => users.find(user => user.userId === userId),
    setAutoRefresh: vi.fn(),
    countGames: vi.fn().mockReturnValue(100),
    getCollectionState: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as never;
}

function receiptUser(userId: string, nickname: string) {
  return {
    userId, nickname, normalizedNickname: nickname, autoRefresh: true,
    receiptEnabled: true, receiptChannelId: "receipt-channel",
    firstSeenAt: new Date(0), lastSeenAt: new Date(0),
  };
}

function storedGame(gameId: number, teamNumber: number) {
  return {
    gameId, teamNumber, collectedAt: new Date(gameId * 1_000), updatedAt: new Date(gameId * 1_000), optional: {},
  };
}
