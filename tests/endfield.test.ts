import { describe, expect, it, vi } from "vitest";

import {
  fetchAllEndfieldNews,
  fetchEndfieldNews,
} from "../src/sources/endfield.js";

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
        sourceKey: "endfield",
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

  it("전체 공지 목록을 페이지 단위로 모두 가져온다", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const page = new URL(String(input)).searchParams.get("page");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              total: 3,
              list:
                page === "1"
                  ? [
                      createBulletin("1001", "첫 번째 공지"),
                      createBulletin("1002", "두 번째 공지"),
                    ]
                  : [createBulletin("1003", "세 번째 공지")],
            },
          }),
        ),
      );
    });

    await expect(
      fetchAllEndfieldNews({ fetcher, pageSize: 2 }),
    ).resolves.toMatchObject([
      { id: "endfield:1001", title: "첫 번째 공지" },
      { id: "endfield:1002", title: "두 번째 공지" },
      { id: "endfield:1003", title: "세 번째 공지" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function createBulletin(cid: string, title: string) {
  return {
    cid,
    tab: "notices",
    title,
    displayTime: 1_750_000_000,
    cover: "",
    brief: "공지 내용",
  };
}
