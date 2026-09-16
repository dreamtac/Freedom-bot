import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { eternalReturnCommand, eternalReturnRecordCommand } from "../src/commands/eternal-return.js";
import { loadCommands } from "../src/commands/index.js";
import * as api from "../src/sources/eternal-return.js";
import * as names from "../src/sources/eternal-return-reference.js";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.restoreAllMocks());

function interaction(subcommand: string, count: number | null = null) {
  return {
    id: "test-interaction",
    commandName: "이터널리턴",
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => name === "닉네임" ? "a1s1d1f1" : "normal",
      getInteger: (name: string) => name === "시즌" ? 41 : count,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

async function execute(target: ReturnType<typeof interaction>, configured = true) {
  await eternalReturnCommand.execute(
    target as unknown as ChatInputCommandInteraction,
    configured ? { erEnabled: true, erApiKey: "test-api-key" } : { erEnabled: true },
  );
}

describe("eternalReturnCommand", () => {
  it("기능이 꺼져 있으면 직접 실행 경로에서도 API와 이름 조회를 차단한다", async () => {
    const apiRequest = vi.spyOn(api, "getRecentGamesByNickname");
    const referenceRequest = vi.spyOn(names, "getReferenceData");
    const target = interaction("전적");
    await eternalReturnCommand.execute(target as unknown as ChatInputCommandInteraction, { erEnabled: false, erApiKey: "key" });
    expect(target.reply).toHaveBeenCalledWith({ content: expect.stringContaining("사용할 수 없는"), flags: MessageFlags.Ephemeral });
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(referenceRequest).not.toHaveBeenCalled();
  });
  it("기존 봇과 충돌하지 않는 하위 명령어와 입력 제한을 등록한다", () => {
    const data = eternalReturnCommand.data.toJSON();
    expect(data.name).toBe("이터널리턴");
    expect(data.options?.map(option => option.name)).toEqual(["전적", "랭크", "무료캐릭터"]);
    expect(data.options?.[0]).toMatchObject({ options: [
      { name: "닉네임", required: true, max_length: 32 },
      { name: "개수", min_value: 1, max_value: 5 },
    ] });
  });

  it("키 미설정 시 개인 안내만 보내고 API를 호출하지 않는다", async () => {
    const request = vi.spyOn(api, "getRecentGamesByNickname");
    const target = interaction("전적");
    await execute(target, false);
    expect(target.reply).toHaveBeenCalledWith({ content: expect.stringContaining("ER_API_KEY"), flags: MessageFlags.Ephemeral });
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("최근 전적은 기본 3경기를 공개 Embed로 표시한다", async () => {
    vi.spyOn(api, "getRecentGamesByNickname").mockResolvedValue({
      code: 200, userGames: Array.from({ length: 10 }, () => ({ gameRank: 1, characterNum: 88, damageToPlayer: 6479 })),
    });
    vi.spyOn(names, "getReferenceData").mockResolvedValue({ ...names.createEmptyReferenceData(), characterName: () => "비형" });
    const target = interaction("전적");
    await execute(target);
    expect(target.deferReply).toHaveBeenCalledWith();
    const embed = target.editReply.mock.calls[0]?.[0].embeds[0].toJSON();
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields[0].name).toContain("비형");
    expect(embed.fields[0].value).toContain("6,479");
  });

  it("저장 수집기가 있으면 직접 검색을 우선 갱신하고 DB 결과를 표시한다", async () => {
    const directApi = vi.spyOn(api, "getRecentGamesByNickname");
    const refreshNickname = vi.fn().mockResolvedValue({
      userId: "uid", nickname: "a1s1d1f1", pagesFetched: 1, recordsSeen: 1,
      storedGames: 1, reachedBoundary: true, exhausted: false,
      games: [{ gameId: 123, userId: "uid", gameRank: 2, characterNum: 1,
        damageToPlayer: 777, collectedAt: new Date(), updatedAt: new Date(), optional: {} }],
    });
    const backfill = vi.fn().mockImplementation(async () => {
      expect(target.editReply).toHaveBeenCalledOnce();
      return { games: [] };
    });
    vi.spyOn(names, "getReferenceData").mockResolvedValue(names.createEmptyReferenceData());
    const target = interaction("전적");
    await eternalReturnCommand.execute(target as unknown as ChatInputCommandInteraction, {
      erEnabled: true,
      erApiKey: "test-api-key",
      eternalReturnCollector: { refreshNickname, backfill } as never,
    });
    expect(refreshNickname).toHaveBeenCalledWith("a1s1d1f1", "interactive");
    expect(backfill).toHaveBeenCalledWith("uid", { targetGames: 100 });
    expect(directApi).not.toHaveBeenCalled();
    expect(target.editReply.mock.calls[0]?.[0].embeds[0].toJSON().fields[0].value).toContain("777");
  });

  it("원본의 /전적 요청도 수신 목록에서 찾고 API 호출 전에 대기 응답한다", async () => {
    const target = interaction("전적");
    target.commandName = "전적";
    const subcommand = vi.spyOn(target.options, "getSubcommand").mockImplementation(() => {
      throw new Error("Standalone command has no subcommand");
    });
    const request = vi.spyOn(api, "getRecentGamesByNickname").mockImplementation(async () => {
      expect(target.deferReply).toHaveBeenCalledOnce();
      return { code: 200, userGames: [] };
    });
    const commandsByName = new Map((await loadCommands({ erEnabled: true })).map(command => [command.data.name, command]));
    expect(commandsByName.get("전적")).toBe(eternalReturnRecordCommand);
    expect(eternalReturnRecordCommand.data.toJSON().name).toBe("전적");
    await eternalReturnRecordCommand.execute(target as unknown as ChatInputCommandInteraction, { erEnabled: true, erApiKey: "test-api-key" });
    expect(subcommand).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("a1s1d1f1", "test-api-key");
    expect(target.editReply).toHaveBeenCalledOnce();
  });

  it("이름 조회가 실패해도 요청한 경기 수와 코드, 안내를 표시한다", async () => {
    vi.spyOn(api, "getRecentGamesByNickname").mockResolvedValue({ code: 200, userGames: [{ characterNum: 88 }, { characterNum: 1 }] });
    vi.spyOn(names, "getReferenceData").mockRejectedValue(new Error("unavailable"));
    const target = interaction("전적", 1);
    await execute(target);
    const embed = target.editReply.mock.calls[0]?.[0].embeds[0].toJSON();
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields[0].name).toContain("88");
    expect(embed.footer.text).toContain("코드로 표시");
  });

  it("랭크 요청은 시즌별 스쿼드 결과를 표시하며 이름 데이터를 불러오지 않는다", async () => {
    const request = vi.spyOn(api, "getRankByNickname").mockResolvedValue({ code: 200, userRank: { mmr: 1782, rank: 121808 } });
    const referenceRequest = vi.spyOn(names, "getReferenceData");
    const target = interaction("랭크");
    await execute(target);
    expect(request).toHaveBeenCalledWith("a1s1d1f1", 41, "test-api-key");
    expect(referenceRequest).not.toHaveBeenCalled();
    const embed = target.editReply.mock.calls[0]?.[0].embeds[0].toJSON();
    expect(embed.fields[0].value).toBe("1,782");
    expect(embed.footer.text).toBe("API 시즌 41 · 스쿼드");
  });

  it("빈 무료 캐릭터 목록은 불필요한 이름 조회 없이 안내한다", async () => {
    const request = vi.spyOn(api, "getFreeCharacters").mockResolvedValue([]);
    const referenceRequest = vi.spyOn(names, "getReferenceData");
    const target = interaction("무료캐릭터");
    await execute(target);
    expect(request).toHaveBeenCalledWith(2, "test-api-key");
    expect(referenceRequest).not.toHaveBeenCalled();
    expect(target.editReply.mock.calls[0]?.[0].embeds[0].toJSON().description).toContain("찾지 못했습니다");
  });

  it("API 오류는 대기 중인 응답을 완료하며 사용자에게 안내한다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(api, "getRecentGamesByNickname").mockRejectedValue(new api.EternalReturnApiError("사용자를 찾지 못했습니다."));
    const target = interaction("전적");
    await execute(target);
    expect(target.editReply).toHaveBeenCalledWith("사용자를 찾지 못했습니다.");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("test-interaction"), expect.objectContaining({ stage: "recent-games-api" }));
  });

  it("예상하지 못한 내부 오류 내용은 공개하지 않는다", async () => {
    vi.spyOn(api, "getRecentGamesByNickname").mockRejectedValue(new Error("internal detail"));
    const target = interaction("전적");
    await execute(target);
    expect(target.editReply).toHaveBeenCalledWith(expect.stringContaining("잠시 후 다시 시도"));
  });
});

describe("이터널 리턴 설정", () => {
  const required = { DISCORD_BOT_TOKEN: "test-token", DISCORD_CLIENT_ID: "12345678901234567" };
  it("키는 선택 설정이며 공백 입력은 미설정으로 처리한다", () => {
    expect(loadConfig(required).erApiKey).toBeUndefined();
    expect(loadConfig({ ...required, ER_API_KEY: "  " }).erApiKey).toBeUndefined();
    expect(loadConfig({ ...required, ER_ENABLED: "true", ER_API_KEY: " test-key " }).erApiKey).toBe("test-key");
  });
});
