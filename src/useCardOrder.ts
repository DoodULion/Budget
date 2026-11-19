import { useState } from 'react';

/** Put saved ids first (dropping any no longer offered), then any new card ids in their default order. */
export function mergeOrder(saved: unknown, defaults: readonly string[]): string[] {
  const known = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && defaults.includes(id)) : [];
  const unique = [...new Set(known)];
  return [...unique, ...defaults.filter((id) => !unique.includes(id))];
}

/**
 * The order of a screen's cards, rearranged by hold-and-drag. A per-device preference kept in
 * localStorage (like Appearance), so it is not budget data and not in backups.
 */
export function useCardOrder(screen: string, defaults: readonly string[]): [string[], (ids: string[]) => void] {
  const key = `budget-tracker-cards-${screen}`;
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      return mergeOrder(raw ? JSON.parse(raw) : null, defaults);
    } catch {
      return [...defaults];
    }
  });
  const save = (ids: string[]) => {
    const next = mergeOrder(ids, defaults);
    setOrder(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage unavailable: the order lasts until the app closes */
    }
  };
  return [order, save];
}
