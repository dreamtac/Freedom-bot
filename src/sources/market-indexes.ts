export type MarketIndexKey = "kospi" | "kosdaq" | "nasdaq-composite" | "sp500";

export interface MarketIndexDefinition {
  key: MarketIndexKey;
  code: string;
  name: string;
  market: "domestic" | "overseas";
}

export const MARKET_INDEXES: readonly MarketIndexDefinition[] = [
  { key: "kospi", code: "0001", name: "KOSPI", market: "domestic" },
  { key: "kosdaq", code: "1001", name: "KOSDAQ", market: "domestic" },
  {
    key: "nasdaq-composite",
    code: "COMP",
    name: "NASDAQ 종합",
    market: "overseas",
  },
  { key: "sp500", code: "SPX", name: "S&P 500", market: "overseas" },
];

export function getMarketIndex(key: string): MarketIndexDefinition | undefined {
  return MARKET_INDEXES.find((index) => index.key === key);
}
