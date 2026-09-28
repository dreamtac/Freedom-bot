import { erGet } from "./eternal-return.js";
import type {
  EternalReturnRequestOptions,
  ReferenceRow,
} from "./eternal-return.js";
import type { EternalReturnStore } from "../storage/eternal-return-store.js";

export interface EternalReturnReferences {
  characterName(code: unknown): string;
  itemName(code: unknown): string;
  areaName(value: unknown): string;
  traitName(code: unknown): string;
  tacticalSkillName(code: unknown): string;
  gadgetName(code: unknown): string;
  installationName(code: unknown): string;
  skillName(code: unknown): string;
}

interface ReferenceInput {
  characters: ReferenceRow[];
  items: ReferenceRow[];
  areas: ReferenceRow[];
  traits: ReferenceRow[];
  l10n: Map<string, string>;
}


const ITEM_META_TYPES = [
  "ItemWeapon",
  "ItemArmor",
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REFERENCE_CACHE_TYPE = "reference-bundle";
const REFERENCE_CACHE_KEY = "Korean";

export interface EternalReturnSeason extends ReferenceRow {
  seasonID?: number;
  seasonName?: string;
  seasonStart?: string;
  seasonEnd?: string;
  isCurrent?: number;
}

interface StoredReferenceBundle {
  hash: unknown;
  characters: ReferenceRow[];
  items: ReferenceRow[];
  areas: ReferenceRow[];
  traits: ReferenceRow[];
  seasons: EternalReturnSeason[];
  l10n: Array<[string, string]>;
}

const LEGACY_AREA_NAMES: Record<number, string> = {
  10: "Harbor",
  20: "Warehouse",
  30: "Pond",
  40: "Stream",
  50: "SandyBeach",
  60: "Uptown",
  70: "Alley",
  80: "GasStation",
  90: "Hotel",
  100: "PoliceStation",
  110: "FireStation",
  120: "Hospital",
  130: "Temple",
  140: "Archery",
  150: "Cemetery",
  160: "Forest",
  170: "Factory",
  180: "Church",
  190: "School",
};

const GADGET_NAMES: Readonly<Record<number, string>> = {
  8_300_101: "키오스크 호출기",
  8_300_201: "휴대용 VLS",
  8_300_301: "사냥꾼의 솥단지",
  8_300_401: "ORB - 감시",
  8_310_201: "키트 - 강풍지대",
  8_310_301: "휴대용 안전지대",
  8_310_501: "CNOT 게이트",
};

const LEGACY_TACTICAL_SKILL_SET_CODES: Readonly<Record<number, number>> = {
  30: 500121,
  40: 500131,
  50: 500141,
  60: 500151,
  70: 500161,
  80: 500171,
  90: 500181,
  110: 500191,
  120: 500201,
  130: 500211,
  150: 500231,
  160: 500251,
  170: 500261,
  190: 500281,
};

const TACTICAL_SKILL_NAMES: Readonly<Record<number, string>> = {
  30: "블링크", 40: "퀘이크", 50: "프로토콜 위반", 60: "붉은 폭풍",
  70: "초월", 80: "아티팩트", 90: "무효화", 110: "강한 결속",
  120: "스트라이더 - A13", 130: "진실의 칼날", 150: "치유의 바람",
  160: "리펄서 미사일", 170: "플라즈마 대시", 190: "라이트 윙",
  500010: "블레싱: 명상", 500020: "중력장", 500030: "롤링썬더", 500040: "폭진",
  500050: "블링크", 500060: "기원", 500070: "대지분쇄", 500080: "힘껏 펀치",
  500090: "메테오", 500100: "라이트닝 쉴드", 500110: "블레싱: 명상",
  500120: "블링크", 500130: "퀘이크", 500140: "프로토콜 위반",
  500150: "붉은 폭풍", 500160: "초월", 500170: "아티팩트", 500180: "무효화",
  500190: "강한 결속", 500200: "스트라이더 - A13", 500210: "진실의 칼날",
  500220: "거짓 서약", 500230: "치유의 바람", 500240: "부착",
  500250: "리펄서 미사일", 500260: "플라즈마 대시", 500270: "쇠약",
  500280: "라이트 윙",
};

export function tacticalSkillFallbackName(code: unknown): string | undefined {
  const numericCode = Number(code);
  return Number.isSafeInteger(numericCode) ? TACTICAL_SKILL_NAMES[numericCode] : undefined;
}

function parseL10n(text: string) {
  const map = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    if (!line || !line.includes("┃")) {
      continue;
    }

    const [key, ...valueParts] = line.split("┃");
    const value = valueParts.join("┃").trim();

    if (key && value) {
      map.set(key.trim(), value);
    }
  }

  return map;
}

function indexByCode(rows: ReferenceRow[]) {
  const map = new Map<number, ReferenceRow>();

  for (const row of rows || []) {
    if (row?.code !== undefined) {
      map.set(Number(row.code), row);
    }
  }

  return map;
}

