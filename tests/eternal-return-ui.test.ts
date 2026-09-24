import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ButtonInteraction, ChatInputCommandInteraction } from "discord.js";

import {
  handleEternalReturnComponent,
  startEternalReturnScreen,
} from "../src/commands/eternal-return-ui.js";
import { createEmptyReferenceData } from "../src/sources/eternal-return-reference.js";
import * as referenceSource from "../src/sources/eternal-return-reference.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("Eternal Return interactive UI", () => {
  it("최근 전적을 5경기씩 표시하고 버튼으로 다음 페이지를 수정한다", async () => {
    const { store, context } = await fixture();
    const target = commandInteraction();
    await startEternalReturnScreen(target as never, context as never, "games");

    const first = target.editReply.mock.calls[0]![0];
    expect(first.embeds[0].toJSON().fields).toHaveLength(5);
    const nextId = first.components[0].toJSON().components.find(component => component.label === "다음 ▶")!.custom_id;
    const button = componentInteraction(nextId, "owner");
    await handleEternalReturnComponent(button as unknown as ButtonInteraction, context as never);

    expect(button.deferUpdate).toHaveBeenCalledOnce();
    const second = button.editReply.mock.calls[0]![0];
    expect(second.embeds[0].toJSON().fields[0].name).toContain("6.");
    store.close();
  });

  it("다른 사용자의 조작을 거부하고 알 수 없는 세션은 만료로 안내한다", async () => {
    const { store, context } = await fixture();
    const target = commandInteraction();
    await startEternalReturnScreen(target as never, context as never, "games");
    const first = target.editReply.mock.calls[0]![0];
    const detailId = first.components[0].toJSON().components.find(component => component.label === "상세 보기")!.custom_id;

    const stranger = componentInteraction(detailId, "stranger");
    await handleEternalReturnComponent(stranger as unknown as ButtonInteraction, context as never);
    expect(stranger.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("실행한 사용자") }));
    expect(stranger.deferUpdate).not.toHaveBeenCalled();

    const expired = componentInteraction("er:missing-session:next", "owner");
    await handleEternalReturnComponent(expired as unknown as ButtonInteraction, context as never);
    expect(expired.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("만료") }));
    store.close();
  });

  it("자동 갱신 중 API userId가 회전해도 열린 화면을 최신 저장 레코드에 연결한다", async () => {
    const { store, context } = await fixture();
    const target = commandInteraction();
    await startEternalReturnScreen(target as never, context as never, "games");
    const first = target.editReply.mock.calls[0]![0];
    const nextId = first.components[0].toJSON().components.find(component => component.label === "다음 ▶")!.custom_id;

    store.upsertResolvedUser("rotated-token", "홉빵맨");
    expect(store.getUser("uid")).toBeUndefined();
    const button = componentInteraction(nextId, "owner");
    await handleEternalReturnComponent(button as unknown as ButtonInteraction, context as never);

    expect(button.editReply.mock.calls[0]![0].embeds[0].toJSON().fields[0].name).toContain("6.");
    store.close();
  });

  it("시즌 화면은 직접 요청에서 프로필을 갱신하고 분석 화면으로 전환한다", async () => {
    const { store, context, getCurrentSeasonProfile } = await fixture();
    const target = commandInteraction();
    await startEternalReturnScreen(target as never, context as never, "season");
    expect(getCurrentSeasonProfile).toHaveBeenCalledWith("uid", { force: true, priority: "interactive" });
    const season = target.editReply.mock.calls[0]![0];
    expect(season.embeds[0].toJSON().title).toContain("시즌 전적");

    const analysisId = season.components[0].toJSON().components.find(component => component.label === "전적 분석")!.custom_id;
    const button = componentInteraction(analysisId, "owner");
    await handleEternalReturnComponent(button as unknown as ButtonInteraction, context as never);
    const analysisEmbed = button.editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(analysisEmbed.title).toContain("전적 분석");
    expect(analysisEmbed.fields.find(field => field.name === "분석 표본")?.value)
      .toContain("현재 시즌 랭크 6/100경기");
    expect(analysisEmbed.fields.find(field => field.name === "DB 전체 수집")?.value).toBe("6경기");
    expect(button.editReply.mock.calls[0]![0].components[0].toJSON().components[0].type).toBe(3);
    store.close();
  });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-ui-"));
  directories.push(directory);
  const store = await EternalReturnStore.open(join(directory, "test.sqlite"));
  store.upsertUser("uid", "홉빵맨");
  store.saveGamePage("uid", Array.from({ length: 6 }, (_, index) => ({
    gameId: 100 - index, seasonId: 41, matchingMode: 3, matchingTeamMode: 3,
    characterNum: index % 2 ? 3 : 42, gameRank: index + 1,
    playerKill: 2, playerDeaths: 1, playerAssistant: 3, teamKill: 7,
    damageToPlayer: 10_000 + index, damageFromPlayer: 5_000, damageToMonster: 20_000,
    startDtm: new Date((100 - index) * 1_000).toISOString(),
  })));
  vi.spyOn(referenceSource, "getReferenceData").mockResolvedValue({
    ...createEmptyReferenceData(), characterName: code => `실험체${code}`,
  });
  const collection = {
    userId: "uid", nickname: "홉빵맨", games: store.listGames("uid", { limit: 500 }),
    pagesFetched: 1, recordsSeen: 6, storedGames: 0, reachedBoundary: true, exhausted: true,
  };
  const getCurrentSeasonProfile = vi.fn().mockResolvedValue({
    userId: "uid", nickname: "홉빵맨", seasonId: 41, seasonName: "Season21", matchingMode: 3,
    mmr: 4648, rank: 100, tier: { label: "플래티넘 2", minimumMmr: 4300, verified: true, source: "test" },
    seasonGames: 28, collectedGames: 6, partial: true,
    preferredCharacters: [{ characterNum: 42, seasonGames: 6, averageDamage: 10_000, damageSamples: 3, collectedGames: 3 }],
    fetchedAt: new Date(), cached: false,
  });
  const context = {
    erEnabled: true, erApiKey: "key", eternalReturnStore: store,
    eternalReturnCollector: {
      refreshNickname: vi.fn().mockResolvedValue(collection),
      backfill: vi.fn().mockResolvedValue(collection),
    },
    eternalReturnProfileService: { getCurrentSeasonProfile },
  };
  return { store, context, getCurrentSeasonProfile };
}

function commandInteraction() {
  return {
    id: "command", user: { id: "owner" },
    options: { getString: () => "홉빵맨", getInteger: () => null },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction & { editReply: ReturnType<typeof vi.fn> };
}

function componentInteraction(customId: string, userId: string) {
  return {
    id: "component", customId, user: { id: userId }, values: [],
    isStringSelectMenu: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}
