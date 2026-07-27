import type { Client } from "discord.js";

import {
  sendStockMasterRefreshFailure,
  sendStockMasterRefreshSummary,
} from "../notifications/discord-stock-master.js";
import type { DomesticStockEntry } from "../sources/domestic-stocks.js";
import type { OverseasStockEntry } from "../sources/overseas-stocks.js";
import type { StockMasterSyncResult } from "../storage/stock-store.js";
import type { StockStore } from "../storage/stock-store.js";
import { fetchDomesticStocks } from "../update-domestic-stocks.js";
import { fetchOverseasStocks } from "../update-overseas-stocks.js";

const RETRY_DELAY_MS = 60 * 60 * 1_000;

interface StockMasterSource {
  fetchDomesticStocks(): Promise<DomesticStockEntry[]>;
  fetchOverseasStocks(): Promise<OverseasStockEntry[]>;
}

export interface StockMasterMonitorOptions {
  store: StockStore;
  intervalMs: number;
  client?: Client;
  channelId?: string;
  source?: StockMasterSource;
}

export interface StockMasterRefreshResult {
  domestic: StockMasterSyncResult;
  overseas: StockMasterSyncResult;
}

export class StockMasterMonitor {
  readonly #store: StockStore;
  readonly #intervalMs: number;
  readonly #client: Client | undefined;
  readonly #channelId: string | undefined;
  readonly #source: StockMasterSource;
  #timer: NodeJS.Timeout | undefined;
  #stopped = true;

  constructor({ store, intervalMs, client, channelId, source }: StockMasterMonitorOptions) {
    this.#store = store;
    this.#intervalMs = intervalMs;
    this.#client = client;
    this.#channelId = channelId;
    this.#source = source ?? { fetchDomesticStocks, fetchOverseasStocks };
  }

  start(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    void this.#runAndSchedule(0);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  async refreshNow(): Promise<StockMasterRefreshResult> {
    const [domesticStocks, overseasStocks] = await Promise.all([
      this.#source.fetchDomesticStocks(),
      this.#source.fetchOverseasStocks(),
    ]);
    const result = {
      domestic: this.#store.syncDomesticStocks(domesticStocks, "krx-kind"),
      overseas: this.#store.syncOverseasStocks(overseasStocks, "kis-overseas-master"),
    };
    console.log(
      `종목 마스터 갱신 완료: 국내 +${result.domestic.added}/-${result.domestic.removed}, 미국 +${result.overseas.added}/-${result.overseas.removed}`,
    );
    if (hasChanges(result)) {
      await this.#sendSummary(result);
    }
    return result;
  }

  async #runAndSchedule(delayMs: number): Promise<void> {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          resolve();
        }, delayMs);
      });
    }
    if (this.#stopped) {
      return;
    }

    let nextDelay = this.#intervalMs;
    try {
      await this.refreshNow();
    } catch (error: unknown) {
      console.error("종목 마스터 갱신에 실패했습니다.", error);
      await this.#sendFailure(error);
      nextDelay = Math.min(this.#intervalMs, RETRY_DELAY_MS);
    }

    if (!this.#stopped) {
      void this.#runAndSchedule(nextDelay);
    }
  }

  async #sendSummary(result: StockMasterRefreshResult): Promise<void> {
    if (!this.#client || !this.#channelId) {
      return;
    }
    try {
      await sendStockMasterRefreshSummary(this.#client, this.#channelId, result);
    } catch (error: unknown) {
      console.error("종목 마스터 갱신 알림 전송에 실패했습니다.", error);
    }
  }

  async #sendFailure(error: unknown): Promise<void> {
    if (!this.#client || !this.#channelId) {
      return;
    }
    try {
      await sendStockMasterRefreshFailure(this.#client, this.#channelId, error);
    } catch (notificationError: unknown) {
      console.error("종목 마스터 갱신 실패 알림 전송에 실패했습니다.", notificationError);
    }
  }
}

function hasChanges(result: StockMasterRefreshResult): boolean {
  return (
    (!result.domestic.initial &&
      (result.domestic.added > 0 || result.domestic.removed > 0)) ||
    (!result.overseas.initial &&
      (result.overseas.added > 0 || result.overseas.removed > 0))
  );
}
