import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PriceAlertStore } from "../src/storage/price-alert-store.js";

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
    expect(store.remove("005930")).toBe(true);
    expect(store.remove("AAPL")).toBe(true);
    expect(store.list()).toEqual([]);

    expect(store.isNightFuturesAlertEnabled()).toBe(false);
    store.setNightFuturesAlertEnabled(true);
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
});

async function createStore(): Promise<PriceAlertStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-price-alerts-"));
  temporaryDirectories.push(directory);
  return PriceAlertStore.open(join(directory, "test.sqlite"));
}
