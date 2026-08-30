import type { KisConfig } from "../config.js";
import WebSocket from "ws";
import { KisApiError, normalizeDomesticStockCode } from "./kis.js";
import { normalizeOverseasStockSymbol } from "./overseas-stocks.js";
import type { OverseasExchange } from "./overseas-stocks.js";

const APPROVAL_PATH = "/oauth2/Approval";
const DOMESTIC_TRADE_TR_ID = "H0UNCNT0";
const NXT_TRADE_TR_ID = "H0NXCNT0";
const OVERSEAS_TRADE_TR_ID = "HDFSCNT0";
const KRX_NIGHT_FUTURES_TRADE_TR_ID = "H0MFCNT0";
const SUBSCRIPTION_DELAY_MS = 120;
const APPROVAL_KEY_SAFETY_MS = 60_000;
const REALTIME_WATCHDOG_INTERVAL_MS = 30_000;
export const KIS_REALTIME_INACTIVITY_TIMEOUT_MS = 2 * 60_000;
const SUBSCRIPTION_CONFIRMATION_TIMEOUT_MS = 15_000;
const KIS_APPROVAL_TIMEOUT_MS = 15_000;

const DOMESTIC_TRADE_COLUMNS = [
  "code",
  "time",
  "price",
  "previousChangeSign",
  "previousChange",
  "previousChangeRate",
  "weightedAveragePrice",
  "open",
  "high",
  "low",
  "bestAsk",
  "bestBid",
  "tradeVolume",
  "accumulatedVolume",
  "accumulatedAmount",
  "sellTradeCount",
  "buyTradeCount",
  "netBuyTradeCount",
  "tradeStrength",
  "sellTradeAmount",
  "buyTradeAmount",
  "tradeClassification",
  "buyRatio",
  "previousVolumeChangeRate",
  "openTime",
  "openDifferenceSign",
  "openDifference",
  "highTime",
  "highDifferenceSign",
  "highDifference",
  "lowTime",
  "lowDifferenceSign",
  "lowDifference",
  "businessDate",
  "newMarketOpenClassification",
  "tradingHalt",
  "askVolume1",
  "bidVolume1",
  "totalAskVolume",
  "totalBidVolume",
  "volumeTurnoverRate",
  "previousSameTimeVolume",
  "previousSameTimeVolumeRate",
  "marketCloseClassification",
  "marketOperationClassification",
  "viReferencePrice",
] as const;

const OVERSEAS_TRADE_COLUMNS = [
  "realtimeSymbol", "symbol", "decimalPlaces", "tradingDate", "localDate", "localTime",
  "koreanDate", "koreanTime", "open", "high", "low", "price", "sign",
  "change", "changeRate", "bestBid", "bestAsk", "bidVolume", "askVolume",
  "tradeVolume", "accumulatedVolume", "accumulatedAmount", "sellVolume",
  "buyVolume", "tradeStrength", "marketType",
] as const;

const KRX_NIGHT_FUTURES_TRADE_COLUMNS = [
  "code", "time", "previousChange", "previousChangeSign", "previousChangeRate",
  "price", "open", "high", "low", "tradeVolume", "accumulatedVolume",
  "accumulatedAmount", "theoreticalPrice", "marketBasis", "disparityRate",
  "nearContractPrice", "farContractPrice", "spreadPrice", "openInterest",
  "openInterestChange", "openTime", "openDifferenceSign", "openDifference",
  "highTime", "highDifferenceSign", "highDifference", "lowTime",
  "lowDifferenceSign", "lowDifference", "buyRatio", "tradeStrength",
  "disparity", "previousOpenInterestChange", "theoreticalBasis", "bestAsk",
  "bestBid", "askVolume", "bidVolume", "sellTradeCount", "buyTradeCount",
  "netBuyTradeCount", "sellTradeVolume", "buyTradeVolume", "totalAskVolume",
  "totalBidVolume", "previousVolumeChangeRate", "upperLimit", "lowerLimit",
  "priceLimitClassification",
] as const;

interface ApprovalKeyCache {
  approvalKey: string;
  expiresAt: number;
}

interface KisRealtimeSystemMessage {
  key?: string;
  message?: string;
  resultCode?: string;
  transactionId: string;
}

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