function indexAreas(rows: ReferenceRow[]) {
  const byCode = new Map<number, ReferenceRow>();
  const byMaskCode = new Map<number, ReferenceRow>();

  for (const row of rows || []) {
    if (row?.code !== undefined) {
      byCode.set(Number(row.code), row);
    }

    if (row?.maskCode !== undefined) {
      byMaskCode.set(Number(row.maskCode), row);
    }
  }

  return { byCode, byMaskCode };
}

async function fetchDataTable(
  apiKey: string,
  metaType: string,
  options: EternalReturnRequestOptions,
) {
  const data = await erGet(`/v2/data/${metaType}`, apiKey, options);
  if (!Array.isArray(data.data)) throw new Error(`Invalid Eternal Return table: ${metaType}`);
  return data.data;
}

async function loadL10n(
  apiKey: string,
  language: string,
  options: EternalReturnRequestOptions,
) {
  const data = await erGet(`/v1/l10n/${language}`, apiKey, options);
  const l10Path = data.data && !Array.isArray(data.data) ? data.data.l10Path : undefined;

  if (!l10Path) {
    throw new Error("Eternal Return language download URL is missing.");
  }

  const response = await fetch(l10Path, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) {
    throw new Error(`Failed to download L10N file: ${response.status} ${response.statusText}`);
  }

  return parseL10n(await response.text());
}

function createReferenceData({ characters, items, areas, traits, l10n }: ReferenceInput): EternalReturnReferences {
  const characterByCode = indexByCode(characters);
  const itemByCode = indexByCode(items);
  const traitByCode = indexByCode(traits);
  const areaIndex = indexAreas(areas);

  function l10nName(key: string) {
    return l10n.get(key) || null;
  }

  function fallback(value: unknown) {
    return value === null || value === undefined || value === "" ? "-" : String(value);
  }

  return {
    characterName(code) {
      const numericCode = Number(code);
      const row = characterByCode.get(numericCode);
      return l10nName(`Character/Name/${numericCode}`) || row?.name || fallback(code);
    },

    itemName(code) {
      const numericCode = Number(code);
      const row = itemByCode.get(numericCode);
      return l10nName(`Item/Name/${numericCode}`) || row?.name || fallback(code);
    },

    areaName(value) {
      const numericValue = Number(value);
      const legacyName = LEGACY_AREA_NAMES[numericValue];

      if (legacyName) {
        return l10nName(`Area/Name/${legacyName}`) || legacyName;
      }

      const row = Number.isFinite(numericValue)
        ? areaIndex.byMaskCode.get(numericValue) || areaIndex.byCode.get(numericValue)
        : null;

      if (row?.name) {
        return l10nName(`Area/Name/${row.name}`) || row.name;
      }

      if (typeof value === "string" && value) {
        return l10nName(`Area/Name/${value}`) || value;
      }

      return fallback(value);
    },

    traitName(code) {
      const numericCode = Number(code);
      const row = traitByCode.get(numericCode);
      return l10nName(`Trait/Name/${numericCode}`) || row?.name || fallback(code);
    },

    tacticalSkillName(code) {
      const numericCode = Number(code);
      const setCode = LEGACY_TACTICAL_SKILL_SET_CODES[numericCode]
        ?? (numericCode >= 500_000 && numericCode < 600_000 ? numericCode + 1 : undefined);
      const localized = (setCode !== undefined
        ? l10nName(`TacticalSkillSet/Code/Name/${setCode}`)
        : null)
        || l10nName(`TacticalSkill/Name/${numericCode}`)
        || l10nName(`TacticalSkillGroup/Name/${numericCode}`)
        || l10nName(`Skill/Name/${numericCode}`);
      return localized?.replace(/<[^>]+>/g, "")
        || tacticalSkillFallbackName(numericCode)
        || `전술 스킬 ${fallback(code)}`;
    },

    gadgetName(code) {
      const numericCode = Number(code);
      return l10nName(`Gadget/Name/${numericCode}`)
        || l10nName(`Skill/Name/${numericCode}`)
        || GADGET_NAMES[numericCode]
        || `가젯 ${fallback(code)}`;
    },

    installationName(code) {
      const numericCode = Number(code);
      return l10nName(`Installation/Name/${numericCode}`) || `설치물 ${fallback(code)}`;
    },

    skillName(code) {
      const normalized = String(code).trim().toUpperCase();
      if (["Q", "W", "E", "R", "T", "D", "F"].includes(normalized)) return normalized;
      const numericCode = Number(code);
      if (Number.isSafeInteger(numericCode)) {
        // Character skill group codes end in 1xx~5xx. Variant skills keep the same
        // hundreds digit (for example 210), so they still map to the same slot.
        const skillIndex = Math.floor((numericCode % 1_000) / 100);
        const characterSlot = ({ 1: "T", 2: "Q", 3: "W", 4: "E", 5: "R" } as const)
          [skillIndex as 1 | 2 | 3 | 4 | 5];
        if (numericCode >= 1_000_000 && numericCode < 2_000_000 && characterSlot) {
          return characterSlot;
        }
        if (numericCode >= 3_000_000 && numericCode < 4_000_000) return "D";
      }
      return l10nName(`Skill/Group/Name/${numericCode}`)
        || l10nName(`Skill/Name/${numericCode}`)
        || fallback(code);
    },
  };
}

