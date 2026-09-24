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

    const legacy = new Database(path);
    legacy.exec(`
      DROP TABLE er_game_receipt_players;
      DROP TABLE er_game_receipts;
      ALTER TABLE er_users DROP COLUMN receipt_channel_id;
      ALTER TABLE er_users DROP COLUMN receipt_enabled;
      ALTER TABLE er_games DROP COLUMN credit_source_json;
      ALTER TABLE er_games DROP COLUMN total_gain_vf_credit;
    `);
    legacy.close();

    const second = await EternalReturnStore.open(path);
    second.close();
    const third = await EternalReturnStore.open(path);
    third.close();

    const inspected = new Database(path, { readonly: true });
    expect(inspected.prepare("SELECT value FROM existing_feature").pluck().get()).toBe("kept");
    expect(inspected.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'er_%'").pluck().get())
      .toBe(8);
    expect((inspected.prepare("PRAGMA table_info(er_users)").all() as Array<{ name: string }>).map(row => row.name))
      .toEqual(expect.arrayContaining(["receipt_enabled", "receipt_channel_id"]));
    expect((inspected.prepare("PRAGMA table_info(er_games)").all() as Array<{ name: string }>).map(row => row.name))
      .toEqual(expect.arrayContaining([
        "credit_source_json", "total_gain_vf_credit", "receipt_details_json", "receipt_eligible",
      ]));
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
        totalGainVFCredit: 830, totalUseVFCredit: 600, crGetByGuideRobot: 20,
        crUseActivationModule: 200, damageToPlayer_basic: 1_234,
        creditSource: { CoinToss: 42 }, totalVFCredits: [100, 200, 300],
        skillOrderInfo: [1, 2, 1, 3], itemTransferredDrone: [301, 302],
        receiptDetails: { discountCoupon: { estimatedSavedCredit: 30 } },
      }),
    ]);

    const result = store.listGames("uid", { matchingMode: 3, characterNum: 20, seasonId: 18 });
    expect(result.map(item => item.gameId)).toEqual([2]);
    expect(result[0]?.optional).toMatchObject({
      versionSeason: 18, mmrBefore: 1000, victory: 1, escapeState: 0,
      killMonsters: { chicken: 2 }, botAdded: 0,
    });
    expect(result[0]).toMatchObject({
      totalGainVFCredit: 830, totalUseVFCredit: 600, crGetByGuideRobot: 20,
      crUseActivationModule: 200, damageToPlayer_basic: 1_234,
      creditSource: { CoinToss: 42 }, totalVFCredits: [100, 200, 300],
      skillOrderInfo: [1, 2, 1, 3], itemTransferredDrone: [301, 302],
      receiptDetails: { discountCoupon: { estimatedSavedCredit: 30 } },
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

  it("닉네임 조회에서 회전된 userId를 받으면 같은 닉네임의 저장 데이터를 합친다", async () => {
    const { store } = await createStore();
    store.upsertUser("old-token", "홉빵맨", new Date(1_000));
    store.setAutoRefresh("old-token", true);
    store.setReceiptSettings("old-token", true, "receipt-channel");
    store.saveGamePage("old-token", [
      game({ gameId: 100, damageToPlayer: 10_000 }),
      game({ gameId: 101, damageToPlayer: 20_000 }),
    ]);
    store.updateCollectionState("old-token", {
      kind: "latest", status: "succeeded", boundaryGameId: 101, succeededAt: new Date(2_000),
    }, new Date(2_000));
    store.putSeasonProfile({
      userId: "old-token", seasonId: 18, matchingMode: 3, mmr: 4_000,
      fetchedAt: new Date(2_000), expiresAt: new Date(3_000),
    });
    const receipt = store.enqueueGameReceipt({
      channelId: "receipt-channel", gameId: 101,
      players: [{ userId: "old-token", nickname: "홉빵맨", teamNumber: 7, isMonitored: true }],
    });

    store.upsertUser("new-token", "홉빵맨", new Date(3_000));
    store.saveGamePage("new-token", [game({ gameId: 101, damageToPlayer: 25_000 })]);
    const resolved = store.upsertResolvedUser("new-token", "홉빵맨", new Date(4_000));

    expect(resolved).toMatchObject({
      userId: "new-token", autoRefresh: true, receiptEnabled: true, receiptChannelId: "receipt-channel",
    });
    expect(store.getUser("old-token")).toBeUndefined();
    expect(store.findUsersByNickname("홉빵맨").map(user => user.userId)).toEqual(["new-token"]);
    expect(store.listGames("new-token").map(item => [item.gameId, item.damageToPlayer]))
      .toEqual([[101, 25_000], [100, 10_000]]);
    expect(store.getCollectionState("new-token", "latest")?.boundaryGameId).toBe(101);
    expect(store.getSeasonProfile("new-token", 18, 3)?.mmr).toBe(4_000);
    expect(store.getGameReceipt(receipt.receiptId)?.status).toBe("pending");
    expect(store.listGameReceiptPlayers(receipt.receiptId)).toMatchObject([
      { userId: "new-token", nickname: "홉빵맨", teamNumber: 7, isMonitored: true },
    ]);
    store.close();
  });

  it("유저별 게임 결과 설정과 선택 채널을 저장한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid-a", "알림A");
    store.upsertUser("uid-b", "알림B");

    store.setReceiptSettings("uid-a", true, "channel-a");
    store.setReceiptSettings("uid-b", true);
    expect(store.listReceiptEnabledUsers().map(user => user.userId)).toEqual(["uid-a", "uid-b"]);
    expect(store.getUser("uid-a")).toMatchObject({ receiptEnabled: true, receiptChannelId: "channel-a" });

    store.setReceiptSettings("uid-a", false, null);
    expect(store.getUser("uid-a")?.receiptEnabled).toBe(false);
    expect(store.getUser("uid-a")?.receiptChannelId).toBeUndefined();
    store.close();
  });

  it("한 경기의 중복 등록을 합치고 실패 재시도와 재시작 중단 복구 후 한 번만 완료한다", async () => {
    const { store, path } = await createStore();
    const first = store.enqueueGameReceipt({
      channelId: "channel", gameId: 900, detectedAt: new Date(1_000),
      players: [{ userId: "uid-a", nickname: "홉빵맨", teamNumber: 3, isMonitored: true }],
    });
    const duplicate = store.enqueueGameReceipt({
      channelId: "channel", gameId: 900, detectedAt: new Date(2_000),
      players: [{ userId: "uid-b", nickname: "홍어심슨", teamNumber: 3, isMonitored: true }],
    });
    expect(duplicate.receiptId).toBe(first.receiptId);
    expect(store.listGameReceiptPlayers(first.receiptId).map(player => player.nickname))
      .toEqual(["홉빵맨", "홍어심슨"]);

    expect(store.claimNextGameReceipt("channel", new Date(3_000))).toMatchObject({
      status: "sending", attemptCount: 1,
    });
    expect(store.markGameReceiptFailed(first.receiptId, "Discord unavailable", new Date(4_000)).status)
      .toBe("failed");
    expect(store.retryFailedGameReceipts("channel", new Date(5_000))).toBe(1);
    expect(store.claimNextGameReceipt("channel", new Date(6_000))).toMatchObject({
      status: "sending", attemptCount: 2,
    });
    store.close();

    const restarted = await EternalReturnStore.open(path);
    expect(restarted.getGameReceipt(first.receiptId)).toMatchObject({ status: "pending", attemptCount: 2 });
    expect(restarted.claimNextGameReceipt("channel", new Date(7_000))).toMatchObject({
      status: "sending", attemptCount: 3,
    });
    expect(restarted.markGameReceiptSent(first.receiptId, "discord-message", new Date(8_000)))
      .toMatchObject({ status: "sent", messageId: "discord-message", attemptCount: 3 });
    expect(restarted.claimNextGameReceipt("channel")).toBeUndefined();

    restarted.enqueueGameReceipt({ channelId: "channel", gameId: 900 });
    expect(restarted.getGameReceipt(first.receiptId)).toMatchObject({ status: "sent", messageId: "discord-message" });
    restarted.close();
  });

  it("게임 결과 상세 스냅샷을 저장하고 경기 갱신 뒤에도 보존하며 실패는 세 번까지만 재시도한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.saveGamePage("uid", [game({ gameId: 901, damageToPlayer: 100 })]);
    const receipt = store.enqueueGameReceipt({
      channelId: "channel", gameId: 901,
      players: [{ userId: "uid", nickname: "홉빵맨", isMonitored: true }],
    });
    store.putGameReceiptDetails(receipt.receiptId, { title: "저장된 게임 결과", damage: 100 });
    store.saveGamePage("uid", [game({ gameId: 901, damageToPlayer: 200 })]);
    expect(store.getGameReceiptDetails(receipt.receiptId)).toEqual({ title: "저장된 게임 결과", damage: 100 });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(store.claimNextPendingGameReceipt()).toMatchObject({ attemptCount: attempt });
      store.markGameReceiptFailed(receipt.receiptId, "failed");
      expect(store.retryFailedGameReceipts(undefined, new Date(), 3)).toBe(attempt < 3 ? 1 : 0);
    }
    expect(store.claimNextPendingGameReceipt()).toBeUndefined();
    store.close();
  });

  it("기존 수집 경기를 suppressed 기준선으로 묶어 첫 실행 알림을 막는다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid-a", "홉빵맨");
    store.upsertUser("uid-b", "홍어심슨");
    store.saveGamePage("uid-a", [game({ gameId: 100, teamNumber: 1 }), game({ gameId: 101 })]);
    store.saveGamePage("uid-b", [game({ gameId: 100, teamNumber: 1 }), game({ gameId: 102 })]);

    expect(store.initializeReceiptBaseline("channel", ["uid-a", "uid-b"], new Date(1_000))).toBe(3);
    expect(store.initializeReceiptBaseline("channel", ["uid-a", "uid-b"], new Date(2_000))).toBe(0);
    const shared = store.getGameReceiptByChannelGame("channel", 100)!;
    expect(shared.status).toBe("suppressed");
    expect(store.listGameReceiptPlayers(shared.receiptId).map(player => player.userId))
      .toEqual(["uid-a", "uid-b"]);
    expect(store.claimNextGameReceipt("channel")).toBeUndefined();
    store.close();
  });

  it("최신 수집의 새 경기만 영속 후보로 남기고 백필과 기존 기준선은 제외한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.saveGamePage("uid", [game({ gameId: 100 })], {
      kind: "latest", status: "succeeded", boundaryGameId: 100,
    });
    store.setReceiptSettings("uid", true, "channel");

    store.saveGamePage("uid", [
      game({ gameId: 102, teamNumber: 7 }), game({ gameId: 101, teamNumber: 7 }), game({ gameId: 100 }),
    ], {
      kind: "latest", status: "running", receiptEligibleGameIds: [102, 101],
    });
    store.saveGamePage("uid", [game({ gameId: 99 })], {
      kind: "backfill", status: "running",
    });

    expect(store.listUnqueuedReceiptGames("uid", "channel").map(item => item.gameId)).toEqual([101, 102]);
    expect(() => store.enqueueGameReceiptBatch([
      { channelId: "channel", gameId: 101 }, { channelId: " ", gameId: 102 },
    ])).toThrow("채널 ID");
    expect(store.getGameReceiptByChannelGame("channel", 101)).toBeUndefined();
    expect(store.enqueueGameReceiptBatch(store.listUnqueuedReceiptGames("uid", "channel").map(item => ({
      channelId: "channel", gameId: item.gameId,
      players: [{ userId: "uid", nickname: "홉빵맨", teamNumber: item.teamNumber, isMonitored: true }],
    })))).toBe(2);
    expect(store.listUnqueuedReceiptGames("uid", "channel")).toEqual([]);
    expect(store.enqueueGameReceiptBatch([
      { channelId: "channel", gameId: 101 }, { channelId: "channel", gameId: 102 },
    ])).toBe(0);
    expect(store.getGameReceiptByChannelGame("channel", 100)?.status).toBe("suppressed");
    expect(store.getGameReceiptByChannelGame("channel", 99)).toBeUndefined();
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
