import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { StockStore } from "./storage/stock-store.js";
import type { DomesticStockEntry } from "./sources/domestic-stocks.js";
import type { StockMasterSyncResult } from "./storage/stock-store.js";

const KRX_LISTED_COMPANIES_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const STOCK_MASTER_TIMEOUT_MS = 30_000;
const MINIMUM_DOMESTIC_STOCKS = 1_000;

if (isDirectExecution()) {
  await updateDomesticStocks();
}

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export async function fetchDomesticStocks(
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<DomesticStockEntry[]> {
  const response = await fetchImpl(KRX_LISTED_COMPANIES_URL, {
    signal: AbortSignal.timeout(STOCK_MASTER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`상장 종목 목록 다운로드에 실패했습니다. (${response.status})`);
  }

  const html = new TextDecoder("euc-kr").decode(
    Buffer.from(await response.arrayBuffer()),
  );
  const stocks = parseKrxListedCompanies(html);

  if (stocks.length < MINIMUM_DOMESTIC_STOCKS) {
    throw new Error(
      `국내 상장 종목 목록이 비정상적으로 적습니다. (${stocks.length}개) 기존 데이터를 유지합니다.`,
    );
  }

  return stocks;
}

export async function updateDomesticStocks(): Promise<StockMasterSyncResult> {
  const stocks = await fetchDomesticStocks();
  const store = await StockStore.open(resolve(".data", "freedom-bot.sqlite"));
  try {
    const result = store.syncDomesticStocks(stocks, "krx-kind");
    console.log(
      `국내 상장 종목 동기화 완료: 추가 ${result.added}개, 제외 ${result.removed}개, 현재 총 ${result.total}개입니다.`,
    );
    return result;
  } finally {
    store.close();
  }
}

export function parseKrxListedCompanies(html: string): DomesticStockEntry[] {
  const stocks: DomesticStockEntry[] = [];
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    if (!rowHtml) {
      continue;
    }

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cellMatch) => decodeHtml(stripTags(cellMatch[1] ?? "")),
    );

    if (cells.length < 3) {
      continue;
    }

    const [name, market, code] = cells;
    if (!name || !market || !code || !/^\d{6}$/.test(code)) {
      continue;
    }

    stocks.push({
      code,
      name,
      market,
    });
  }

  return stocks;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .trim();
}

function isDirectExecution(): boolean {
  const executedPath = process.argv[1];
  if (!executedPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(executedPath).href;
}
