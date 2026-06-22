import { describe, expect, it, vi } from "vitest";

import { fetchEndfieldNews } from "../src/sources/endfield.js";

describe("fetchEndfieldNews", () => {
  it("CMS 공지를 공통 뉴스 형식으로 변환한다", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            total: 1,
            list: [
              {
                cid: "0123",
                tab: "notices",
                title: "테스트 공지",
                displayTime: 1_750_000_000,
                cover: "https://example.com/cover.jpg",
                brief: "공지 내용",
              },
            ],
          },
        }),
      ),
    );

    await expect(fetchEndfieldNews({ fetcher })).resolves.toEqual([
      {
        id: "endfield:0123",
        source: "명일방주: 엔드필드",
        category: "notices",
        title: "테스트 공지",
        summary: "공지 내용",
        publishedAt: new Date(1_750_000_000_000),
        url: "https://endfield.gryphline.com/ko-kr/news/0123",
        imageUrl: "https://example.com/cover.jpg",
      },
    ]);
  });
});
