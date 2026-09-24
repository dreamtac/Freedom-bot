import type { Client } from "discord.js";

import { buildReceiptComponents, buildReceiptSummaryEmbed } from "../commands/eternal-return-receipt-formatters.js";
import type { EternalReturnReceiptBuilder, EternalReturnReceiptView } from "../services/eternal-return-receipt.js";
import type { EternalReturnReferences } from "../sources/eternal-return-reference.js";
import type { EternalReturnStore } from "../storage/eternal-return-store.js";

export interface EternalReturnReceiptMonitorResult {
  sent: number;
  failed: number;
}

interface EternalReturnReceiptMonitorOptions {
  client: Pick<Client, "channels">;
  store: Pick<EternalReturnStore,
    "claimNextPendingGameReceipt" | "markGameReceiptSent" | "markGameReceiptFailed"
    | "retryFailedGameReceipts" | "putGameReceiptDetails">;
  builder: Pick<EternalReturnReceiptBuilder, "build">;
  loadReferences: () => Promise<EternalReturnReferences>;
  maxPerCycle?: number;
  maxAttempts?: number;
  logger?: Pick<Console, "log" | "error">;
}

export class EternalReturnReceiptMonitor {
  readonly #client: EternalReturnReceiptMonitorOptions["client"];
  readonly #store: EternalReturnReceiptMonitorOptions["store"];
  readonly #builder: EternalReturnReceiptMonitorOptions["builder"];
  readonly #loadReferences: EternalReturnReceiptMonitorOptions["loadReferences"];
  readonly #maxPerCycle: number;
  readonly #maxAttempts: number;
  readonly #logger: Pick<Console, "log" | "error">;
  #active: Promise<EternalReturnReceiptMonitorResult> | undefined;

  constructor(options: EternalReturnReceiptMonitorOptions) {
    this.#client = options.client;
    this.#store = options.store;
    this.#builder = options.builder;
    this.#loadReferences = options.loadReferences;
    this.#maxPerCycle = Math.max(1, Math.min(10, options.maxPerCycle ?? 3));
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.#logger = options.logger ?? console;
  }

  start(): Promise<EternalReturnReceiptMonitorResult> {
    return this.checkNow();
  }

  checkNow(): Promise<EternalReturnReceiptMonitorResult> {
    if (this.#active) return this.#active;
    const request = this.#dispatch().finally(() => {
      if (this.#active === request) this.#active = undefined;
    });
    this.#active = request;
    return request;
  }

  async #dispatch(): Promise<EternalReturnReceiptMonitorResult> {
    this.#store.retryFailedGameReceipts(undefined, new Date(), this.#maxAttempts);
    let references: EternalReturnReferences | undefined;
    let sent = 0;
    let failed = 0;
    for (let index = 0; index < this.#maxPerCycle; index += 1) {
      const receipt = this.#store.claimNextPendingGameReceipt();
      if (!receipt) break;
      try {
        references ??= await this.#loadReferences();
        const view = await this.#builder.build(receipt.receiptId, references);
        this.#store.putGameReceiptDetails(receipt.receiptId, view);
        const channel = await this.#client.channels.fetch(receipt.channelId);
        if (!channel?.isSendable()) {
          throw new Error(`메시지를 전송할 수 없는 채널입니다: ${receipt.channelId}`);
        }
        const message = await channel.send({
          embeds: [buildReceiptSummaryEmbed(view)],
          components: buildReceiptComponents(view, receipt.receiptId),
        });
        this.#store.markGameReceiptSent(receipt.receiptId, message.id);
        sent += 1;
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        this.#store.markGameReceiptFailed(receipt.receiptId, message);
        this.#logger.error(`이터널 리턴 게임 결과 발송 실패 (${receipt.receiptId}, ${receipt.attemptCount}/${this.#maxAttempts})`, {
          name: error instanceof Error ? error.name : "UnknownError",
          message,
        });
        failed += 1;
      }
    }
    if (sent > 0) this.#logger.log(`이터널 리턴 게임 결과 ${sent}건을 전송했습니다.`);
    return { sent, failed };
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "알 수 없는 발송 오류";
  return message.slice(0, 500);
}

export type { EternalReturnReceiptView };
