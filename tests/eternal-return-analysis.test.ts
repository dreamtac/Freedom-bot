import { describe, expect, it, vi } from "vitest";

import { analyzeEternalReturnPerformance } from "../src/services/eternal-return-analysis.js";
import type { StoredEternalReturnGame } from "../src/storage/eternal-return-store.js";

describe("analyzeEternalReturnPerformance", () => {
  it("겹치지 않는 최근·이전 구간에서 결측치를 제외하고 0은 표본에 포함한다", () => {
    const games = [
      game(6, 1, 100, 2), game(5, 1, 0, 1), game(4, 2, undefined, 3),
      game(3, 1, 50, 5), game(2, 2, 150, 4), game(1, 2, undefined, 6),
    ];
    const listGames = vi.fn(() => games);
    const countGames = vi.fn(() => 86);
    const store = { listGames, countGames };
    const result = analyzeEternalReturnPerformance(store, "uid", {
      seasonId: 41, matchingMode: 3, windowSize: 3,
    });

    expect(result.overall.recentGames).toBe(3);
    expect(result.overall.previousGames).toBe(3);
    expect(result.overall.metrics.damage.recent).toEqual({ average: 50, sampleSize: 2 });
    expect(result.overall.metrics.damage.previous).toEqual({ average: 100, sampleSize: 2 });
    expect(result.overall.metrics.damage.change).toBe(-50);
    expect(result.overall.metrics.rank.lowerIsBetter).toBe(true);
    expect(result.byCharacter.find(entry => entry.characterNum === 1)?.result)
      .toMatchObject({ recentGames: 2, previousGames: 1 });
    expect(result.complete).toBe(true);
    expect(result.totalStoredGames).toBe(86);
    expect(result.patches).toEqual(["1.2.3"]);
    expect(listGames).toHaveBeenCalledWith("uid", { seasonId: 41, matchingMode: 3, limit: 6 });
  });
});

function game(
  gameId: number,
  characterNum: number,
  damageToPlayer: number | undefined,
  gameRank: number,
): StoredEternalReturnGame {
  return {
    userId: "uid", gameId, seasonId: 41, matchingMode: 3, characterNum, gameRank,
    playerKill: gameId % 2, playerDeaths: 1, playerAssistant: 2, teamKill: 3,
    gameVersion: "1.2.3",
    ...(damageToPlayer !== undefined ? { damageToPlayer } : {}),
    startDtm: new Date(gameId * 1000).toISOString(),
    collectedAt: new Date(), updatedAt: new Date(), optional: {},
  };
}
