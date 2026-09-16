import { MessageFlags, SlashCommandBuilder, type Interaction } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleInteraction } from "../src/interaction-handler.js";
import type { BotCommand } from "../src/commands/types.js";

afterEach(() => vi.restoreAllMocks());

function request(autocomplete = false) {
  return {
    id: "interaction-id",
    applicationId: "application-id",
    commandName: "테스트",
    isChatInputCommand: () => !autocomplete,
    isAutocomplete: () => autocomplete,
    isMessageComponent: () => false,
    deferred: false,
    replied: false,
    responded: false,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
  };
}

describe("handleInteraction", () => {
  it.each(["이터널리턴", "전적", "상세전적", "시즌전적", "전적분석"])("비활성 명령 /%s는 남은 등록이나 키가 있어도 실행하지 않는다", async name => {
    const target = { ...request(), commandName: name };
    const execute = vi.fn();
    const command: BotCommand = { data: new SlashCommandBuilder().setName(name).setDescription("test"), execute };
    await handleInteraction(target as unknown as Interaction, new Map([[name, command]]), { erEnabled: false, erApiKey: "key" });
    expect(execute).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledWith({ content: "현재 이 봇에서 사용할 수 없는 기능입니다.", flags: MessageFlags.Ephemeral });
  });

  it("비활성 전적 자동완성은 콜백을 실행하지 않는다", async () => {
    const target = { ...request(true), commandName: "전적" };
    const autocomplete = vi.fn();
    const command: BotCommand = { data: new SlashCommandBuilder().setName("전적").setDescription("test"), execute: vi.fn(), autocomplete };
    await handleInteraction(target as unknown as Interaction, new Map([["전적", command]]), {});
    expect(autocomplete).not.toHaveBeenCalled();
    expect(target.respond).toHaveBeenCalledWith([]);
  });

  it("비활성 전적 버튼에는 안내하고 다른 기능의 버튼은 건드리지 않는다", async () => {
    const target = { ...request(), isChatInputCommand: () => false, isMessageComponent: () => true, customId: "er:games:next" };
    await handleInteraction(target as unknown as Interaction, new Map(), { erEnabled: false });
    expect(target.reply).toHaveBeenCalledOnce();
    target.reply.mockClear();
    target.customId = "endfield:next";
    await handleInteraction(target as unknown as Interaction, new Map(), { erEnabled: false });
    expect(target.reply).not.toHaveBeenCalled();
  });

  it("실행 코드에서 빠진 명령어에도 응답하고 경고를 남긴다", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const target = request();
    await handleInteraction(target as unknown as Interaction, new Map(), {});
    expect(target.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("명령어 등록"),
      flags: MessageFlags.Ephemeral,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unknown-command"));
    expect(target.reply.mock.calls[0]?.[0].content).not.toContain("전적");
  });

  it("정상 명령어 처리 시 상세 로그를 남기지 않는다", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const command: BotCommand = {
      data: new SlashCommandBuilder().setName("테스트").setDescription("test"),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    await handleInteraction(request() as unknown as Interaction, new Map([["테스트", command]]), {});
    expect(command.execute).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it("알 수 없는 자동완성 요청은 빈 목록으로 응답한다", async () => {
    const target = request(true);
    await handleInteraction(target as unknown as Interaction, new Map(), {});
    expect(target.respond).toHaveBeenCalledWith([]);
  });

  it("대기 응답 이후 오류는 원래 응답을 완료한다", async () => {
    const target = request();
    const command: BotCommand = {
      data: new SlashCommandBuilder().setName("테스트").setDescription("test"),
      execute: async () => { target.deferred = true; throw new Error("test failure"); },
    };
    await handleInteraction(target as unknown as Interaction, new Map([["테스트", command]]), {});
    expect(target.editReply).toHaveBeenCalledOnce();
    expect(target.followUp).not.toHaveBeenCalled();
  });

  it("만료된 요청의 오류 응답마저 실패해도 예외를 전파하지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const target = request();
    const failure = Object.assign(new Error("Unknown interaction"), {
      code: 10062, status: 404, requestBody: { token: "must-not-be-logged" },
    });
    const command: BotCommand = {
      data: new SlashCommandBuilder().setName("테스트").setDescription("test"),
      execute: vi.fn().mockRejectedValue(failure),
    };
    target.reply.mockRejectedValue(failure);
    await expect(handleInteraction(target as unknown as Interaction, new Map([["테스트", command]]), {})).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("error-response-failed"), expect.objectContaining({ code: 10062 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-be-logged");
  });
});
