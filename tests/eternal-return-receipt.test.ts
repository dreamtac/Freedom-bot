import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReceiptDetailEmbed,
  buildReceiptSummaryEmbed,
} from "../src/commands/eternal-return-receipt-formatters.js";
import {
  EternalReturnReceiptBuilder,
  buildReceiptPlayerView,
  buildReceiptView,
} from "../src/services/eternal-return-receipt.js";
import { EternalReturnRouteService } from "../src/services/eternal-return-route.js";
import { createEmptyReferenceData } from "../src/sources/eternal-return-reference.js";
import { EternalReturnStore, type StoredEternalReturnGame } from "../src/storage/eternal-return-store.js";

const directories: string[] = [];
const references = {
  ...createEmptyReferenceData(),
  characterName: (code: unknown) => `실험체${code}`,
  itemName: (code: unknown) => `아이템${code}`,
  areaName: (code: unknown) => `지역${code}`,
  traitName: (code: unknown) => `특성${code}`,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("Eternal Return receipt view model", () => {
  it("총액을 기준으로 중복 없이 크레딧을 분류하고 잔여값만 미분류로 둔다", () => {
    const game = storedGame({
      totalGainVFCredit: 1_400,
      totalUseVFCredit: 1_440,
      crGetTimeElapsed: 500,
      crGetPhaseStart: 50,
      crGetAnimal: 999,
      crGetMutant: 40,
      killAlphaGainVFCredit: 3,
      killOmegaGainVFCredit: 5,
      killGammaGainVFCredit: 4,
      killWicklineGainVFCredit: 6,
      crGetKill: 90,
      crGetAssist: 70,
      killItemBountyGainVFCredit: 100,
      crGetCreditBonus: 100,
      crGetByGuideRobot: 30,
      itemShredderGainVFCredit: 20,
      kioskExchangeCredit: 33,
      transferConsoleFromMaterialUseVFCredit: 510,
      crUseTreeOfLife: 180,
      crUseForceCore: 330,
      remoteDroneUseVFCreditMySelf: 245,
      remoteDroneUseVFCreditAlly: 100,
      tacticalSkillUpgradeUseVFCredit: 180,
      crUseActivationModule: 180,
      transferConsoleFromEscapeKeyUseVFCredit: 100,
      transferConsoleFromRevivalUseVFCredit: 250,
      traitFirstSub: [7_210_801, 7_211_101],
      itemTransferredDrone: [101, 102, 102],
      creditSource: {
        PreliminaryPhase: 100,
        KillChicken: 10,
        KillBat: 20,
        KillAlpha: 3,
        KillWickline: 6,
        BoriIdleDropInterval: 10,
        BoriDeath: 15,
        TraitSkillCoinToss: 166,
        KillAttackDrone: 6,
        GuideRobotRadial: 50,
        FutureUnknownSource: 22,
      },
    });

    const view = buildReceiptPlayerView({ userId: "uid", nickname: "홉빵맨", game }, references);
    expect(view.credits.valid).toBe(true);
    expect(view.credits.gain.find(item => item.key === "wild")?.value).toBe(30);
    expect(view.credits.gain.find(item => item.key === "boss")?.value).toBe(18);
    expect(view.credits.gain.find(item => item.key === "gain-unclassified")?.value).toBe(22);
    expect(view.credits.use.find(item => item.key === "material")?.value).toBe(510);
    expect(view.credits.use.find(item => item.key === "tactical")?.value).toBe(180);
    expect(view.credits.use.find(item => item.key === "use-unclassified")?.value).toBe(5);
    expect(view.credits.coinToss).toBe(166);
    expect(view.credits.discountCoupon).toBe(true);
    expect(view.credits.unknownSourceKeys).toEqual(["FutureUnknownSource"]);
    expect(view.credits.droneItems).toEqual([
      { code: 101, name: "아이템101", count: 1 },
      { code: 102, name: "아이템102", count: 2 },
    ]);
  });

  it("상세 합계가 총액을 넘으면 전송 불가로 표시한다", () => {
    const player = buildReceiptPlayerView({
      userId: "uid", nickname: "테스터",
      game: storedGame({ totalGainVFCredit: 10, crGetKill: 20 }),
    }, references);
    const receipt = buildReceiptView([player]);
    expect(receipt.valid).toBe(false);
    expect(receipt.errors[0]).toContain("총액");
    expect(() => buildReceiptSummaryEmbed(receipt)).toThrow("정합성");
  });

  it("전투·팀 기여·행동에서 0을 숨기고 의미가 확정된 필드만 사용한다", () => {
    const player = buildReceiptPlayerView({
      userId: "uid", nickname: "테스터",
      game: storedGame({
        damageToPlayer: 10_000,
        damageToPlayer_basic: 4_000,
        damageToPlayer_skill: 6_000,
        damageOffsetedByShield_Player: 500,
        protectAbsorb: 9_999,
        ccTimeToPlayer: 3.5,
        teamRecover: 700,
        addSurveillanceCamera: 2,
        addTelephotoCamera: 1,
        useSecurityConsole: 2,
        tacticalSkillGroup: 30,
        tacticalSkillUseCount: 4,
        useHyperLoop: 3,
        damageToGuideRobot: 1_234,
        useGadget: { 8300101: 2 },
        getBoriReward: { Gold: 1, Purple: 2 },
      }),
    }, references);

    expect(player.combat.damageTypes.map(item => item.label)).toEqual(["기본 공격", "스킬"]);
    expect(player.combat.shieldAbsorbed).toBe(500);
    expect(player.contribution.support.map(item => item.label)).toEqual(["아군 회복"]);
    expect(player.contribution.vision).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "camera-add", value: 3 }),
      expect.objectContaining({ key: "security", value: 2 }),
    ]));
    expect(player.activity.lines).toEqual(expect.arrayContaining([
      expect.stringContaining("전술 스킬 30 4회"),
      "하이퍼루프 3회",
      "LUMI에게 가한 피해 1,234",
      "보리 보상 상자 3개",
      "키오스크 호출기 2회",
    ]));
    expect(buildReceiptDetailEmbed(player, "contribution").toJSON().description).not.toContain("9,999");
  });

  it("실제 스킬 레벨업 순서와 루트 제목·추천 수를 빌드에 표시한다", () => {
    const player = buildReceiptPlayerView({
      userId: "uid", nickname: "홉빵맨",
      game: storedGame({
        characterNum: 31,
        characterLevel: 20,
        bestWeaponLevel: 16,
        routeIdOfStart: 5212,
        placeOfStart: 90,
        equipment: { 0: 101, 1: 201 },
        traitFirstCore: 7000601,
        traitFirstSub: [7_211_101],
        skillOrderInfo: { q: [1, 4], w: [2], e: [3] },
      }),
      route: { routeId: 5212, title: "호묘부활", likes: 4_732, skillPath: ["q", "e", "w"] },
    }, references);
    expect(player.build.skillOrder).toEqual(["Q", "W", "E", "Q"]);
    const description = buildReceiptDetailEmbed(player, "build").toJSON().description ?? "";
    expect(description).toContain("루트 5212 · 호묘부활");
    expect(description).toContain("추천 4,732회(조회 시점)");
    expect(description).toContain("Q → W → E → Q");
    expect(description).not.toContain("q → e → w");
  });

  it("세 등록 유저를 gameId와 팀 번호로 묶고 모바일용 Embed 제한을 지킨다", () => {
    const players = [
      ["a", "홉빵맨", 4], ["b", "홍어심슨", 4], ["c", "재자명지", 5],
    ].map(([userId, nickname, teamNumber], index) => buildReceiptPlayerView({
      userId: String(userId), nickname: String(nickname),
      game: storedGame({ gameId: 900, teamNumber: Number(teamNumber), characterNum: index + 1,
        damageToPlayer: 10_000 + index, matchingTeamMode: 3 }),
    }, references));
    const receipt = buildReceiptView(players);
    expect(receipt.teams).toHaveLength(2);
    expect(receipt.teams.map(team => team.players.length)).toEqual([2, 1]);
    const json = buildReceiptSummaryEmbed(receipt).toJSON();
    expect(json.title?.length).toBeLessThanOrEqual(256);
    expect(json.description?.length).toBeLessThanOrEqual(4096);
    expect(json.fields?.every(field => field.name.length <= 256 && field.value.length <= 1024)).toBe(true);
  });

  it("같은 모드 과거 표본이 5경기 이상일 때만 개인 최고를 선정한다", () => {
    const current = storedGame({ gameId: 10, damageToPlayer: 30_000, matchingMode: 3, matchingTeamMode: 3 });
    const previous = Array.from({ length: 5 }, (_, index) => storedGame({
      gameId: index + 1, damageToPlayer: 10_000 + index, matchingMode: 3, matchingTeamMode: 3,
    }));
    const player = buildReceiptPlayerView({
      userId: "uid", nickname: "테스터", game: current, previousGames: previous,
    }, references);
    expect(player.features).toContain("개인 최고 피해 30,000");
  });

  it("긴 이름과 특징 없는 경기에서도 Discord 문자열 제한을 지킨다", () => {
    const longReferences = {
      ...references,
      characterName: () => "가".repeat(2_000),
      itemName: () => "나".repeat(2_000),
    };
    const player = buildReceiptPlayerView({
      userId: "uid", nickname: "다".repeat(500),
      game: storedGame({ gameRank: 7, playerKill: 0, playerAssistant: 0, playerDeaths: 0,
        teamKill: 0, equipment: { 0: 101 } }),
    }, longReferences);
    const receipt = buildReceiptView([player]);
    expect(receipt.features).toEqual([]);
    const summary = buildReceiptSummaryEmbed(receipt).toJSON();
    const build = buildReceiptDetailEmbed(player, "build").toJSON();
    expect(summary.title?.length).toBeLessThanOrEqual(256);
    expect(summary.fields?.every(field => field.name.length <= 256 && field.value.length <= 1024)).toBe(true);
    expect(build.description?.length).toBeLessThanOrEqual(4096);
  });
});