type RealtimeWebSocket = Pick<
  WebSocket,
  "close" | "pong" | "send" | "onclose" | "onerror" | "onmessage" | "onopen"
>;

type WebSocketFactory = (url: string) => RealtimeWebSocket;

export interface KisRealtimeTick {
  code: string;
  market: RealtimeMarket | OverseasExchange | "KRX_NIGHT_FUTURES";
  assetType: "domestic" | "overseas" | "nightFutures";
  tradingDate?: string;
  tradeTime?: string;
  price: number;
  open: number;
  high?: number;
  low?: number;
  volume?: number;
  change?: number;
  changeRate?: number;
}

export type RealtimeMarket = "KRX" | "NXT";

export type KisRealtimeSubscription =
  | { assetType: "domestic"; code: string; market: RealtimeMarket }
  | {
      assetType: "overseas";
      symbol: string;
      exchange: OverseasExchange;
      session?: "day" | "standard";
    }
  | { assetType: "nightFutures"; code: string };

export interface KisRealtimeStatus {
  confirmedSubscriptionKeys?: readonly string[];
  confirmedSubscriptions: number;
  lastError?: string;
  lastMessageAt?: number;
  lastTickAt?: Partial<Record<KisRealtimeTick["assetType"], number>>;
  state: "connecting" | "connected" | "disconnected" | "error";
  subscriptionKeys?: readonly string[];
  totalSubscriptions: number;
}

