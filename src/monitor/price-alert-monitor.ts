import type { Client } from "discord.js";

import { sendStockPriceAlert } from "../notifications/discord-price-alert.js";
import type {
  KisRealtimeSubscription,
  KisRealtimeTick,
  RealtimeMarket,
} from "../sources/kis-realtime.js";
import { getCurrentKospi200NightFuturesContract } from "../sources/krx-night-futures.js";
import {
  NIGHT_FUTURES_ALERT_THRESHOLDS,
  PRICE_ALERT_THRESHOLDS,
  type PriceAlertDirection,
  type PriceAlertStock,
  type PriceAlertStore,
} from "../storage/price-alert-store.js";

const RECONNECT_DELAY_MS = 5_000;

interface RealtimePriceSource {
  streamPriceAlerts(
    subscriptions: readonly KisRealtimeSubscription[],
    onTick: (tick: KisRealtimeTick) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
}

interface OpeningPriceSource {
  fetchDomesticQuote(
    code: string,
    marketCode: "J",
  ): Promise<{ open?: number }>;
}

export interface PriceAlertMonitorOptions {
  channelId: string;
  client: Client;
  openingPriceSource?: OpeningPriceSource;
  realtimeClient: RealtimePriceSource;
  store: PriceAlertStore;
}

export class PriceAlertMonitor {
  readonly #channelId: string;
  readonly #client: Client;
  readonly #openingPriceSource: OpeningPriceSource | undefined;
  readonly #realtimeClient: RealtimePriceSource;
  readonly #store: PriceAlertStore;
  readonly #pendingEventKeys = new Set<string>();
  #abortController: AbortController | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #sessionTimer: NodeJS.Timeout | undefined;
  #activeDomesticMarket: RealtimeMarket | undefined;
  #activeNightFuturesSession = false;
  #stopped = true;

  constructor({
    channelId,
    client,
    openingPriceSource,
    realtimeClient,
    store,
  }: PriceAlertMonitorOptions) {
    this.#channelId = channelId;
    this.#client = client;
    this.#openingPriceSource = openingPriceSource;
    this.#realtimeClient = realtimeClient;
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
    this.#abortController?.abort();
    this.#scheduleSessionRefresh();
    void this.#connect();
  }

  async #connect(): Promise<void> {
    const stocks = this.#store.list();
    if (this.#stopped) {
      return;
    }

    const domesticMarket = getActiveRealtimeMarket();
    this.#activeDomesticMarket = domesticMarket;
    const shouldWatchNightFutures =
      this.#store.isNightFuturesAlertEnabled() && isKrxNightFuturesSession();
    this.#activeNightFuturesSession = shouldWatchNightFutures;
    let nightFuturesCode: string | undefined;
    if (shouldWatchNightFutures) {
      try {
        nightFuturesCode = (await getCurrentKospi200NightFuturesContract()).code;
      } catch (error: unknown) {
        console.error("KOSPI 야간선물 최근월물을 가져오지 못했습니다.", error);
      }
    }

    const subscriptions = getSubscriptions(stocks, domesticMarket, nightFuturesCode);
    if (subscriptions.length === 0) {
      return;
    }

    const controller = new AbortController();
    this.#abortController = controller;
    try {
      await this.#prepareOpeningPrices(stocks, domesticMarket);
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

    const stock = this.#store.get(tick.code);
    if (!stock || stock.assetType !== tick.assetType) {
      return;
    }

    const tradingDate = getTradingDate(
      tick.assetType === "overseas" ? "America/New_York" : "Asia/Seoul",
    );
    let openingPrice = this.#store.getOpeningPrice(stock?.code ?? tick.code, tradingDate);
    if ((tick.market === "KRX" || tick.assetType === "overseas") && tick.open > 0) {
      openingPrice = tick.open;
      this.#store.saveOpeningPrice(tick.code, tradingDate, openingPrice);
    }

    const rate = getOpeningPriceChangeRate(tick.price, openingPrice ?? 0);
    if (rate === undefined || openingPrice === undefined) {
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
      if (this.#pendingEventKeys.has(eventKey) || this.#store.hasNotified(event)) {
        continue;
      }

      this.#pendingEventKeys.add(eventKey);
      try {
        await this.#sendAlert(stock, tick, openingPrice, rate, direction, threshold);
        this.#store.markNotified(event);
      } catch (error: unknown) {
        console.error("주가 변동 알림 전송에 실패했습니다.", error);
      } finally {
        this.#pendingEventKeys.delete(eventKey);
      }
    }
  }

  async #handleNightFuturesTick(tick: KisRealtimeTick): Promise<void> {
    if (!this.#store.isNightFuturesAlertEnabled() || tick.changeRate === undefined) {
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
        this.#store.hasNightFuturesNotified(event)
      ) {
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
          openingPrice: basePrice,
          referenceLabel: "기준가격",
          rate,
          threshold,
        });
        this.#store.markNightFuturesNotified(event);
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
    openingPrice: number,
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
      openingPrice,
      referenceLabel: "시가",
      rate,
      threshold,
    });
  }

  async #prepareOpeningPrices(
    stocks: readonly PriceAlertStock[],
    market: RealtimeMarket | undefined,
  ): Promise<void> {
    if (market !== "NXT" || !this.#openingPriceSource) {
      return;
    }

    const tradingDate = getTradingDate("Asia/Seoul");
    for (const stock of stocks.filter((stock) => stock.assetType === "domestic")) {
      if (this.#store.getOpeningPrice(stock.code, tradingDate) !== undefined) {
        continue;
      }

      try {
        const quote = await this.#openingPriceSource.fetchDomesticQuote(stock.code, "J");
        if (quote.open !== undefined && quote.open > 0) {
          this.#store.saveOpeningPrice(stock.code, tradingDate, quote.open);
        }
      } catch (error: unknown) {
        console.error(`KRX 시가를 가져오지 못했습니다: ${stock.code}`, error);
      }
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
      if (
        getActiveRealtimeMarket() !== this.#activeDomesticMarket ||
        nightFuturesSession !== this.#activeNightFuturesSession
      ) {
        this.refresh();
        return;
      }
      this.#scheduleSessionRefresh();
    }, nextMinute + 50);
  }
}

export function getOpeningPriceChangeRate(
  price: number,
  openingPrice: number,
): number | undefined {
  if (!Number.isFinite(price) || !Number.isFinite(openingPrice) || openingPrice <= 0) {
    return undefined;
  }

  return ((price - openingPrice) / openingPrice) * 100;
}

function getTradingDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get("year") ?? ""}${valueByType.get("month") ?? ""}${valueByType.get("day") ?? ""}`;
}

function getSubscriptions(
  stocks: readonly PriceAlertStock[],
  domesticMarket: RealtimeMarket | undefined,
  nightFuturesCode?: string,
): KisRealtimeSubscription[] {
  const stockSubscriptions = stocks.flatMap((stock): KisRealtimeSubscription[] => {
    if (stock.assetType === "overseas") {
      return stock.exchange
        ? [{ assetType: "overseas", symbol: stock.code, exchange: stock.exchange }]
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
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
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
    return weekday !== "Sat" && weekday !== "Sun";
  }
  return minuteOfDay < 6 * 60 && weekday !== "Sun" && weekday !== "Mon";
}

function getActiveRealtimeMarket(now = new Date()): RealtimeMarket | undefined {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") {
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
