import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks,
} from "../lib/db";
import {
  getPersonalProxyUrl, setPersonalProxyUrl,
  getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS,
  getDimSleepingEnabled, setDimSleepingEnabled,
} from "../lib/proxyConfig";
import { resetProxyStats } from "../lib/proxyStatus";
import { getIndependentGroupsMode, setIndependentGroupsMode } from "../lib/groupMode";
import { findTickerConflicts, type TickerConflict } from "../lib/db";
import { GroupConflictDialog } from "./GroupConflictDialog";
import { detectPortfolioJson } from "../lib/portfolioImport";
import {
  getSyncState, getLastSyncedAt, enableSync, disableSync, pauseSync, resumeSync,
  uploadToDrive, downloadFromDrive, tryRestoreSession,
} from "../lib/syncManager";
import { isSignedIn, getAccessToken, wasSignedIn } from "../lib/googleAuth";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;          // 적용 후 부모 reload 트리거
}

export function SettingsDialog({ isOpen, onClose, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const downOnBackdropRef = useRef(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [pollMs, setPollMs] = useState(10_000);
  const [syncState, setSyncState] = useState(getSyncState());
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncBusyMsg, setSyncBusyMsg] = useState("");   // 진행 중 오버레이 메시지
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(getLastSyncedAt());
  const [independentMode, setIndependent] = useState(getIndependentGroupsMode());
  const [conflicts, setConflicts] = useState<TickerConflict[] | null>(null);

  const handleIndependentToggle = async (next: boolean) => {
    if (next) {
      // ON 으로 토글 — 단순 적용
      setIndependentGroupsMode(true);
      setIndependent(true);
      setStatusMsg("✅ 그룹별 독립 보유 모드 ON");
    } else {
      // OFF 로 토글 — 충돌 검사 후 모달 (있으면)
      const list = await findTickerConflicts();
      if (list.length === 0) {
        setIndependentGroupsMode(false);
        setIndependent(false);
        setStatusMsg("✅ 그룹별 동기화 모드 (충돌 없음)");
      } else {
        // 모달 띄워 사용자에게 해결 방법 묻기 — 모달 닫힌 후 모드 전환
        setConflicts(list);
      }
    }
  };

  // 다이얼로그 열릴 때마다 현재 데이터 로드
  useEffect(() => {
    if (!isOpen) return;
    setProxyUrl(getPersonalProxyUrl() ?? "");
    setPollMs(getPersonalPollMs());
    setSyncState(getSyncState());
    setLastSyncedAt(getLastSyncedAt());
    setIndependent(getIndependentGroupsMode());
    // 다이얼로그 열 때 — 토큰 silent refresh 시도
    // 진짜 만료된 경우만 자동 logout (이전 로그인 흔적 있는데 토큰 갱신 실패)
    void (async () => {
      const initial = getSyncState();
      if (initial === "unconfigured") return;
      // 이미 토큰 활성이면 그대로
      if (isSignedIn()) {
        // sync mode "on" 이면 추가로 silent refresh 호출 (백그라운드)
        void tryRestoreSession();
        return;
      }
      // 토큰 만료 — silent refresh 직접 시도 (syncState 무관)
      if (!wasSignedIn()) return;
      const token = await getAccessToken();
      if (!token) {
        await disableSync();
        setSyncState("unconfigured");
        setLastSyncedAt(null);
        setStatusMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
      }
    })();
    void (async () => {
      const data = await exportAll();
      setRaw(JSON.stringify(data, null, 2));
      setStatusMsg(`현재: 종목 ${data.holdings.length}건 / 피크 ${Object.keys(data.peaks).length}건`);
    })();
  }, [isOpen]);

  const saveProxy = async () => {
    const v = proxyUrl.trim().replace(/\/+$/, "");

    // 빈 값 = 해제 (검증 skip)
    if (!v) {
      setPersonalProxyUrl(null);
      setProxyUrl("");
      setStatusMsg("✅ 전용 프록시 해제 — 공개 4-way 사용");
      onChanged();
      return;
    }

    // 1) URL 형식 검증
    let parsed: URL;
    try {
      parsed = new URL(v);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        alert(`❌ 잘못된 URL — 프로토콜이 https/http 가 아닙니다\n입력: ${v}`);
        return;
      }
    } catch {
      alert(`❌ 잘못된 URL 형식입니다\n입력: ${v}\n\n예시: https://portfolio-proxy.your-name.workers.dev`);
      return;
    }

    // 2) 실제 호출 검증 — Naver 검색 API 로 health check
    setStatusMsg("⏳ 프록시 검증 중...");
    try {
      const testTarget = "https://m.stock.naver.com/api/json/search/searchListJson.nhn?keyword=samsung";
      const url = `${v}/?url=${encodeURIComponent(testTarget)}`;
      const resp = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        alert(`❌ 프록시 응답 오류 ${resp.status}\nURL: ${v}\n\n응답: ${text.slice(0, 200)}\n\nWorker 가 정상 배포되었는지 확인하세요.`);
        setStatusMsg("");
        return;
      }
      // JSON 응답이어야 정상 (HTML 이면 다른 페이지)
      const text = await resp.text();
      const isJson = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
      if (!isJson) {
        alert(`❌ 프록시 응답이 JSON 이 아닙니다.\n\nURL: ${v}\n\nWorker 코드가 우리 코드와 동일한지 확인하세요.\n응답 시작: ${text.slice(0, 100)}`);
        setStatusMsg("");
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`❌ 프록시 연결 실패\nURL: ${v}\n\n원인: ${msg}\n\n확인 사항:\n- Worker 가 배포됐는지\n- URL 오타\n- 인터넷 연결`);
      setStatusMsg("");
      return;
    }

    // 검증 통과 — 저장 + 옛 프록시 통계 리셋 + React Query 캐시 무효화
    setPersonalProxyUrl(v);
    setProxyUrl(v);
    resetProxyStats();              // 옛 4-way down 상태 제거 → 적응형 polling 즉시 정상화
    queryClient.invalidateQueries();
    onChanged();
    setStatusMsg(`✅ 전용 프록시 검증 OK — 적용: ${v}`);
  };

  const handlePollChange = (ms: number) => {
    setPollMs(ms);
    setPersonalPollMs(ms);
    setStatusMsg(`✅ 폴링 주기 ${ms / 1000}초 적용`);
    onChanged();
  };

  if (!isOpen) return null;

  const result = detectPortfolioJson(raw);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setStatusMsg("✅ 클립보드에 복사됨");
    } catch {
      // fallback — execCommand
      const ta = document.createElement("textarea");
      ta.value = raw;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setStatusMsg("✅ 클립보드에 복사됨");
      } catch {
        setStatusMsg("❌ 복사 실패");
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
      setStatusMsg("📥 클립보드에서 가져옴 — 적용 버튼 누르면 덮어쓰기");
    } catch {
      setStatusMsg("❌ 클립보드 읽기 실패 — textarea에 직접 붙여넣어주세요");
    }
  };

  const handleApply = async () => {
    if (!result || result.kind === "error") return;
    setBusy(true);
    try {
      if (result.kind === "holdings" || result.kind === "combined") {
        await replaceAllHoldings(result.stocks);
      }
      if (result.kind === "peaks" || result.kind === "combined") {
        await replaceAllPeaks(result.peaks);
      }
      setStatusMsg("💾 적용 완료");
      onChanged();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`❌ 저장 실패\n\n${msg}`);
      setStatusMsg("❌ 저장 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full
                       max-h-[90vh] flex flex-col">
        {/* ─── 진행 중 오버레이 — 업로드/다운로드/로그인 시 ─── */}
        {syncBusy && syncBusyMsg && (
          <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm
                          rounded-lg flex items-center justify-center">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg
                            px-6 py-4 flex items-center gap-3">
              <span className="inline-block w-5 h-5 border-2 border-blue-500
                               border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-gray-800">
                {syncBusyMsg}
              </span>
            </div>
          </div>
        )}
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center gap-3">
          <h2 className="text-lg font-bold shrink-0">⚙️ 설정</h2>
          <span className="text-xs text-gray-500 truncate">{statusMsg}</span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-5 py-3 space-y-3 flex-1 flex flex-col min-h-0">
          {/* Google Drive 동기화 */}
          <div className="border border-gray-200 rounded p-2.5 bg-emerald-50/40 space-y-1.5">
            <div className="text-xs font-bold text-gray-700">
              💾 Google Drive 동기화 (선택)
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              내 Google Drive 의 숨김 폴더에 자동 백업하는 기능입니다.<br />
              (여러 기기에서 같은 종목(그룹) 데이터를 사용할 수 있습니다.)<br />
              별도로 사용자의 정보를 서버에 저장하지는 않습니다.
            </div>
            {syncState === "unconfigured" && (
              <button
                disabled={syncBusy}
                onClick={async () => {
                  setSyncBusy(true);
                  setSyncBusyMsg("Google 로그인 중...");
                  setStatusMsg("Google 로그인 중...");
                  try {
                    await enableSync();
                    setSyncState("off");
                    // 로그인 후 — Drive 에 파일 있으면 다운로드, 없으면 업로드
                    setSyncBusyMsg("Drive 데이터 확인 중...");
                    const downloaded = await downloadFromDrive();
                    if (downloaded) {
                      onChanged();
                      setStatusMsg("✅ 로그인 + Drive 데이터 가져옴 (자동 sync OFF)");
                    } else {
                      setSyncBusyMsg("첫 업로드 중...");
                      await uploadToDrive();
                      setStatusMsg("✅ 로그인 + 첫 업로드 완료 (자동 sync OFF)");
                    }
                    setLastSyncedAt(getLastSyncedAt());
                  } catch (e) {
                    const msg = (e as Error).message;
                    alert(`❌ Google 로그인 / 동기화 실패\n\n${msg}`);
                    setStatusMsg(`⚠️ ${msg}`);
                  } finally {
                    setSyncBusy(false);
                    setSyncBusyMsg("");
                  }
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700
                           disabled:opacity-50 text-white text-sm rounded">
                🔐 Google 로그인 + 동기화 시작
              </button>
            )}
            {(syncState === "on" || syncState === "off") && (
              <div className="space-y-1.5">
                {/* 상태: 자동 동기화 [ON|OFF] 토글 */}
                <div className="text-xs text-gray-700 flex items-center gap-2">
                  <span>상태: 자동 동기화</span>
                  <button onClick={() => {
                    if (syncState === "on") { pauseSync(); setSyncState("off"); setStatusMsg("자동 sync OFF"); }
                    else { resumeSync(); setSyncState("on"); setStatusMsg("자동 sync ON"); }
                  }}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition ${
                      syncState === "on"
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-200 text-gray-600"
                    }`}>
                    {syncState === "on" ? "ON" : "OFF"}
                  </button>
                  {lastSyncedAt && (
                    <span className="text-gray-500 ml-auto">
                      마지막: {new Date(lastSyncedAt).toLocaleString("ko-KR")}
                    </span>
                  )}
                </div>
                {/* 업로드 / 다운로드 / 로그아웃 — 항상 표시 */}
                <div className="flex gap-2 flex-wrap">
                  <button disabled={syncBusy}
                    onClick={async () => {
                      setSyncBusy(true);
                      setSyncBusyMsg("Drive 에 업로드 중...");
                      try {
                        await uploadToDrive();
                        setLastSyncedAt(getLastSyncedAt());
                        setStatusMsg("✅ Drive 에 업로드");
                      } catch (e) {
                        const msg = (e as Error).message;
                        alert(`❌ Drive 업로드 실패\n\n${msg}\n\n로그인 만료 또는 네트워크 문제일 수 있습니다.`);
                        setStatusMsg(`⚠️ ${msg}`);
                      } finally { setSyncBusy(false); setSyncBusyMsg(""); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↑ 업로드
                  </button>
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("Drive 의 데이터로 이 기기를 덮어씁니다. 계속할까요?")) return;
                      setSyncBusy(true);
                      setSyncBusyMsg("Drive 에서 다운로드 중...");
                      try {
                        const ok = await downloadFromDrive();
                        if (ok) {
                          onChanged();
                          setLastSyncedAt(getLastSyncedAt());
                          setStatusMsg("✅ Drive 에서 가져옴");
                        } else {
                          alert("⚠️ Drive 에 저장된 데이터가 없습니다.\n\n먼저 [↑ 업로드] 로 현재 기기 데이터를 Drive 에 저장하세요.");
                          setStatusMsg("⚠️ Drive 에 데이터 없음");
                        }
                      } catch (e) {
                        const msg = (e as Error).message;
                        alert(`❌ Drive 다운로드 실패\n\n${msg}\n\n로그인 만료된 경우, 로그아웃 후 다시 로그인하세요.`);
                        setStatusMsg(`⚠️ ${msg}`);
                      } finally { setSyncBusy(false); setSyncBusyMsg(""); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↓ 다운로드
                  </button>
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("로그아웃 + 동기화 설정 해제?")) return;
                      setSyncBusy(true);
                      try { await disableSync(); setSyncState("unconfigured"); setLastSyncedAt(null); }
                      finally { setSyncBusy(false); }
                    }}
                    className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs rounded ml-auto">
                    🚪 로그아웃
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 전용 프록시 URL */}
          <div className="border border-gray-200 rounded p-2.5 bg-blue-50/30 space-y-1">
            <div className="text-xs font-bold text-gray-700">
              🔧 내 전용 프록시 URL (선택)
            </div>
            <div className="text-[11px] text-gray-500">
              비워두면 공개 4-way (Cloudflare/Vercel/Deno/Render). 본인 worker URL 입력 시
              본인만 사용 — 공개 부담 0, 본인 100k/일 무료. 가이드:&nbsp;
              <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md"
                 target="_blank" rel="noopener noreferrer"
                 className="text-blue-600 underline">
                Cloudflare Worker 1-click 배포
              </a>
            </div>
            <div className="flex gap-2">
              <input type="text" value={proxyUrl}
                     onChange={e => setProxyUrl(e.target.value)}
                     placeholder="예: https://your-proxy.workers.dev"
                     className="flex-1 border rounded px-2 py-1 text-xs font-mono
                                focus:outline-none focus:border-blue-500" />
              <button onClick={saveProxy}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700
                                 text-white text-xs rounded">
                저장
              </button>
            </div>
            {/* 폴링 주기 — 전용 프록시 있을 때만 의미 (공개는 항상 10초) */}
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] ${proxyUrl ? "text-gray-700" : "text-gray-400"}`}>
                폴링 주기:
              </span>
              {POLL_OPTIONS.map(ms => {
                const sec = ms / 1000;
                const active = pollMs === ms;
                const enabled = !!proxyUrl;
                return (
                  <button key={ms}
                          onClick={() => handlePollChange(ms)}
                          disabled={!enabled}
                          className={`px-2 py-0.5 text-[11px] rounded border transition
                                      ${active
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
                                      ${!enabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                    {sec}초
                  </button>
                );
              })}
              {!proxyUrl && (
                <span className="text-[10px] text-gray-400 ml-1">
                  (공개 프록시는 10초 고정)
                </span>
              )}
            </div>

            {/* 장 마감 종목 흐리게 표시 */}
            <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" defaultChecked={getDimSleepingEnabled()}
                     onChange={e => {
                       setDimSleepingEnabled(e.target.checked);
                       setStatusMsg(`✅ 장 마감 흐리게: ${e.target.checked ? "ON" : "OFF"}`);
                       onChanged();
                     }}
                     className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
              <span className="flex-1">
                <span className="text-[11px] text-gray-700 font-medium block">
                  장 마감 시 종목 흐리게 표시
                </span>
                <span className="text-[10px] text-gray-500">
                  마지막 체결로부터 시간이 지난 종목이나 정규장 외 시간에
                  카드를 60% 투명도로 표시합니다. 끄면 항상 또렷하게 보입니다.
                </span>
              </span>
            </label>

            {/* 그룹별 독립 보유 모드 — 다중 계좌 시나리오 */}
            <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" checked={independentMode}
                     onChange={e => handleIndependentToggle(e.target.checked)}
                     className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
              <span className="flex-1">
                <span className="text-[11px] text-gray-700 font-medium block">
                  그룹별 독립 보유 (다중 계좌)
                </span>
                <span className="text-[10px] text-gray-500">
                  ON: 같은 종목을 그룹별 다른 평단/수량으로 관리 (예: A 증권사 vs B 증권사 계좌).<br/>
                  OFF (기본): 같은 종목은 모든 그룹에서 동일 값 (한 종목을 보유·관심 동시 노출).
                </span>
              </span>
            </label>
          </div>

          <div className="text-sm text-gray-600">
            포트폴리오 데이터 (JSON) — holdings + peaks 통합
          </div>
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            className="flex-1 min-h-[260px] w-full p-3 border border-gray-300 rounded
                       font-mono text-xs resize-none
                       focus:outline-none focus:border-blue-400"
            spellCheck={false} />

          {/* 미리보기 / 검증 결과 */}
          {result && result.kind === "error" && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              ✗ {result.error}
            </div>
          )}
          {result && result.kind === "holdings" && (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              ✓ holdings: {result.stocks.length}건 (피크는 변경 없음)
            </div>
          )}
          {result && result.kind === "peaks" && (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              ✓ peaks: {Object.keys(result.peaks).length}건 (보유는 변경 없음)
            </div>
          )}
          {result && result.kind === "combined" && (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              ✓ combined: 종목 {result.stocks.length}건 + 피크 {Object.keys(result.peaks).length}건
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50
                            flex items-center gap-2 flex-wrap">
          <button onClick={() => void handleCopy()}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                             text-white rounded text-sm">
            📋 복사하기
          </button>
          <button onClick={() => void handlePaste()}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                             text-gray-700 rounded text-sm">
            📥 붙여넣기
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                               text-gray-700 rounded text-sm">
              닫기
            </button>
            <button onClick={() => void handleApply()}
                    disabled={!result || result.kind === "error" || busy}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700
                               disabled:bg-gray-300
                               text-white rounded text-sm font-bold">
              {busy ? "저장 중..." : "💾 적용 (덮어쓰기)"}
            </button>
          </div>
        </footer>
      </div>
      {conflicts && (
        <GroupConflictDialog
          conflicts={conflicts}
          onResolved={() => {
            // 충돌 해결 후 — 독립 모드 OFF 적용
            setIndependentGroupsMode(false);
            setIndependent(false);
            setStatusMsg("✅ 그룹 동기화 모드로 전환됨");
            onChanged();
          }}
          onClose={() => setConflicts(null)} />
      )}
    </div>
  );
}
