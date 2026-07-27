import { resolve } from "node:path";

import { NewsStore } from "./storage/news-store.js";

const store = await NewsStore.open(resolve(".data", "freedom-bot.sqlite"));

try {
  const posts = store.listRecent(20);
  if (posts.length === 0) {
    console.log("저장된 공지가 없습니다. 봇을 한 번 실행해 주세요.");
  }

  for (const post of posts) {
    const notified = post.notifiedAt ? "알림 완료" : "알림 대기";
    console.log(
      `${formatDate(post.publishedAt)} | ${notified} | ${post.id}\n${post.title || "(이전된 공지 ID)"}\n${post.url}\n`,
    );
  }
} finally {
  store.close();
}

function formatDate(date: Date): string {
  if (date.getTime() === 0) {
    return "날짜 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}
