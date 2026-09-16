import type { EternalReturnCollector } from "../services/eternal-return-collector.js";
import type { EternalReturnStore } from "../storage/eternal-return-store.js";

export interface EternalReturnMonitorResult {
  users: number;
  succeeded: number;
  failed: number;
  storedGames: number;
}

interface EternalReturnMonitorOptions {
  store: Pick<EternalReturnStore, "listAutoRefreshUsers">;
  collector: Pick<EternalReturnCollector, "refreshUser">;
  intervalMs: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  logger?: Pick<Console, "log" | "error">;
}

export class EternalReturnMonitor {
  readonly #store: EternalReturnMonitorOptions["store"];
  readonly #collector: EternalReturnMonitorOptions["collector"];
  readonly #intervalMs: number;
  readonly #setTimer: typeof setTimeout;
  readonly #clearTimer: typeof clearTimeout;
  readonly #logger: Pick<Console, "log" | "error">;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #active: Promise<EternalReturnMonitorResult> | undefined;
  #stopped = true;

  constructor(options: EternalReturnMonitorOptions) {
    this.#store = options.store;
    this.#collector = options.collector;
    this.#intervalMs = options.intervalMs;
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
    this.#logger = options.logger ?? console;
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    await this.#runAndSchedule();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
    await this.#active;
  }

  checkNow(): Promise<EternalReturnMonitorResult> {
    if (this.#active) return this.#active;
    const request = this.#checkUsers().finally(() => {
      if (this.#active === request) this.#active = undefined;
    });
    this.#active = request;
    return request;
  }

  async #runAndSchedule(): Promise<void> {
    try {
      const result = await this.checkNow();
      if (result.users > 0) {
        this.#logger.log(
          `이터널 리턴 자동 갱신: ${result.succeeded}/${result.users}명 성공, 새 경기 ${result.storedGames}개`,
        );
      }
    } catch (error: unknown) {
      this.#logger.error("이터널 리턴 자동 갱신을 실행하지 못했습니다.", error);
    }
    if (!this.#stopped) {
      this.#timer = this.#setTimer(() => void this.#runAndSchedule(), this.#intervalMs);
    }
  }

  async #checkUsers(): Promise<EternalReturnMonitorResult> {
    const users = this.#store.listAutoRefreshUsers();
    let succeeded = 0;
    let failed = 0;
    let storedGames = 0;
    for (const user of users) {
      try {
        const result = await this.#collector.refreshUser(user.userId, "refresh");
        succeeded += 1;
        storedGames += result.storedGames;
      } catch (error: unknown) {
        failed += 1;
        this.#logger.error(`이터널 리턴 자동 갱신 실패: ${user.nickname} (${user.userId})`, error);
      }
    }
    return { users: users.length, succeeded, failed, storedGames };
  }
}
