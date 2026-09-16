export type EternalReturnRequestPriority = "interactive" | "refresh" | "backfill";

const PRIORITY_ORDER: Record<EternalReturnRequestPriority, number> = {
  interactive: 0,
  refresh: 1,
  backfill: 2,
};

export class EternalReturnRequestQueueStoppedError extends Error {
  constructor() {
    super("이터널 리턴 API 요청 관리자가 종료되었습니다.");
    this.name = "EternalReturnRequestQueueStoppedError";
  }
}

interface QueuedRequest<T> {
  sequence: number;
  priority: EternalReturnRequestPriority;
  run(signal: AbortSignal): Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface EternalReturnRequestQueueOptions {
  minStartIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface EternalReturnRequestQueueStatus {
  active: boolean;
  queued: number;
  stopped: boolean;
  cooldownUntil: number;
  lastStartedAt?: number;
}

export class EternalReturnRequestQueue {
  readonly #minStartIntervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #pending: QueuedRequest<unknown>[] = [];
  #sequence = 0;
  #draining = false;
  #stopped = false;
  #lastStartedAt: number | undefined;
  #cooldownUntil = 0;
  #activeController: AbortController | undefined;
  #waitController: AbortController | undefined;

  constructor(options: EternalReturnRequestQueueOptions = {}) {
    this.#minStartIntervalMs = options.minStartIntervalMs ?? 1_100;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }));
  }

  schedule<T>(
    run: (signal: AbortSignal) => Promise<T>,
    priority: EternalReturnRequestPriority = "interactive",
  ): Promise<T> {
    if (this.#stopped) return Promise.reject(new EternalReturnRequestQueueStoppedError());
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({
        sequence: this.#sequence++,
        priority,
        run,
        resolve,
        reject,
      } as QueuedRequest<unknown>);
      this.#startDrain();
    });
  }

  pauseFor(delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) return;
    this.#cooldownUntil = Math.max(this.#cooldownUntil, this.#now() + delayMs);
  }

  status(): EternalReturnRequestQueueStatus {
    return {
      active: Boolean(this.#activeController),
      queued: this.#pending.length,
      stopped: this.#stopped,
      cooldownUntil: this.#cooldownUntil,
      ...(this.#lastStartedAt === undefined ? {} : { lastStartedAt: this.#lastStartedAt }),
    };
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    const error = new EternalReturnRequestQueueStoppedError();
    for (const request of this.#pending.splice(0)) request.reject(error);
    this.#waitController?.abort(error);
    this.#activeController?.abort(error);
  }

  #startDrain(): void {
    if (this.#draining) return;
    this.#draining = true;
    void this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (!this.#stopped && this.#pending.length > 0) {
        await this.#waitUntilAllowed();
        if (this.#stopped) break;
        const request = this.#takeNext();
        if (!request) continue;
        const controller = new AbortController();
        this.#activeController = controller;
        this.#lastStartedAt = this.#now();
        try {
          request.resolve(await request.run(controller.signal));
        } catch (error: unknown) {
          request.reject(error);
        } finally {
          if (this.#activeController === controller) this.#activeController = undefined;
        }
      }
    } finally {
      this.#draining = false;
      if (!this.#stopped && this.#pending.length > 0) this.#startDrain();
    }
  }

  async #waitUntilAllowed(): Promise<void> {
    while (!this.#stopped) {
      const intervalUntil = this.#lastStartedAt === undefined
        ? 0
        : this.#lastStartedAt + this.#minStartIntervalMs;
      const waitMs = Math.max(intervalUntil, this.#cooldownUntil) - this.#now();
      if (waitMs <= 0) return;
      const controller = new AbortController();
      this.#waitController = controller;
      await this.#sleep(waitMs, controller.signal);
      if (this.#waitController === controller) this.#waitController = undefined;
    }
  }

  #takeNext(): QueuedRequest<unknown> | undefined {
    let bestIndex = 0;
    for (let index = 1; index < this.#pending.length; index += 1) {
      const candidate = this.#pending[index]!;
      const best = this.#pending[bestIndex]!;
      const priorityDifference = PRIORITY_ORDER[candidate.priority] - PRIORITY_ORDER[best.priority];
      if (priorityDifference < 0 || (priorityDifference === 0 && candidate.sequence < best.sequence)) {
        bestIndex = index;
      }
    }
    return this.#pending.splice(bestIndex, 1)[0];
  }
}

let sharedQueue = new EternalReturnRequestQueue();

export function getEternalReturnRequestQueue(): EternalReturnRequestQueue {
  return sharedQueue;
}

export function shutdownEternalReturnRequests(): void {
  sharedQueue.stop();
}

export function replaceEternalReturnRequestQueueForTesting(
  queue: EternalReturnRequestQueue,
): () => void {
  const previous = sharedQueue;
  sharedQueue = queue;
  return () => {
    queue.stop();
    sharedQueue = previous;
  };
}
