import type { Client } from "discord.js";

import { sendStockPriceAlert } from "../notifications/discord-price-alert.js";
import type {
  KisRealtimeSubscription,
  KisRealtimeTick,
  RealtimeMarket,
} from "../sources/kis-realtime.js";
import { getCurrentKospi200NightFuturesContract } from "../sources/krx-night-futures.js";
import {
  getKoreanTradingDate,
  getPreviousKoreanTradingDate,
  isKoreanTradingDay,
  isUsTradingDay,
} from "../sources/market-calendar.js";
import {
  NIGHT_FUTURES_ALERT_THRESHOLDS,
  MAX_PRICE_ALERT_STOCKS,
  PRICE_ALERT_THRESHOLDS,
  type PriceAlertDirection,
  type PriceAlertStock,
  type PriceAlertStore,
} from "../storage/price-alert-store.js";

const RECONNECT_DELAY_MS = 5_000;
const NXT_CLOSE_FLUSH_INTERVAL_MS = 5_000;
const tradingDateFormatters = new Map<string, Intl.DateTimeFormat>();

interface RealtimePriceSource {
  streamPriceAlerts(
    subscriptions: readonly KisRealtimeSubscription[],
    onTick: (tick: KisRealtimeTick) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
}

interface NxtClosePriceSource {
  fetchDomesticQuote(
    code: string,
    marketCode: "NX",
  ): Promise<{ businessDate?: string; price: number }>;
}

interface OverseasStockMetadataSource {
  resolveOverseas(query: string): {
    symbol: string;
    name?: string;
    exchange: NonNullable<PriceAlertStock["exchange"]>;
  };
}

export interface PriceAlertMonitorOptions {
  channelId: string;
  client: Client;
  nxtClosePriceSource?: NxtClosePriceSource;
  realtimeClient: RealtimePriceSource;
  stockMetadataSource?: OverseasStockMetadataSource;
  store: PriceAlertStore;
}

export class PriceAlertMonitor {
  readonly #channelId: string;
  readonly #client: Client;
  readonly #nxtClosePriceSource: NxtClosePriceSource | undefined;
  readonly #realtimeClient: RealtimePriceSource;
  readonly #stockMetadataSource: OverseasStockMetadataSource | undefined;
  readonly #store: PriceAlertStore;
  readonly #notifiedEventKeys = new Set<string>();
  readonly #pendingEventKeys = new Set<string>();
  readonly #pendingNxtClosingPrices = new Map<
    string,
    { code: string; price: number; tradingDate: string }
  >();
  readonly #nxtCloseCaptureAttempts = new Set<string>();
  readonly #stocksByCode = new Map<string, PriceAlertStock>();
  readonly #domesticReferencePrices = new Map<
    string,
    { label: string; price: number } | null
  >();
  #abortController: AbortController | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #sessionTimer: NodeJS.Timeout | undefined;
  #nxtCloseFlushTimer: NodeJS.Timeout | undefined;
  #activeDomesticMarket: RealtimeMarket | undefined;
  #activeOverseasSession: "day" | "standard" | undefined;
  #activeNightFuturesSession = false;
  #nightFuturesAlertEnabled = false;
  #stopped = true;

  constructor({
    channelId,
    client,
    nxtClosePriceSource,
    realtimeClient,
    stockMetadataSource,
    store,
  }: PriceAlertMonitorOptions) {
    this.#channelId = channelId;
    this.#client = client;
    this.#nxtClosePriceSource = nxtClosePriceSource;
    this.#realtimeClient = realtimeClient;
    this.#stockMetadataSource = stockMetadataSource;
    this.#store = store;
  }

  start(): void {
    if (!this.#stopped) {
      return;
    }

    this.#stopped = false;
    this.refresh();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#nxtCloseFlushTimer) {
      clearTimeout(this.#nxtCloseFlushTimer);
      this.#nxtCloseFlushTimer = undefined;
    }
    this.#flushNxtClosingPrices();
    this.#abortController?.abort();
    this.#abortController = undefined;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#sessionTimer) {
      clearTimeout(this.#sessionTimer);
      this.#sessionTimer = undefined;
    }
  }

  refresh(): void {
    if (this.#stopped) {
      return;
    }

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#flushNxtClosingPrices();
    this.#abortController?.abort();
    this.#scheduleSessionRefresh();
    void this.#connect();
  }

  async #connect(): Promise<void> {
    const stocks = this.#repairOverseasStockMetadata(this.#store.list());
    this.#stocksByCode.clear();
    for (const stock of stocks) {
      this.#stocksByCode.set(stock.code, stock);
    }
    this.#domesticReferencePrices.clear();
    if (this.#stopped) {
      return;
    }

