import { it as test, afterEach, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  erGet, getRecentGamesByNickname, getRankByNickname, getGamesByUserId,
  getUserIdByNickname, getGameResults, getFreeCharacters,
} from "../src/sources/eternal-return.js";
import { getReferenceData as loadReferenceData, createEmptyReferenceData } from "../src/sources/eternal-return-reference.js";
import { buildRecentGamesEmbed, buildRankEmbed, buildFreeCharactersEmbed } from "../src/commands/eternal-return-formatters.js";
import {
  EternalReturnRequestQueue,
  replaceEternalReturnRequestQueueForTesting,
} from "../src/sources/eternal-return-request-queue.js";


const originalFetch = global.fetch;
let restoreQueue: (() => void) | undefined;
beforeEach(() => {
  let now = 0;
  restoreQueue = replaceEternalReturnRequestQueueForTesting(new EternalReturnRequestQueue({
    minStartIntervalMs: 0,
    now: () => now,
    sleep: async ms => { now += ms; },
  }));
});
afterEach(() => {
  global.fetch = originalFetch;
  restoreQueue?.();
});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const key = "test-key-not-a-real-secret";
const nickname = "테스트 & 친구";
const game = {
  gameId: 123, matchingMode: 3, matchingTeamMode: 3, characterNum: 1,
  gameRank: 2, playerKill: 3, playerAssistant: 4, playerDeaths: 0,
  teamKill: 7, damageToPlayer: 12345, damageFromPlayer: 6789,
  healAmount: 100, monsterKill: 20, playTime: 601, mmrGain: 15,
  equipment: { 0: 101 }, traitFirstCore: 201, placeOfStart: 10,
};

test("documented uid response supports nickname → recent matches and encodes URL values", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers["x-api-key"], key);
    return calls.length === 1
      ? json({ code: 200, user: { uid: "uid/a+b", nickname } })
      : json({ code: 200, userGames: [game] });
  };
  const result = await getRecentGamesByNickname(nickname, key);
  assert.deepEqual(getGameResults(result), [game]);
  assert.deepEqual(calls, [
    `https://open-api.bser.io/v1/user/nickname?query=${encodeURIComponent(nickname)}`,
    "https://open-api.bser.io/v1/user/games/uid/uid%2Fa%2Bb",
  ]);
});

test("user game pagination sends the returned next value as an encoded query", async () => {
  global.fetch = async (url) => {
    assert.equal(url, "https://open-api.bser.io/v1/user/games/uid/uid%2Fa?next=cursor%2B1");
    return json({ code: 200, userGames: [], next: "next-2" });
  };
  const result = await getGamesByUserId("uid/a", key, { next: "cursor+1", priority: "backfill" });
  assert.equal(result.next, "next-2");
});

test("simultaneous recent-match lookups for one nickname share UID and game requests", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    await Promise.resolve();
    return calls === 1
      ? json({ code: 200, user: { uid: "shared-uid" } })
      : json({ code: 200, userGames: [game] });
  };
  const [first, second] = await Promise.all([
    getRecentGamesByNickname(nickname, key),
    getRecentGamesByNickname(` ${nickname} `, key),
  ]);
  assert.equal(first, second);
  assert.equal(calls, 2);
});

test("documented uid response supports nickname → season rank", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return calls.length === 1 ? json({ code: 200, user: { uid: "sample-uid" } })
      : json({ code: 200, userRank: { mmr: 3933, rank: 11 } });
  };
  const data = await getRankByNickname(nickname, 33, key);
  assert.equal(data.userRank.mmr, 3933);
  assert.equal(calls[1], "https://open-api.bser.io/v1/rank/uid/sample-uid/33/3");
});

test("legacy userId response remains readable", async () => {
  global.fetch = async () => json({ code: 200, user: { userId: "legacy-id" } });
  assert.equal(await getUserIdByNickname(nickname, key), "legacy-id");
});

test("missing nickname stops before requesting matches", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return json({ code: 404, message: "Not found" }); };
  await assert.rejects(getRecentGamesByNickname(nickname, key), /사용자를 찾지 못했습니다/);
  assert.equal(calls, 1);
});

test("HTTP 403 produces an actionable authentication error", async () => {
  global.fetch = async () => json({ message: "Forbidden" }, 403);
  await assert.rejects(erGet("/test", key), /API 접근이 거부/);
});

