import type { KisConfig } from "../config.js";
import {
  getOverseasExchangeLabel,
  normalizeOverseasStockSymbol,
} from "./overseas-stocks.js";
import type { OverseasExchange } from "./overseas-stocks.js";

const DOMESTIC_QUOTE_PATH =
  "/uapi/domestic-stock/v1/quotations/inquire-price";
const DOMESTIC_DAILY_PRICE_PATH =
  "/uapi/domestic-stock/v1/quotations/inquire-daily-price";
const DOMESTIC_NEWS_TITLE_PATH =
  "/uapi/domestic-stock/v1/quotations/news-title";
const DOMESTIC_INVESTOR_PATH =
  "/uapi/domestic-stock/v1/quotations/inquire-investor";
const DOMESTIC_INDEX_PRICE_PATH =
  "/uapi/domestic-stock/v1/quotations/inquire-index-price";
const OVERSEAS_QUOTE_PATH = "/uapi/overseas-price/v1/quotations/price";
const OVERSEAS_DAILY_PRICE_PATH =
  "/uapi/overseas-price/v1/quotations/dailyprice";
const OVERSEAS_INDEX_PRICE_PATH =
  "/uapi/overseas-price/v1/quotations/inquire-time-indexchartprice";
const FUTURES_QUOTE_PATH =
  "/uapi/domestic-futureoption/v1/quotations/inquire-price";
const TOKEN_PATH = "/oauth2/tokenP";
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export type DomesticMarketCode = "J" | "NX";

export interface KisStockQuote {
  code: string;
  marketCode: DomesticMarketCode;
  name?: string;
  marketName?: string;
  price: number;
  change: number;
  changeRate: number;
  changeDirection: "up" | "down" | "flat";
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  amount?: number;
  requestedAt: Date;
}

export interface KisDailyPrice {
  date?: string;
  close?: number;
  volume: number;
}

export interface KisInvestorParticipantFlow {
  buyVolume?: number;
  sellVolume?: number;
  netBuyVolume: number;
}

export interface KisDomesticInvestorFlow {
  date?: string;
  personal: KisInvestorParticipantFlow;
  foreign: KisInvestorParticipantFlow;
  institution: KisInvestorParticipantFlow;
}

export interface KisOverseasQuote {
  symbol: string;
  exchange: OverseasExchange;
  exchangeName: string;
  price: number;
  change: number;
  changeRate: number;
  changeDirection: "up" | "down" | "flat";
  previousClose?: number;
  volume?: number;
  amount?: number;
  requestedAt: Date;
}

export interface KisIndexQuote {
  code: string;
  market: "domestic" | "overseas";
  price: number;
  change: number;
  changeRate: number;
  changeDirection: "up" | "down" | "flat";
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  advancingIssues?: number;
  flatIssues?: number;
  decliningIssues?: number;
  requestedAt: Date;
}

export interface KisFuturesQuote {
  code: string;
  name?: string;
  price: number;
  change: number;
  changeRate: number;
  changeDirection: "up" | "down" | "flat";
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  requestedAt: Date;
}

export interface KisNewsTitle {
  serialNumber?: string;
  providerCode?: string;
  date?: string;
  time?: string;
  title: string;
  categoryCode?: string;
  source?: string;
}

interface KisTokenCache {
  accessToken: string;
  expiresAt: number;
}

