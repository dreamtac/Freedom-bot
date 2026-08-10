import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_PRICE_ALERT_STOCKS,
  PriceAlertStore,
} from "../src/storage/price-alert-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PriceAlertStore", () => {
  it("감시 종목과 당일 구간 알림 이력을 SQLite에 저장한다", async () => {
    const store = await createStore();

    expect(store.add({ code: "005930", name: "삼성전자", assetType: "domestic", market: "유가" })).toBe(true);
    expect(store.add({ code: "005930", name: "삼성전자", assetType: "domestic", market: "유가" })).toBe(false);
    expect(store.list()).toMatchObject([
      { code: "005930", name: "삼성전자", assetType: "domestic", market: "유가" },
    ]);
    expect(store.add({ code: "AAPL", name: "애플", assetType: "overseas", exchange: "NAS" })).toBe(true);
    expect(store.list()).toMatchObject([
      { code: "005930", assetType: "domestic" },
      { code: "AAPL", assetType: "overseas", exchange: "NAS" },
    ]);

    const event = {
      code: "005930",
      tradingDate: "20260721",
      direction: "up" as const,
      threshold: 3,
    };
    expect(store.hasNotified(event)).toBe(false);
    store.markNotified(event);
    expect(store.hasNotified(event)).toBe(true);
    expect(store.getOpeningPrice("005930", "20260721")).toBeUndefined();
    store.saveOpeningPrice("005930", "20260721", 71_500);
    expect(store.getOpeningPrice("005930", "20260721")).toBe(71_500);
    expect(store.getLatestNxtClosingPriceBefore("005930", "20260722")).toBeUndefined();
    store.saveNxtClosingPrice("005930", "20260721", 72_000);
    store.saveNxtClosingPrice("005930", "20260722", 73_000);
    expect(store.getNxtClosingPrice("005930", "20260722")).toBe(73_000);
    expect(store.getLatestNxtClosingPriceBefore("005930", "20260723")).toEqual({
      tradingDate: "20260722",
      price: 73_000,
    });
    expect(store.remove("005930")).toBe(true);
    expect(store.hasNotified(event)).toBe(false);
    expect(store.getOpeningPrice("005930", "20260721")).toBeUndefined();
    expect(store.getNxtClosingPrice("005930", "20260722")).toBeUndefined();
    expect(store.remove("AAPL")).toBe(true);
    expect(store.list()).toEqual([]);

    expect(store.isNightFuturesAlertEnabled()).toBe(false);
    expect(store.setNightFuturesAlertEnabled(true)).toBe(true);
    expect(store.isNightFuturesAlertEnabled()).toBe(true);
    const nightEvent = {
      tradingDate: "20260723",
      direction: "down" as const,
      threshold: 2,
    };
    expect(store.hasNightFuturesNotified(nightEvent)).toBe(false);
    store.markNightFuturesNotified(nightEvent);
    expect(store.hasNightFuturesNotified(nightEvent)).toBe(true);

    store.close();
  });

  it("야간선물 알림이 켜져 있으면 종목 알림을 39개로 제한한다", async () => {
    const store = await createStore();

    expect(store.setNightFuturesAlertEnabled(true)).toBe(true);
    for (let index = 0; index < MAX_PRICE_ALERT_STOCKS - 1; index += 1) {
      expect(
        store.add({
          code: String(index).padStart(6, "0"),
          name: `종목 ${index}`,
          assetType: "domestic",
        }),
      ).toBe(true);
    }

    expect(store.getMaximumStockAlerts()).toBe(MAX_PRICE_ALERT_STOCKS - 1);
    expect(() =>
      store.add({ code: "999999", name: "한도 초과", assetType: "domestic" }),
    ).toThrow("야간선물 알림이 켜져 있어");

    store.close();
  });

  it("종목 알림이 40개면 야간선물 알림을 켤 수 없다", async () => {
    const store = await createStore();

    for (let index = 0; index < MAX_PRICE_ALERT_STOCKS; index += 1) {
      store.add({
        code: String(index).padStart(6, "0"),
        name: `종목 ${index}`,
        assetType: "domestic",
      });
    }

    expect(store.setNightFuturesAlertEnabled(true)).toBe(false);
    expect(store.isNightFuturesAlertEnabled()).toBe(false);

    store.close();
  });
});

async function createStore(): Promise<PriceAlertStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-price-alerts-"));
  temporaryDirectories.push(directory);
  return PriceAlertStore.open(join(directory, "test.sqlite"));
}
