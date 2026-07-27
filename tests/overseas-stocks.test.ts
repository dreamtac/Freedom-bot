import { describe, expect, it } from "vitest";

import {
  getOverseasStockCandidates,
  resolveOverseasStockQuery,
  suggestOverseasStocks,
} from "../src/sources/overseas-stocks.js";

describe("overseas stock lookup", () => {
  it("한글 종목명과 티커를 미국 종목으로 해석한다", () => {
    expect(resolveOverseasStockQuery("엔비디아")).toMatchObject({
      symbol: "NVDA",
      exchange: "NAS",
      name: "엔비디아",
    });
    expect(resolveOverseasStockQuery("스페이스X")).toMatchObject({
      symbol: "SPCX",
      exchange: "NAS",
      name: "스페이스X",
    });
    expect(getOverseasStockCandidates("brk.b")).toMatchObject([
      { symbol: "BRK.B", exchange: "NAS" },
      { symbol: "BRK.B", exchange: "NYS" },
      { symbol: "BRK.B", exchange: "AMS" },
    ]);
  });

  it("자동완성에 주요 미국 종목을 제공한다", () => {
    expect(suggestOverseasStocks("테슬라")).toMatchObject([
      { symbol: "TSLA", name: "테슬라", exchange: "NAS" },
    ]);
    expect(suggestOverseasStocks("스페이스")).toMatchObject([
      { symbol: "SPCX", name: "스페이스X", exchange: "NAS" },
    ]);
  });
});
