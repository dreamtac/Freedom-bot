import { describe, expect, it } from "vitest";

import { buildMarketIndexEmbed, marketIndexCommand } from "../src/commands/market-index.js";
import { getMarketIndex } from "../src/sources/market-indexes.js";

describe("marketIndexCommand", () => {
  it("지수 상세 조회 슬래시 명령어를 등록한다", () => {
    const command = marketIndexCommand.data.toJSON();

    expect(command).toMatchObject({
      name: "지수",
      description: "주요 지수의 상세 현황을 조회합니다.",
    });
    expect(command.options?.[0]).toMatchObject({
      name: "지수",
      required: true,
      choices: [
        { name: "KOSPI", value: "kospi" },
        { name: "KOSDAQ", value: "kosdaq" },
        { name: "NASDAQ 종합", value: "nasdaq-composite" },
        { name: "S&P 500", value: "sp500" },
      ],
    });
  });

  it("국내 지수의 상세 수치와 시장 폭을 표시한다", () => {
    const kospi = getMarketIndex("kospi");
    expect(kospi).toBeDefined();
    const embed = buildMarketIndexEmbed(kospi!, {
      code: "0001",
      market: "domestic",
      price: 3_200.51,
      change: 18.42,
      changeRate: 0.58,
      changeDirection: "up",
      open: 3_190,
      high: 3_210,
      low: 3_180,
      advancingIssues: 520,
      flatIssues: 42,
      decliningIssues: 330,
      requestedAt: new Date("2026-07-27T10:00:00.000Z"),
    }).toJSON();

    expect(embed.title).toBe("KOSPI 지수");
    expect(embed.description).toBe("**3,200.51**\n전일 대비 +18.42 (+0.58%)");
    expect(embed.fields).toEqual([
      expect.objectContaining({
        name: "장중 범위",
        value: "시가 3,190\n고가 3,210\n저가 3,180",
        inline: true,
      }),
      expect.objectContaining({ name: "전일 종가", value: "3,182.09", inline: true }),
      expect.objectContaining({
        name: "국내 시장 폭",
        value: "상승 520 · 보합 42 · 하락 330",
        inline: false,
      }),
    ]);
  });

  it("해외 지수에는 시장 폭을 표시하지 않는다", () => {
    const sp500 = getMarketIndex("sp500");
    expect(sp500).toBeDefined();
    const embed = buildMarketIndexEmbed(sp500!, {
      code: "SPX",
      market: "overseas",
      price: 6_345.67,
      change: -10.45,
      changeRate: -0.16,
      changeDirection: "down",
      previousClose: 6_356.12,
      open: 6_350,
      high: 6_370,
      low: 6_300,
      requestedAt: new Date("2026-07-27T10:00:00.000Z"),
    }).toJSON();

    expect(embed.title).toBe("S&P 500 지수");
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields?.[1]).toMatchObject({ name: "전일 종가", value: "6,356.12" });
  });
});
