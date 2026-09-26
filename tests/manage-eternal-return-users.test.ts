import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { manageEternalReturnUsers } from "../src/manage-eternal-return-users.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

describe("manageEternalReturnUsers", () => {
  it("명시적으로 추가한 사용자만 자동 수집 대상으로 관리한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-manage-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite");
    const resolveUserId = vi.fn().mockResolvedValue("uid");
    const previous = await EternalReturnStore.open(databasePath);
    previous.upsertUser("old-uid", "홉빵맨");
    previous.setAutoRefresh("old-uid", true);
    previous.close();

    await expect(manageEternalReturnUsers(["add", "홉빵맨"], {
      databasePath,
      environment: { ER_ENABLED: "true", ER_API_KEY: "key" },
      resolveUserId,
    })).resolves.toContain("등록했습니다");
    await expect(manageEternalReturnUsers(["list"], { databasePath })).resolves.toBe("홉빵맨\tuid");
    await expect(manageEternalReturnUsers(["disable", "홉빵맨"], { databasePath })).resolves.toContain("비활성화");
    await expect(manageEternalReturnUsers(["list"], { databasePath })).resolves.toBe("자동 수집 대상이 없습니다.");

    const store = await EternalReturnStore.open(databasePath);
    expect(store.getUser("uid")?.autoRefresh).toBe(false);
    expect(store.getUser("old-uid")?.autoRefresh).toBe(false);
    store.close();
  });

  it("자동 수집과 게임 결과 구독을 별도로 관리하고 최초 활성화 때 기존 경기를 기준선 처리한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-receipt-manage-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite");
    const store = await EternalReturnStore.open(databasePath);
    store.upsertUser("uid", "홉빵맨");
    store.setAutoRefresh("uid", true);
    store.saveGamePage("uid", [{ gameId: 700, characterNum: 1 }]);
    store.close();
    const environment = {
      ER_ENABLED: "true",
      ER_RECEIPTS_ENABLED: "true",
      ER_RECEIPT_CHANNEL_ID: "12345678901234567",
    };

    await expect(manageEternalReturnUsers(["receipt", "홉빵맨", "on"], { databasePath, environment }))
      .resolves.toContain("게임 결과 알림을 켰습니다");
    await expect(manageEternalReturnUsers(["status", "홉빵맨"], { databasePath }))
      .resolves.toContain("자동 수집 ON\t게임 결과 ON\t채널 12345678901234567");

    const inspected = await EternalReturnStore.open(databasePath);
    expect(inspected.getGameReceiptByChannelGame("12345678901234567", 700)?.status).toBe("suppressed");
    inspected.close();

    await expect(manageEternalReturnUsers(["receipt", "홉빵맨", "off"], { databasePath }))
      .resolves.toContain("비활성화했습니다");
    await expect(manageEternalReturnUsers(["status"], { databasePath }))
      .resolves.toContain("자동 수집 ON\t게임 결과 OFF");
  });

  it("자동 수집하지 않는 유저와 잘못된 채널에는 게임 결과 구독을 허용하지 않는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-receipt-invalid-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite");
    const store = await EternalReturnStore.open(databasePath);
    store.upsertUser("uid", "테스터");
    store.close();
    const environment = { ER_ENABLED: "true", ER_RECEIPTS_ENABLED: "true" };
    await expect(manageEternalReturnUsers(["receipt", "테스터", "on"], { databasePath, environment }))
      .rejects.toThrow("자동 수집");

    const enabled = await EternalReturnStore.open(databasePath);
    enabled.setAutoRefresh("uid", true);
    enabled.close();
    await expect(manageEternalReturnUsers(["receipt", "테스터", "on", "bad"], { databasePath, environment }))
      .rejects.toThrow("17~20자리");
  });
});
