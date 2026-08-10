import { describe, expect, it } from "vitest";

import { getNxtMarketSession } from "../src/sources/nxt-market-session.js";

describe("getNxtMarketSession", () => {
  it("NXT 프리·메인·애프터마켓 시간을 구분한다", () => {
    expect(getNxtMarketSession(new Date("2026-07-28T08:30:00+09:00"))).toMatchObject({
      kind: "pre",
      label: "NXT 프리마켓",
    });
    expect(getNxtMarketSession(new Date("2026-07-28T12:32:00+09:00"))).toMatchObject({
      kind: "main",
      label: "NXT 메인마켓",
    });
    expect(getNxtMarketSession(new Date("2026-07-28T16:00:00+09:00"))).toMatchObject({
      kind: "after",
      label: "NXT 애프터마켓",
    });
  });

  it("NXT 시장 간 거래중단과 휴장을 구분한다", () => {
    expect(getNxtMarketSession(new Date("2026-07-28T15:25:00+09:00"))).toMatchObject({
      kind: "pause",
      label: "NXT 거래중단",
    });
    expect(getNxtMarketSession(new Date("2026-08-01T12:00:00+09:00"))).toMatchObject({
      kind: "closed",
      label: "NXT 휴장",
    });
    expect(getNxtMarketSession(new Date("2026-02-17T12:00:00+09:00"))).toMatchObject({
      kind: "closed",
      label: "NXT 휴장",
    });
  });
});
