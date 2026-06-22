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
  pageSize?: number;
}

export async function fetchEndfieldNews(
  options: FetchEndfieldOptions = {},
): Promise<NewsPost[]> {
  const fetcher = options.fetcher ?? fetch;
  const pageSize = options.pageSize ?? 20;
  const url = new URL(API_URL);
  url.searchParams.set("lang", "ko-kr");
  url.searchParams.set("code", APP_CODE);
  url.searchParams.set("page", "1");
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

  return parsed.data.list
    .filter((bulletin) => !HIDDEN_BULLETIN_IDS.has(bulletin.cid))
    .map((bulletin) => ({
      id: `endfield:${bulletin.cid}`,
      source: "명일방주: 엔드필드",
      category: bulletin.tab,
      title: bulletin.title,
      summary: bulletin.brief,
      publishedAt: new Date(bulletin.displayTime * 1_000),
      url: `${SITE_URL}/${bulletin.cid}`,
      ...(bulletin.cover ? { imageUrl: bulletin.cover } : {}),
    }));
}
