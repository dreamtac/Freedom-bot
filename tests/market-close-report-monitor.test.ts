import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMarketCloseReportEmbed } from "../src/notifications/discord-market-close-report.js";
import {
  calculateDailyChangeRate,
  getDueMarketCloseReport,
  MarketCloseReportMonitor,
} from "../src/monitor/market-close-report-monitor.js";
import type {
  KisDailyPrice,
  KisIndexQuote,
} from "../src/sources/kis.js";
import type { OverseasExchange } from "../src/sources/overseas-stocks.js";
import { PriceAlertStore } from "../src/storage/price-alert-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("MarketCloseReportMonitor", () => {
  it("국내 정규장 마감 후 국내 관심 종목만 한 번 전송한다", async () => {
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    store.add({
      code: "NVDA",
      name: "엔비디아",
      assetType: "overseas",
      exchange: "NAS",
    });
    const source = new FakeMarketClosePriceSource();
    const send = vi.fn(async () => undefined);
    const client = createClient(send);
    const monitor = new MarketCloseReportMonitor({
      channelId: "channel-id",
      client,
      priceSource: source,
      requestGapMs: 0,
      store,
    });

    try {
      const now = new Date("2026-08-31T06:45:00.000Z");
      await monitor.checkNow(now);
      await monitor.checkNow(now);

      expect(source.domesticStockCodes).toEqual(["005930"]);
      expect(source.overseasStockCodes).toEqual([]);
      expect(send).toHaveBeenCalledTimes(1);
      const embed = getSentEmbed(send);
      expect(embed.title).toBe("한국 시장 마감");
      expect(embed.fields?.[0]?.value).toContain("KOSPI");
      expect(embed.fields?.[0]?.value).toContain("KOSDAQ");
      expect(embed.fields?.[1]?.value).toContain("삼성전자");
      expect(embed.fields?.[1]?.value).not.toContain("엔비디아");
      expect(store.hasSentMarketCloseReport("domestic", "20260831")).toBe(true);
    } finally {
      monitor.stop();
      store.close();
    }
  });

  it("한국시간 오전 7시 이후 미국 관심 종목과 미국 지수만 전송한다", async () => {
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    store.add({
      code: "NVDA",
      name: "엔비디아",
      assetType: "overseas",
      exchange: "NAS",
    });
    const source = new FakeMarketClosePriceSource();
    const send = vi.fn(async () => undefined);
    const monitor = new MarketCloseReportMonitor({
      channelId: "channel-id",
      client: createClient(send),
      priceSource: source,
      requestGapMs: 0,
      store,
    });

    try {
      await monitor.checkNow(new Date("2026-08-31T22:05:00.000Z"));

      expect(source.domesticStockCodes).toEqual([]);
      expect(source.overseasStockCodes).toEqual(["NVDA"]);
      const embed = getSentEmbed(send);
      expect(embed.title).toBe("미국 시장 마감");
      expect(embed.fields?.[0]?.value).toContain("NASDAQ 종합");
      expect(embed.fields?.[0]?.value).toContain("S&P 500");
      expect(embed.fields?.[1]?.value).toContain("엔비디아");
      expect(embed.fields?.[1]?.value).not.toContain("삼성전자");
      expect(store.hasSentMarketCloseReport("overseas", "20260831")).toBe(true);
    } finally {
      monitor.stop();
      store.close();
    }
  });

  it("장 마감 전과 휴장일에는 리포트를 예약하지 않는다", () => {
    expect(getDueMarketCloseReport(new Date("2026-08-31T06:20:00.000Z"))).toBeUndefined();
    expect(getDueMarketCloseReport(new Date("2026-08-30T07:00:00.000Z"))).toBeUndefined();
  });

  it("해당 거래일 정규장 종가와 직전 종가로 등락률을 계산한다", () => {
    expect(
      calculateDailyChangeRate(
        [
          { date: "20260831", close: 105, volume: 10 },
          { date: "20260827", close: 90, volume: 20 },
          { date: "20260828", close: 100, volume: 20 },
        ],
        "20260831",
      ),
    ).toBeCloseTo(5);
  });
});