test("application errors are not treated as successful data", async () => {
  global.fetch = async () => json({ code: 500, message: "Service unavailable" });
  await assert.rejects(erGet("/test", key), /코드 500/);
});

test("HTTP 429 retries and recovers", async () => {
  let calls = 0;
  global.fetch = async () => ++calls === 1
    ? json({ message: "Rate limited" }, 429, { "retry-after": "0" })
    : json({ code: 200, data: [] });
  assert.equal((await erGet("/test", key)).code, 200);
  assert.equal(calls, 2);
});

test("HTTP 403 with retry-after is treated as a shared rate limit and retries", async () => {
  let calls = 0;
  global.fetch = async () => ++calls === 1
    ? json({ message: "Rate limited" }, 403, { "retry-after": "0" })
    : json({ code: 200, data: [] });
  assert.equal((await erGet("/test", key)).code, 200);
  assert.equal(calls, 2);
});

test("persistent HTTP 429 stops after four attempts", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return json({}, 429, { "retry-after": "0" }); };
  await assert.rejects(erGet("/test", key), /요청이 많습니다/);
  assert.equal(calls, 4);
});

test("free character response is forwarded to the caller", async () => {
  global.fetch = async (url) => {
    assert.equal(url, "https://open-api.bser.io/v1/freeCharacters/2");
    return json({ code: 200, freeCharacters: [1, 2] });
  };
  assert.deepEqual(await getFreeCharacters(2, key), [1, 2]);
});

test("v2 reference tables and downloaded Korean names render in match summaries", async () => {
  const tables = [];
  global.fetch = async (url, options) => {
    if (url === "https://example.test/korean.txt") {
      assert.equal(options?.headers, undefined);
      assert.ok(options?.signal);
      return new Response("Character/Name/1┃재키\r\nItem/Name/101┃시험 무기\nTrait/Name/201┃시험 특성\nArea/Name/Harbor┃항구");
    }
    assert.equal(options.headers["x-api-key"], key);
    if (url.endsWith("/v1/l10n/Korean")) {
      return json({ code: 200, data: { l10Path: "https://example.test/korean.txt" } });
    }
    assert.match(url, /\/v2\/data\//);
    tables.push(url.split("/").at(-1));
    return json({ code: 200, data: [] });
  };
  const [references, shared] = await Promise.all([loadReferenceData(key), loadReferenceData(key)]);
  assert.equal(references, shared);
  assert.equal(await loadReferenceData(key), references);
  assert.deepEqual(tables, ["hash", "Character", "Area", "Trait", "ItemWeapon", "ItemArmor", "Season"]);
  const embed = buildRecentGamesEmbed(nickname, [game], references).toJSON();
  assert.match(embed.fields[0].name, /#2.*재키/);
  assert.match(embed.fields[0].value, /피해 12,345/);
  assert.match(embed.fields[0].value, /K\/A\/D 3\/4\/0/);
  assert.match(embed.fields[0].value, /시험 무기/);
  assert.match(embed.fields[0].value, /시험 특성/);
  assert.match(embed.fields[0].value, /항구/);
});

test("empty and partial match data render without crashing; results are capped at five", () => {
  const references = createEmptyReferenceData();
  assert.match(buildRecentGamesEmbed(nickname, [], references).toJSON().description, /찾지 못했습니다/);
  const embed = buildRecentGamesEmbed(nickname, Array.from({ length: 8 }, () => ({})), references).toJSON();
  assert.equal(embed.fields.length, 5);
  assert.match(embed.fields[0].value, /피해 -/);
});

test("rank and free-character embeds support empty results", () => {
  assert.match(buildRankEmbed(nickname, undefined).toJSON().description, /찾지 못했습니다/);
  const rank = buildRankEmbed(nickname, { mmr: 0, rank: 11 }).toJSON();
  assert.equal(rank.fields[0].value, "0");
  assert.equal(rank.fields[1].value, "11");
  const references = createEmptyReferenceData();
  assert.match(buildFreeCharactersEmbed("일반", [], references).toJSON().description, /찾지 못했습니다/);
  assert.equal(buildFreeCharactersEmbed("일반", [1, 2], references).toJSON().description, "1, 2");
});
