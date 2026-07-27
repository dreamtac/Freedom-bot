import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StockMasterMonitor } from "../src/monitor/stock-master-monitor.js";
import { StockStore } from "../src/storage/stock-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("StockMasterMonitor", () => {
  it("국내·미국 종목 목록을 함께 동기화한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-stock-master-"));
    temporaryDirectories.push(directory);
    const store = await StockStore.open(join(directory, "test.sqlite"));
    let revision = 1;
    const monitor = new StockMasterMonitor({
      store,
      intervalMs: 86_400_000,
      source: {
        async fetchDomesticStocks() {
          return revision === 1
            ? [{ code: "111111", name: "국내 A", market: "유가증권" }]
            : [{ code: "222222", name: "국내 B", market: "코스닥" }];
        },
        async fetchOverseasStocks() {
          return revision === 1
            ? [{ symbol: "AAAA", exchange: "NAS" as const, name: "미국 A" }]
            : [{ symbol: "BBBB", exchange: "NYS" as const, name: "미국 B" }];
        },
      },
    });

    await expect(monitor.refreshNow()).resolves.toMatchObject({
      domestic: { added: 1, removed: 0, initial: true },
      overseas: { added: 1, removed: 0, initial: true },
    });
    revision = 2;
    await expect(monitor.refreshNow()).resolves.toMatchObject({
      domestic: { added: 1, removed: 1, initial: false },
      overseas: { added: 1, removed: 1, initial: false },
    });
    expect(store.resolve("222222")).toMatchObject({ name: "국내 B" });
    expect(store.resolveOverseas("BBBB")).toMatchObject({ name: "미국 B" });

    store.close();
  });
});
