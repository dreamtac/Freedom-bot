import { afterEach, describe, expect, it, vi } from "vitest";

import { EternalReturnMonitor } from "../src/monitor/eternal-return-monitor.js";
import type { EternalReturnCollectionResult } from "../src/services/eternal-return-collector.js";

afterEach(() => vi.useRealTimers());

function result(userId: string, storedGames = 0): EternalReturnCollectionResult {
  return {
    userId, nickname: userId, games: [], pagesFetched: 1, recordsSeen: storedGames,
    storedGames, reachedBoundary: true, exhausted: false,
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
    const monitor = new EternalReturnMonitor({
      store: monitorStore([
        { userId: "a", nickname: "A" }, { userId: "b", nickname: "B" },
      ]),
      collector: { refreshNickname, backfill: vi.fn() }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(monitor.checkNow()).resolves.toEqual({ users: 2, succeeded: 1, failed: 1, storedGames: 2 });
    expect(refreshNickname).toHaveBeenCalledTimes(2);
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

    await expect(monitor.checkNow()).resolves.toEqual({ users: 1, succeeded: 1, failed: 0, storedGames: 41 });
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

    await expect(monitor.checkNow()).resolves.toEqual({ users: 1, succeeded: 1, failed: 0, storedGames: 0 });
    expect(setAutoRefresh).toHaveBeenCalledTimes(1);
    expect(setAutoRefresh).toHaveBeenCalledWith("new-token", true);
  });
});

function monitorStore(
  users: Array<{ userId: string; nickname: string }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    listAutoRefreshUsers: () => users,
    getUser: (userId: string) => users.find(user => user.userId === userId),
    setAutoRefresh: vi.fn(),
    countGames: vi.fn().mockReturnValue(100),
    getCollectionState: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as never;
}
