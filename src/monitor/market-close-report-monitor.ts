import type { Client } from "discord.js";

import {
  sendMarketCloseReport,
  type MarketCloseIndexResult,
  type MarketCloseStockResult,
} from "../notifications/discord-market-close-report.js";
import type { KisDailyPrice, KisIndexQuote } from "../sources/kis.js";
import { MARKET_INDEXES } from "../sources/market-indexes.js";
import {
  getKoreanTradingDate,
  getUsTradingDate,
  isKoreanTradingDay,
  isUsTradingDay,
} from "../sources/market-calendar.js";
import type { OverseasExchange } from "../sources/overseas-stocks.js";
import type {
  MarketCloseReportMarket,
  PriceAlertStock,
  PriceAlertStore,
} from "../storage/price-alert-store.js";

const CHECK_INTERVAL_MS = 60_000;
const REQUEST_GAP_MS = 120;

interface MarketClosePriceSource {
  fetchDomesticDailyPrices(code: string, count?: number): Promise<KisDailyPrice[]>;
  fetchDomesticIndexQuote(code: string): Promise<KisIndexQuote>;
  fetchOverseasDailyPrices(
    symbol: string,
    exchange: OverseasExchange,
    count?: number,
  ): Promise<KisDailyPrice[]>;
  fetchOverseasIndexQuote(code: string): Promise<KisIndexQuote>;
}

export interface MarketCloseReportMonitorOptions {
  channelId: string;
  client: Client;
  priceSource: MarketClosePriceSource;
  store: PriceAlertStore;
  checkIntervalMs?: number;
  requestGapMs?: number;
}

export class MarketCloseReportMonitor {
  readonly #channelId: string;
  readonly #client: Client;
  readonly #priceSource: MarketClosePriceSource;
  readonly #store: PriceAlertStore;
  readonly #checkIntervalMs: number;
  readonly #requestGapMs: number;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #stopped = true;

  constructor({
    channelId,
    client,
    priceSource,
    store,
    checkIntervalMs = CHECK_INTERVAL_MS,
    requestGapMs = REQUEST_GAP_MS,
  }: MarketCloseReportMonitorOptions) {
    this.#channelId = channelId;
    this.#client = client;
    this.#priceSource = priceSource;
    this.#store = store;
    this.#checkIntervalMs = checkIntervalMs;
    this.#requestGapMs = requestGapMs;
  }

  start(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    void this.checkNow();
    this.#timer = setInterval(() => void this.checkNow(), this.#checkIntervalMs);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async checkNow(now = new Date()): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      const dueReport = getDueMarketCloseReport(now);
      if (!dueReport) {
        return;
      }
      const stocks = this.#store
        .list()
        .filter((stock) => stock.assetType === dueReport.market);
      if (
        stocks.length === 0 ||
        this.#store.hasSentMarketCloseReport(
          dueReport.market,
          dueReport.tradingDate,
        )
      ) {
        return;
      }

      const [indexes, stockResults] = await Promise.all([
        this.#fetchIndexes(dueReport.market),
        this.#fetchStocks(stocks, dueReport.tradingDate),
      ]);
      await sendMarketCloseReport(this.#client, this.#channelId, {
        market: dueReport.market,
        tradingDate: dueReport.tradingDate,
        indexes,
        stocks: stockResults,
      });
      this.#store.markMarketCloseReportSent(
        dueReport.market,
        dueReport.tradingDate,
      );
    } catch (error: unknown) {
      console.error("시장 마감 리포트를 전송하지 못했습니다.", error);
    } finally {
      this.#running = false;
    }
  }

  async #fetchIndexes(
    market: MarketCloseReportMarket,
  ): Promise<MarketCloseIndexResult[]> {
    const definitions = MARKET_INDEXES.filter((index) => index.market === market);
    const results: MarketCloseIndexResult[] = [];
    for (const definition of definitions) {
      const quote = market === "domestic"
        ? await this.#priceSource.fetchDomesticIndexQuote(definition.code)
        : await this.#priceSource.fetchOverseasIndexQuote(definition.code);
      results.push({ name: definition.name, changeRate: quote.changeRate });
      await delay(this.#requestGapMs);
    }
    return results;
  }

  async #fetchStocks(
    stocks: readonly PriceAlertStock[],
    tradingDate: string,
  ): Promise<MarketCloseStockResult[]> {
    const results: MarketCloseStockResult[] = [];
    for (const stock of stocks) {
      const prices = stock.assetType === "domestic"
        ? await this.#priceSource.fetchDomesticDailyPrices(stock.code, 5)
        : await this.#fetchOverseasPrices(stock);
      results.push({
        code: stock.code,
        name: stock.name,
        changeRate: calculateDailyChangeRate(prices, tradingDate),
      });
      await delay(this.#requestGapMs);
    }
    return results;
  }

  #fetchOverseasPrices(stock: PriceAlertStock): Promise<KisDailyPrice[]> {
    if (!stock.exchange) {
      throw new Error(`${stock.name} (${stock.code})의 미국 거래소 정보가 없습니다.`);
    }
    return this.#priceSource.fetchOverseasDailyPrices(
      stock.code,
      stock.exchange,
      5,
    );
  }
}

export function getDueMarketCloseReport(
  now: Date,
): { market: MarketCloseReportMarket; tradingDate: string } | undefined {
  const koreanClock = getKoreanClock(now);
  const koreanDate = getKoreanTradingDate(now);
  if (
    koreanClock.minutes >= 15 * 60 + 40 &&
    isKoreanTradingDay(koreanDate)
  ) {
    return { market: "domestic", tradingDate: koreanDate };
  }

  if (koreanClock.minutes >= 7 * 60 && koreanClock.minutes < 11 * 60) {
    const usDate = getUsTradingDate(now);
    if (isUsTradingDay(usDate)) {
      return { market: "overseas", tradingDate: usDate };
    }
  }
  return undefined;
}

export function calculateDailyChangeRate(
  prices: readonly KisDailyPrice[],
  tradingDate: string,
): number {
  const current = prices.find(
    (price) => price.date === tradingDate && price.close !== undefined,
  );
  const previous = prices
    .filter(
      (price) =>
        price.date !== undefined &&
        price.date < tradingDate &&
        price.close !== undefined,
    )
    .sort((left, right) => right.date!.localeCompare(left.date!))[0];
  if (!current?.close || !previous?.close) {
    throw new Error(`${tradingDate} 정규장 종가가 아직 확정되지 않았습니다.`);
  }
  return ((current.close - previous.close) / previous.close) * 100;
}

function getKoreanClock(now: Date): { minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: "hour" | "minute"): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { minutes: value("hour") * 60 + value("minute") };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
