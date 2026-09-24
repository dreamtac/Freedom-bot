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
});
