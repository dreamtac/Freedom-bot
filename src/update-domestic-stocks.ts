import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { StockStore } from "./storage/stock-store.js";
import type { DomesticStockEntry } from "./sources/domestic-stocks.js";

const KRX_LISTED_COMPANIES_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";

if (isDirectExecution()) {
  await updateDomesticStocks();
}

export async function updateDomesticStocks(): Promise<void> {
  const response = await fetch(KRX_LISTED_COMPANIES_URL);
  if (!response.ok) {
    throw new Error(`상장 종목 목록 다운로드에 실패했습니다. (${response.status})`);
  }

  const html = new TextDecoder("euc-kr").decode(
    Buffer.from(await response.arrayBuffer()),
  );
  const stocks = parseKrxListedCompanies(html);

  if (stocks.length === 0) {
    throw new Error("상장 종목 목록에서 가져온 종목이 없습니다.");
  }

  const store = await StockStore.open(resolve(".data", "freedom-bot.sqlite"));
  try {
    const result = store.importStocks(stocks, "krx-kind");
    console.log(
      `국내 상장 종목 ${stocks.length}개를 SQLite에 저장했습니다. 현재 총 ${result.total}개입니다.`,
    );
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