describe("EternalReturnRouteService", () => {
  it("루트를 24시간 캐시하고 동시 요청을 공유한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-route-"));
    directories.push(directory);
    const store = await EternalReturnStore.open(join(directory, "test.sqlite"));
    let now = new Date("2026-09-24T00:00:00Z");
    const load = vi.fn(async (routeId: number) => ({ routeId, title: "호묘부활", likes: 4_732 }));
    const service = new EternalReturnRouteService({ apiKey: "key", store, now: () => now, load });

    const [first, shared] = await Promise.all([service.get(5212), service.get(5212)]);
    expect(first).toEqual(shared);
    expect(load).toHaveBeenCalledTimes(1);
    await service.get(5212);
    expect(load).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
    await service.get(5212);
    expect(load).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("루트 조회 실패가 게임 결과 생성을 막지 않게 선택적으로 무시한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-route-"));
    directories.push(directory);
    const store = await EternalReturnStore.open(join(directory, "test.sqlite"));
    const service = new EternalReturnRouteService({
      apiKey: "key", store, load: vi.fn().mockRejectedValue(new Error("route unavailable")),
    });
    await expect(service.getOptional(5212)).resolves.toBeUndefined();
    store.close();
  });
});

describe("EternalReturnReceiptBuilder", () => {
  it("DB의 결과 선수와 경기를 읽어 팀 View Model을 구성한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-receipt-builder-"));
    directories.push(directory);
    const store = await EternalReturnStore.open(join(directory, "test.sqlite"));
    for (const [userId, nickname, teamNumber] of [["a", "홉빵맨", 4], ["b", "홍어심슨", 4]] as const) {
      store.upsertUser(userId, nickname);
      store.saveGamePage(userId, [storedGame({ gameId: 700, teamNumber, routeIdOfStart: 5212 })]);
    }
    const receipt = store.enqueueGameReceipt({
      channelId: "channel", gameId: 700,
      players: [
        { userId: "a", nickname: "홉빵맨", teamNumber: 4, isMonitored: true },
        { userId: "b", nickname: "홍어심슨", teamNumber: 4, isMonitored: true },
      ],
    });
    const getOptional = vi.fn().mockResolvedValue({ routeId: 5212, title: "호묘부활", likes: 100 });
    const builder = new EternalReturnReceiptBuilder({ store, routes: { getOptional } });
    const view = await builder.build(receipt.receiptId, references);

    expect(view.players.map(player => player.nickname)).toEqual(["홉빵맨", "홍어심슨"]);
    expect(view.teams).toHaveLength(1);
    expect(view.players[0]?.build.route?.title).toBe("호묘부활");
    expect(getOptional).toHaveBeenCalledTimes(2);
    store.close();
  });
});

function storedGame(overrides: Partial<StoredEternalReturnGame> = {}): StoredEternalReturnGame {
  return {
    userId: "uid",
    gameId: 123,
    matchingMode: 3,
    matchingTeamMode: 3,
    characterNum: 1,
    gameRank: 2,
    playerKill: 3,
    playerDeaths: 1,
    playerAssistant: 4,
    teamKill: 7,
    startDtm: "2026-09-24T10:00:00Z",
    duration: 1_200,
    collectedAt: new Date("2026-09-24T10:30:00Z"),
    updatedAt: new Date("2026-09-24T10:30:00Z"),
    optional: {},
    ...overrides,
  };
}