describe("buildMarketCloseReportEmbed", () => {
  it("상승·보합·하락 수만 요약하고 최고 등락 종목은 표시하지 않는다", () => {
    const embed = buildMarketCloseReportEmbed({
      market: "overseas",
      tradingDate: "20260831",
      indexes: [
        { name: "NASDAQ 종합", changeRate: -1.18 },
        { name: "S&P 500", changeRate: -0.72 },
      ],
      stocks: [
        { code: "NVDA", name: "엔비디아", changeRate: -3.84 },
        { code: "AAPL", name: "애플", changeRate: 0.43 },
      ],
    }).toJSON();

    expect(embed.fields?.[2]?.value).toBe("상승 1종목 · 보합 0종목 · 하락 1종목");
    expect(JSON.stringify(embed)).not.toContain("가장 많이");
  });

  it("감시 종목이 많으면 Discord 필드 길이에 맞춰 나눈다", () => {
    const embed = buildMarketCloseReportEmbed({
      market: "overseas",
      tradingDate: "20260831",
      indexes: [{ name: "NASDAQ 종합", changeRate: 1 }],
      stocks: Array.from({ length: 40 }, (_, index) => ({
        code: `TEST${index}`,
        name: `아주 긴 관심 종목 이름 ${index + 1} `.repeat(3),
        changeRate: index / 10,
      })),
    }).toJSON();

    const stockFields = embed.fields?.filter((field) =>
      field.name.startsWith("관심 종목"),
    ) ?? [];
    expect(stockFields.length).toBeGreaterThan(1);
    expect(stockFields.every((field) => field.value.length <= 1_024)).toBe(true);
  });
});

class FakeMarketClosePriceSource {
  domesticStockCodes: string[] = [];
  overseasStockCodes: string[] = [];

  async fetchDomesticDailyPrices(code: string): Promise<KisDailyPrice[]> {
    this.domesticStockCodes.push(code);
    return [
      { date: "20260831", close: 102, volume: 10 },
      { date: "20260828", close: 100, volume: 10 },
    ];
  }

  async fetchOverseasDailyPrices(
    symbol: string,
    _exchange: OverseasExchange,
  ): Promise<KisDailyPrice[]> {
    this.overseasStockCodes.push(symbol);
    return [
      { date: "20260831", close: 98, volume: 10 },
      { date: "20260828", close: 100, volume: 10 },
    ];
  }

  async fetchDomesticIndexQuote(code: string): Promise<KisIndexQuote> {
    return createIndexQuote(code, "domestic", code === "0001" ? 1.24 : -0.38);
  }

  async fetchOverseasIndexQuote(code: string): Promise<KisIndexQuote> {
    return createIndexQuote(code, "overseas", code === "COMP" ? -1.18 : -0.72);
  }
}

function createIndexQuote(
  code: string,
  market: "domestic" | "overseas",
  changeRate: number,
): KisIndexQuote {
  return {
    code,
    market,
    price: 100,
    change: changeRate,
    changeRate,
    changeDirection: changeRate > 0 ? "up" : changeRate < 0 ? "down" : "flat",
    requestedAt: new Date(),
  };
}

function createClient(send: ReturnType<typeof vi.fn>): Client {
  return {
    channels: {
      fetch: vi.fn(async () => ({ isSendable: () => true, send })),
    },
  } as unknown as Client;
}

function getSentEmbed(send: ReturnType<typeof vi.fn>): Record<string, any> {
  const payload = send.mock.calls[0]?.[0] as {
    embeds?: Array<{ toJSON(): Record<string, any> }>;
  };
  return payload.embeds?.[0]?.toJSON() ?? {};
}

async function createStore(): Promise<PriceAlertStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-market-close-"));
  temporaryDirectories.push(directory);
  return PriceAlertStore.open(join(directory, "test.sqlite"));
}
