// 🔔 지금 시끄러운 종목 — 최근 5분 사이 평소보다 돈이 확 몰린 종목(lib/hotNow). PC·모바일 같은 화면
import { useQuery } from "@tanstack/react-query";
import { fetchHotNow, type HotRow } from "../lib/hotNow";
import { openTickPopup } from "../lib/tickPopup";

const eok = (won: number) => (won >= 1e12 ? `${(won / 1e12).toFixed(1)}조` : won >= 1e8 ? `${Math.round(won / 1e8).toLocaleString()}억` : `${Math.round(won / 1e4).toLocaleString()}만`);
const sign = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const tone = (n: number) => (n > 0 ? "text-rose-600" : n < 0 ? "text-blue-600" : "text-gray-500");

export function HotNowTab({ compact = false }: { compact?: boolean }) {
  const q = useQuery({
    queryKey: ["hot-now"],
    queryFn: () => fetchHotNow(5),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 50_000,
    retry: 1,
  });
  const d = q.data;
  return (
    <div className={compact ? "space-y-2" : "max-w-[1100px] mx-auto p-3 space-y-3"}>
      <div className="pg-card rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <b className="text-gray-800 text-[15px]">🔔 지금 시끄러운 종목</b>
          <span className="text-[12px] text-gray-500">
            최근 {d?.windowMin || 5}분 동안 <b>평소보다 돈이 확 몰린</b> 종목 · 1분마다 새로
          </span>
          {d && <span className="ml-auto text-[11px] text-gray-400">{new Date(d.at + 9 * 3600_000).toISOString().slice(11, 16)} 기준</span>}
        </div>
        <div className="mt-1.5 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed">
          ⚠️ <b>사라는 신호가 아니에요.</b> 우리가 실제로 재 보니 이렇게 갑자기 몰린 종목을 따라 사면, 수수료·세금까지 치면 평균적으로 조금씩 손해였어요.
          "지금 어디로 돈이 몰리나"를 빨리 보는 용도로 쓰세요. 종목을 누르면 종목정보 창(실시간 체결·호가·단타 신호 성적)이 열려요.
        </div>
      </div>

      {q.isLoading ? <div className="text-gray-400 text-sm p-4">불러오는 중…</div>
        : q.isError && !d ? <div className="text-rose-600 text-sm p-4">순위를 못 받았어요 — 잠시 뒤 다시 시도합니다.</div>
        : !d || d.windowMin === 0 ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600 leading-relaxed">
            ⏳ 기록을 모으는 중이에요. 이 화면은 1분마다 거래 순위를 찍어 두고 <b>방금 전과 비교</b>해서 계산해요.
            <br />1분 뒤부터 보이고, <b>5분쯤 열어 두면</b> 더 정확해져요.
          </div>
        ) : d.quiet ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600">
            😴 지금은 거래가 거의 없어요 — 장이 끝났거나 쉬는 시간이에요. 장 중(08:00~20:00, 정규장 09:00~15:30)에 열어 두면 보여요.
          </div>
        ) : !d.rows.length ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600">조용해요 — 최근 {d.windowMin}분 동안 평소보다 1.5배 넘게 몰린 종목이 없어요.</div>
        ) : (
          <div className="pg-card rounded-lg border border-gray-200 bg-white overflow-hidden">
            {d.windowMin < 5 && <div className="px-3 py-1 text-[11px] text-gray-500 bg-gray-50 border-b border-gray-100">아직 {d.windowMin}분 기록으로 계산했어요 — 5분쯤 지나면 더 정확해져요.</div>}
            {d.rows.map((r, i) => <Row key={r.code} r={r} i={i} win={d.windowMin} compact={compact} />)}
          </div>
        )}
    </div>
  );
}

function Row({ r, i, win, compact }: { r: HotRow; i: number; win: number; compact: boolean }) {
  const hot = r.times >= 5 ? "bg-rose-500 text-white" : r.times >= 3 ? "bg-orange-400 text-white" : "bg-amber-100 text-amber-800";
  return (
    <button type="button" onClick={() => openTickPopup(r.code, r.name)}
            className="w-full text-left flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50"
            title={`${r.name} — 최근 ${win}분 거래대금 ${eok(r.recentValue)}원 (오늘 1분 평균의 ${r.times.toFixed(1)}배), 그동안 값 ${sign(r.recentPct)}. 누르면 종목정보`}>
      <span className="w-5 shrink-0 text-[11px] text-gray-400 tabular-nums text-right">{i + 1}</span>
      <span className={`shrink-0 w-[64px] text-center rounded px-1 py-0.5 text-[12px] font-bold tabular-nums ${hot}`}>{r.times.toFixed(1)}배</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <b className="truncate text-gray-900 text-[14px]">{r.name}</b>
          <span className="shrink-0 text-[10px] text-gray-400">{r.market}</span>
          {r.upper && <span className="shrink-0 px-1 rounded bg-rose-600 text-white text-[10px] font-bold">상한가</span>}
        </span>
        <span className="block text-[11.5px] text-gray-500">
          {win}분 동안 <b className="text-gray-700">{eok(r.recentValue)}원</b> 거래 · 그 사이 <b className={tone(r.recentPct)}>{sign(r.recentPct)}</b>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[14px] font-bold tabular-nums text-gray-900">{r.price.toLocaleString()}원</span>
        <span className={`block text-[12px] tabular-nums font-bold ${tone(r.pct)}`}>오늘 {sign(r.pct)}</span>
        {!compact && <span className="block text-[10.5px] text-gray-400 tabular-nums">오늘 {eok(r.value)}원</span>}
      </span>
    </button>
  );
}
