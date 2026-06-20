// 검색창 최근 검색어 — localStorage 보관(기기 로컬, 동기화 대상 아님).
//   명시 검색(Enter/검색 버튼/칩 클릭) 시에만 기록해 입력 중 부분어로 더럽혀지지 않게 함.

const KEY = "portfolio.recentSearches";
const MAX = 12;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): string[] {
  const q = query.trim();
  if (!q) return getRecentSearches();
  const prev = getRecentSearches().filter(x => x !== q);   // 중복 제거(최신 우선)
  const next = [q, ...prev].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 용량 초과 등 무시 */ }
  return next;
}

export function removeRecentSearch(query: string): string[] {
  const next = getRecentSearches().filter(x => x !== query);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 무시 */ }
  return next;
}

export function clearRecentSearches(): string[] {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
  return [];
}