    const domesticMarket = getActiveRealtimeMarket();
    this.#activeDomesticMarket = domesticMarket;
    const overseasSession = stocks.some((stock) => stock.assetType === "overseas")
      ? getActiveOverseasRealtimeSession()
      : undefined;
    this.#activeOverseasSession = overseasSession;
    const nightFuturesAlertEnabled = this.#store.isNightFuturesAlertEnabled();
    this.#nightFuturesAlertEnabled = nightFuturesAlertEnabled;
    const hasNightFuturesCapacity = stocks.length < MAX_PRICE_ALERT_STOCKS;
    const shouldWatchNightFutures =
      nightFuturesAlertEnabled && hasNightFuturesCapacity && isKrxNightFuturesSession();
    if (nightFuturesAlertEnabled && !hasNightFuturesCapacity) {
      console.error(
        "KOSPI 야간선물 실시간 알림을 구독하지 않았습니다. KIS WebSocket은 최대 40개까지만 구독할 수 있습니다.",
      );
    }
    this.#activeNightFuturesSession = shouldWatchNightFutures;
    let nightFuturesCode: string | undefined;
    if (shouldWatchNightFutures) {
      try {
        nightFuturesCode = (await getCurrentKospi200NightFuturesContract()).code;
      } catch (error: unknown) {
        console.error("KOSPI 야간선물 최근월물을 가져오지 못했습니다.", error);
      }
    }

