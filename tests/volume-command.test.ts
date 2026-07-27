import { describe, expect, it } from "vitest";

import { analyzeVolume, volumeCommand } from "../src/commands/volume.js";

describe("volumeCommand", () => {
  it("거래량 분석 슬래시 명령어를 등록한다", () => {
    const command = volumeCommand.data.toJSON();

    expect(command.name).toBe("거래량");
    expect(command.options?.[0]).toMatchObject({
      name: "종목",
      required: true,
      autocomplete: true,
    });
    expect(command.options?.[1]).toMatchObject({
      name: "평균일수",
      min_value: 5,
      max_value: 30,
    });
  });
});

describe("analyzeVolume", () => {
  it("오늘 누적 거래량을 최근 평균과 비교한다", () => {
    expect(
      analyzeVolume({
        todayVolume: 1_800_000,
        averageDays: 3,
        dailyPrices: [
          { date: "20260714", volume: 1_000_000 },
          { date: "20260713", volume: 1_100_000 },
          { date: "20260712", volume: 900_000 },
        ],
      }),
    ).toMatchObject({
      todayVolume: 1_800_000,
      averageVolume: 1_000_000,
      ratio: 1.8,
      status: "active",
      sampleDays: 3,
    });
  });
});
