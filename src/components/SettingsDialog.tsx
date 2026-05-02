import { useEffect, useRef, useState } from "react";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks,
} from "../lib/db";
import {
  getPersonalProxyUrl, setPersonalProxyUrl,
  getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS,
  getDimSleepingEnabled, setDimSleepingEnabled,
} from "../lib/proxyConfig";
import { detectPortfolioJson } from "../lib/portfolioImport";
import {
  getSyncState, getLastSyncedAt, enableSync, disableSync, pauseSync, resumeSync,
  uploadToDrive, downloadFromDrive,
} from "../lib/syncManager";
import { isSignedIn } from "../lib/googleAuth";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;          // 적용 후 부모 reload 트리거
}

export function SettingsDialog({ isOpen, onClose, onChanged }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const downOnBackdropRef = useRef(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [pollMs, setPollMs] = useState(10_000);
  const [syncState, setSyncState] = useState(getSyncState());
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(getLastSyncedAt());

  // 다이얼로그 열릴 때마다 현재 데이터 로드
  useEffect(() => {
    if (!isOpen) return;
    setProxyUrl(getPersonalProxyUrl() ?? "");
    setPollMs(getPersonalPollMs());
    setSyncState(getSyncState());
    setLastSyncedAt(getLastSyncedAt());
    void (async () => {
      const data = await exportAll();
      setRaw(JSON.stringify(data, null, 2));
      setStatusMsg(`현재: 종목 ${data.holdings.length}건 / 피크 ${Object.keys(data.peaks).length}건`);
    })();
  }, [isOpen]);

  const saveProxy = () => {
    const v = proxyUrl.trim().replace(/\/+$/, "");
    setPersonalProxyUrl(v || null);
    setProxyUrl(v);
    setStatusMsg(v ? `✅ 전용 프록시 적용: ${v}` : "✅ 전용 프록시 해제 — 공개 4-way 사용");
    onChanged();  // React Query refetch 트리거 (URL 즉시 반영)
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
      setStatusMsg(`❌ 저장 실패: ${e instanceof Error ? e.message : ""}`);
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
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full
                       max-h-[90vh] flex flex-col">
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
              💾 Google Drive 동기화 — 다기기 sync (선택)
            </div>
            <div className="text-[11px] text-gray-500">
              본인 Google 계정의 앱 전용 폴더에 종목·피크 자동 백업.
              로그인 정보·이메일 미수집, 우리 서버 통과 0.
            </div>
            {syncState === "unconfigured" && (
              <button
                disabled={syncBusy}
                onClick={async () => {
                  setSyncBusy(true);
                  setStatusMsg("Google 로그인 중...");
                  try {
                    await enableSync();
                    setSyncState("on");
                    // 로그인 후 — Drive 에 기존 파일 있으면 다운로드 우선 권유
                    const downloaded = await downloadFromDrive();
                    if (downloaded) {
                      onChanged();
                      setStatusMsg("✅ 로그인 + Drive 데이터 가져옴");
                    } else {
                      // 비어있으면 현재 IndexedDB 를 업로드
                      await uploadToDrive();
                      setStatusMsg("✅ 로그인 + 첫 업로드 완료");
                    }
                    setLastSyncedAt(getLastSyncedAt());
                  } catch (e) {
                    setStatusMsg(`⚠️ ${(e as Error).message}`);
                  } finally {
                    setSyncBusy(false);
                  }
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700
                           disabled:opacity-50 text-white text-sm rounded">
                🔐 Google 로그인 + 동기화 시작
              </button>
            )}
            {syncState === "on" && (
              <div className="space-y-1">
                <div className="text-xs text-gray-700">
                  상태: <b className="text-emerald-700">자동 동기화 ON</b>
                  {lastSyncedAt && (
                    <span className="ml-2 text-gray-500">
                      (마지막: {new Date(lastSyncedAt).toLocaleString("ko-KR")})
                    </span>
                  )}
                  {!isSignedIn() && (
                    <span className="ml-2 text-amber-600">(토큰 만료 — 다음 sync 시 자동 재로그인)</span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button disabled={syncBusy}
                    onClick={async () => {
                      setSyncBusy(true);
                      try {
                        await uploadToDrive();
                        setLastSyncedAt(getLastSyncedAt());
                        setStatusMsg("✅ Drive 에 업로드");
                      } catch (e) {
                        setStatusMsg(`⚠️ ${(e as Error).message}`);
                      } finally { setSyncBusy(false); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↑ 업로드
                  </button>
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("Drive 의 데이터로 이 기기를 덮어씁니다. 계속할까요?")) return;
                      setSyncBusy(true);
                      try {
                        const ok = await downloadFromDrive();
                        if (ok) {
                          onChanged();
                          setLastSyncedAt(getLastSyncedAt());
                          setStatusMsg("✅ Drive 에서 가져옴");
                        } else {
                          setStatusMsg("⚠️ Drive 에 데이터 없음");
                        }
                      } catch (e) {
                        setStatusMsg(`⚠️ ${(e as Error).message}`);
                      } finally { setSyncBusy(false); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↓ 다운로드
                  </button>
                  <button onClick={() => { pauseSync(); setSyncState("off"); setStatusMsg("자동 sync 일시 중지"); }}
                    className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded">
                    ⏸ 일시 중지
                  </button>
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("로그아웃 + 동기화 설정 해제. 계속?")) return;
                      setSyncBusy(true);
                      try {
                        await disableSync();
                        setSyncState("unconfigured");
                        setLastSyncedAt(null);
                        setStatusMsg("로그아웃 완료");
                      } finally { setSyncBusy(false); }
                    }}
                    className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs rounded ml-auto">
                    🚪 로그아웃
                  </button>
                </div>
              </div>
            )}
            {syncState === "off" && (
              <div className="space-y-1">
                <div className="text-xs text-gray-700">
                  상태: <b className="text-amber-700">일시 중지</b>
                  {lastSyncedAt && (
                    <span className="ml-2 text-gray-500">
                      (마지막: {new Date(lastSyncedAt).toLocaleString("ko-KR")})
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { resumeSync(); setSyncState("on"); setStatusMsg("자동 sync 재개"); }}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded">
                    ▶ 자동 sync 재개
                  </button>
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("로그아웃 + 동기화 설정 해제?")) return;
                      setSyncBusy(true);
                      try { await disableSync(); setSyncState("unconfigured"); setLastSyncedAt(null); }
                      finally { setSyncBusy(false); }
                    }}
                    className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs rounded">
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
    </div>
  );
}
