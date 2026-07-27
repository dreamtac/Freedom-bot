import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StockStore } from "../src/storage/stock-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("StockStore", () => {
  it("기본 종목을 SQLite에 시드하고 이름으로 조회한다", async () => {
    const store = await createStore();

    expect(store.resolve("이랜시스")).toMatchObject({
      code: "264850",
      name: "이랜시스",
      matchedBy: "name",
    });
    expect(store.resolve("264850")).toMatchObject({
      code: "264850",
      name: "이랜시스",
      matchedBy: "code",
    });

    store.close();
  });

  it("가져온 종목 목록을 SQLite에 저장하고 조회한다", async () => {
    const store = await createStore();
    store.importStocks(
      [{ code: "042700", name: "한미반도체", market: "유가증권" }],
      "test",
    );

    expect(store.resolve("한미반도체")).toMatchObject({
      code: "042700",
      name: "한미반도체",
      market: "유가증권",
      matchedBy: "name",
    });

    store.close();
  });

  it("입력 중인 종목명으로 자동완성 후보를 반환한다", async () => {
    const store = await createStore();
    store.importStocks(
      [
        { code: "006400", name: "삼성SDI", market: "유가증권" },
        { code: "009150", name: "삼성전기", market: "유가증권" },
        { code: "032830", name: "삼성생명", market: "유가증권" },
      ],
      "test",
    );

    expect(store.suggest("삼성").map((stock) => stock.name)).toEqual(
      expect.arrayContaining(["삼성전자", "삼성SDI", "삼성전기", "삼성생명"]),
    );

    store.close();
  });

  it("입력 중인 종목코드로 자동완성 후보를 반환한다", async () => {
    const store = await createStore();
    store.importStocks(
      [{ code: "042700", name: "한미반도체", market: "유가증권" }],
      "test",
    );

    expect(store.suggest("042")).toEqual([
      {
        code: "042700",
        name: "한미반도체",
        market: "유가증권",
      },
    ]);

    store.close();
  });

  it("미국 종목명과 티커를 별도 SQLite 목록에서 검색한다", async () => {
    const store = await createStore();
    store.importOverseasStocks(
      [
        {
          symbol: "SPCX",
          exchange: "NAS",
          name: "스페이스엑스",
          aliases: ["SpaceX", "스페이스X"],
        },
      ],
      "test",
    );

    expect(store.resolveOverseas("스페이스X")).toMatchObject({
      symbol: "SPCX",
      exchange: "NAS",
      name: "스페이스엑스",
      matchedBy: "name",
    });
    expect(store.suggestOverseas("스페이스")).toEqual([
      { symbol: "SPCX", exchange: "NAS", name: "스페이스엑스" },
    ]);

    store.close();
  });
});

async function createStore(): Promise<StockStore> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-stocks-"));
  temporaryDirectories.push(directory);
  return StockStore.open(join(directory, "test.sqlite"));
}
