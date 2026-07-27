import { normalizeStockName, StockLookupError } from "./domestic-stocks.js";

export type OverseasExchange = "NAS" | "NYS" | "AMS";

export interface OverseasStockEntry {
  symbol: string;
  name: string;
  exchange: OverseasExchange;
  aliases?: readonly string[];
}

export interface OverseasStockMatch {
  symbol: string;
  name?: string;
  exchange: OverseasExchange;
  matchedBy: "symbol" | "name";
}

// Korean aliases keep the common lookup path fast; any valid US ticker still works.
export const DEFAULT_OVERSEAS_STOCKS: readonly OverseasStockEntry[] = [
  { symbol: "AAPL", name: "애플", exchange: "NAS", aliases: ["Apple"] },
  { symbol: "MSFT", name: "마이크로소프트", exchange: "NAS", aliases: ["Microsoft"] },
  { symbol: "NVDA", name: "엔비디아", exchange: "NAS", aliases: ["Nvidia"] },
  { symbol: "TSLA", name: "테슬라", exchange: "NAS", aliases: ["Tesla"] },
  {
    symbol: "SPCX",
    name: "스페이스X",
    exchange: "NAS",
    aliases: [
      "SpaceX",
      "Space X",
      "스페이스 엑스",
      "Space Exploration Technologies",
    ],
  },
  { symbol: "AMZN", name: "아마존", exchange: "NAS", aliases: ["Amazon"] },
  { symbol: "GOOGL", name: "알파벳 A", exchange: "NAS", aliases: ["구글", "Google", "Alphabet"] },
  { symbol: "GOOG", name: "알파벳 C", exchange: "NAS", aliases: ["구글 C"] },
  { symbol: "META", name: "메타", exchange: "NAS", aliases: ["Meta", "페이스북", "Facebook"] },
  { symbol: "AVGO", name: "브로드컴", exchange: "NAS", aliases: ["Broadcom"] },
  { symbol: "AMD", name: "AMD", exchange: "NAS", aliases: ["어드밴스드 마이크로 디바이시스"] },
  { symbol: "NFLX", name: "넷플릭스", exchange: "NAS", aliases: ["Netflix"] },
  { symbol: "PLTR", name: "팔란티어", exchange: "NYS", aliases: ["Palantir"] },
  { symbol: "CRM", name: "세일즈포스", exchange: "NYS", aliases: ["Salesforce"] },
  { symbol: "JPM", name: "JP모건", exchange: "NYS", aliases: ["JP Morgan", "JPMorgan"] },
  { symbol: "V", name: "비자", exchange: "NYS", aliases: ["Visa"] },
  { symbol: "LLY", name: "일라이릴리", exchange: "NYS", aliases: ["Eli Lilly"] },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", exchange: "NYS", aliases: ["S&P500", "S&P 500", "에스앤피500"] },
  { symbol: "QQQ", name: "Invesco QQQ ETF", exchange: "NAS", aliases: ["나스닥100", "Nasdaq 100"] },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", exchange: "NYS", aliases: ["러셀2000", "Russell 2000"] },
];

export function resolveOverseasStockQuery(query: string): OverseasStockMatch {
  const normalizedQuery = normalizeStockName(query);
  const exactMatches = findMatches(normalizedQuery, false);
  const exactMatch = exactMatches[0];
  if (exactMatches.length === 1 && exactMatch) {
    return toMatch(exactMatch, normalizedQuery);
  }
  if (exactMatches.length > 1) {
    throw ambiguousStockError(exactMatches);
  }

  const partialMatches = findMatches(normalizedQuery, true);
  const partialMatch = partialMatches[0];
  if (partialMatches.length === 1 && partialMatch) {
    return toMatch(partialMatch, normalizedQuery);
  }
  if (partialMatches.length > 1) {
    throw ambiguousStockError(partialMatches);
  }

  const symbol = normalizeOverseasStockSymbol(query);
  return { symbol, exchange: "NAS", matchedBy: "symbol" };
}

export function getOverseasStockCandidates(query: string): OverseasStockMatch[] {
  const normalizedQuery = normalizeStockName(query);
  const exactMatches = findMatches(normalizedQuery, false);
  if (exactMatches.length > 0) {
    return exactMatches.map((stock) => toMatch(stock, normalizedQuery));
  }

  const partialMatches = findMatches(normalizedQuery, true);
  if (partialMatches.length > 0) {
    return partialMatches.map((stock) => toMatch(stock, normalizedQuery));
  }

  const symbol = normalizeOverseasStockSymbol(query);
  return (["NAS", "NYS", "AMS"] as const).map((exchange) => ({
    symbol,
    exchange,
    matchedBy: "symbol" as const,
  }));
}

export function suggestOverseasStocks(query: string, limit = 25): OverseasStockEntry[] {
  const normalizedQuery = normalizeStockName(query);
  if (!normalizedQuery) {
    return [...DEFAULT_OVERSEAS_STOCKS].slice(0, limit);
  }

  return DEFAULT_OVERSEAS_STOCKS.filter((stock) =>
    getSearchTerms(stock).some((term) => term.includes(normalizedQuery)),
  ).slice(0, limit);
}

export function normalizeOverseasStockSymbol(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalizedSymbol)) {
    throw new StockLookupError(
      "미국 주식은 티커(AAPL, NVDA) 또는 지원 종목명을 입력해 주세요.",
    );
  }
  return normalizedSymbol;
}

export function getOverseasExchangeLabel(exchange: OverseasExchange): string {
  if (exchange === "NAS") return "NASDAQ";
  if (exchange === "NYS") return "NYSE";
  return "AMEX";
}

function findMatches(query: string, partial: boolean): OverseasStockEntry[] {
  if (!query) return [];
  return DEFAULT_OVERSEAS_STOCKS.filter((stock) =>
    getSearchTerms(stock).some((term) =>
      partial ? term.includes(query) || query.includes(term) : term === query,
    ),
  );
}

function getSearchTerms(stock: OverseasStockEntry): readonly string[] {
  return [stock.symbol, stock.name, ...(stock.aliases ?? [])].map(normalizeStockName);
}

function toMatch(stock: OverseasStockEntry, query: string): OverseasStockMatch {
  return {
    symbol: stock.symbol,
    name: stock.name,
    exchange: stock.exchange,
    matchedBy: normalizeStockName(stock.symbol) === query ? "symbol" : "name",
  };
}

function ambiguousStockError(stocks: readonly OverseasStockEntry[]): StockLookupError {
  const suggestions = stocks.slice(0, 5).map((stock) => `${stock.name}(${stock.symbol})`).join(", ");
  return new StockLookupError(`종목명이 여러 개와 일치합니다: ${suggestions}`);
}
