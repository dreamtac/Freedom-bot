import { describe, expect, it } from "vitest";

import { buildQuoteEmbed, quoteCommand } from "../src/commands/quote.js";
import {
  buildNightFuturesEmbed,
  nightFuturesCommand,
} from "../src/commands/night-futures.js";

describe("quoteCommand", () => {
  it("시세 조회 슬래시 명령어를 등록한다", () => {
    const command = quoteCommand.data.toJSON();

    expect(command.name).toBe("시세");
    expect(command.options?.[0]).toMatchObject({
      name: "종목",
      description: "국내 종목명·코드 또는 미국 티커·종목명입니다. 예: 삼성전자, NVDA",
      required: true,
      autocomplete: true,
    });
  });

  it("KRX 정규장에는 NXT 메인마켓 시세를 숨긴다", () => {
    const embed = buildQuoteEmbed({
      resolvedName: "삼성전자",
      nxtQuote: {
        code: "005930",
        marketCode: "NX",
        price: 222_000,
        change: -32_000,
        changeRate: -12.6,
        changeDirection: "down",
        requestedAt: new Date("2026-07-28T12:32:00+09:00"),
      },
      krxQuote: {
        code: "005930",
        marketCode: "J",
        price: 222_000,
        change: -32_000,
        changeRate: -12.6,
        changeDirection: "down",
        requestedAt: new Date("2026-07-28T12:32:00+09:00"),
      },
    }).toJSON();

    expect(embed.description).toContain("KRX 정규장: 222,000원");
    expect(embed.description).not.toContain("NXT 메인마켓");
    expect(embed.fields?.[0]).toMatchObject({ name: "KRX 정규장" });
  });

  it("NXT 애프터마켓에는 NXT 시세를 함께 표시한다", () => {
    const embed = buildQuoteEmbed({
      resolvedName: "삼성전자",
      nxtQuote: {
        code: "005930",
        marketCode: "NX",
        price: 222_500,
        change: -31_500,
        changeRate: -12.4,
        changeDirection: "down",
        requestedAt: new Date("2026-07-28T16:00:00+09:00"),
      },
      krxQuote: {
        code: "005930",
        marketCode: "J",
        price: 222_000,
        change: -32_000,
        changeRate: -12.6,
        changeDirection: "down",
        requestedAt: new Date("2026-07-28T16:00:00+09:00"),
      },
    }).toJSON();

    expect(embed.description).toContain("NXT 애프터마켓: 222,500원");
    expect(embed.fields?.[0]).toMatchObject({ name: "NXT 애프터마켓" });
  });

  it("NXT 마감 뒤에는 마지막 가격을 NXT 종가로 표시한다", () => {
    const embed = buildQuoteEmbed({
      resolvedName: "삼성전자",
      nxtQuote: {
        code: "005930",
        marketCode: "NX",
        price: 246_500,
        change: 6_500,
        changeRate: 2.71,
        changeDirection: "up",
        requestedAt: new Date("2026-08-05T20:37:00+09:00"),
      },
      krxQuote: {
        code: "005930",
        marketCode: "J",
        price: 246_000,
        change: 6_000,
        changeRate: 2.5,
        changeDirection: "up",
        requestedAt: new Date("2026-08-05T20:37:00+09:00"),
      },
    }).toJSON();

    expect(embed.description).toContain("NXT 종가: 246,500원");
    expect(embed.fields?.[0]).toMatchObject({ name: "NXT 종가" });
  });
});

describe("nightFuturesCommand", () => {
  it("KOSPI200 야간선물 조회 슬래시 명령어를 등록한다", () => {
    const command = nightFuturesCommand.data.toJSON();

    expect(command).toMatchObject({
      name: "야간선물",
      description: "KOSPI 야간선물 최근월물 시세를 조회합니다.",
    });
  });

  it("내부 월물 이름 대신 KOSPI 야간선물로 표시한다", () => {
    const embed = buildNightFuturesEmbed({
      code: "1A01609",
      name: "F 202609",
      price: 1_103.75,
      change: -28.75,
      changeRate: -2.54,
      changeDirection: "down",
      previousClose: 1_104,
      open: 1_136.55,
      high: 1_140.2,
      low: 1_099,
      volume: 8_568,
      requestedAt: new Date("2026-07-23T12:59:00.000Z"),
    }).toJSON();

    expect(embed.title).toBe("KOSPI 야간선물");
    expect(embed.description).not.toContain("F 202609");
    expect(embed.fields).toEqual([
      expect.objectContaining({ name: "장중 범위", inline: true }),
      expect.objectContaining({ name: "거래 정보", inline: true }),
    ]);
  });
});