const tokenCaches = new Map<string, KisTokenCache>();

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export class KisClient {
  constructor(
    private readonly config: KisConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  async fetchDomesticQuote(
    code: string,
    marketCode: DomesticMarketCode = "J",
  ): Promise<KisStockQuote> {
    const normalizedCode = normalizeDomesticStockCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(DOMESTIC_QUOTE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", marketCode);
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST01010100",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "시세 조회");
    assertKisSuccess(data, "시세 조회");

    const output = asRecord(data.output);
    return parseDomesticQuote(normalizedCode, marketCode, output);
  }

  async fetchDomesticDailyPrices(
    code: string,
    count = 30,
  ): Promise<KisDailyPrice[]> {
    const normalizedCode = normalizeDomesticStockCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(DOMESTIC_DAILY_PRICE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);
    url.searchParams.set("FID_PERIOD_DIV_CODE", "D");
    url.searchParams.set("FID_ORG_ADJ_PRC", "0");

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST01010400",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "기간별 시세 조회");
    assertKisSuccess(data, "기간별 시세 조회");

    return getDailyPriceRows(data)
      .map(parseDailyPrice)
      .filter((price) => price.volume > 0)
      .slice(0, count);
  }

  async fetchDomesticNewsTitles(
    code: string,
    count = 10,
  ): Promise<KisNewsTitle[]> {
    const normalizedCode = normalizeDomesticStockCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(DOMESTIC_NEWS_TITLE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_NEWS_OFER_ENTP_CODE", "");
    url.searchParams.set("FID_COND_MRKT_CLS_CODE", "");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);
    url.searchParams.set("FID_TITL_CNTT", "");
    url.searchParams.set("FID_INPUT_DATE_1", "");
    url.searchParams.set("FID_INPUT_HOUR_1", "");
    url.searchParams.set("FID_RANK_SORT_CLS_CODE", "");
    url.searchParams.set("FID_INPUT_SRNO", "");

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST01011800",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "뉴스 제목 조회");
    assertKisSuccess(data, "뉴스 제목 조회");

    return asRecordArray(data.output)
      .map(parseNewsTitle)
      .filter((news): news is KisNewsTitle => news !== undefined)
      .slice(0, count);
  }

  async fetchDomesticInvestorFlow(
    code: string,
  ): Promise<KisDomesticInvestorFlow> {
    const normalizedCode = normalizeDomesticStockCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(DOMESTIC_INVESTOR_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST01010900",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "투자자 수급 조회");
    assertKisSuccess(data, "투자자 수급 조회");
    const output = asRecordArray(data.output)[0];
    if (!output) {
      throw new KisApiError("투자자 수급 데이터가 없습니다.");
    }
    return parseDomesticInvestorFlow(output);
  }

  async fetchDomesticIndexQuote(code: string): Promise<KisIndexQuote> {
    const normalizedCode = normalizeDomesticIndexCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(DOMESTIC_INDEX_PRICE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "U");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHPUP02100000",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "국내 지수 조회");
    assertKisSuccess(data, "국내 지수 조회");
    return parseDomesticIndexQuote(normalizedCode, asRecord(data.output));
  }

  async fetchOverseasIndexQuote(code: string): Promise<KisIndexQuote> {
    const normalizedCode = normalizeOverseasIndexCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(OVERSEAS_INDEX_PRICE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "N");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);
    url.searchParams.set("FID_HOUR_CLS_CODE", "0");
    url.searchParams.set("FID_PW_DATA_INCU_YN", "Y");

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHKST03030200",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "해외 지수 조회");
    assertKisSuccess(data, "해외 지수 조회");
    return parseOverseasIndexQuote(normalizedCode, asRecord(data.output1));
  }

  async fetchOverseasQuote(
    symbol: string,
    exchange: OverseasExchange,
  ): Promise<KisOverseasQuote> {
    const normalizedSymbol = normalizeOverseasStockSymbol(symbol);
    const accessToken = await this.getAccessToken();
    const url = new URL(OVERSEAS_QUOTE_PATH, this.config.baseUrl);
    url.searchParams.set("AUTH", "");
    url.searchParams.set("EXCD", exchange);
    url.searchParams.set("SYMB", normalizedSymbol);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "HHDFS00000300",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "미국 주식 시세 조회");
    assertKisSuccess(data, "미국 주식 시세 조회");
    return parseOverseasQuote(normalizedSymbol, exchange, asRecord(data.output));
  }

  async fetchOverseasDailyPrices(
    symbol: string,
    exchange: OverseasExchange,
    count = 30,
  ): Promise<KisDailyPrice[]> {
    const normalizedSymbol = normalizeOverseasStockSymbol(symbol);
    const accessToken = await this.getAccessToken();
    const url = new URL(OVERSEAS_DAILY_PRICE_PATH, this.config.baseUrl);
    url.searchParams.set("AUTH", "");
    url.searchParams.set("EXCD", exchange);
    url.searchParams.set("SYMB", normalizedSymbol);
    url.searchParams.set("GUBN", "0");
    url.searchParams.set("BYMD", "");
    url.searchParams.set("MODP", "1");

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "HHDFS76240000",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "미국 주식 일봉 조회");
    assertKisSuccess(data, "미국 주식 일봉 조회");
    return getDailyPriceRows(data)
      .map(parseOverseasDailyPrice)
      .filter((price) => price.volume > 0)
      .slice(0, count);
  }

  async fetchKrxNightFuturesQuote(code: string): Promise<KisFuturesQuote> {
    const normalizedCode = normalizeFuturesCode(code);
    const accessToken = await this.getAccessToken();
    const url = new URL(FUTURES_QUOTE_PATH, this.config.baseUrl);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "CM");
    url.searchParams.set("FID_INPUT_ISCD", normalizedCode);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: "FHMIF10000000",
        custtype: "P",
      },
    });

    const data = await readJsonResponse(response, "KOSPI200 야간선물 시세 조회");
    assertKisSuccess(data, "KOSPI200 야간선물 시세 조회");
    return parseFuturesQuote(normalizedCode, asRecord(data.output1));
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    const cacheKey = this.getTokenCacheKey();
    const cachedToken = tokenCaches.get(cacheKey);
    if (cachedToken && cachedToken.expiresAt > now) {
      return cachedToken.accessToken;
    }

    const url = new URL(TOKEN_PATH, this.config.baseUrl);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      }),
    });

    const data = await readJsonResponse(response, "접근 토큰 발급");
    const accessToken = readString(data, "access_token");
    const expiresInSeconds = readOptionalNumber(data, "expires_in") ?? 86_400;

    tokenCaches.set(cacheKey, {
      accessToken,
      expiresAt: now + expiresInSeconds * 1000 - TOKEN_EXPIRY_SAFETY_MS,
    });

    return accessToken;
  }

  private getTokenCacheKey(): string {
    return `${this.config.baseUrl}:${this.config.appKey}`;
  }
}