export class KisRealtimeClient {
  #approvalKeyCache?: ApprovalKeyCache;
  #approvalKeyRequest: Promise<string> | undefined;
  #status: KisRealtimeStatus = {
    state: "disconnected",
    confirmedSubscriptions: 0,
    totalSubscriptions: 0,
  };

  constructor(
    private readonly config: KisConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly webSocketFactory: WebSocketFactory = (url) => new WebSocket(url),
  ) {}

  async streamDomesticTrades(
    codes: readonly string[],
    market: RealtimeMarket,
    onTick: (tick: KisRealtimeTick) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    return this.streamPriceAlerts(
      codes.map((code) => ({ assetType: "domestic" as const, code, market })),
      onTick,
      signal,
    );
  }

  getStatus(): KisRealtimeStatus {
    return {
      ...this.#status,
      ...(this.#status.subscriptionKeys
        ? { subscriptionKeys: [...this.#status.subscriptionKeys] }
        : {}),
      ...(this.#status.confirmedSubscriptionKeys
        ? { confirmedSubscriptionKeys: [...this.#status.confirmedSubscriptionKeys] }
        : {}),
      ...(this.#status.lastTickAt
        ? { lastTickAt: { ...this.#status.lastTickAt } }
        : {}),
    };
  }

  async streamPriceAlerts(
    subscriptions: readonly KisRealtimeSubscription[],
    onTick: (tick: KisRealtimeTick) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const normalizedSubscriptions = normalizeSubscriptions(subscriptions);
    const overseasExchangeBySymbol = new Map(
      subscriptions.flatMap((subscription) =>
        subscription.assetType === "overseas"
          ? [[normalizeOverseasStockSymbol(subscription.symbol), subscription.exchange] as const]
          : [],
      ),
    );
    if (normalizedSubscriptions.length === 0 || signal.aborted) {
      this.#status = {
        state: "disconnected",
        confirmedSubscriptions: 0,
        totalSubscriptions: 0,
      };
      return;
    }

    let approvalKey: string;
    try {
      approvalKey = await this.getApprovalKey();
    } catch (error: unknown) {
      this.#status = {
        state: "error",
        confirmedSubscriptions: 0,
        totalSubscriptions: normalizedSubscriptions.length,
        ...(error instanceof Error ? { lastError: error.message } : {}),
      };
      throw error;
    }
    if (signal.aborted) {
      return;
    }

    this.#status = {
      state: "connecting",
      confirmedSubscriptions: 0,
      confirmedSubscriptionKeys: [],
      subscriptionKeys: normalizedSubscriptions.map(getSubscriptionKey),
      totalSubscriptions: normalizedSubscriptions.length,
    };

    await new Promise<void>((resolve, reject) => {
      const socket = this.webSocketFactory(`${this.config.websocketUrl}/tryitout`);
      const expectedSubscriptionKeys = new Set(
        normalizedSubscriptions.map(getSubscriptionKey),
      );
      const confirmedSubscriptionKeys = new Set<string>();
      let settled = false;
      let lastMessageAt = Date.now();
      let subscriptionConfirmationTimer: NodeJS.Timeout | undefined;
      let watchdogTimer: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (subscriptionConfirmationTimer) {
          clearTimeout(subscriptionConfirmationTimer);
          subscriptionConfirmationTimer = undefined;
        }
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = undefined;
        }
        signal.removeEventListener("abort", abort);
      };

      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.#status = {
          ...this.#status,
          state: "disconnected",
        };
        resolve();
      };
      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.#status = {
          ...this.#status,
          state: "error",
          lastError: error.message,
        };
        reject(error);
      };
      const abort = (): void => {
        socket.close();
        finish();
      };
      const failSubscription = (systemMessage: KisRealtimeSystemMessage): void => {
        const subscription = systemMessage.key
          ? `${systemMessage.transactionId}:${systemMessage.key}`
          : systemMessage.transactionId;
        fail(
          new KisApiError(
            `KIS 실시간 시세 구독이 거절되었습니다. (${subscription}) ${systemMessage.message ?? "알 수 없는 오류"}`,
          ),
        );
        socket.close();
      };
      const confirmSubscription = (systemMessage: KisRealtimeSystemMessage): void => {
        if (systemMessage.resultCode !== "0") {
          failSubscription(systemMessage);
          return;
        }

        const key = systemMessage.key
          ? `${systemMessage.transactionId}:${systemMessage.key}`
          : undefined;
        if (!key || !expectedSubscriptionKeys.has(key)) {
          return;
        }
        confirmedSubscriptionKeys.add(key);
        this.#status = {
          ...this.#status,
          confirmedSubscriptions: confirmedSubscriptionKeys.size,
          confirmedSubscriptionKeys: [...confirmedSubscriptionKeys],
        };
        if (confirmedSubscriptionKeys.size === expectedSubscriptionKeys.size) {
          if (subscriptionConfirmationTimer) {
            clearTimeout(subscriptionConfirmationTimer);
            subscriptionConfirmationTimer = undefined;
          }
          this.#status = {
            ...this.#status,
            state: "connected",
          };
        }
      };

      signal.addEventListener("abort", abort, { once: true });
      watchdogTimer = setInterval(() => {
        if (settled || Date.now() - lastMessageAt < KIS_REALTIME_INACTIVITY_TIMEOUT_MS) {
          return;
        }

        fail(
          new KisApiError(
            "KIS 실시간 시세 메시지가 2분 동안 수신되지 않아 재연결합니다.",
          ),
        );
        socket.close();
      }, REALTIME_WATCHDOG_INTERVAL_MS);
      socket.onopen = () => {
        void sendSubscriptions(
          socket,
          approvalKey,
          normalizedSubscriptions,
          signal,
        )
          .then(() => {
            if (settled || confirmedSubscriptionKeys.size === expectedSubscriptionKeys.size) {
              return;
            }
            subscriptionConfirmationTimer = setTimeout(() => {
              const pendingSubscriptions = normalizedSubscriptions
                .filter(
                  (subscription) => !confirmedSubscriptionKeys.has(getSubscriptionKey(subscription)),
                )
                .map((subscription) => `${subscription.transactionId}:${subscription.key}`)
                .join(", ");
              fail(
                new KisApiError(
                  `KIS 실시간 시세 구독 확인이 시간 초과되었습니다. (${pendingSubscriptions})`,
                ),
              );
              socket.close();
            }, SUBSCRIPTION_CONFIRMATION_TIMEOUT_MS);
          })
          .catch((error: unknown) => {
            fail(
              error instanceof Error
                ? error
                : new KisApiError("KIS 실시간 시세 구독에 실패했습니다."),
            );
            socket.close();
          },
        );
      };
      socket.onmessage = (event) => {
        lastMessageAt = Date.now();
        this.#status = {
          ...this.#status,
          lastMessageAt,
        };
        void toText(event.data).then((raw) => {
          if (!raw) {
            return;
          }

          const systemMessage = parseKisRealtimeSystemMessage(raw);
          if (systemMessage?.transactionId === "PINGPONG") {
            // KIS sends an application-level heartbeat that requires a WebSocket PONG.
            try {
              socket.pong(raw);
            } catch (error: unknown) {
              fail(
                error instanceof Error
                  ? error
                  : new KisApiError("KIS 실시간 PONG 응답에 실패했습니다."),
              );
              socket.close();
            }
            return;
          }
          if (systemMessage) {
            confirmSubscription(systemMessage);
            return;
          }

          const ticks = parseRealtimeTradeMessage(raw, overseasExchangeBySymbol);
          if (ticks.length > 0) {
            const lastTickAt = { ...this.#status.lastTickAt };
            for (const tick of ticks) {
              lastTickAt[tick.assetType] = lastMessageAt;
            }
            this.#status = { ...this.#status, lastTickAt };
          }
          for (const tick of ticks) {
            void Promise.resolve(onTick(tick)).catch((error: unknown) => {
              console.error("KIS 실시간 시세 처리에 실패했습니다.", error);
            });
          }
        }).catch((error: unknown) => {
          fail(
            error instanceof Error
              ? error
              : new KisApiError("KIS 실시간 시세 메시지를 처리하지 못했습니다."),
          );
          socket.close();
        });
      };
      socket.onerror = () => {
        fail(new KisApiError("KIS 실시간 시세 연결에 실패했습니다."));
        socket.close();
      };
      socket.onclose = () => finish();
    });
  }

  private async getApprovalKey(): Promise<string> {
    const now = Date.now();
    if (this.#approvalKeyCache && this.#approvalKeyCache.expiresAt > now) {
      return this.#approvalKeyCache.approvalKey;
    }

    if (this.#approvalKeyRequest) {
      return this.#approvalKeyRequest;
    }

    const request = this.issueApprovalKey().finally(() => {
      if (this.#approvalKeyRequest === request) {
        this.#approvalKeyRequest = undefined;
      }
    });
    this.#approvalKeyRequest = request;
    return request;
  }

  private async issueApprovalKey(): Promise<string> {
    const now = Date.now();
    const url = new URL(APPROVAL_PATH, this.config.baseUrl);
    const response = await this.fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(KIS_APPROVAL_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.appKey,
        secretkey: this.config.appSecret,
      }),
    });
    const data = await readJsonResponse(response);
    const approvalKey = data.approval_key;
    if (typeof approvalKey !== "string" || approvalKey.length === 0) {
      throw new KisApiError("KIS 실시간 접속키를 받지 못했습니다.");
    }

    this.#approvalKeyCache = {
      approvalKey,
      expiresAt: now + 24 * 60 * 60 * 1000 - APPROVAL_KEY_SAFETY_MS,
    };
    return approvalKey;
  }
}