    void this.#captureNxtClosesAfterMarket(stocks).catch((error: unknown) => {
      console.error("NXT 기준가 보완 조회에 실패했습니다.", error);
    });

    const subscriptions = getSubscriptions(
      stocks,
      domesticMarket,
      overseasSession,
      nightFuturesCode,
    );
    if (subscriptions.length === 0) {
      return;
    }

    const controller = new AbortController();
    this.#abortController = controller;
    try {
      if (this.#stopped || controller.signal.aborted) {
        return;
      }

      await this.#realtimeClient.streamPriceAlerts(
        subscriptions,
        (tick) => this.#handleTick(tick),
        controller.signal,
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        console.error("KIS 실시간 주가 알림 연결이 종료되었습니다.", error);
      }
    } finally {
      if (this.#abortController !== controller) {
        return;
      }
      this.#abortController = undefined;
      if (!this.#stopped && !controller.signal.aborted) {
        this.#reconnectTimer = setTimeout(() => {
          this.#reconnectTimer = undefined;
          void this.#connect();
        }, RECONNECT_DELAY_MS);
      }
    }
  }

  async #handleTick(tick: KisRealtimeTick): Promise<void> {
    if (tick.assetType === "nightFutures") {
      await this.#handleNightFuturesTick(tick);
      return;
    }

    const stock = this.#stocksByCode.get(tick.code);
    if (!stock || stock.assetType !== tick.assetType) {
      return;
    }

    const tradingDate = tick.assetType === "overseas"
      ? normalizeTradingDate(tick.tradingDate) ?? getTradingDate("America/New_York")
      : getTradingDate("Asia/Seoul");
    const reference = this.#getReferencePrice(stock, tick, tradingDate);
    if (!reference) {
      return;
    }

    const rate = getReferencePriceChangeRate(tick.price, reference.price);
    if (rate === undefined) {
      return;
    }

    const direction: PriceAlertDirection = rate > 0 ? "up" : "down";
    for (const threshold of PRICE_ALERT_THRESHOLDS) {
      if (Math.abs(rate) < threshold) {
        continue;
      }

      const event = {
        code: stock.code,
        tradingDate,
        direction,
        threshold,
      };
      const eventKey = `${event.code}:${event.tradingDate}:${event.direction}:${event.threshold}`;
      if (this.#pendingEventKeys.has(eventKey) || this.#notifiedEventKeys.has(eventKey)) {
        continue;
      }
      if (this.#store.hasNotified(event)) {
        this.#notifiedEventKeys.add(eventKey);
        continue;
      }

      this.#pendingEventKeys.add(eventKey);
      try {
        await this.#sendAlert(stock, tick, reference, rate, direction, threshold);
        this.#store.markNotified(event);
        this.#notifiedEventKeys.add(eventKey);
      } catch (error: unknown) {
        console.error("주가 변동 알림 전송에 실패했습니다.", error);
      } finally {
        this.#pendingEventKeys.delete(eventKey);
      }
    }
  }

  async #handleNightFuturesTick(tick: KisRealtimeTick): Promise<void> {
    if (!this.#nightFuturesAlertEnabled || tick.changeRate === undefined) {
      return;
    }

    const rate = tick.changeRate;
    const basePrice = getBasePrice(tick.price, rate);
    if (basePrice === undefined || rate === 0) {
      return;
    }

    const tradingDate = getKrxNightFuturesTradingDate();
    const direction: PriceAlertDirection = rate > 0 ? "up" : "down";
    for (const threshold of NIGHT_FUTURES_ALERT_THRESHOLDS) {
      if (Math.abs(rate) < threshold) {
        continue;
      }

      const event = { tradingDate, direction, threshold };
      const eventKey = `night-futures:${tradingDate}:${direction}:${threshold}`;
      if (
        this.#pendingEventKeys.has(eventKey) ||
        this.#notifiedEventKeys.has(eventKey)
      ) {
        continue;
      }
      if (this.#store.hasNightFuturesNotified(event)) {
        this.#notifiedEventKeys.add(eventKey);
        continue;
      }

      this.#pendingEventKeys.add(eventKey);
      try {
        await sendStockPriceAlert(this.#client, this.#channelId, {
          code: tick.code,
          assetType: "nightFutures",
          currency: "POINT",
          currentPrice: tick.price,
          direction,
          market: "KRX_NIGHT_FUTURES",
          name: "KOSPI 야간선물",
          referencePrice: basePrice,
          referenceLabel: "기준가격",
          rate,
          threshold,
        });
        this.#store.markNightFuturesNotified(event);
        this.#notifiedEventKeys.add(eventKey);
      } catch (error: unknown) {
        console.error("KOSPI 야간선물 변동 알림 전송에 실패했습니다.", error);
      } finally {
        this.#pendingEventKeys.delete(eventKey);
      }
    }
  }

  async #sendAlert(
    stock: PriceAlertStock,
    tick: KisRealtimeTick,
    reference: { label: string; price: number },
    rate: number,
    direction: PriceAlertDirection,
    threshold: number,
  ): Promise<void> {
    await sendStockPriceAlert(this.#client, this.#channelId, {
      code: stock.code,
      assetType: stock.assetType,
      currency: stock.assetType === "overseas" ? "USD" : "KRW",
      currentPrice: tick.price,
      direction,
      market: tick.market,
      name: stock.name,
      referencePrice: reference.price,
      referenceLabel: reference.label,
      rate,
      threshold,
    });
  }

  #getReferencePrice(
    stock: PriceAlertStock,
    tick: KisRealtimeTick,
    tradingDate: string,
  ): { label: string; price: number } | undefined {
    if (stock.assetType === "domestic") {
      if (tick.market === "NXT" && tick.price > 0) {
        this.#queueNxtClosingPrice(stock.code, tradingDate, tick.price);
      }
      const referenceKey = `${stock.code}:${tradingDate}`;
      if (this.#domesticReferencePrices.has(referenceKey)) {
        return this.#domesticReferencePrices.get(referenceKey) ?? undefined;
      }

      const previousNxtClose = this.#store.getLatestNxtClosingPriceBefore(
        stock.code,
        tradingDate,
      );
      const expectedTradingDate = getPreviousKoreanTradingDate(tradingDate);
      const reference = previousNxtClose && previousNxtClose.tradingDate === expectedTradingDate
        ? { label: "전일 NXT 종가", price: previousNxtClose.price }
        : null;
      this.#domesticReferencePrices.set(referenceKey, reference);
      return reference ?? undefined;
    }

    if (tick.changeRate === undefined) {
      return undefined;
    }
    const previousClose = tick.change !== undefined && tick.price - tick.change > 0
      ? tick.price - tick.change
      : getBasePrice(tick.price, tick.changeRate);
    return previousClose === undefined
      ? undefined
      : { label: "전일 종가", price: previousClose };
  }

  #repairOverseasStockMetadata(
    stocks: readonly PriceAlertStock[],
  ): PriceAlertStock[] {
    return stocks.map((stock) => {
      if (stock.assetType !== "overseas" || !this.#stockMetadataSource) {
        return stock;
      }

      try {
        const metadata = this.#stockMetadataSource.resolveOverseas(stock.code);
        if (stock.exchange === metadata.exchange) {
          return stock;
        }
        this.#store.updateOverseasMetadata(stock.code, {
          exchange: metadata.exchange,
        });
        console.log(
          `미국 주가 알림 종목 정보를 갱신했습니다: ${stock.code} (${metadata.exchange})`,
        );
        return {
          ...stock,
          exchange: metadata.exchange,
        };
      } catch (error: unknown) {
        if (!stock.exchange) {
          console.error(
            `미국 주가 알림 종목의 거래소를 확인하지 못해 구독에서 제외합니다: ${stock.code}`,
            error,
          );
        }
        return stock;
      }
    });
  }

  async #captureNxtClosesAfterMarket(
    stocks: readonly PriceAlertStock[],
  ): Promise<void> {
    const source = this.#nxtClosePriceSource;
    if (!source) {
      return;
    }

    const tradingDate = getKoreanTradingDate();
    const previousTradingDate = getPreviousKoreanTradingDate(tradingDate);
    const captureCurrentClose = isNxtCloseCaptureWindow();
    const domesticStocks = stocks.filter((stock) => stock.assetType === "domestic");
    await runWithConcurrency(domesticStocks, 3, async (stock) => {
      const needsPreviousClose = previousTradingDate !== undefined &&
        this.#store.getNxtClosingPrice(stock.code, previousTradingDate) === undefined;
      const needsCurrentClose = captureCurrentClose &&
        this.#store.getNxtClosingPrice(stock.code, tradingDate) === undefined;
      if (!needsPreviousClose && !needsCurrentClose) {
        return;
      }

      const captureKey = `${stock.code}:${tradingDate}:${captureCurrentClose ? "close" : "reference"}`;
      if (
        this.#nxtCloseCaptureAttempts.has(captureKey)
      ) {
        return;
      }
      this.#nxtCloseCaptureAttempts.add(captureKey);

      try {
        const quote = await source.fetchDomesticQuote(stock.code, "NX");
        const quoteTradingDate = normalizeTradingDate(quote.businessDate);
        const validPreviousClose = quoteTradingDate === previousTradingDate;
        const validCurrentClose = captureCurrentClose && quoteTradingDate === tradingDate;
        if (!validPreviousClose && !validCurrentClose) {
          console.warn(
            `NXT 종가를 저장하지 않았습니다: ${stock.code}의 거래일을 확인할 수 없습니다.`,
          );
          return;
        }
        if (quote.price > 0 && quoteTradingDate) {
          this.#store.saveNxtClosingPrice(stock.code, quoteTradingDate, quote.price);
          if (validPreviousClose) {
            this.#domesticReferencePrices.delete(`${stock.code}:${tradingDate}`);
          }
        }
      } catch (error: unknown) {
        console.error(`NXT 종가를 가져오지 못했습니다: ${stock.code}`, error);
      }
    });
  }

  #queueNxtClosingPrice(code: string, tradingDate: string, price: number): void {
    const key = `${code}:${tradingDate}`;
    this.#pendingNxtClosingPrices.set(key, { code, price, tradingDate });
    this.#scheduleNxtCloseFlush();
  }

  #scheduleNxtCloseFlush(): void {
    if (this.#nxtCloseFlushTimer) {
      return;
    }

    this.#nxtCloseFlushTimer = setTimeout(() => {
      this.#nxtCloseFlushTimer = undefined;
      this.#flushNxtClosingPrices();
    }, NXT_CLOSE_FLUSH_INTERVAL_MS);
  }

  #flushNxtClosingPrices(): void {
    if (this.#pendingNxtClosingPrices.size === 0) {
      return;
    }

    const pendingPrices = [...this.#pendingNxtClosingPrices.entries()];
    this.#pendingNxtClosingPrices.clear();
    for (const [key, pendingPrice] of pendingPrices) {
      try {
        this.#store.saveNxtClosingPrice(
          pendingPrice.code,
          pendingPrice.tradingDate,
          pendingPrice.price,
        );
      } catch (error: unknown) {
        console.error(`NXT 종가를 저장하지 못했습니다: ${pendingPrice.code}`, error);
        this.#pendingNxtClosingPrices.set(key, pendingPrice);
      }
    }

    if (this.#pendingNxtClosingPrices.size > 0 && !this.#stopped) {
      this.#scheduleNxtCloseFlush();
    }
  }

  #scheduleSessionRefresh(): void {
    if (this.#stopped || this.#sessionTimer) {
      return;
    }

    const now = new Date();
    const nextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    this.#sessionTimer = setTimeout(() => {
      this.#sessionTimer = undefined;
      const nightFuturesSession =
        this.#store.isNightFuturesAlertEnabled() && isKrxNightFuturesSession();
      const overseasSession = this.#stocksByCode.size > 0 &&
          [...this.#stocksByCode.values()].some((stock) => stock.assetType === "overseas")
        ? getActiveOverseasRealtimeSession()
        : undefined;
      if (
        getActiveRealtimeMarket() !== this.#activeDomesticMarket ||
        overseasSession !== this.#activeOverseasSession ||
        nightFuturesSession !== this.#activeNightFuturesSession
      ) {
        this.refresh();
        return;
      }
      this.#scheduleSessionRefresh();
    }, nextMinute + 50);
  }
}

