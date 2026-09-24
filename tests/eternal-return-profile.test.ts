import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_TIER_RULE_SEASON_ID,
  currentTier,
  EternalReturnProfileService,
} from "../src/services/eternal-return-profile.js";
import { findCurrentSeason } from "../src/sources/eternal-return-reference.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("current Eternal Return season and tier", () => {
  it("Season 응답의 isCurrent 플래그만 사용한다", () => {
    expect(findCurrentSeason([
      { seasonID: 40, seasonName: "old", isCurrent: 0 },
      { seasonID: 41, seasonName: "current", isCurrent: 1 },
      { seasonID: 42, seasonName: "future", isCurrent: 0 },
    ])?.seasonID).toBe(41);
  });

  it("현재 시즌 공식 RP 경계와 상위 순위 조건을 적용한다", () => {
    expect(currentTier(CURRENT_TIER_RULE_SEASON_ID, 4648)?.label).toBe("플래티넘 2");
    expect(currentTier(CURRENT_TIER_RULE_SEASON_ID, 4650)?.label).toBe("플래티넘 1");
    expect(currentTier(CURRENT_TIER_RULE_SEASON_ID, 7600, 1000)?.label).toBe("타이탄");
    expect(currentTier(CURRENT_TIER_RULE_SEASON_ID, 7600, 300)?.label).toBe("이모탈");
    expect(currentTier(40, 5000)).toBeUndefined();
  });
});

describe("EternalReturnProfileService", () => {
  it("공식 사용 횟수 TOP을 DB로 보완하고 피해량 표본과 캐시를 구분한다", async () => {
    const store = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.saveGamePage("uid", [
      game(5, 3, 100), game(4, 3, 0), game(3, 42), game(2, 79, 300), game(1, 1, 50),
    ]);
    const loadStats = vi.fn().mockResolvedValue({
      code: 200,
      userStats: [{
        nickname: "홉빵맨", mmr: 4648, rank: 100, totalGames: 28,
        characterStats: [
          { characterCode: 3, totalGames: 6 },
          { characterCode: 42, totalGames: 5 },
          { characterCode: 79, totalGames: 5 },
        ],
      }],
    });
    const loadRank = vi.fn().mockResolvedValue({ code: 200, userRank: { mmr: 4648, rank: 101, serverRank: 7 } });
    const service = new EternalReturnProfileService({
      apiKey: "key", store,
      loadSeasons: vi.fn().mockResolvedValue([{ seasonID: 41, seasonName: "Season21", isCurrent: 1 }]),
      loadStats, loadRank,
    });

    const fresh = await service.getCurrentSeasonProfile("uid");
    const cached = await service.getCurrentSeasonProfile("uid");

    expect(fresh.tier?.label).toBe("플래티넘 2");
    expect(fresh.preferredCharacters.map(character => character.characterNum)).toEqual([3, 42, 79, 1]);
    expect(fresh.preferredCharacters[0]).toMatchObject({
      seasonGames: 6, collectedGames: 2, averageDamage: 50, damageSamples: 2,
    });
    expect(fresh.preferredCharacters[1]).toMatchObject({ damageSamples: 0 });
    expect(fresh.partial).toBe(true);
    expect(cached.cached).toBe(true);
    expect(loadStats).toHaveBeenCalledTimes(1);
    expect(loadRank).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("랭크 기록이 없어도 빈 프로필을 저장하고 갱신 실패 시 이전 캐시를 표시한다", async () => {
    const store = await createStore();
    store.upsertUser("uid", "테스터");
    const loadSeasons = vi.fn().mockResolvedValue([{ seasonID: 41, seasonName: "Season21", isCurrent: 1 }]);
    const empty = new EternalReturnProfileService({
      apiKey: "key", store, loadSeasons,
      loadStats: vi.fn().mockResolvedValue({ code: 404 }),
      loadRank: vi.fn().mockResolvedValue({ code: 404 }),
    });
    await expect(empty.getCurrentSeasonProfile("uid", { force: true })).resolves.toMatchObject({
      seasonGames: 0, preferredCharacters: [], partial: false,
    });

    const loadStats = vi.fn().mockRejectedValue(new Error("stats unavailable"));
    const failing = new EternalReturnProfileService({
      apiKey: "key", store, loadSeasons, loadStats,
      loadRank: vi.fn().mockResolvedValue({ code: 404 }),
    });
    await expect(failing.getCurrentSeasonProfile("uid", { force: true })).resolves.toMatchObject({ stale: true, cached: true });
    await expect(failing.getCurrentSeasonProfile("uid", { force: true })).resolves.toMatchObject({ stale: true, cached: true });
    expect(loadStats).toHaveBeenCalledTimes(2);
    store.close();
  });
});

async function createStore(): Promise<EternalReturnStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-profile-"));
  directories.push(directory);
  return EternalReturnStore.open(join(directory, "test.sqlite"));
}

function game(gameId: number, characterNum: number, damageToPlayer?: number) {
  return {
    gameId, seasonId: 41, matchingMode: 3, characterNum,
    startDtm: new Date(gameId * 1000).toISOString(),
    ...(damageToPlayer !== undefined ? { damageToPlayer } : {}),
  };
}