export function parseDomesticTradeMessage(raw: string): KisRealtimeTick[] {
  const parts = raw.split("|", 4);
  const market = getMarketFromTransactionId(parts[1]);
  if (parts.length < 4 || parts[0] !== "0" || !market) {
    return [];
  }

  const values = parts[3]?.split("^") ?? [];
  const ticks: KisRealtimeTick[] = [];
  for (let index = 0; index + DOMESTIC_TRADE_COLUMNS.length <= values.length; index += DOMESTIC_TRADE_COLUMNS.length) {
    const row = Object.fromEntries(
      DOMESTIC_TRADE_COLUMNS.map((column, offset) => [column, values[index + offset] ?? ""]),
    );
    const code = row.code;
    const price = parseNumber(row.price);
    const open = parseNumber(row.open);
    if (!code || price === undefined || open === undefined || price <= 0 || open <= 0) {
      continue;
    }

    const tradeTime = row.time;
    const high = parseNumber(row.high);
    const low = parseNumber(row.low);
    const volume = parseNumber(row.accumulatedVolume);
    const change = parseNumber(row.previousChange);
    const changeRate = parseNumber(row.previousChangeRate);
    ticks.push({
      code,
      market,
      assetType: "domestic",
      price,
      open,
      ...(tradeTime ? { tradeTime } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(change !== undefined ? { change } : {}),
      ...(changeRate !== undefined ? { changeRate } : {}),
    });
  }

  return ticks;
}

export function parseOverseasTradeMessage(
  raw: string,
  exchangeBySymbol: ReadonlyMap<string, OverseasExchange>,
): KisRealtimeTick[] {
  const parts = raw.split("|", 4);
  if (parts.length < 4 || parts[0] !== "0" || parts[1] !== OVERSEAS_TRADE_TR_ID) {
    return [];
  }

  const values = parts[3]?.split("^") ?? [];
  const ticks: KisRealtimeTick[] = [];
  for (let index = 0; index + OVERSEAS_TRADE_COLUMNS.length <= values.length; index += OVERSEAS_TRADE_COLUMNS.length) {
    const row = Object.fromEntries(
      OVERSEAS_TRADE_COLUMNS.map((column, offset) => [column, values[index + offset] ?? ""]),
    );
    const code = row.symbol?.toUpperCase();
    const market = code ? exchangeBySymbol.get(code) : undefined;
    const price = parseNumber(row.price);
    const open = parseNumber(row.open);
    if (!code || !market || price === undefined || open === undefined || price <= 0 || open <= 0) {
      continue;
    }

    const high = parseNumber(row.high);
    const low = parseNumber(row.low);
    const volume = parseNumber(row.accumulatedVolume);
    const rawChange = parseNumber(row.change);
    const rawChangeRate = parseNumber(row.changeRate);
    const direction = getChangeMultiplier(row.sign);
    ticks.push({
      code: code.toUpperCase(),
      market,
      assetType: "overseas",
      price,
      open,
      ...(row.tradingDate ? { tradingDate: row.tradingDate } : {}),
      ...(row.localTime ? { tradeTime: row.localTime } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(rawChange !== undefined ? { change: Math.abs(rawChange) * direction } : {}),
      ...(rawChangeRate !== undefined
        ? { changeRate: Math.abs(rawChangeRate) * direction }
        : {}),
    });
  }
  return ticks;
}

export function parseKrxNightFuturesTradeMessage(raw: string): KisRealtimeTick[] {
  const parts = raw.split("|", 4);
  if (parts.length < 4 || parts[0] !== "0" || parts[1] !== KRX_NIGHT_FUTURES_TRADE_TR_ID) {
    return [];
  }

  const values = parts[3]?.split("^") ?? [];
  const ticks: KisRealtimeTick[] = [];
  for (let index = 0; index + KRX_NIGHT_FUTURES_TRADE_COLUMNS.length <= values.length; index += KRX_NIGHT_FUTURES_TRADE_COLUMNS.length) {
    const row = Object.fromEntries(
      KRX_NIGHT_FUTURES_TRADE_COLUMNS.map((column, offset) => [column, values[index + offset] ?? ""]),
    );
    const code = row.code;
    const price = parseNumber(row.price);
    const open = parseNumber(row.open);
    if (!code || price === undefined || open === undefined || price <= 0 || open <= 0) {
      continue;
    }

    const rawChange = parseNumber(row.previousChange);
    const rawChangeRate = parseNumber(row.previousChangeRate);
    const direction = getChangeMultiplier(row.previousChangeSign);
    const high = parseNumber(row.high);
    const low = parseNumber(row.low);
    const volume = parseNumber(row.accumulatedVolume);
    ticks.push({
      code: code.toUpperCase(),
      market: "KRX_NIGHT_FUTURES",
      assetType: "nightFutures",
      price,
      open,
      ...(row.time ? { tradeTime: row.time } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(rawChange !== undefined ? { change: Math.abs(rawChange) * direction } : {}),
      ...(rawChangeRate !== undefined
        ? { changeRate: Math.abs(rawChangeRate) * direction }
        : {}),
    });
  }

  return ticks;
}

export function parseRealtimeTradeMessage(
  raw: string,
  exchangeBySymbol: ReadonlyMap<string, OverseasExchange> = new Map(),
): KisRealtimeTick[] {
  return [
    ...parseDomesticTradeMessage(raw),
    ...parseOverseasTradeMessage(raw, exchangeBySymbol),
    ...parseKrxNightFuturesTradeMessage(raw),
  ];
}

async function sendSubscriptions(
  socket: RealtimeWebSocket,
  approvalKey: string,
  subscriptions: readonly NormalizedRealtimeSubscription[],
  signal: AbortSignal,
): Promise<void> {
  for (const subscription of subscriptions) {
    if (signal.aborted) {
      return;
    }

    socket.send(
      JSON.stringify({
        header: {
          approval_key: approvalKey,
          custtype: "P",
          tr_type: "1",
          "content-type": "utf-8",
        },
        body: {
          input: {
            tr_id: subscription.transactionId,
            tr_key: subscription.key,
          },
        },
      }),
    );
    await delay(SUBSCRIPTION_DELAY_MS, signal);
  }
}

interface NormalizedRealtimeSubscription {
  transactionId: string;
  key: string;
}

function getSubscriptionKey(subscription: NormalizedRealtimeSubscription): string {
  return `${subscription.transactionId}:${subscription.key}`;
}

function normalizeSubscriptions(
  subscriptions: readonly KisRealtimeSubscription[],
): NormalizedRealtimeSubscription[] {
  const normalized = subscriptions.map((subscription) => {
    if (subscription.assetType === "domestic") {
      return {
        transactionId: getTradeTransactionId(subscription.market),
        key: normalizeDomesticStockCode(subscription.code),
      };
    }
    if (subscription.assetType === "nightFutures") {
      return {
        transactionId: KRX_NIGHT_FUTURES_TRADE_TR_ID,
        key: normalizeNightFuturesCode(subscription.code),
      };
    }
    return {
      transactionId: OVERSEAS_TRADE_TR_ID,
      key: getOverseasSubscriptionKey(subscription),
    };
  });
  return [...new Map(normalized.map((item) => [`${item.transactionId}:${item.key}`, item])).values()];
}

function getOverseasSubscriptionKey(
  subscription: Extract<KisRealtimeSubscription, { assetType: "overseas" }>,
): string {
  const symbol = normalizeOverseasStockSymbol(subscription.symbol);
  if (subscription.session !== "day") {
    return `D${subscription.exchange}${symbol}`;
  }

  const dayMarketCode: Record<OverseasExchange, string> = {
    NAS: "BAQ",
    NYS: "BAY",
    AMS: "BAA",
  };
  return `R${dayMarketCode[subscription.exchange]}${symbol}`;
}

function normalizeNightFuturesCode(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,9}$/.test(normalizedCode)) {
    throw new KisApiError("KOSPI 야간선물 종목코드 형식이 올바르지 않습니다.");
  }
  return normalizedCode;
}

function getChangeMultiplier(sign: string | undefined): number {
  if (sign === "1" || sign === "2") return 1;
  if (sign === "4" || sign === "5") return -1;
  return 0;
}

function getTradeTransactionId(market: RealtimeMarket): string {
  return market === "NXT" ? NXT_TRADE_TR_ID : DOMESTIC_TRADE_TR_ID;
}

function getMarketFromTransactionId(
  transactionId: string | undefined,
): RealtimeMarket | undefined {
  if (transactionId === DOMESTIC_TRADE_TR_ID) {
    return "KRX";
  }
  if (transactionId === NXT_TRADE_TR_ID) {
    return "NXT";
  }
  return undefined;
}

function parseKisRealtimeSystemMessage(raw: string): KisRealtimeSystemMessage | undefined {
  try {
    const message: unknown = JSON.parse(raw);
    if (!message || typeof message !== "object" || !("header" in message)) {
      return undefined;
    }

    const { header } = message;
    if (
      !header ||
      typeof header !== "object" ||
      !("tr_id" in header) ||
      typeof header.tr_id !== "string"
    ) {
      return undefined;
    }
    const body = "body" in message ? message.body : undefined;
    const key = "tr_key" in header && typeof header.tr_key === "string"
      ? header.tr_key
      : undefined;
    const resultCode =
      body && typeof body === "object" && "rt_cd" in body && typeof body.rt_cd === "string"
        ? body.rt_cd
        : undefined;
    const responseMessage =
      body && typeof body === "object" && "msg1" in body && typeof body.msg1 === "string"
        ? body.msg1
        : undefined;
    return {
      transactionId: header.tr_id,
      ...(key ? { key } : {}),
      ...(resultCode ? { resultCode } : {}),
      ...(responseMessage ? { message: responseMessage } : {}),
    };
  } catch {
    return undefined;
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new KisApiError("KIS 실시간 접속키 응답을 JSON으로 읽지 못했습니다.");
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "msg1" in data && typeof data.msg1 === "string"
        ? data.msg1
        : "알 수 없는 오류";
    throw new KisApiError(`KIS 실시간 접속키 발급에 실패했습니다. (${response.status}) ${message}`);
  }

  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

async function toText(data: unknown): Promise<string | undefined> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