export function getReferencePriceChangeRate(
  price: number,
  openingPrice: number,
): number | undefined {
  if (!Number.isFinite(price) || !Number.isFinite(openingPrice) || openingPrice <= 0) {
    return undefined;
  }

  return ((price - openingPrice) / openingPrice) * 100;
}

function getTradingDate(timeZone: string, now = new Date()): string {
  let formatter = tradingDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    tradingDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get("year") ?? ""}${valueByType.get("month") ?? ""}${valueByType.get("day") ?? ""}`;
}

function normalizeTradingDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll(/[^0-9]/g, "");
  return /^\d{8}$/.test(normalized) ? normalized : undefined;
}

function getSubscriptions(
  stocks: readonly PriceAlertStock[],
  domesticMarket: RealtimeMarket | undefined,
  overseasSession: "day" | "standard" | undefined,
  nightFuturesCode?: string,
): KisRealtimeSubscription[] {
  const stockSubscriptions = stocks.flatMap((stock): KisRealtimeSubscription[] => {
    if (stock.assetType === "overseas") {
      return stock.exchange
        ? [{
            assetType: "overseas",
            symbol: stock.code,
            exchange: stock.exchange,
            session: overseasSession ?? "standard",
          }]
        : [];
    }
    return domesticMarket
      ? [{ assetType: "domestic", code: stock.code, market: domesticMarket }]
      : [];
  });
  return [
    ...stockSubscriptions,
    ...(nightFuturesCode
      ? [{ assetType: "nightFutures" as const, code: nightFuturesCode }]
      : []),
  ];
}

function getActiveOverseasRealtimeSession(now = new Date()): "day" | "standard" {
  const tradingDate = getKoreanTradingDate(now);
  if (!isUsTradingDay(tradingDate)) {
    return "standard";
  }

  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  })
    .format(now)
    .split(":")
    .map(Number);
  const minuteOfDay = (hour ?? 0) * 60 + (minute ?? 0);
  return minuteOfDay >= 10 * 60 && minuteOfDay < 16 * 60 ? "day" : "standard";
}

function getBasePrice(price: number, rate: number): number | undefined {
  const divisor = 1 + rate / 100;
  if (!Number.isFinite(price) || !Number.isFinite(divisor) || divisor <= 0) {
    return undefined;
  }
  return price / divisor;
}

function getKrxNightFuturesTradingDate(now = new Date()): string {
  const koreaTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return getTradingDate(
    "Asia/Seoul",
    Number(koreaTime) < 6 ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now,
  );
}

function isKrxNightFuturesSession(now = new Date()): boolean {
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  })
    .format(now)
    .split(":")
    .map(Number);
  const minuteOfDay = (hour ?? 0) * 60 + (minute ?? 0);
  if (minuteOfDay >= 18 * 60) {
    return isKoreanTradingDay(getKoreanTradingDate(now));
  }
  return minuteOfDay < 6 * 60 && isKoreanTradingDay(
    getKoreanTradingDate(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  );
}

function isNxtCloseCaptureWindow(now = new Date()): boolean {
  if (!isKoreanTradingDay(getKoreanTradingDate(now))) {
    return false;
  }
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  })
    .format(now)
    .split(":")
    .map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0) >= 20 * 60;
}

function getActiveRealtimeMarket(now = new Date()): RealtimeMarket | undefined {
  if (!isKoreanTradingDay(getKoreanTradingDate(now))) {
    return undefined;
  }

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  })
    .format(now)
    .split(":")
    .map(Number);
  const hour = time[0] ?? 0;
  const minute = time[1] ?? 0;
  const minuteOfDay = hour * 60 + minute;
  if (minuteOfDay >= 9 * 60 && minuteOfDay < 15 * 60 + 30) {
    return "KRX";
  }
  if (minuteOfDay >= 15 * 60 + 40 && minuteOfDay < 20 * 60) {
    return "NXT";
  }
  return undefined;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item !== undefined) {
          await operation(item);
        }
      }
    },
  );
  await Promise.all(workers);
}
