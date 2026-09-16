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
    const refreshUser = vi.fn().mockResolvedValue(result("uid", 1));
    const monitor = new EternalReturnMonitor({
      store: { listAutoRefreshUsers: () => [{ userId: "uid", nickname: "홉빵맨" }] as never },
      collector: { refreshUser }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await monitor.start();
    expect(refreshUser).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refreshUser).toHaveBeenCalledTimes(2);
    await monitor.stop();
  });

  it("한 사용자의 실패가 다음 사용자의 갱신을 막지 않는다", async () => {
    const refreshUser = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(result("b", 2));
    const monitor = new EternalReturnMonitor({
      store: { listAutoRefreshUsers: () => [
        { userId: "a", nickname: "A" }, { userId: "b", nickname: "B" },
      ] as never },
      collector: { refreshUser }, intervalMs: 300_000,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(monitor.checkNow()).resolves.toEqual({ users: 2, succeeded: 1, failed: 1, storedGames: 2 });
    expect(refreshUser).toHaveBeenCalledTimes(2);
  });

  it("진행 중인 주기 확인은 같은 작업을 공유한다", async () => {
    let finish!: (value: EternalReturnCollectionResult) => void;
    const refreshUser = vi.fn(() => new Promise<EternalReturnCollectionResult>(resolve => { finish = resolve; }));
    const monitor = new EternalReturnMonitor({
      store: { listAutoRefreshUsers: () => [{ userId: "uid", nickname: "홉빵맨" }] as never },
      collector: { refreshUser }, intervalMs: 300_000,
    });
    const first = monitor.checkNow();
    const second = monitor.checkNow();
    expect(first).toBe(second);
    finish(result("uid"));
    await first;
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });
});
