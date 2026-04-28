import type { UsIndex } from "../lib/api";
import { signColor } from "../lib/format";

interface Props {
  indices: UsIndex[] | undefined;
  loading?: boolean;
}

function formatPrice(symbol: string, price: number): string {
  // 환율은 소수 2자리, 지수는 콤마 + 정수 또는 소수 1자리
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "^VIX") return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

export function UsIndicesBar({ indices, loading }: Props) {
  if (loading && (!indices || indices.length === 0)) {
    return (
      <div className="flex gap-3 px-3 py-2 text-sm text-gray-400 animate-pulse">
        미국증시 로딩 중...
      </div>
    );
  }
  if (!indices || indices.length === 0) return null;

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto flex flex-wrap gap-x-4 gap-y-1
                       px-3 py-2 text-xs">
        {indices.map(idx => {
          const sign = signColor(idx.diff);
          return (
            <div key={idx.symbol}
                 className="inline-flex items-baseline gap-1.5 shrink-0">
              <span className="text-gray-500 font-medium">{idx.name}</span>
              <span className="font-bold text-gray-800 tabular-nums">
                {formatPrice(idx.symbol, idx.price)}
              </span>
              <span className={`tabular-nums font-medium ${sign}`}>
                {idx.diff >= 0 ? "+" : ""}{idx.pct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
