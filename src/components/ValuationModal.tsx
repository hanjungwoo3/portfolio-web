import type { Investor, Consensus } from "../types";
import { formatSigned, signColor } from "../lib/format";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  name: string;
  sector?: string;
  investor?: Investor | null;
  consensus?: Consensus | null;
  peak?: number;
  curPrice?: number;
}

const FLOW_FIELDS: { label: string; key: keyof Investor }[] = [
  { label: "외국인보유", key: "외국인비율" },
  { label: "개인", key: "개인" },
  { label: "외국인", key: "외국인" },
  { label: "기관", key: "기관" },
  { label: "연기금", key: "연기금" },
  { label: "금융투자", key: "금융투자" },
  { label: "투신", key: "투신" },
  { label: "사모", key: "사모" },
  { label: "보험", key: "보험" },
  { label: "은행", key: "은행" },
  { label: "기타금융", key: "기타금융" },
  { label: "기타법인", key: "기타법인" },
];

export function ValuationModal({
  isOpen, onClose, ticker, name, sector, investor, consensus, peak, curPrice,
}: Props) {
  if (!isOpen) return null;

  const targetGapPct =
    consensus?.target && curPrice && curPrice > 0
      ? ((consensus.target - curPrice) / curPrice) * 100
      : undefined;
  const peakDropPct =
    peak && peak > 0 && curPrice
      ? ((curPrice - peak) / peak) * 100
      : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full
                       max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <header className="px-5 py-4 border-b flex items-baseline gap-3">
          <h2 className="text-xl font-bold">📊 기업가치</h2>
          <span className="text-base font-bold">{name}</span>
          <span className="text-sm text-gray-500">{ticker}</span>
          {sector && <span className="text-sm text-gray-500">· {sector}</span>}
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        </header>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* 가격 / 피크 / 목표 */}
          <section className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">현재가</div>
              <div className="text-lg font-bold">
                {curPrice ? `${curPrice.toLocaleString()}원` : "—"}
              </div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">피크가</div>
              {peak ? (
                <>
                  <div className="text-lg font-bold">
                    {peak.toLocaleString()}원
                  </div>
                  {peakDropPct !== undefined && (
                    <div className="text-xs text-gray-500">
                      현재 ({peakDropPct >= 0 ? "+" : ""}{peakDropPct.toFixed(2)}%)
                    </div>
                  )}
                </>
              ) : <div className="text-gray-400">—</div>}
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">
                목표가
                {typeof consensus?.score === "number" && (
                  <span className="ml-1">({consensus.score.toFixed(2)})</span>
                )}
                {consensus?.opinion && (
                  <span className="ml-1">{consensus.opinion}</span>
                )}
              </div>
              {consensus?.target ? (
                <>
                  <div className="text-lg font-bold">
                    {consensus.target.toLocaleString()}원
                  </div>
                  {targetGapPct !== undefined && (
                    <div className={`text-xs font-bold ${signColor(targetGapPct)}`}>
                      ({targetGapPct >= 0 ? "+" : ""}{targetGapPct.toFixed(2)}%)
                    </div>
                  )}
                </>
              ) : <div className="text-gray-400">—</div>}
            </div>
          </section>

          {/* 투자자 12 항목 */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 mb-2">
              📈 수급 (외국인/기관/개인 등)
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm
                             border border-gray-200 rounded p-3">
              {FLOW_FIELDS.map(({ label, key }) => {
                const raw = investor ? investor[key] : null;
                const isRatio = key === "외국인비율";
                const isHighlight = ["외국인", "기관", "연기금"].includes(label);
                const value =
                  raw === null || raw === undefined ? "—"
                  : isRatio ? `${(raw as number).toFixed(2)}%`
                  : formatSigned(raw as number);
                const valueColor =
                  isRatio ? "text-gray-800"
                  : (raw === null || raw === undefined) ? "text-gray-400"
                  : signColor(raw as number);
                return (
                  <div key={label}
                       className={`flex justify-between
                                   ${isHighlight ? "font-bold" : ""}`}>
                    <span className="text-gray-600">{label}</span>
                    <span className={`tabular-nums ${valueColor}`}>{value}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 외부 링크 */}
          <section className="flex flex-wrap gap-2">
            <a href={`https://tossinvest.com/stocks/A${ticker}`}
               target="_blank" rel="noopener noreferrer"
               className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                          text-white rounded text-sm">
              🔗 토스에서 보기
            </a>
            <a href={`https://finance.naver.com/item/main.naver?code=${ticker}`}
               target="_blank" rel="noopener noreferrer"
               className="px-3 py-1.5 bg-green-600 hover:bg-green-700
                          text-white rounded text-sm">
              🔗 네이버 금융
            </a>
            <a href={`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`}
               target="_blank" rel="noopener noreferrer"
               className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700
                          text-white rounded text-sm">
              🔗 와이즈리포트 (재무)
            </a>
          </section>
        </div>

        <footer className="px-5 py-3 border-t text-xs text-gray-400">
          출처: Toss API (가격/수급), 네이버 금융 (목표가/섹터). 재무 상세는 와이즈리포트 직접 링크.
        </footer>
      </div>
    </div>
  );
}
