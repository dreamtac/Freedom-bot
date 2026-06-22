import { describe, expect, it } from "vitest";

import { findUnseenPosts } from "../src/monitor/news-monitor.js";
import type { NewsPost } from "../src/sources/types.js";

describe("findUnseenPosts", () => {
  it("처음 보는 공지만 오래된 순서로 반환한다", () => {
    const posts: NewsPost[] = [
      createPost("newer", "2026-06-22T10:00:00Z"),
      createPost("seen", "2026-06-21T10:00:00Z"),
      createPost("older", "2026-06-20T10:00:00Z"),
    ];

    expect(findUnseenPosts(posts, (id) => id === "seen").map((post) => post.id))
      .toEqual(["older", "newer"]);
  });
});

function createPost(id: string, publishedAt: string): NewsPost {
  return {
    id,
    source: "test",
    category: "notices",
    title: id,
    summary: "summary",
    publishedAt: new Date(publishedAt),
    url: "https://example.com",
  };
}
