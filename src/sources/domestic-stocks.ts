export interface DomesticStockEntry {
  code: string;
  name: string;
  market?: string;
  aliases?: readonly string[];
}

export interface DomesticStockMatch {
  code: string;
  name?: string;
  market?: string;
  matchedBy: "code" | "name";
}

export const DEFAULT_DOMESTIC_STOCKS: readonly DomesticStockEntry[] = [
  { code: "005930", name: "삼성전자", aliases: ["삼전", "Samsung Electronics"] },
  { code: "000660", name: "SK하이닉스", aliases: ["하이닉스", "SK hynix"] },
  { code: "373220", name: "LG에너지솔루션", aliases: ["LG엔솔", "엘지에너지솔루션"] },
  { code: "207940", name: "삼성바이오로직스", aliases: ["삼바"] },
  { code: "005380", name: "현대차", aliases: ["현대자동차"] },
  { code: "000270", name: "기아" },
  { code: "005935", name: "삼성전자우", aliases: ["삼전우"] },
  { code: "035420", name: "NAVER", aliases: ["네이버"] },
  { code: "035720", name: "카카오" },
  { code: "051910", name: "LG화학", aliases: ["엘지화학"] },
  { code: "006400", name: "삼성SDI" },
  { code: "068270", name: "셀트리온" },
  { code: "005490", name: "POSCO홀딩스", aliases: ["포스코홀딩스", "포스코"] },
  { code: "105560", name: "KB금융" },
  { code: "055550", name: "신한지주" },
  { code: "012450", name: "한화에어로스페이스", aliases: ["한화에어로"] },
  { code: "034020", name: "두산에너빌리티" },
  { code: "028260", name: "삼성물산" },
  { code: "012330", name: "현대모비스" },
  { code: "096770", name: "SK이노베이션" },
  { code: "264850", name: "이랜시스" },
];

export function resolveDomesticStockQuery(query: string): DomesticStockMatch {
  const normalizedQuery = normalizeStockName(query);
  if (/^\d{6}$/.test(normalizedQuery)) {
    const codeMatch = DEFAULT_DOMESTIC_STOCKS.find(
      (stock) => stock.code === normalizedQuery,
    );
    return {
      code: normalizedQuery,
      ...(codeMatch ? { name: codeMatch.name } : {}),
      ...(codeMatch?.market ? { market: codeMatch.market } : {}),
      matchedBy: "code",
    };
  }

  const exactMatch = DEFAULT_DOMESTIC_STOCKS.find((stock) =>
    getStockSearchTerms(stock).some((term) => term === normalizedQuery),
  );
  if (exactMatch) {
    return {
      code: exactMatch.code,
      name: exactMatch.name,
      ...(exactMatch.market ? { market: exactMatch.market } : {}),
      matchedBy: "name",
    };
  }

  const partialMatches = DEFAULT_DOMESTIC_STOCKS.filter((stock) =>
    getStockSearchTerms(stock).some(
      (term) => term.includes(normalizedQuery) || normalizedQuery.includes(term),
    ),
  );

  if (partialMatches.length === 1) {
    const match = partialMatches[0];
    if (!match) {
      throw new StockLookupError("종목을 찾지 못했습니다.");
    }

    return {
      code: match.code,
      name: match.name,
      ...(match.market ? { market: match.market } : {}),
      matchedBy: "name",
    };
  }

  if (partialMatches.length > 1) {
    const suggestions = partialMatches
      .slice(0, 5)
      .map((stock) => `${stock.name}(${stock.code})`)
      .join(", ");
    throw new StockLookupError(`종목명이 여러 개와 일치합니다: ${suggestions}`);
  }

  throw new StockLookupError(
    "종목을 찾지 못했습니다. 6자리 종목코드나 등록된 종목명을 입력해 주세요.",
  );
}

export class StockLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockLookupError";
  }
}

function getStockSearchTerms(stock: DomesticStockEntry): readonly string[] {
  return [stock.name, ...(stock.aliases ?? [])].map(normalizeStockName);
}

export function normalizeStockName(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}
