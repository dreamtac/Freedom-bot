import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type { EternalReturnGame } from "../src/sources/eternal-return.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

describe("EternalReturnStore", () => {
  it("반복 마이그레이션이 기존 기능의 테이블과 데이터를 보존한다", async () => {
    const { path } = await createDatabasePath();
    const database = new Database(path);
    database.exec("CREATE TABLE existing_feature (value TEXT NOT NULL); INSERT INTO existing_feature VALUES ('kept')");
    database.close();

    const first = await EternalReturnStore.open(path);
    first.close();
    const second = await EternalReturnStore.open(path);
    second.close();

    const inspected = new Database(path, { readonly: true });
    expect(inspected.prepare("SELECT value FROM existing_feature").pluck().get()).toBe("kept");
    expect(inspected.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'er_%'").pluck().get())
      .toBe(6);
    inspected.close();
  });

  it("UID와 경기 ID 복합키로 중복을 갱신하고 다른 유저의 같은 경기는 분리한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid-a", "홉빵맨", new Date(1_000));
    store.upsertUser("uid-b", "친구", new Date(1_000));

    expect(store.saveGamePage("uid-a", [game({ damageToPlayer: 100 })], undefined, new Date(2_000))).toBe(1);
    expect(store.saveGamePage("uid-a", [game({ damageToPlayer: 250 })], undefined, new Date(3_000))).toBe(1);
    store.saveGamePage("uid-b", [game({ damageToPlayer: 999 })], undefined, new Date(4_000));

    expect(store.countGames("uid-a")).toBe(1);
    expect(store.countGames("uid-b")).toBe(1);
    expect(store.getGame("uid-a", 123)?.damageToPlayer).toBe(250);
    expect(store.getGame("uid-b", 123)?.damageToPlayer).toBe(999);
    expect(store.getGame("uid-a", 123)?.collectedAt.getTime()).toBe(2_000);
    expect(store.getGame("uid-a", 123)?.updatedAt.getTime()).toBe(3_000);
    store.close();
  });

  it("숫자형 문자열을 정규화하고 결측치와 유효한 0을 구분한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "테스터");
    const stringNumbers = {
      gameId: "123", matchingMode: "3", gameRank: 0, playerKill: "0",
      damageToPlayer: 0, damageFromPlayer: undefined, damageToMonster: "321.5",
      placeOfStart: 0, placeOfDeath: "Cemetery", equipment: { 0: 101 },
      traitFirstSub: [], startDtm: "not-a-date",
    } as unknown as EternalReturnGame;
    store.saveGamePage("uid", [stringNumbers]);

    const stored = store.getGame("uid", 123)!;
    expect(stored.matchingMode).toBe(3);
    expect(stored.gameRank).toBe(0);
    expect(stored.playerKill).toBe(0);
    expect(stored.damageToPlayer).toBe(0);
    expect(stored.damageFromPlayer).toBeUndefined();
    expect(stored.damageToMonster).toBe(321.5);
    expect(stored.placeOfStart).toBe(0);
    expect(stored.placeOfDeath).toBe("Cemetery");
    expect(stored.equipment).toEqual({ 0: 101 });
    expect(stored.traitFirstSub).toEqual([]);
    expect(stored.startDtm).toBe("not-a-date");
    store.close();
  });

  it("필수 및 향후 분석 필드를 보관하고 조건별로 최신 경기부터 조회한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "테스터");
    store.saveGamePage("uid", [
      game({ gameId: 1, startDtm: "2026-09-01T10:00:00Z", characterNum: 10, matchingMode: 2 }),
      game({
        gameId: 2, startDtm: "2026-09-02T10:00:00Z", characterNum: 20, matchingMode: 3,
        versionSeason: 18, versionMajor: 1, versionMinor: 2, gameVersion: "18.1.2",
        mmrBefore: 1000, mmrAfter: 1020, victory: 1, escapeState: 0,
        teamRecover: 50, protectAbsorb: 60, ccTimeToPlayer: 3.5,
        killMonsters: { chicken: 2 }, viewContribution: 7,
        tacticalSkillGroup: 100, tacticalSkillLevel: 3, tacticalSkillUseCount: 4,
        teamNumber: 8, preMade: 2, premadeMatchingType: 1, botAdded: 0,
        characterLevel: 20, bestWeapon: 5,
      }),
    ]);

    const result = store.listGames("uid", { matchingMode: 3, characterNum: 20, seasonId: 18 });
    expect(result.map(item => item.gameId)).toEqual([2]);
    expect(result[0]?.optional).toMatchObject({
      versionSeason: 18, mmrBefore: 1000, victory: 1, escapeState: 0,
      killMonsters: { chicken: 2 }, botAdded: 0,
    });
    store.close();
  });

  it("최신 완료 경계와 과거 커서를 별도 상태로 저장한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "테스터");
    store.updateCollectionState("uid", {
      kind: "latest", status: "succeeded", boundaryGameId: 500,
      attemptedAt: new Date(1_000), succeededAt: new Date(2_000),
    }, new Date(2_000));
    store.updateCollectionState("uid", {
      kind: "backfill", status: "failed", cursor: "450",
      attemptedAt: new Date(3_000), error: "temporary failure",
    }, new Date(3_000));
    store.updateCollectionState("uid", {
      kind: "backfill", status: "running", attemptedAt: new Date(4_000),
    }, new Date(4_000));

    expect(store.getCollectionState("uid", "latest")).toMatchObject({
      kind: "latest", status: "succeeded", boundaryGameId: 500,
    });
    expect(store.getCollectionState("uid", "backfill")).toMatchObject({
      kind: "backfill", status: "running", cursor: "450", lastError: "temporary failure",
    });
    store.close();
  });

  it("경기 페이지와 수집 상태를 하나의 트랜잭션으로 저장한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "테스터");
    expect(() => store.saveGamePage("uid", [game()], {
      kind: "latest", status: "invalid" as "succeeded",
    })).toThrow();
    expect(store.countGames("uid")).toBe(0);

    expect(store.saveGamePage("uid", [game()], {
      kind: "latest", status: "succeeded", boundaryGameId: 123, succeededAt: new Date(5_000),
    })).toBe(1);
    expect(store.saveGamePage("uid", [game()])).toBe(1);
    expect(store.countExistingGameIds("uid", [123, 999])).toBe(1);
    expect(store.countGames("uid")).toBe(1);
    expect(store.getCollectionState("uid", "latest")?.boundaryGameId).toBe(123);
    store.close();
  });

  it("닉네임 변경 이력을 UID별로 유지하며 같은 닉네임의 다른 UID를 병합하지 않는다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid-a", "이전닉", new Date(1_000));
    store.upsertUser("uid-a", "새닉", new Date(2_000));
    store.upsertUser("uid-b", "이전닉", new Date(3_000));

    expect(store.getUser("uid-a")?.nickname).toBe("새닉");
    expect(store.findUsersByNickname("이전닉").map(user => user.userId)).toEqual(["uid-b", "uid-a"]);
    expect(store.findUsersByNickname("새닉").map(user => user.userId)).toEqual(["uid-a"]);
    store.setAutoRefresh("uid-a", true);
    expect(store.listAutoRefreshUsers().map(user => user.userId)).toEqual(["uid-a"]);
    store.close();
  });

  it("공통 자료와 시즌 프로필 캐시를 키별로 갱신한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "테스터");
    store.putReference({
      dataType: "Character", cacheKey: "ko", payload: [{ code: 1, name: "재키" }],
      sourceVersion: "18.1", fetchedAt: new Date(1_000), expiresAt: new Date(2_000),
    });
    store.putSeasonProfile({
      userId: "uid", seasonId: 18, matchingMode: 3, mmr: 0, rank: 10,
      stats: { characterStats: [1] }, rankData: { serverCode: 0 },
      fetchedAt: new Date(3_000), expiresAt: new Date(4_000),
    });

    expect(store.getReference<{ code: number }[]>("Character", "ko")).toMatchObject({
      sourceVersion: "18.1", payload: [{ code: 1, name: "재키" }],
    });
    expect(store.getSeasonProfile("uid", 18, 3)).toMatchObject({
      mmr: 0, rank: 10, stats: { characterStats: [1] }, rankData: { serverCode: 0 },
    });
    store.close();
  });
});

async function createDatabasePath(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "test.sqlite") };
}

async function createStore(): Promise<{ store: EternalReturnStore; path: string }> {
  const { path } = await createDatabasePath();
  return { store: await EternalReturnStore.open(path), path };
}

function game(overrides: Partial<EternalReturnGame> = {}): EternalReturnGame {
  return {
    gameId: 123, seasonId: 18, matchingMode: 3, matchingTeamMode: 3,
    characterNum: 1, gameRank: 2, playerKill: 3, playerAssistant: 4,
    playerDeaths: 0, teamKill: 7, damageToPlayer: 12_345,
    damageFromPlayer: 6_789, damageToMonster: 54_321, monsterKill: 20,
    startDtm: "2026-09-02T10:00:00Z", equipment: { 0: 101 },
    traitFirstCore: 201, traitFirstSub: [202], traitSecondSub: [203],
    placeOfStart: 10, placeOfDeath: "Cemetery", ...overrides,
  };
}
