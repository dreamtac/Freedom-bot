import { describe, expect, it } from "vitest";

import { buildStockNewsEmbed, stockNewsCommand } from "../src/commands/stock-news.js";

describe("stockNewsCommand", () => {
  it("뉴스 조회 슬래시 명령어를 등록한다", () => {
    const command = stockNewsCommand.data.toJSON();

    expect(command.name).toBe("뉴스");
    expect(command.options?.[0]).toMatchObject({
      name: "종목",
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
});
