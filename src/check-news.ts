import { fetchEndfieldNews } from "./sources/endfield.js";

const posts = await fetchEndfieldNews({ pageSize: 5 });

for (const post of posts) {
  console.log(
    `[${post.publishedAt.toISOString()}] ${post.category} | ${post.title}\n${post.url}`,
  );
}
