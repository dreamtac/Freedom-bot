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
      clientId: "12345678901234567",
      guildId: "23456789012345678",
      newsPollIntervalMs: 300_000,
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
      clientId: "12345678901234567",
      newsPollIntervalMs: 300_000,
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
      clientId: "12345678901234567",
      newsPollIntervalMs: 300_000,
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
});
