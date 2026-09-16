import "dotenv/config";

import { readEternalReturnConfig } from "./features/eternal-return-policy.js";

async function checkEternalReturn(): Promise<void> {
  const { erEnabled, erApiKey: apiKey } = readEternalReturnConfig(process.env);
  if (!erEnabled) throw new Error("이터널 리턴 기능이 비활성화되어 있습니다. 개발 환경에서 ER_ENABLED=true로 설정해 주세요.");
  const nickname = process.argv[2]?.trim();
  if (!apiKey) throw new Error(".env에 ER_API_KEY를 설정해 주세요.");
  if (!nickname) throw new Error("사용법: npm run check:eternal-return -- 게임닉네임");

  const { getFreeCharacters, getGameResults, getRankByNickname, getRecentGamesByNickname } = await import("./sources/eternal-return.js");
  const { getReferenceData } = await import("./sources/eternal-return-reference.js");
  const { buildRecentGamesEmbed } = await import("./commands/eternal-return-formatters.js");

  const data = await getRecentGamesByNickname(nickname, apiKey);
  const games = getGameResults(data);
  const references = await getReferenceData(apiKey);
  const embed = buildRecentGamesEmbed(nickname, games.slice(0, 3), references).toJSON();
  console.log(`${nickname}: 최근 ${games.length}경기 조회 성공`);
  for (const field of embed.fields ?? []) {
    console.log(`${field.name}\n${field.value}\n`);
  }

  const season = games.find(game => game.matchingMode === 3 && (game.seasonId ?? 0) > 0)?.seasonId;
  if (season) {
    const data = await getRankByNickname(nickname, season, apiKey);
    console.log(`API 시즌 ${season} 랭크: ${data.userRank?.mmr ?? "기록 없음"}`);
  }
  const characters = await getFreeCharacters(2, apiKey);
  console.log(`일반 무료 캐릭터: ${[...new Set(characters.map(code => references.characterName(code)))].join(", ") || "없음"}`);
  console.log("이터널 리턴 API 및 메시지 생성 확인 완료 (Discord 메시지는 전송하지 않음)");
}

checkEternalReturn().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "이터널 리턴 API 확인에 실패했습니다.");
  process.exitCode = 1;
});
