import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("필수 환경변수를 애플리케이션 설정으로 변환한다", () => {
    expect(
      loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "12345678901234567",
        DISCORD_GUILD_ID: "23456789012345678",
      }),
    ).toEqual({
      botToken: "test-token",
      erEnabled: false,
      clientId: "12345678901234567",
      guildId: "23456789012345678",
      newsPollIntervalMs: 300_000,
      stockMasterRefreshIntervalMs: 86_400_000,
    });
  });

  it("빈 서버 ID는 선택하지 않은 것으로 처리한다", () => {
    expect(
      loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "12345678901234567",
        DISCORD_GUILD_ID: "",
      }),
    ).toEqual({
      botToken: "test-token",
      erEnabled: false,
      clientId: "12345678901234567",
      newsPollIntervalMs: 300_000,
      stockMasterRefreshIntervalMs: 86_400_000,
    });
  });

  it("한국투자증권 API 키가 있으면 시세 조회 설정을 포함한다", () => {
    expect(
      loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "12345678901234567",
        KIS_APP_KEY: "app-key",
        KIS_APP_SECRET: "app-secret",
      }),
    ).toEqual({
      botToken: "test-token",
      erEnabled: false,
      clientId: "12345678901234567",
      newsPollIntervalMs: 300_000,
      stockMasterRefreshIntervalMs: 86_400_000,
      kis: {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.koreainvestment.com:9443",
        websocketUrl: "ws://ops.koreainvestment.com:21000",
      },
    });
  });

  it("한국투자증권 API 키는 app key와 secret을 함께 요구한다", () => {
    expect(() =>
      loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "12345678901234567",
        KIS_APP_KEY: "app-key",
      }),
    ).toThrow("KIS_APP_KEY와 KIS_APP_SECRET은 함께 설정해야 합니다.");
  });

  it("필수 환경변수가 없으면 이해할 수 있는 오류를 반환한다", () => {
    expect(() => loadConfig({})).toThrow("환경변수 설정을 확인해 주세요");
  });

  const required = { DISCORD_BOT_TOKEN: "test-token", DISCORD_CLIENT_ID: "12345678901234567" };

  it.each([undefined, "", " ", "false", " false "])("ER_ENABLED=%s이면 키가 있어도 기능과 키 전달을 끈다", flag => {
    const config = loadConfig({ ...required, ER_ENABLED: flag, ER_API_KEY: "secret" });
    expect(config.erEnabled).toBe(false);
    expect(config.erApiKey).toBeUndefined();
  });

  it("명시적으로 활성화한 개발 설정에서만 키를 전달한다", () => {
    expect(loadConfig({ ...required, ER_ENABLED: "true", ER_API_KEY: " key " }))
      .toMatchObject({ erEnabled: true, erApiKey: "key" });
    expect(loadConfig({ ...required, ER_ENABLED: "true" })).toMatchObject({ erEnabled: true });
  });

  it.each(["0", "1", "yes", "FALSE", "typo"])("잘못된 기능 설정 %s를 거부한다", flag => {
    expect(() => loadConfig({ ...required, ER_ENABLED: flag })).toThrow("ER_ENABLED");
  });
});
