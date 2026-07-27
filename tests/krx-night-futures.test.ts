import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { parseKrxNightFuturesMaster } from "../src/sources/krx-night-futures.js";

describe("KOSPI200 KRX 야간선물 종목 마스터", () => {
  it("최근월물 KOSPI200 야간선물만 순서대로 읽는다", () => {
    const line = (type: string, code: string, standardCode: string, name: string, underlying: string) =>
      type + code.padEnd(9) + standardCode.padEnd(12) + name.padEnd(41) + "0".repeat(18) + underlying;
    const archive = zipSync({
      "fo_cme_code.mst": strToU8([
        line("1", "1A01609", "KR4A01690002", "", "KOSPI200"),
        line("1", "1A01612", "KR4A016C0004", "", "KOSPI200"),
        line("2", "D0160901", "KR4D01696CS2", "", "KOSPI200"),
        line("1", "1A01609", "KR4A01690002", "", "USD"),
      ].join("\n")),
    });

    expect(parseKrxNightFuturesMaster(archive)).toEqual([
      { code: "1A01609", standardCode: "KR4A01690002", name: "KOSPI200 KRX 야간선물" },
      { code: "1A01612", standardCode: "KR4A016C0004", name: "KOSPI200 KRX 야간선물" },
    ]);
  });
});
