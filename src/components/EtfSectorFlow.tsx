// 섹터별 흐름 — ETF랭킹과 지수 탭이 함께 쓰는 블록.
//
//   ETF랭킹: 누르면 아래 목록이 그 섹터로 좁혀진다(필터).
//   지수 탭:  누르면 그 섹터의 ETF 목록이 팝업으로 뜬다(EtfSectorDialog).
//   같은 그림을 두 곳에서 쓰므로 카드 렌더는 여기 한 곳에만 둔다.
//
// ★ 데이터는 '스냅샷' 이다. 전체 ETF 시세 조회는 약 17 프록시 콜이라 폴링에 못 태운다
//   (etfRanking.ts 주석 참조). 그래서 localStorage 캐시를 읽어 쓰고, 캐시가 아예 없을 때만
//   1회 조회한다. 지수 탭의 다른 카드들이 실시간인 것과 달리 여기는 '기준 시각' 이 붙는다.

import { signColor } from "../lib/format";
import type { EtfSectorStat } from "../lib/etfSectors";

// 섹터 한 칸 — 중앙값 등락률로 줄 세운다. 평균은 한 종목 급등에 휘둘려서 안 쓴다.
//   막대는 '오른 종목 비율' — 중앙값이 같아도 고르게 간 섹터와 한두 개가 끈 섹터를 가른다.
export function SectorCard({ s, on, onClick }: {
  s: EtfSectorStat; on: boolean; onClick: () => void;
}) {
  const lead = s.rows[0];
  return (
    <button onClick={onClick}
            title={`${s.label} ${s.count}종 · 대표 ${lead?.name ?? "—"} (거래대금 1위)`}
            className={`w-full mb-2 break-inside-avoid text-left px-2.5 py-2 rounded-lg border transition-colors
                        ${on ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
      <span className="flex items-baseline gap-1.5">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{s.label}</span>
        {/* 표본이 1~2 종뿐인 섹터는 중앙값이 한 종목에 좌우된다 — 숫자를 눈에 띄게 해 경고 */}
        <span className={`shrink-0 text-[10px] tabular-nums ${
                s.count < 3 ? "text-amber-600 font-bold" : "text-gray-400"}`}>
          {s.count}
        </span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${signColor(s.median)}`}>
          {s.median > 0 ? "+" : ""}{s.median.toFixed(2)}%
        </span>
      </span>
      {/* 오른 종목 비율 */}
      <span className="block mt-1 h-1 rounded bg-gray-200 overflow-hidden">
        <span className="block h-full bg-rose-400" style={{ width: `${Math.round(s.upRatio * 100)}%` }} />
      </span>
      <span className="mt-1 flex items-baseline gap-1 text-[11px]">
        <span className="flex-1 min-w-0 truncate text-gray-500">{lead?.name ?? "—"}</span>
        {lead && (
          <span className={`shrink-0 tabular-nums ${signColor(lead.pct)}`}>
            {lead.pct > 0 ? "+" : ""}{lead.pct.toFixed(2)}%
          </span>
        )}
      </span>
    </button>
  );
}

// 섹터 카드 그리드. fetchedAt 을 주면 '기준 시각' 캡션을 위에 붙인다(지수 탭용 —
//   그 탭의 다른 카드는 실시간인데 여기만 스냅샷이라 언제 기준인지 밝혀야 한다).
export function EtfSectorFlow({ sectors, selectedKey, onPick, fetchedAt, onRefresh, refreshing }: {
  sectors: EtfSectorStat[];
  selectedKey?: string | null;
  onPick: (s: EtfSectorStat) => void;
  fetchedAt?: number;
  onRefresh?: () => void;      // 주면 캡션에 새로고침 버튼이 붙는다(지수 탭용)
  refreshing?: boolean;
}) {
  if (sectors.length === 0) return null;
  const stamp = fetchedAt
    ? new Date(fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;
  return (
    <>
    {stamp && (
      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 -mt-0.5 mb-1 flex-wrap">
        <span>
          중앙값 등락률 순 · 레버리지·인버스·선물 제외 ·{" "}
          <span className="text-gray-400">기준 {stamp} · 누르면 종목 목록</span>
        </span>
        {/* 이 블록만 스냅샷이라(전수 조회 약 17콜) 자동 갱신하지 않는다 — 여기서 직접 받는다 */}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing}
                  title="전체 ETF 시세를 다시 조회합니다 (프록시 약 17콜)"
                  className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                             hover:bg-gray-100 disabled:opacity-50">
            {refreshing ? "조회 중…" : "🔄 새로고침"}
          </button>
        )}
      </div>
    )}
    <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-6 gap-2">
      {sectors.map(s => (
        <SectorCard key={s.key} s={s} on={s.key === selectedKey} onClick={() => onPick(s)} />
      ))}
    </div>
    </>
  );
}
