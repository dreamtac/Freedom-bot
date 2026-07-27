import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { NewsPost } from "../sources/types.js";

interface NewsPostRow {
  id: string;
  source_key: string;
  source_name: string;
  category: string;
  title: string;
  summary: string;
  url: string;
  image_url: string | null;
  published_at: number;
  first_seen_at: number;
  notified_at: number | null;
}

interface LegacyStoreData {
  version: 1;
  seenPostIds: string[];
}

export interface StoredNewsPost extends NewsPost {
  firstSeenAt: Date;
  notifiedAt?: Date;
}

export class NewsStore {
  readonly #database: Database.Database;

  private constructor(database: Database.Database) {
    this.#database = database;
    this.#migrate();
  }

  static async open(filePath: string): Promise<NewsStore> {
    await mkdir(dirname(filePath), { recursive: true });
    const database = new Database(filePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new NewsStore(database);
  }

  close(): void {
    this.#database.close();
  }

  count(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM news_posts")
      .get() as { count: number };
    return row.count;
  }

  upsert(posts: readonly NewsPost[], markAsNotified = false): void {
    const now = Date.now();
    const statement = this.#database.prepare(`
      INSERT INTO news_posts (
        id, source_key, source_name, external_id, category, title, summary,
        url, image_url, published_at, first_seen_at, notified_at
      ) VALUES (
        @id, @sourceKey, @sourceName, @externalId, @category, @title, @summary,
        @url, @imageUrl, @publishedAt, @firstSeenAt, @notifiedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        source_key = excluded.source_key,
        source_name = excluded.source_name,
        external_id = excluded.external_id,
        category = excluded.category,
        title = excluded.title,
        summary = excluded.summary,
        url = excluded.url,
        image_url = excluded.image_url,
        published_at = excluded.published_at
    `);

    const transaction = this.#database.transaction(() => {
      for (const post of posts) {
        statement.run({
          id: post.id,
          sourceKey: post.sourceKey,
          sourceName: post.source,
          externalId: getExternalId(post.id),
          category: post.category,
          title: post.title,
          summary: post.summary,
          url: post.url,
          imageUrl: post.imageUrl ?? null,
          publishedAt: post.publishedAt.getTime(),
          firstSeenAt: now,
          notifiedAt: markAsNotified ? now : null,
        });
      }
    });
    transaction();
  }

  getPending(sourceKey: string): StoredNewsPost[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM news_posts
         WHERE source_key = ? AND notified_at IS NULL
         ORDER BY published_at ASC, first_seen_at ASC`,
      )
      .all(sourceKey) as NewsPostRow[];
    return rows.map(toStoredNewsPost);
  }

  markNotified(postId: string, notifiedAt = new Date()): void {
    this.#database
      .prepare("UPDATE news_posts SET notified_at = ? WHERE id = ?")
      .run(notifiedAt.getTime(), postId);
  }

  listRecent(limit = 20): StoredNewsPost[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM news_posts
         ORDER BY published_at DESC, first_seen_at DESC
         LIMIT ?`,
      )
      .all(limit) as NewsPostRow[];
    return rows.map(toStoredNewsPost);
  }

  async importLegacyJson(filePath: string): Promise<number> {
    let data: LegacyStoreData;
    try {
      data = JSON.parse(await readFile(filePath, "utf8")) as LegacyStoreData;
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        return 0;
      }
      throw error;
    }

    const now = Date.now();
    const statement = this.#database.prepare(`
      INSERT OR IGNORE INTO news_posts (
        id, source_key, source_name, external_id, category, title, summary,
        url, image_url, published_at, first_seen_at, notified_at
      ) VALUES (?, ?, ?, ?, 'unknown', '', '', '', NULL, 0, ?, ?)
    `);
    let imported = 0;
    const transaction = this.#database.transaction(() => {
      for (const id of data.seenPostIds) {
        const sourceKey = getSourceKey(id);
        const result = statement.run(
          id,
          sourceKey,
          sourceKey,
          getExternalId(id),
          now,
          now,
        );
        imported += result.changes;
      }
    });
    transaction();
    return imported;
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS news_posts (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        source_name TEXT NOT NULL,
        external_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT NOT NULL,
        image_url TEXT,
        published_at INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL,
        notified_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_news_posts_source_external
        ON news_posts(source_key, external_id);

      CREATE INDEX IF NOT EXISTS idx_news_posts_pending
        ON news_posts(source_key, notified_at, published_at);
    `);
  }
}

function toStoredNewsPost(row: NewsPostRow): StoredNewsPost {
  return {
    id: row.id,
    sourceKey: row.source_key,
    source: row.source_name,
    category: row.category,
    title: row.title,
    summary: row.summary,
    publishedAt: new Date(row.published_at),
    url: row.url,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    firstSeenAt: new Date(row.first_seen_at),
    ...(row.notified_at ? { notifiedAt: new Date(row.notified_at) } : {}),
  };
}

function getSourceKey(id: string): string {
  return id.includes(":") ? id.slice(0, id.indexOf(":")) : "unknown";
}

function getExternalId(id: string): string {
  return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
