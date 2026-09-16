import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EternalReturnRequestQueue,
  EternalReturnRequestQueueStoppedError,
} from "../src/sources/eternal-return-request-queue.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("requests start at least 1.1 seconds apart", async () => {
  let now = 0;
  const starts: number[] = [];
  const queue = new EternalReturnRequestQueue({
    minStartIntervalMs: 1_100,
    now: () => now,
    sleep: async ms => { now += ms; },
  });
  await Promise.all([
    queue.schedule(async () => { starts.push(now); return 1; }),
    queue.schedule(async () => { starts.push(now); return 2; }),
    queue.schedule(async () => { starts.push(now); return 3; }),
  ]);
  assert.deepEqual(starts, [0, 1_100, 2_200]);
});

test("interactive work overtakes queued refresh and backfill work", async () => {
  let now = 0;
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  const order: string[] = [];
  const queue = new EternalReturnRequestQueue({
    minStartIntervalMs: 1,
    now: () => now,
    sleep: async ms => { now += ms; },
  });
  const first = queue.schedule(async () => {
    order.push("active-refresh");
    firstStarted.resolve();
    await releaseFirst.promise;
  }, "refresh");
  await firstStarted.promise;
  const backfill = queue.schedule(async () => { order.push("backfill"); }, "backfill");
  const refresh = queue.schedule(async () => { order.push("refresh"); }, "refresh");
  const interactive = queue.schedule(async () => { order.push("interactive"); }, "interactive");
  releaseFirst.resolve();
  await Promise.all([first, backfill, refresh, interactive]);
  assert.deepEqual(order, ["active-refresh", "interactive", "refresh", "backfill"]);
});

test("global cooldown delays every queued request", async () => {
  let now = 100;
  const starts: number[] = [];
  const queue = new EternalReturnRequestQueue({
    minStartIntervalMs: 10,
    now: () => now,
    sleep: async ms => { now += ms; },
  });
  queue.pauseFor(2_000);
  await Promise.all([
    queue.schedule(async () => { starts.push(now); }),
    queue.schedule(async () => { starts.push(now); }),
  ]);
  assert.deepEqual(starts, [2_100, 2_110]);
});

test("stop rejects queued work and aborts the active request", async () => {
  const activeStarted = deferred<void>();
  const queue = new EternalReturnRequestQueue({ minStartIntervalMs: 0 });
  const active = queue.schedule(signal => new Promise<void>((_resolve, reject) => {
    activeStarted.resolve();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await activeStarted.promise;
  const pending = queue.schedule(async () => undefined);
  queue.stop();
  await assert.rejects(active, EternalReturnRequestQueueStoppedError);
  await assert.rejects(pending, EternalReturnRequestQueueStoppedError);
  await assert.rejects(queue.schedule(async () => undefined), EternalReturnRequestQueueStoppedError);
});
