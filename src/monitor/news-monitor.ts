import type { Client } from "discord.js";

import { sendNewsPost } from "../notifications/discord-news.js";
import { fetchEndfieldNews } from "../sources/endfield.js";
import { NewsStore } from "../storage/news-store.js";

export interface NewsMonitorOptions {
  client: Client;
  channelId: string;
  intervalMs: number;
  databasePath: string;
  legacyStorePath: string;
}

export class NewsMonitor {
  readonly #client: Client;
  readonly #channelId: string;
  readonly #intervalMs: number;
  readonly #databasePath: string;
  readonly #legacyStorePath: string;
  #store: NewsStore | undefined;
  #timer: NodeJS.Timeout | undefined;
  #stopped = true;

  constructor(options: NewsMonitorOptions) {
    this.#client = options.client;
    this.#channelId = options.channelId;
    this.#intervalMs = options.intervalMs;
    this.#databasePath = options.databasePath;
    this.#legacyStorePath = options.legacyStorePath;
  }

  async start(): Promise<void> {
    if (!this.#stopped) {
      return;
    }

    this.#stopped = false;
    this.#store = await NewsStore.open(this.#databasePath);
    const imported = await this.#store.importLegacyJson(this.#legacyStorePath);
    if (imported > 0) {
      console.log(`기존 JSON 공지 ID ${imported}개를 SQLite로 이전했습니다.`);
    }
    await this.#runAndSchedule();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#store?.close();
    this.#store = undefined;
  }

  async #runAndSchedule(): Promise<void> {
    try {
      await this.checkNow();
    } catch (error: unknown) {
      console.error("게임 공지 확인에 실패했습니다.", error);
    }

    if (!this.#stopped) {
      this.#timer = setTimeout(
        () => void this.#runAndSchedule(),
        this.#intervalMs,
      );
    }
  }

  async checkNow(): Promise<void> {
    const posts = await fetchEndfieldNews();
    const store = this.#getStore();

    if (store.count() === 0) {
      store.upsert(posts, true);
      console.log(`기존 엔드필드 공지 ${posts.length}개를 기준 데이터로 저장했습니다.`);
      return;
    }

    store.upsert(posts);
    const pendingPosts = store.getPending("endfield");
    for (const post of pendingPosts) {
      await sendNewsPost(this.#client, this.#channelId, post);
      store.markNotified(post.id);
      console.log(`새 공지를 전송했습니다: ${post.title}`);
    }

    if (pendingPosts.length === 0) {
      console.log("새로운 엔드필드 공지가 없습니다.");
    }
  }

  #getStore(): NewsStore {
    if (!this.#store) {
      throw new Error("공지 데이터베이스가 열려 있지 않습니다.");
    }
    return this.#store;
  }
}
