// 정렬 옵션 선택 + 방향 토글 (asc/desc)
import {
  type SortKey, type SortDirection, SORT_LABELS, DEFAULT_DIR,
} from "../lib/sortHoldings";

interface Props {
  sortKey: SortKey;
  sortDir: SortDirection;
  onChangeKey: (k: SortKey) => void;
  onToggleDir: () => void;
}

export function SortSelector({ sortKey, sortDir, onChangeKey, onToggleDir }: Props) {
  const arrow = sortDir === "desc" ? "▼" : "▲";
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <span className="text-gray-500">정렬</span>
      <select
        value={sortKey}
        onChange={(e) => {
          const k = e.target.value as SortKey;
          onChangeKey(k);
        }}
        className="bg-white border border-gray-300 rounded px-1.5 py-0.5
                   text-gray-700 hover:bg-gray-50 cursor-pointer focus:outline-none
                   focus:ring-1 focus:ring-gray-400">
        {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
          <option key={k} value={k}>{SORT_LABELS[k]}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onToggleDir}
        title={`${sortDir === "desc" ? "내림차순" : "오름차순"} (클릭해 토글)`}
        className="px-1.5 py-0.5 rounded border border-gray-300 bg-white
                   text-gray-700 hover:bg-gray-100 cursor-pointer
                   tabular-nums leading-none">
        {arrow}
      </button>
    </div>
  );
}

// default 방향으로 키 변경
export function makeSortHandlers(
  setSortKey: (k: SortKey) => void,
  setSortDir: (d: SortDirection) => void,
  saveSortKey: (k: SortKey) => void,
  saveSortDir: (d: SortDirection) => void,
  currentDir: SortDirection,
) {
  return {
    onChangeKey: (k: SortKey) => {
      setSortKey(k);
      saveSortKey(k);
      // 키 변경 시 그 키의 default 방향으로 reset
      const dir = DEFAULT_DIR[k];
      setSortDir(dir);
      saveSortDir(dir);
    },
    onToggleDir: () => {
      const next: SortDirection = currentDir === "desc" ? "asc" : "desc";
      setSortDir(next);
      saveSortDir(next);
    },
  };
}
