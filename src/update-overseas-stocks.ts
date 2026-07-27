import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { unzipSync } from "fflate";

import { DEFAULT_OVERSEAS_STOCKS } from "./sources/overseas-stocks.js";
import type {
  OverseasExchange,
  OverseasStockEntry,
} from "./sources/overseas-stocks.js";
import { StockStore } from "./storage/stock-store.js";

const OVERSEAS_MASTER_FILES: ReadonlyArray<{
  exchange: OverseasExchange;
  url: string;
}> = [
  {
    exchange: "NAS",
    url: "https://new.real.download.dws.co.kr/common/master/nasmst.cod.zip",
  },
  {
    exchange: "NYS",
    url: "https://new.real.download.dws.co.kr/common/master/nysmst.cod.zip",
  },
  {
    exchange: "AMS",
    url: "https://new.real.download.dws.co.kr/common/master/amsmst.cod.zip",
  },
];

if (isDirectExecution()) {
  await updateOverseasStocks();
}

export async function updateOverseasStocks(): Promise<void> {
  const batches = await Promise.all(
    OVERSEAS_MASTER_FILES.map(async ({ exchange, url }) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          exchange + " 미국 종목 목록 다운로드에 실패했습니다. (" + response.status + ")",
        );
      }
      return parseOverseasStockMaster(
        new Uint8Array(await response.arrayBuffer()),
        exchange,
      );
    }),
  );
  const stocks = mergeCuratedAliases(batches.flat());
  if (stocks.length === 0) {
    throw new Error("미국 상장 종목 목록에서 가져온 종목이 없습니다.");
  }

  const store = await StockStore.open(resolve(".data", "freedom-bot.sqlite"));
  try {
    const result = store.importOverseasStocks(stocks, "kis-overseas-master");
    console.log(
      "미국 상장 종목 " + stocks.length + "개를 SQLite에 저장했습니다. 현재 총 " +
        result.total + "개입니다.",
    );
  } finally {
    store.close();
  }
}

export function parseOverseasStockMaster(
  archive: Uint8Array,
  exchange: OverseasExchange,
): OverseasStockEntry[] {
  const files = unzipSync(archive);
  const file = Object.values(files)[0];
  if (!file) {
    throw new Error(exchange + " 미국 종목 마스터 압축 파일이 비어 있습니다.");
  }

  const text = new TextDecoder("euc-kr").decode(file);
  const stocks: OverseasStockEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const columns = line.split("\t").map((column) => column.trim());
    const symbol = columns[4]?.toUpperCase();
    const koreanName = columns[6];
    const englishName = columns[7];
    const securityType = columns[8];
    if (
      !symbol ||
      !koreanName ||
      !englishName ||
      (securityType !== "2" && securityType !== "3")
    ) {
      continue;
    }

    stocks.push({
      symbol,
      name: koreanName,
      exchange,
      aliases: [englishName],
    });
  }
  return stocks;
}

function mergeCuratedAliases(
  stocks: readonly OverseasStockEntry[],
): OverseasStockEntry[] {
  const curatedByKey = new Map(
    DEFAULT_OVERSEAS_STOCKS.map((stock) => [
      stock.exchange + ":" + stock.symbol,
      stock,
    ]),
  );
  return stocks.map((stock) => {
    const curated = curatedByKey.get(stock.exchange + ":" + stock.symbol);
    if (!curated) return stock;
    return {
      ...stock,
      aliases: [
        ...(stock.aliases ?? []),
        curated.name,
        ...(curated.aliases ?? []),
      ],
    };
  });
}

function isDirectExecution(): boolean {
  const executedPath = process.argv[1];
  return Boolean(executedPath && import.meta.url === pathToFileURL(executedPath).href);
}
