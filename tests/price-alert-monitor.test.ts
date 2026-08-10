import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PriceAlertMonitor,
  type RealtimePriceSource,
} from "../src/monitor/price-alert-monitor.js";
import type {
  KisRealtimeSubscription,
  KisRealtimeTick,
} from "../src/sources/kis-realtime.js";
import { PriceAlertStore } from "../src/storage/price-alert-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PriceAlertMonitor", () => {
  it("NXT 마지막 가격을 5초 단위로 한 번만 SQLite에 저장한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T01:00:00.000Z"));
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    store.saveNxtClosingPrice("005930", "20260804", 100);
    const realtimeClient = new FakeRealtimePriceSource();
    const getStockSpy = vi.spyOn(store, "get");
    const getReferenceSpy = vi.spyOn(store, "getLatestNxtClosingPriceBefore");
    const monitor = new PriceAlertMonitor({
      channelId: "channel-id",
      client: {} as Client,
      realtimeClient,
      store,
    });

    try {
      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(realtimeClient.onTick).toBeDefined();

      await realtimeClient.onTick?.({
        assetType: "domestic",
        code: "005930",
        market: "NXT",
        open: 100,
        price: 101,
      });
      await realtimeClient.onTick?.({
        assetType: "domestic",
        code: "005930",
        market: "NXT",
        open: 100,
        price: 102,
      });

      expect(getStockSpy).not.toHaveBeenCalled();
      expect(getReferenceSpy).toHaveBeenCalledTimes(1);

      expect(store.getLatestNxtClosingPriceBefore("005930", "20260806")).toEqual({
        tradingDate: "20260804",
        price: 100,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.getLatestNxtClosingPriceBefore("005930", "20260806")).toEqual({
        tradingDate: "20260805",
        price: 102,
      });
    } finally {
      monitor.stop();
      store.close();
      vi.useRealTimers();
    }
  });

  it("20시 이후 NXT 보완 조회는 거래일이 일치할 때 종목별 하루 한 번만 저장한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T11:10:00.000Z"));
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    const nxtClosePriceSource = {
      fetchDomesticQuote: vi.fn(async () => ({
        businessDate: "20260805",
        price: 102,
      })),
    };
    const monitor = new PriceAlertMonitor({
      channelId: "channel-id",
      client: {} as Client,
      nxtClosePriceSource,
      realtimeClient: new FakeRealtimePriceSource(),
      store,
    });

    try {
      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(nxtClosePriceSource.fetchDomesticQuote).toHaveBeenCalledTimes(1);
      expect(store.getNxtClosingPrice("005930", "20260805")).toBe(102);

      monitor.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(nxtClosePriceSource.fetchDomesticQuote).toHaveBeenCalledTimes(1);
    } finally {
      monitor.stop();
      store.close();
      vi.useRealTimers();
    }
  });

  it("NXT 보완 조회의 거래일이 오늘과 다르면 저장하지 않는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T11:10:00.000Z"));
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    const monitor = new PriceAlertMonitor({
      channelId: "channel-id",
      client: {} as Client,
      nxtClosePriceSource: {
        fetchDomesticQuote: async () => ({
          businessDate: "20260804",
          price: 100,
        }),
      },
      realtimeClient: new FakeRealtimePriceSource(),
      store,
    });

    try {
      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getNxtClosingPrice("005930", "20260805")).toBeUndefined();
    } finally {
      monitor.stop();
      store.close();
      vi.useRealTimers();
    }
  });

  it("장 시작 전에는 KIS가 반환한 직전 거래일 NXT 종가를 보완 저장한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    const store = await createStore();
    store.add({ code: "005930", name: "삼성전자", assetType: "domestic" });
    const monitor = new PriceAlertMonitor({
      channelId: "channel-id",
      client: {} as Client,
      nxtClosePriceSource: {
        fetchDomesticQuote: async () => ({
          businessDate: "20260804",
          price: 100,
        }),
      },
      realtimeClient: new FakeRealtimePriceSource(),
      store,
    });

    try {
      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getNxtClosingPrice("005930", "20260804")).toBe(100);
    } finally {
      monitor.stop();
      store.close();
      vi.useRealTimers();
    }
  });
});

class FakeRealtimePriceSource implements RealtimePriceSource {
  onTick: ((tick: KisRealtimeTick) => void | Promise<void>) | undefined;

  streamPriceAlerts(
    _subscriptions: readonly KisRealtimeSubscription[],
    onTick: (tick: KisRealtimeTick) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    this.onTick = onTick;
    return new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
  }
}

async function createStore(): Promise<PriceAlertStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-price-alert-monitor-"));
  temporaryDirectories.push(directory);
  return PriceAlertStore.open(join(directory, "test.sqlite"));
}