export function createEmptyReferenceData(): EternalReturnReferences {
  return createReferenceData({
    characters: [],
    items: [],
    areas: [],
    traits: [],
    l10n: new Map(),
  });
}

async function loadReferenceData(
  apiKey: string,
  options: EternalReturnRequestOptions,
  store?: EternalReturnStore,
): Promise<EternalReturnReferences> {
  const now = Date.now();
  const cached = store?.getReference<StoredReferenceBundle>(REFERENCE_CACHE_TYPE, REFERENCE_CACHE_KEY);
  if (cached?.expiresAt && cached.expiresAt.getTime() > now) return referencesFromBundle(cached.payload);

  const hashResponse = await erGet("/v2/data/hash", apiKey, options);
  const hash = hashResponse.data;
  const unchanged = cached && JSON.stringify(cached.payload.hash) === JSON.stringify(hash);
  if (unchanged) {
    const l10n = await loadL10n(apiKey, "Korean", options);
    const bundle = { ...cached.payload, hash, l10n: [...l10n.entries()] };
    saveBundle(store, bundle, now);
    return referencesFromBundle(bundle);
  }

  const characters = await fetchDataTable(apiKey, "Character", options);
  const areas = await fetchDataTable(apiKey, "Area", options);
  const traits = await fetchDataTable(apiKey, "Trait", options);
  const itemTables: ReferenceRow[][] = [];

  for (const metaType of ITEM_META_TYPES) {
    itemTables.push(await fetchDataTable(apiKey, metaType, options));
  }
  const seasons = await fetchDataTable(apiKey, "Season", options);
  const l10n = await loadL10n(apiKey, "Korean", options);
  const bundle: StoredReferenceBundle = {
    hash, characters, items: itemTables.flat(), areas, traits, seasons, l10n: [...l10n.entries()],
  };
  saveBundle(store, bundle, now);
  return referencesFromBundle(bundle);
}

// Share an in-flight load across commands. Failed loads may be retried later.
const referenceCache = new Map<string, { expiresAt: number; promise: Promise<EternalReturnReferences> }>();
const storedReferenceLoads = new WeakMap<EternalReturnStore, Map<string, Promise<EternalReturnReferences>>>();

export function getReferenceData(
  apiKey: string,
  options: EternalReturnRequestOptions = {},
  store?: EternalReturnStore,
): Promise<EternalReturnReferences> {
  if (store) {
    let loads = storedReferenceLoads.get(store);
    if (!loads) {
      loads = new Map();
      storedReferenceLoads.set(store, loads);
    }
    const existing = loads.get(apiKey);
    if (existing) return existing;
    const promise = loadReferenceData(apiKey, options, store).finally(() => loads!.delete(apiKey));
    loads.set(apiKey, promise);
    return promise;
  }
  const cached = referenceCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadReferenceData(apiKey, options).catch((error: unknown) => {
    referenceCache.delete(apiKey);
    throw error;
  });
  referenceCache.set(apiKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  return promise;
}

export async function getSeasonData(
  apiKey: string,
  options: EternalReturnRequestOptions = {},
  store?: EternalReturnStore,
): Promise<EternalReturnSeason[]> {
  if (store) {
    await getReferenceData(apiKey, options, store);
    return store.getReference<StoredReferenceBundle>(REFERENCE_CACHE_TYPE, REFERENCE_CACHE_KEY)?.payload.seasons ?? [];
  }
  const rows = await fetchDataTable(apiKey, "Season", options);
  return rows as EternalReturnSeason[];
}

export function findCurrentSeason(seasons: readonly EternalReturnSeason[]): EternalReturnSeason | undefined {
  return [...seasons]
    .filter(season => Number(season.isCurrent) === 1 && Number.isSafeInteger(Number(season.seasonID)))
    .sort((a, b) => Number(b.seasonID) - Number(a.seasonID))[0];
}

function referencesFromBundle(bundle: StoredReferenceBundle): EternalReturnReferences {
  return createReferenceData({
    characters: bundle.characters,
    items: bundle.items,
    areas: bundle.areas,
    traits: bundle.traits,
    l10n: new Map(bundle.l10n),
  });
}

function saveBundle(store: EternalReturnStore | undefined, bundle: StoredReferenceBundle, fetchedAt: number): void {
  store?.putReference({
    dataType: REFERENCE_CACHE_TYPE,
    cacheKey: REFERENCE_CACHE_KEY,
    payload: bundle,
    fetchedAt: new Date(fetchedAt),
    expiresAt: new Date(fetchedAt + CACHE_TTL_MS),
  });
}
