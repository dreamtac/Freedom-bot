import type { EternalReturnCollector } from "../services/eternal-return-collector.js";
import type {
  EternalReturnGameReceiptInput,
  EternalReturnReceiptPlayerInput,
  EternalReturnStore,
} from "../storage/eternal-return-store.js";

export interface EternalReturnMonitorResult {
  users: number;
  succeeded: number;
  failed: number;
  storedGames: number;
  queuedReceipts: number;
}

interface EternalReturnMonitorOptions {
  store: Pick<EternalReturnStore,
    "listAutoRefreshUsers" | "listReceiptEnabledUsers" | "listUnqueuedReceiptGames"
    | "enqueueGameReceiptBatch" | "getUser" | "setAutoRefresh" | "countGames" | "getCollectionState">;
  collector: Pick<EternalReturnCollector, "refreshNickname" | "backfill">;
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
          `이터널 리턴 자동 갱신: ${result.succeeded}/${result.users}명 성공, `
          + `새 경기 ${result.storedGames}개, 게임 결과 ${result.queuedReceipts}개 대기`,
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
    const usersByNickname = new Map<string, typeof users>();
    for (const user of users) {
      const key = normalizeNickname(user.nickname);
      const group = usersByNickname.get(key) ?? [];
      group.push(user);
      usersByNickname.set(key, group);
    }
    let succeeded = 0;
    let failed = 0;
    let storedGames = 0;
    for (const group of usersByNickname.values()) {
      const user = group[0]!;
      try {
        const result = await this.#collector.refreshNickname(user.nickname, "refresh");
        if (result.userId !== user.userId || group.length > 1) {
          this.#store.setAutoRefresh(result.userId, true);
          for (const previous of group) {
            if (previous.userId !== result.userId && this.#store.getUser(previous.userId)) {
              this.#store.setAutoRefresh(previous.userId, false);
            }
          }
          this.#logger.log(`이터널 리턴 자동 갱신 UID 연결 갱신: ${user.nickname}`);
        }
        storedGames += result.storedGames;
        const backfill = this.#store.getCollectionState(result.userId, "backfill");
        if (this.#store.countGames(result.userId) < 100 && backfill?.cursor) {
          const backfillResult = await this.#collector.backfill(result.userId, { targetGames: 100 });
          storedGames += backfillResult.storedGames;
        }
        succeeded += 1;
      } catch (error: unknown) {
        failed += 1;
        this.#logger.error(`이터널 리턴 자동 갱신 실패: ${user.nickname} (${user.userId})`, error);
      }
    }
    const queuedReceipts = this.#queueDetectedGames();
    return { users: usersByNickname.size, succeeded, failed, storedGames, queuedReceipts };
  }

  #queueDetectedGames(): number {
    const grouped = new Map<string, {
      input: EternalReturnGameReceiptInput;
      players: Map<string, EternalReturnReceiptPlayerInput>;
    }>();
    for (const user of this.#store.listReceiptEnabledUsers()) {
      if (!user.receiptChannelId) continue;
      for (const game of this.#store.listUnqueuedReceiptGames(user.userId, user.receiptChannelId)) {
        const key = `${user.receiptChannelId}\0${game.gameId}`;
        let group = grouped.get(key);
        if (!group) {
          const players = new Map<string, EternalReturnReceiptPlayerInput>();
          group = {
            input: {
              channelId: user.receiptChannelId,
              gameId: game.gameId,
              detectedAt: game.collectedAt,
              players: [],
            },
            players,
          };
          grouped.set(key, group);
        } else if (game.collectedAt < (group.input.detectedAt ?? game.collectedAt)) {
          group.input.detectedAt = game.collectedAt;
        }
        group.players.set(user.userId, {
          userId: user.userId,
          nickname: user.nickname,
          ...(game.teamNumber !== undefined ? { teamNumber: game.teamNumber } : {}),
          isMonitored: true,
        });
      }
    }
    const inputs = [...grouped.values()].map(group => ({
      ...group.input,
      players: [...group.players.values()],
    }));
    return inputs.length === 0 ? 0 : this.#store.enqueueGameReceiptBatch(inputs);
  }
}

function normalizeNickname(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
}
