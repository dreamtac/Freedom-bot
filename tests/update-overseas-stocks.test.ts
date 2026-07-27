import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseOverseasStockMaster } from "../src/update-overseas-stocks.js";

describe("parseOverseasStockMaster", () => {
  it("KIS 미국 종목 마스터에서 주식과 ETF의 이름 및 티커를 읽는다", () => {
    const stockRow = [
      "US", "22", "NAS", "NASDAQ", "SPCX", "NASSPCX", "SPACEX",
      "SPACE EXPLORATION TECHNOLOGIES", "2",
    ].join("\t");
    const etfRow = [
      "US", "22", "NAS", "NASDAQ", "QQQ", "NASQQQ", "INVESCO QQQ",
      "INVESCO QQQ TRUST", "3",
    ].join("\t");
    const indexRow = [
      "US", "22", "NAS", "NASDAQ", "NDX", "NASNDX", "NASDAQ 100",
      "NASDAQ 100", "1",
    ].join("\t");
    const archive = zipSync({
      "NASMST.COD": strToU8([stockRow, etfRow, indexRow].join("\n")),
    });

    expect(parseOverseasStockMaster(archive, "NAS")).toEqual([
      {
        symbol: "SPCX",
        name: "SPACEX",
        exchange: "NAS",
        aliases: ["SPACE EXPLORATION TECHNOLOGIES"],
      },
      {
        symbol: "QQQ",
        name: "INVESCO QQQ",
        exchange: "NAS",
        aliases: ["INVESCO QQQ TRUST"],
      },
    ]);
  });
});
