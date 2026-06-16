// 경고 뱃지 클릭 → 거래소 시장조치(투자경고/위험/주의·매매거래정지 등) 공시 모달
// 네이버 공시 피드에서 시장조치 공시만 추려 목록 + 선택 공시 본문(정지요건·날짜)을 표시.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { fetchMarketAlerts, fetchDisclosureBody } from "../lib/api";
import { openGoogleAi } from "../lib/googleAi";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  ticker: string;
  name: string;
  warning?: string;
  onClose: () => void;
}

// 단계별 색 (뱃지와 동일 톤)
const WARN_COLOR: Record<string, string> = {
  투자위험: "text-red-700",
  관리종목: "text-red-700",
  거래정지: "text-gray-600",
  투자경고: "text-orange-600",
  공매도과열: "text-orange-600",
  단기과열: "text-orange-600",
  투자주의환기: "text-orange-600",
  투자주의: "text-amber-600",
};

export function MarketAlertDialog({ ticker, name, warning, onClose }: Props) {
  useEscClose(true, onClose);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["market-alerts", ticker],
    queryFn: () => fetchMarketAlerts(ticker),
    staleTime: 30 * 60 * 1000,
  });

  // 선택 공시 = 사용자가 고른 것, 없으면 가장 최근
  const activeId = selectedId ?? alerts?.[0]?.disclosureId ?? null;
  const { data: body, isLoading: bodyLoading } = useQuery({
    queryKey: ["disclosure-body", ticker, activeId],
    queryFn: () => fetchDisclosureBody(ticker, activeId!),
    enabled: activeId != null,
    staleTime: 30 * 60 * 1000,
  });

  const warnColor = warning ? (WARN_COLOR[warning] ?? "text-gray-700") : "text-gray-700";

  // 구글 AI 모드(udm=50) — 공시 본문을 쿼리로. 세션토큰 없이 깨끗한 URL(만료 안 됨).
  //   iframe 은 구글이 차단 → 팝업 창으로 오픈.
  const activeNotice = alerts?.find(a => a.disclosureId === activeId);
  // AI 모드(udm=50)는 '짧은 질문'이어야 답을 생성 — 긴 원문 덤프는 웹결과 목록으로 떨어짐.
  //   원문은 모달에 이미 보이므로, 여기선 사유·기간·조건을 묻는 자연어 질문만 전송.
  const aiQuery = (() => {
    const w = warning ?? "시장경보";
    const noticeCtx = activeNotice?.title ? ` "${activeNotice.title}" 공시 기준으로` : "";
    return `${name}(${ticker}) 주식이${noticeCtx} ${w}종목으로 지정된 이유, `
      + `언제까지 유지되고 어떤 조건에서 해제되는지, 매매거래정지 조건은 무엇인지 `
      + `일반 투자자가 알기 쉽게 설명해줘`;
  })();

  // 카드의 opacity(흐림)/transform stacking context 를 벗어나도록 body 로 portal
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white shadow-xl w-full max-w-5xl rounded-t-xl sm:rounded-lg
                      max-h-[88vh] flex flex-col">
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2 rounded-t-xl">
          <TriangleAlert size={18} className={warnColor} />
          <h2 className={`text-base font-bold ${warnColor}`}>{warning || "시장조치"}</h2>
          <span className="text-sm text-gray-600 truncate">{name} ({ticker})</span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </header>

        <div className="px-4 py-3 overflow-y-auto space-y-3">
          {isLoading ? (
            <div className="text-sm text-gray-400 py-6 text-center">공시 불러오는 중…</div>
          ) : !alerts || alerts.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center space-y-2">
              <div>최근 시장조치 공시를 찾지 못했습니다.</div>
              <a href={`https://m.stock.naver.com/domestic/stock/${ticker}/notice`}
                 target="_blank" rel="noopener noreferrer"
                 className="inline-block text-blue-600 hover:underline">네이버 공시 전체 보기 →</a>
            </div>
          ) : (
            <>
              {/* 시장조치 공시 목록 — 클릭 시 본문 전환 */}
              <div className="flex flex-col gap-1">
                {alerts.map(a => {
                  const on = a.disclosureId === activeId;
                  return (
                    <button key={a.disclosureId}
                            onClick={() => setSelectedId(a.disclosureId)}
                            className={`flex items-baseline gap-2 text-left px-2 py-1.5 rounded border text-xs
                                        ${on ? "bg-amber-50 border-amber-300"
                                             : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                      <span className="tabular-nums text-gray-400 shrink-0">{a.date.slice(2)}</span>
                      <span className={`flex-1 ${on ? "font-bold text-gray-900" : "text-gray-700"}`}>{a.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* 선택 공시 본문 */}
              <div className="border-t pt-2">
                {bodyLoading ? (
                  <div className="text-xs text-gray-400 py-4 text-center">본문 불러오는 중…</div>
                ) : body ? (
                  <pre className="whitespace-pre text-[10px] leading-snug text-gray-700
                                  bg-gray-50 rounded p-2 max-h-[45vh] overflow-auto font-mono">
                    {body}
                  </pre>
                ) : (
                  <div className="text-xs text-gray-400 py-3 text-center">본문을 불러오지 못했습니다.</div>
                )}
                {activeId != null && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => openGoogleAi(aiQuery)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
                                       bg-blue-600 text-white hover:bg-blue-700 active:opacity-80">
                      🔍 구글 AI로 해설 (팝업)
                    </button>
                    <a href={`https://m.stock.naver.com/domestic/stock/${ticker}/notice/${activeId}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-xs text-blue-600 hover:underline">
                      네이버 원문 →
                    </a>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 해제 안내 — 투자경고/위험일 때 */}
          {(warning === "투자경고" || warning === "투자위험") && (
            <div className="text-[11px] text-gray-500 leading-relaxed bg-amber-50/60 rounded p-2">
              ※ 투자경고 해제는 <b>확정 예정일이 따로 공시되지 않습니다</b>. 주가 급등요건에서 벗어나
              안정되면 거래소가 매 거래일 점검 후 <b>「투자경고종목 지정해제」</b> 공시로 해제됩니다.
              해제 전 추가 급등 시 <b>투자위험 격상·1일 매매정지</b>가 될 수 있습니다.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MarketAlertDialog;