export function normalizeDomesticStockCode(code: string): string {
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new KisApiError("국내 주식 종목코드는 6자리 숫자여야 합니다.");
  }

  return normalizedCode;
}

export function normalizeDomesticIndexCode(code: string): string {
  const normalizedCode = code.trim();
  if (!/^\d{4}$/.test(normalizedCode)) {
    throw new KisApiError("국내 지수 코드는 4자리 숫자여야 합니다.");
  }
  return normalizedCode;
}

export function normalizeOverseasIndexCode(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[.A-Z][.A-Z0-9-]{0,9}$/.test(normalizedCode)) {
    throw new KisApiError("해외 지수 코드 형식이 올바르지 않습니다.");
  }
  return normalizedCode;
}

export function normalizeFuturesCode(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,9}$/.test(normalizedCode)) {
    throw new KisApiError("선물 종목코드 형식이 올바르지 않습니다.");
  }
  return normalizedCode;
}

export class KisApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KisApiError";
  }
}

async function readJsonResponse(
  response: Response,
  action: string,
): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new KisApiError(`${action} 응답을 JSON으로 읽지 못했습니다.`);
  }

  if (!response.ok) {
    const message = asRecord(data).msg1 ?? asRecord(data).error_description;
    throw new KisApiError(
      `${action}에 실패했습니다. (${response.status})${typeof message === "string" ? ` ${message}` : ""}`,
    );
  }

  return asRecord(data);
}

function assertKisSuccess(data: Record<string, unknown>, action: string): void {
  if (data.rt_cd !== undefined && data.rt_cd !== "0") {
    const message = typeof data.msg1 === "string" ? data.msg1 : "알 수 없는 오류";
    throw new KisApiError(`${action}에 실패했습니다. ${message}`);
  }
}

