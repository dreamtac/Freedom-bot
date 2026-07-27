import { describe, expect, it } from "vitest";

import { buildMarketOverviewEmbed, marketOverviewCommand } from "../src/commands/market-overview.js";

describe("marketOverviewCommand", () => {
  it("시장 현황 슬래시 명령어를 등록한다", () => {
    expect(marketOverviewCommand.data.toJSON()).toMatchObject({
      name: "시장현황",
      description: "한국과 미국의 주요 지수 현황을 조회합니다.",
    });
  });

  it("국내와 미국 주요 지수를 한눈에 표시한다", () => {
    const embed = buildMarketOverviewEmbed([
      {
        code: "0001",
        name: "KOSPI",
        market: "domestic",
        quote: {
          code: "0001",
          market: "domestic",
          price: 3_200.51,
          change: 18.42,
          changeRate: 0.58,
          changeDirection: "up",
          low: 3_180,
          high: 3_210,
          advancingIssues: 520,
          flatIssues: 42,
          decliningIssues: 330,
          requestedAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      },
      {
        code: "1001",
        name: "KOSDAQ",
        market: "domestic",
        quote: {
          code: "1001",
          market: "domestic",
          price: 810.23,
          change: -4.52,
          changeRate: -0.55,
          changeDirection: "down",
          low: 805,
          high: 820,
          advancingIssues: 410,
          flatIssues: 60,
          decliningIssues: 920,
          requestedAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      },
      {
        code: "COMP",
        name: "NASDAQ 종합",
        market: "overseas",
        quote: {
          code: "COMP",
          market: "overseas",
          price: 20_345.67,
          change: 120.45,
          changeRate: 0.60,
          changeDirection: "up",
          low: 20_200,
          high: 20_400,
          requestedAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      },
      {
        code: "SPX",
        name: "S&P 500",
        market: "overseas",
        quote: {
          code: "SPX",
          market: "overseas",
          price: 6_345.67,
          change: -10.45,
          changeRate: -0.16,
          changeDirection: "down",
          low: 6_300,
          high: 6_370,
          requestedAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      },
    ]).toJSON();

    expect(embed.title).toBe("주요 시장 현황");
    expect(embed.description).toBe("전일 대비와 장중 범위입니다.");
    expect(embed.fields).toEqual([
      expect.objectContaining({
        name: "한국 시장 · KRX",
        value: "**KOSPI**  **3,200.51**\n전일 대비 +18.42 (+0.58%) · 장중 3,180 - 3,210\n\n**KOSDAQ**  **810.23**\n전일 대비 -4.52 (-0.55%) · 장중 805 - 820",
        inline: false,
      }),
      expect.objectContaining({
        name: "미국 시장 · 주요 지수",
        value: "**NASDAQ 종합**  **20,345.67**\n전일 대비 +120.45 (+0.60%) · 장중 20,200 - 20,400\n\n**S&P 500**  **6,345.67**\n전일 대비 -10.45 (-0.16%) · 장중 6,300 - 6,370",
        inline: false,
      }),
      expect.objectContaining({
        name: "국내 시장 폭",
        value: "**KOSPI**  상승 520 · 보합 42 · 하락 330\n**KOSDAQ**  상승 410 · 보합 60 · 하락 920",
        inline: false,
      }),
    ]);
  });
});
