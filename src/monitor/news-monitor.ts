import type { Client } from "discord.js";

import { sendNewsPost } from "../notifications/discord-news.js";
import { fetchEndfieldNews } from "../sources/endfield.js";
import type { NewsPost } from "../sources/types.js";
import { SeenPostStore } from "../storage/seen-post-store.js";

export interface NewsMonitorOptions {
  client: Client;
  channelId: string;
  intervalMs: number;
  storePath: string;
}

export class NewsMonitor {
  readonly #client: Client;
  readonly #channelId: string;
  readonly #intervalMs: number;
  readonly #store: SeenPostStore;
  #timer: NodeJS.Timeout | undefined;
  #stopped = true;

  constructor(options: NewsMonitorOptions) {
    this.#client = options.client;
    this.#channelId = options.channelId;
    this.#intervalMs = options.intervalMs;
    this.#store = new SeenPostStore(options.storePath);
  }

  async start(): Promise<void> {
    if (!this.#stopped) {
      return;
    }

    this.#stopped = false;
    await this.#store.load();
    await this.#runAndSchedule();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
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

    if (this.#store.isEmpty()) {
      await this.#store.add(posts.map((post) => post.id));
      console.log(`기존 엔드필드 공지 ${posts.length}개를 기준 데이터로 저장했습니다.`);
      return;
    }

    const unseenPosts = findUnseenPosts(posts, (id) => this.#store.has(id));
    for (const post of unseenPosts) {
      await sendNewsPost(this.#client, this.#channelId, post);
      await this.#store.add([post.id]);
      console.log(`새 공지를 전송했습니다: ${post.title}`);
    }

    if (unseenPosts.length === 0) {
      console.log("새로운 엔드필드 공지가 없습니다.");
    }
  }
}

export function findUnseenPosts(
  posts: readonly NewsPost[],
  hasSeen: (id: string) => boolean,
): NewsPost[] {
  return posts
    .filter((post) => !hasSeen(post.id))
    .sort((left, right) => left.publishedAt.getTime() - right.publishedAt.getTime());
}
