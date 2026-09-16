import { Routes, SlashCommandBuilder, type REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { parseRegistrationOptions, syncApplicationCommands } from "../src/command-registration.js";

const clientId = "12345678901234567";
const guildId = "23456789012345678";
const oldGuildId = "34567890123456789";
const commands = [{ data: new SlashCommandBuilder().setName("시세").setDescription("stock quote"), execute: vi.fn() }];
const options = { dryRun: false, cleanupGuildIds: [] };

function mockRest() {
  const rest = {
    get: vi.fn(async (route: string): Promise<unknown> => {
      if (route === Routes.oauth2CurrentApplication()) return { id: clientId };
      if (route === Routes.applicationCommands(clientId)) return [
        { id: "1", name: "전적", type: 1 }, { id: "2", name: "다른명령", type: 1 },
        { id: "3", name: "전적", type: 2 },
      ];
      return [{ id: "4", name: "이터널리턴", type: 1 }, { id: "5", name: "엔드필드", type: 1 }];
    }),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return { rest, client: rest as unknown as Pick<REST, "get" | "post" | "delete"> };
}

describe("command registration", () => {
  it("비활성화 시 전역·현재 서버·지정 서버의 전적만 삭제하고 다른 명령은 보존한다", async () => {
    const { rest, client } = mockRest();
    const plan = await syncApplicationCommands(client, { clientId, guildId, erEnabled: false }, commands, { ...options, cleanupGuildIds: [oldGuildId, guildId] });
    expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands(clientId, guildId), { body: commands[0]!.data.toJSON() });
    expect(rest.delete.mock.calls.map(call => call[0])).toEqual([
      Routes.applicationCommand(clientId, "1"),
      Routes.applicationGuildCommand(clientId, guildId, "4"),
      Routes.applicationGuildCommand(clientId, oldGuildId, "4"),
    ]);
    expect(plan.filter(action => action.action === "delete").map(action => action.name)).toEqual(["전적", "이터널리턴", "이터널리턴"]);
    expect(Math.max(...rest.get.mock.invocationCallOrder)).toBeLessThan(rest.post.mock.invocationCallOrder[0]!);
  });

  it("전역 운영 등록에서는 전역만 조회하고 이름이 다른 명령을 지우지 않는다", async () => {
    const { rest, client } = mockRest();
    await syncApplicationCommands(client, { clientId, erEnabled: false }, commands, options);
    expect(rest.get).toHaveBeenCalledTimes(2);
    expect(rest.post).toHaveBeenCalledWith(Routes.applicationCommands(clientId), { body: commands[0]!.data.toJSON() });
    expect(rest.delete).toHaveBeenCalledExactlyOnceWith(Routes.applicationCommand(clientId, "1"));
  });

  it("dry-run은 계획만 반환하고 Discord를 변경하지 않는다", async () => {
    const { rest, client } = mockRest();
    const plan = await syncApplicationCommands(client, { clientId, guildId, erEnabled: false }, commands, { ...options, dryRun: true });
    expect(plan.some(action => action.action === "delete")).toBe(true);
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("개발 활성화 상태에서는 다른 범위의 명령을 정리하지 않는다", async () => {
    const { rest, client } = mockRest();
    const er = { ...commands[0]!, data: new SlashCommandBuilder().setName("전적").setDescription("record") };
    await syncApplicationCommands(client, { clientId, guildId, erEnabled: true }, [er], options);
    expect(rest.get).toHaveBeenCalledExactlyOnceWith(Routes.oauth2CurrentApplication());
    expect(rest.delete).not.toHaveBeenCalled();
    expect(rest.post).toHaveBeenCalledOnce();
  });

  it("앱 ID가 다르면 등록·삭제를 하지 않는다", async () => {
    const { rest, client } = mockRest();
    rest.get.mockResolvedValueOnce({ id: "another-app" });
    await expect(syncApplicationCommands(client, { clientId, erEnabled: false }, commands, options)).rejects.toThrow("DISCORD_CLIENT_ID");
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("추가 범위 조회가 실패하면 등록·삭제 전에 중단한다", async () => {
    const { rest, client } = mockRest();
    rest.get.mockImplementation(async route => {
      if (route === Routes.oauth2CurrentApplication()) return { id: clientId };
      if (route === Routes.applicationCommands(clientId)) return [];
      throw new Error("scope not accessible");
    });
    await expect(syncApplicationCommands(client, { clientId, guildId, erEnabled: false }, commands, options)).rejects.toThrow("scope not accessible");
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("잘못된 비활성 목록과 활성 상태의 정리 옵션은 API 호출 전에 거부한다", async () => {
    const { rest, client } = mockRest();
    const er = { ...commands[0]!, data: new SlashCommandBuilder().setName("전적").setDescription("record") };
    await expect(syncApplicationCommands(client, { clientId, erEnabled: false }, [er], options)).rejects.toThrow("비활성화");
    await expect(syncApplicationCommands(client, { clientId, erEnabled: true }, commands, { ...options, cleanupGuildIds: [guildId] })).rejects.toThrow("ER_ENABLED=false");
    expect(rest.get).not.toHaveBeenCalled();
  });

  it("정리 서버 옵션은 명시적인 서버 ID만 허용하고 중복을 제거한다", () => {
    expect(parseRegistrationOptions(["--dry-run", `--cleanup-guild=${guildId}`, `--cleanup-guild=${guildId}`]))
      .toEqual({ dryRun: true, cleanupGuildIds: [guildId] });
    expect(() => parseRegistrationOptions(["--cleanup-guild=all"])).toThrow("옵션");
  });
});
