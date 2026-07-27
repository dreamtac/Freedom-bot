import { describe, expect, it } from "vitest";

import { getUsMarketSession } from "../src/sources/us-market-session.js";

describe("getUsMarketSession", () => {
  it("한국 낮 시간의 미국 데이장을 구분한다", () => {
    expect(getUsMarketSession(new Date("2026-07-22T03:00:00Z"))).toMatchObject({
      kind: "day",
      label: "데이장",
      timeZone: "Asia/Seoul",
    });
  });

  it("미 동부 시간 기준으로 프리장·정규장·애프터장을 구분한다", () => {
    expect(getUsMarketSession(new Date("2026-07-22T11:00:00Z"))).toMatchObject({
      kind: "pre",
      label: "프리장",
    });
    expect(getUsMarketSession(new Date("2026-07-22T14:00:00Z"))).toMatchObject({
      kind: "regular",
      label: "정규장",
    });
    expect(getUsMarketSession(new Date("2026-07-22T21:00:00Z"))).toMatchObject({
      kind: "after",
      label: "애프터장",
    });
  });
});
