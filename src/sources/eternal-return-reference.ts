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

interface StoredReferenceBundle {
  hash: unknown;
  characters: ReferenceRow[];
  items: ReferenceRow[];
  areas: ReferenceRow[];
  traits: ReferenceRow[];
  seasons: ReferenceRow[];
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
