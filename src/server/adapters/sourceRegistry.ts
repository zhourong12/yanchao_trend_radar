import { googleTrendingDiscoveryAdapter } from "./googleTrendingAdapter";
import { dailyHotApiAdapter, sixtySecondsHotAdapter } from "./hotListAdapters";
import { googleTrendsLiveAdapter, weiboHotLiveAdapter } from "./liveAdapters";
import { taobaoThemeAdapter } from "./taobaoGlobalAdapter";
import type { TrendSourceAdapter } from "./types";

const trendSources = new Map<string, TrendSourceAdapter>();

export function registerTrendSource(adapter: TrendSourceAdapter) {
  if (trendSources.has(adapter.name)) throw new Error(`Trend source already registered: ${adapter.name}`);
  trendSources.set(adapter.name, adapter);
  return adapter;
}

export function listRegisteredTrendSources() {
  return [...trendSources.values()];
}

export function getRegisteredTrendSource(name: string) {
  return trendSources.get(name);
}

[
  googleTrendingDiscoveryAdapter,
  googleTrendsLiveAdapter,
  weiboHotLiveAdapter,
  dailyHotApiAdapter,
  sixtySecondsHotAdapter,
  taobaoThemeAdapter
].forEach(registerTrendSource);
