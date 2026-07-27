import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";

import { priceAlertCommand } from "../src/commands/price-alert.js";
import { nightFuturesAlertCommand } from "../src/commands/night-futures-alert.js";
import { getOpeningPriceChangeRate } from "../src/monitor/price-alert-monitor.js";

describe("priceAlertCommand", () => {
  it("서버 관리 권한이 있는 사용자에게 주가 알림 관리 명령을 제공한다", () => {
    const command = priceAlertCommand.data.toJSON();

    expect(command.name).toBe("주가알림");
    expect(command.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
    expect(command.options?.map((option) => option.name)).toEqual([
      "추가",
      "삭제",
      "목록",
    ]);
  });
});

describe("nightFuturesAlertCommand", () => {
  it("KOSPI 야간선물 알림 관리 명령을 등록한다", () => {
    const command = nightFuturesAlertCommand.data.toJSON();

    expect(command.name).toBe("야간선물알림");
    expect(command.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
    expect(command.options?.map((option) => option.name)).toEqual([
      "켜기",
      "끄기",
      "상태",
    ]);
  });
});

describe("getOpeningPriceChangeRate", () => {
  it("현재가를 시가 대비 등락률로 환산한다", () => {
    expect(getOpeningPriceChangeRate(10_500, 10_000)).toBe(5);
    expect(getOpeningPriceChangeRate(9_700, 10_000)).toBeCloseTo(-3);
    expect(getOpeningPriceChangeRate(10_000, 0)).toBeUndefined();
  });
});