function parseDomesticQuote(
  code: string,
  marketCode: DomesticMarketCode,
  output: Record<string, unknown>,
): KisStockQuote {
  const name = readOptionalString(output, "hts_kor_isnm");
  const marketName = readOptionalString(output, "rprs_mrkt_kor_name");
  const open = readOptionalNumber(output, "stck_oprc");
  const high = readOptionalNumber(output, "stck_hgpr");
  const low = readOptionalNumber(output, "stck_lwpr");
  const volume = readOptionalNumber(output, "acml_vol");
  const amount = readOptionalNumber(output, "acml_tr_pbmn");

  return {
    code,
    marketCode,
    ...(name ? { name } : {}),
    ...(marketName ? { marketName } : {}),
    price: readNumber(output, "stck_prpr"),
    change: readOptionalNumber(output, "prdy_vrss") ?? 0,
    changeRate: readOptionalNumber(output, "prdy_ctrt") ?? 0,
    changeDirection: parseChangeDirection(readOptionalString(output, "prdy_vrss_sign")),
    ...(open !== undefined ? { open } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(amount !== undefined ? { amount } : {}),
    requestedAt: new Date(),
  };
}

function parseDomesticIndexQuote(
  code: string,
  output: Record<string, unknown>,
): KisIndexQuote {
  const rawChange = readOptionalNumber(output, "bstp_nmix_prdy_vrss") ?? 0;
  const rawChangeRate = readOptionalNumber(output, "bstp_nmix_prdy_ctrt") ?? 0;
  const changeDirection = parseOverseasChangeDirection(
    readOptionalString(output, "prdy_vrss_sign"),
    rawChange,
    rawChangeRate,
  );
  const multiplier =
    changeDirection === "up" ? 1 : changeDirection === "down" ? -1 : 0;
  const previousClose = readOptionalNumber(output, "prdy_clpr");
  const open = readOptionalNumber(output, "bstp_nmix_oprc");
  const high = readOptionalNumber(output, "bstp_nmix_hgpr");
  const low = readOptionalNumber(output, "bstp_nmix_lwpr");
  const advancingIssues = readOptionalNumber(output, "ascn_issu_cnt");
  const flatIssues = readOptionalNumber(output, "stnr_issu_cnt");
  const decliningIssues = readOptionalNumber(output, "down_issu_cnt");

  return {
    code,
    market: "domestic",
    price: readNumber(output, "bstp_nmix_prpr"),
    change: Math.abs(rawChange) * multiplier,
    changeRate: Math.abs(rawChangeRate) * multiplier,
    changeDirection,
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(open !== undefined ? { open } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(advancingIssues !== undefined ? { advancingIssues } : {}),
    ...(flatIssues !== undefined ? { flatIssues } : {}),
    ...(decliningIssues !== undefined ? { decliningIssues } : {}),
    requestedAt: new Date(),
  };
}

function parseChangeDirection(sign?: string): "up" | "down" | "flat" {
  if (sign === "1" || sign === "2") {
    return "up";
  }

  if (sign === "4" || sign === "5") {
    return "down";
  }

  return "flat";
}

function getDailyPriceRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const output2 = asRecordArray(data.output2);
  if (output2.length > 0) {
    return output2;
  }

  return asRecordArray(data.output);
}

function parseDailyPrice(output: Record<string, unknown>): KisDailyPrice {
  const date = readOptionalString(output, "stck_bsop_date");
  const close = readOptionalNumber(output, "stck_clpr");

  return {
    ...(date ? { date } : {}),
    ...(close !== undefined ? { close } : {}),
    volume: readNumber(output, "acml_vol"),
  };
}

function parseDomesticInvestorFlow(
  output: Record<string, unknown>,
): KisDomesticInvestorFlow {
  const date = readOptionalString(output, "stck_bsop_date");
  return {
    ...(date ? { date } : {}),
    personal: parseInvestorParticipantFlow(output, "prsn"),
    foreign: parseInvestorParticipantFlow(output, "frgn"),
    institution: parseInvestorParticipantFlow(output, "orgn"),
  };
}

function parseInvestorParticipantFlow(
  output: Record<string, unknown>,
  prefix: "prsn" | "frgn" | "orgn",
): KisInvestorParticipantFlow {
  const buyVolume = readOptionalNumber(output, prefix + "_shnu_vol");
  const sellVolume = readOptionalNumber(output, prefix + "_seln_vol");
  const netBuyVolume = readOptionalNumber(output, prefix + "_ntby_qty") ?? 0;
  return {
    ...(buyVolume !== undefined ? { buyVolume } : {}),
    ...(sellVolume !== undefined ? { sellVolume } : {}),
    netBuyVolume,
  };
}

function parseOverseasQuote(
  symbol: string,
  exchange: OverseasExchange,
  output: Record<string, unknown>,
): KisOverseasQuote {
  const price = readNumber(output, "last");
  const rawChange = readOptionalNumber(output, "diff") ?? 0;
  const rawChangeRate = readOptionalNumber(output, "rate") ?? 0;
  const changeDirection = parseOverseasChangeDirection(
    readOptionalString(output, "sign"),
    rawChange,
    rawChangeRate,
  );
  const multiplier =
    changeDirection === "up" ? 1 : changeDirection === "down" ? -1 : 0;
  const change = Math.abs(rawChange) * multiplier;
  const changeRate = Math.abs(rawChangeRate) * multiplier;
  const previousClose = readOptionalNumber(output, "base");
  const volume = readOptionalNumber(output, "tvol");
  const amount = readOptionalNumber(output, "tamt");
  return {
    symbol,
    exchange,
    exchangeName: getOverseasExchangeLabel(exchange),
    price,
    change,
    changeRate,
    changeDirection,
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(amount !== undefined ? { amount } : {}),
    requestedAt: new Date(),
  };
}

function parseOverseasIndexQuote(
  code: string,
  output: Record<string, unknown>,
): KisIndexQuote {
  const rawChange = readOptionalNumber(output, "ovrs_nmix_prdy_vrss") ?? 0;
  const rawChangeRate = readOptionalNumber(output, "prdy_ctrt") ?? 0;
  const changeDirection = parseOverseasChangeDirection(
    readOptionalString(output, "prdy_vrss_sign"),
    rawChange,
    rawChangeRate,
  );
  const multiplier =
    changeDirection === "up" ? 1 : changeDirection === "down" ? -1 : 0;
  const previousClose = readOptionalNumber(output, "ovrs_nmix_prdy_clpr");
  const open = readOptionalNumber(output, "ovrs_prod_oprc");
  const high = readOptionalNumber(output, "ovrs_prod_hgpr");
  const low = readOptionalNumber(output, "ovrs_prod_lwpr");

  return {
    code,
    market: "overseas",
    price: readNumber(output, "ovrs_nmix_prpr"),
    change: Math.abs(rawChange) * multiplier,
    changeRate: Math.abs(rawChangeRate) * multiplier,
    changeDirection,
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(open !== undefined ? { open } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    requestedAt: new Date(),
  };
}

function parseOverseasChangeDirection(
  sign: string | undefined,
  change: number,
  changeRate: number,
): "up" | "down" | "flat" {
  const directionFromSign = parseChangeDirection(sign);
  if (directionFromSign !== "flat" || sign === "3") {
    return directionFromSign;
  }
  if (change < 0 || changeRate < 0) return "down";
  if (change > 0 || changeRate > 0) return "up";
  return "flat";
}

function parseOverseasDailyPrice(output: Record<string, unknown>): KisDailyPrice {
  const date = readOptionalString(output, "xymd");
  const close = readOptionalNumber(output, "clos");
  return {
    ...(date ? { date } : {}),
    ...(close !== undefined ? { close } : {}),
    volume: readOptionalNumber(output, "tvol") ?? 0,
  };
}

function parseFuturesQuote(
  code: string,
  output: Record<string, unknown>,
): KisFuturesQuote {
  const rawChange = readOptionalNumber(output, "futs_prdy_vrss") ?? 0;
  const rawChangeRate = readOptionalNumber(output, "futs_prdy_ctrt") ?? 0;
  const changeDirection = parseOverseasChangeDirection(
    readOptionalString(output, "prdy_vrss_sign"),
    rawChange,
    rawChangeRate,
  );
  const multiplier =
    changeDirection === "up" ? 1 : changeDirection === "down" ? -1 : 0;
  const name = readOptionalString(output, "hts_kor_isnm");
  const previousClose = readOptionalNumber(output, "futs_prdy_clpr");
  const open = readOptionalNumber(output, "futs_oprc");
  const high = readOptionalNumber(output, "futs_hgpr");
  const low = readOptionalNumber(output, "futs_lwpr");
  const volume = readOptionalNumber(output, "acml_vol");

  return {
    code,
    ...(name ? { name } : {}),
    price: readNumber(output, "futs_prpr"),
    change: Math.abs(rawChange) * multiplier,
    changeRate: Math.abs(rawChangeRate) * multiplier,
    changeDirection,
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(open !== undefined ? { open } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(volume !== undefined ? { volume } : {}),
    requestedAt: new Date(),
  };
}

function parseNewsTitle(
  output: Record<string, unknown>,
): KisNewsTitle | undefined {
  const title = readOptionalString(output, "hts_pbnt_titl_cntt");
  if (!title) {
    return undefined;
  }

  const serialNumber = readOptionalString(output, "cntt_usiq_srno");
  const providerCode = readOptionalString(output, "news_ofer_entp_code");
  const date = readOptionalString(output, "data_dt");
  const time = readOptionalString(output, "data_tm");
  const categoryCode = readOptionalString(output, "news_lrdv_code");
  const source = readOptionalString(output, "dorg");

  return {
    ...(serialNumber ? { serialNumber } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    title,
    ...(categoryCode ? { categoryCode } : {}),
    ...(source ? { source } : {}),
  };
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new KisApiError(`KIS 응답에 ${key} 값이 없습니다.`);
  }

  return value;
}

function readOptionalString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(data: Record<string, unknown>, key: string): number {
  const value = readOptionalNumber(data, key);
  if (value === undefined) {
    throw new KisApiError(`KIS 응답에 숫자 ${key} 값이 없습니다.`);
  }

  return value;
}

function readOptionalNumber(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const normalizedValue = value.replaceAll(",", "").trim();
  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((record) => Object.keys(record).length > 0);
}
