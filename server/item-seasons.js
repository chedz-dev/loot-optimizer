import seasonData from '../data/item-season-classification.json' with { type: 'json' };
import { rankingItems } from './trinkets-s2.js';

export const CURRENT_ITEM_SEASON = Object.freeze({ ...seasonData.currentSeason });
const currentItemIds = new Set(rankingItems.map((item) => item.itemId));
const verifiedItems = new Map(seasonData.items.map((entry) => [entry.itemId, entry]));

/** Availability by item ID, not the season/upgrade track of an equipped copy.
 * Read-time enrichment deliberately ignores stale classifications in snapshots.
 * An old numeric ID may return in the current dungeon pool. Absence from that
 * pool is not evidence that an item belongs to a past season.
 */
export function classifyItemSeason(itemId) {
  const id = Number(itemId);
  if (Number.isSafeInteger(id) && currentItemIds.has(id)) {
    return { status: 'current', seasonId: CURRENT_ITEM_SEASON.id, label: CURRENT_ITEM_SEASON.label,
      basis: 'active-catalog', sourceUrl: null, referenceSeasonId: CURRENT_ITEM_SEASON.id };
  }
  const verified = verifiedItems.get(id);
  if (verified) return {
    status: verified.status, seasonId: verified.seasonId, label: verified.label,
    basis: 'verified-source', sourceUrl: verified.sourceUrl, referenceSeasonId: CURRENT_ITEM_SEASON.id,
  };
  return { status: 'unknown', seasonId: null, label: null, basis: 'unverified', sourceUrl: null,
    referenceSeasonId: CURRENT_ITEM_SEASON.id };
}
