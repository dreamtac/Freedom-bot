import { describe, expect, it } from "vitest";

import { buildStockNewsEmbed, stockNewsCommand } from "../src/commands/stock-news.js";

describe("stockNewsCommand", () => {
  it("뉴스 조회 슬래시 명령어를 등록한다", () => {
    const command = stockNewsCommand.data.toJSON();

    expect(command.name).toBe("뉴스");
    expect(command.options?.[0]).toMatchObject({
      name: "종목",
      description: "국내 종목명·코드 또는 미국 티커·종목명입니다. 예: 삼성전자, NVDA",
      required: true,
      autocomplete: true,
    });
    expect(command.options?.[1]).toMatchObject({
      name: "개수",
      min_value: 3,
      max_value: 10,
    });
  });
});

describe("buildStockNewsEmbed", () => {
  it("주가 흐름과 뉴스 제목의 시각 및 출처를 함께 표시한다", () => {
    const embed = buildStockNewsEmbed({
      code: "005930",
      name: "삼성전자",
      krxQuote: {
        code: "005930",
        marketCode: "J",
        price: 72_000,
        change: 2_000,
        changeRate: 2.86,
        changeDirection: "up",
        requestedAt: new Date("2026-07-20T10:00:00+09:00"),
      },
      news: [
        {
          date: "20260720",
          time: "143015",
          source: "연합뉴스",
          title: "삼성전자, 차세대 메모리 투자 확대",
        },
      ],
    });
    const json = embed.toJSON();

    expect(json.title).toBe("삼성전자 (005930) 관련 뉴스");
    expect(json.description).toContain("KRX 정규장 72,000원");
    expect(json.fields?.[0]).toMatchObject({
      name: "최근 관련 뉴스 1건",
      value: "- [7/20 14:30 · 연합뉴스] 삼성전자, 차세대 메모리 투자 확대",
    });
  });

  it("NXT 시세는 조회 시각의 시장 구분으로 표시한다", () => {
    const embed = buildStockNewsEmbed({
      code: "005930",
      nxtQuote: {
        code: "005930",
        marketCode: "NX",
        price: 72_000,
        change: 2_000,
        changeRate: 2.86,
        changeDirection: "up",
        requestedAt: new Date("2026-07-28T12:32:00+09:00"),
      },
      news: [],
    }).toJSON();

    expect(embed.description).toContain("NXT 메인마켓 72,000원");
  });

  it("미국 주식의 세션별 시세와 뉴스 제목을 표시한다", () => {
    const embed = buildStockNewsEmbed({
      code: "NVDA",
      name: "엔비디아",
      overseasQuote: {
        symbol: "NVDA",
        exchange: "NAS",
        exchangeName: "NASDAQ",
        price: 185.42,
        change: -3.18,
        changeRate: -1.69,
        changeDirection: "down",
        requestedAt: new Date("2026-08-04T10:30:00-04:00"),
      },
      news: [
        {
          date: "20260804",
          time: "101500",
          source: "Reuters",
          title: "Nvidia shares decline in early trading",
        },
      ],
    }).toJSON();

    expect(embed.title).toBe("엔비디아 (NVDA) 관련 뉴스");
    expect(embed.description).toContain("미국 정규장 $185.42");
    expect(embed.description).toContain("거래소 NASDAQ · 미 동부 시간 10:30");
    expect(embed.fields?.[0]).toMatchObject({
      name: "최근 관련 뉴스 1건",
      value: "- [8/4 10:15 · Reuters] Nvidia shares decline in early trading",
    });
  });
});
