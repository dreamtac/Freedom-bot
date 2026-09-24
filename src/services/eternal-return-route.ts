import {
  getRecommendedWeaponRoute,
  type EternalReturnRequestOptions,
  type EternalReturnWeaponRoute,
} from "../sources/eternal-return.js";
import type { EternalReturnStore } from "../storage/eternal-return-store.js";

const CACHE_TYPE = "weapon-route";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedRoute {
  route?: EternalReturnWeaponRoute;
}

interface EternalReturnRouteServiceOptions {
  apiKey: string;
  store: EternalReturnStore;
  now?: () => Date;
  load?: (
    routeId: number,
    apiKey: string,
    options: EternalReturnRequestOptions,
  ) => Promise<EternalReturnWeaponRoute | undefined>;
}

export class EternalReturnRouteService {
  readonly #apiKey: string;
  readonly #store: EternalReturnStore;
  readonly #now: () => Date;
  readonly #load: NonNullable<EternalReturnRouteServiceOptions["load"]>;
  readonly #requests = new Map<number, Promise<EternalReturnWeaponRoute | undefined>>();

  constructor(options: EternalReturnRouteServiceOptions) {
    this.#apiKey = options.apiKey;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#load = options.load ?? getRecommendedWeaponRoute;
  }

  get(
    routeId: number,
    options: EternalReturnRequestOptions = { priority: "refresh" },
  ): Promise<EternalReturnWeaponRoute | undefined> {
    if (!Number.isSafeInteger(routeId) || routeId <= 0) return Promise.resolve(undefined);
    const cached = this.#store.getReference<CachedRoute>(CACHE_TYPE, String(routeId));
    if (cached?.expiresAt && cached.expiresAt > this.#now()) return Promise.resolve(cached.payload.route);
    const existing = this.#requests.get(routeId);
    if (existing) return existing;
    const request = this.#load(routeId, this.#apiKey, options)
      .then(route => {
        const fetchedAt = this.#now();
        this.#store.putReference<CachedRoute>({
          dataType: CACHE_TYPE,
          cacheKey: String(routeId),
          payload: route ? { route } : {},
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
        });
        return route;
      })
      .finally(() => this.#requests.delete(routeId));
    this.#requests.set(routeId, request);
    return request;
  }

  async getOptional(
    routeId: number,
    options: EternalReturnRequestOptions = { priority: "refresh" },
  ): Promise<EternalReturnWeaponRoute | undefined> {
    try {
      return await this.get(routeId, options);
    } catch {
      return undefined;
    }
  }
}
