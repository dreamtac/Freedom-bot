import { z } from "zod";

import type { NewsPost } from "./types.js";

const API_URL = "https://web-news.gryphline.com/api/bulletin";
const SITE_URL = "https://endfield.gryphline.com/ko-kr/news";
const APP_CODE = "arknights_endfield_official";
const HIDDEN_BULLETIN_IDS = new Set(["2664"]);

const bulletinSchema = z.object({
  cid: z.string().min(1),
  tab: z.string().min(1),
  title: z.string().min(1),
  displayTime: z.number().int().nonnegative(),
  cover: z.string().default(""),
  brief: z.string().default(""),
});

const responseSchema = z.object({
  code: z.number(),
  data: z.object({
    list: z.array(bulletinSchema),
    total: z.number().int().nonnegative(),
  }),
});

export interface FetchEndfieldOptions {
  fetcher?: typeof fetch;
  page?: number;
  pageSize?: number;
}

export async function fetchEndfieldNews(
  options: FetchEndfieldOptions = {},
): Promise<NewsPost[]> {
  return (await fetchEndfieldNewsPage(options)).posts;
}

export async function fetchAllEndfieldNews(
  options: FetchEndfieldOptions = {},
): Promise<NewsPost[]> {
  const pageSize = options.pageSize ?? 20;
  const firstPage = await fetchEndfieldNewsPage({
    ...options,
    page: 1,
    pageSize,
  });
  const posts = [...firstPage.posts];
  const totalPages = Math.ceil(firstPage.total / pageSize);

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchEndfieldNewsPage({
      ...options,
      page,
      pageSize,
    });
    if (nextPage.posts.length === 0) {
      break;
    }
    posts.push(...nextPage.posts);
  }

  return posts;
}

interface EndfieldNewsPage {
  posts: NewsPost[];
  total: number;
}

async function fetchEndfieldNewsPage(
  options: FetchEndfieldOptions = {},
): Promise<EndfieldNewsPage> {
  const fetcher = options.fetcher ?? fetch;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const url = new URL(API_URL);
  url.searchParams.set("lang", "ko-kr");
  url.searchParams.set("code", APP_CODE);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));

  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      "user-agent": "FreedomBot/0.1 (+game news notifier)",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`엔드필드 공지 요청 실패: HTTP ${response.status}`);
  }

  const parsed = responseSchema.parse(await response.json());
  if (parsed.code !== 0) {
    throw new Error(`엔드필드 CMS 오류 코드: ${parsed.code}`);
  }

  return {
    posts: parsed.data.list
      .filter((bulletin) => !HIDDEN_BULLETIN_IDS.has(bulletin.cid))
      .map((bulletin) => ({
        id: `endfield:${bulletin.cid}`,
        sourceKey: "endfield",
        source: "명일방주: 엔드필드",
        category: bulletin.tab,
        title: bulletin.title,
        summary: bulletin.brief,
        publishedAt: new Date(bulletin.displayTime * 1_000),
        url: `${SITE_URL}/${bulletin.cid}`,
        ...(bulletin.cover ? { imageUrl: bulletin.cover } : {}),
      })),
    total: parsed.data.total,
  };
}
