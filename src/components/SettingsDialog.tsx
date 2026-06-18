import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks, applyImportedSettings, replaceAllMemos, replaceAllTrades,
} from "../lib/db";
import {
  getPersonalProxies, setPersonalProxies, type PersonalProxy,
  fetchProxyUsage, type ProxyUsage,
  getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS, PUBLIC_MIN_POLL_MS,
  getDimSleepingEnabled, setDimSleepingEnabled,
  checkPersonalProxyPostSupport, checkPersonalProxyInvestingSupport,
  invalidatePersonalProxyStatusCache,
  type PersonalProxyStatus,
} from "../lib/proxyConfig";
import { getTodayProxyCalls, getRecentProxyCalls } from "../lib/usageCounter";
import { resetProxyStats } from "../lib/proxyStatus";

const UPDATE_GUIDE_URL = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/UPDATE-POST-SUPPORT.md";
const USAGE_GUIDE_URL = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/PROXY-USAGE.md";
import { getIndependentGroupsMode, setIndependentGroupsMode } from "../lib/groupMode";
import { getTabVisibility, setTabVisibility, getMarketSplit, setMarketSplit } from "../lib/tabVisibility";
import { getGroupFolders, setGroupFolders, type GroupFolder } from "../lib/groupFolders";
import { findTickerConflicts, type TickerConflict } from "../lib/db";
import { GroupConflictDialog } from "./GroupConflictDialog";
import { detectPortfolioJson } from "../lib/portfolioImport";
import {
  getSyncState, getLastSyncedAt, disableSync, pauseSync,
  uploadToDrive, downloadFromDrive, tryRestoreSession,
  setPendingSyncAction, peekPendingSyncAction, clearPendingSyncAction,
  type PendingSyncAction,
} from "../lib/syncManager";
import { isSignedIn, getAccessToken, wasSignedIn, signIn } from "../lib/googleAuth";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;          // 적용 후 부모 reload 트리거
  groups?: string[];              // 사용자 그룹 이름 (폴더 관리용)
}

export function SettingsDialog({ isOpen, onClose, onChanged, groups = [] }: Props) {
  useEscClose(isOpen, onClose);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const downOnBackdropRef = useRef(false);
  const [proxies, setProxies] = useState<PersonalProxy[]>([]);
  // 프록시별 사용량 (워커 /usage) — url → 결과/상태
  const [usage, setUsage] = useState<Record<string, ProxyUsage | "unsupported" | "loading">>({});
  const [pollMs, setPollMs] = useState(10_000);
  // syncState 값은 더 이상 직접 안 읽음(저장/불러오기 항상 노출) — setter 로 만료 시 상태만 갱신
  const [, setSyncState] = useState(getSyncState());
  const [proxyStatus, setProxyStatus] = useState<PersonalProxyStatus | "checking">("checking");
  const [investStatus, setInvestStatus] = useState<PersonalProxyStatus | "checking">("checking");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncBusyMsg, setSyncBusyMsg] = useState("");   // 진행 중 오버레이 메시지
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(getLastSyncedAt());
  const [signedIn, setSignedIn] = useState(isSignedIn());  // 구글 로그인 여부 (UI 반응형)
  const [independentMode, setIndependent] = useState(getIndependentGroupsMode());
  const [conflicts, setConflicts] = useState<TickerConflict[] | null>(null);
  const [tabVis, setTabVis] = useState(getTabVisibility());
  const [folders, setFolders] = useState<GroupFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");

  const persistFolders = (next: GroupFolder[]) => {
    setFolders(next);
    setGroupFolders(next);
    onChanged();
  };
  const addFolder = () => {
    const n = newFolderName.trim();
    if (!n || folders.some(f => f.name === n)) return;
    persistFolders([...folders, { name: n, groups: [] }]);
    setNewFolderName("");
  };
  const toggleGroupInFolder = (folderName: string, group: string, checked: boolean) => {
    // 한 그룹은 한 폴더만 — 체크 시 다른 폴더에서 제거
    const next = folders.map(f => {
      if (f.name === folderName) {
        return { ...f, groups: checked ? Array.from(new Set([...f.groups, group])) : f.groups.filter(g => g !== group) };
      }
      return checked ? { ...f, groups: f.groups.filter(g => g !== group) } : f;
    });
    persistFolders(next);
  };

  const toggleTab = (key: "usMarket" | "semiCheck" | "sectorRank" | "myStocks" | "myTrades" | "consensus" | "etfReverse", v: boolean) => {
    const next = { ...tabVis, [key]: v };
    setTabVis(next);
    setTabVisibility({ [key]: v });
    const labelMap = { usMarket: "지수", semiCheck: "반도체", sectorRank: "섹터", myStocks: "내주식", myTrades: "내거래", consensus: "컨센서스", etfReverse: "ETF검색" };
    setStatusMsg(`✅ ${labelMap[key]} 탭: ${v ? "표시" : "숨김"}`);
    onChanged();
  };

  const handleIndependentToggle = async (next: boolean) => {
    if (next) {
      // ON 으로 토글 — 즉시 적용 (확인창)
      if (!window.confirm(
        "그룹별 독립 보유(다중 계좌) 모드를 켤까요?\n\n"
        + "같은 종목을 그룹마다 다른 수량·평단으로 따로 관리합니다.\n"
        + "※ 즉시 적용됩니다 (하단 '적용' 버튼과 무관)."
      )) return;   // 취소 시 체크박스 원복
      setIndependentGroupsMode(true);
      setIndependent(true);
      window.alert("✅ 그룹별 독립 보유 모드 ON (적용됨)");
      onChanged();
    } else {
      // OFF 로 토글 — 충돌 검사 후 모달 (있으면)
      const list = await findTickerConflicts();
      if (list.length === 0) {
        if (!window.confirm(
          "그룹별 동기화 모드로 바꿀까요?\n\n"
          + "같은 종목은 모든 그룹에서 동일한 수량·평단을 갖습니다.\n"
          + "※ 즉시 적용됩니다."
        )) return;
        setIndependentGroupsMode(false);
        setIndependent(false);
        window.alert("✅ 그룹별 동기화 모드 (적용됨)");
        onChanged();
      } else {
        // 모달 띄워 사용자에게 해결 방법 묻기 — 모달 닫힌 후 모드 전환
        setConflicts(list);
      }
    }
  };

  // 다이얼로그 열릴 때마다 현재 데이터 로드
  useEffect(() => {
    if (!isOpen) return;
    const px = getPersonalProxies();
    setProxies(px);
    refreshUsage(px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setPollMs(getPersonalPollMs());
    setSyncState(getSyncState());
    setLastSyncedAt(getLastSyncedAt());
    setIndependent(getIndependentGroupsMode());
    // 개인 프록시 POST 호환성 검증 — 캐시된 결과 우선, 없으면 비동기 호출
    setProxyStatus("checking");
    void checkPersonalProxyPostSupport().then(setProxyStatus);
    setInvestStatus("checking");
    void checkPersonalProxyInvestingSupport().then(setInvestStatus);
    setFolders(getGroupFolders());
    // 다이얼로그 열 때 — 토큰 silent refresh 시도, 실패하면 자동 logout (설정 안에서만 표시)
    // 평소 다른 곳에선 로그인 UI 가 안 보임 (업로드/다운로드 시점에만 필요)
    setSignedIn(isSignedIn());
    void (async () => {
      if (isSignedIn()) {
        void tryRestoreSession();   // 백그라운드 silent refresh
        return;
      }
      if (!wasSignedIn()) return;
      const token = await getAccessToken();
      setSignedIn(!!token);
      if (!token && getSyncState() !== "unconfigured") {
        await disableSync();
        setSyncState("unconfigured");
        setLastSyncedAt(null);
        setStatusMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
      }
    })();
    void (async () => {
      const data = await exportAll();
      setStatusMsg(`현재: 종목 ${data.holdings.length}건`);
    })();
  }, [isOpen]);

  // ─── Drive 저장/불러오기 — 로그인 안 돼 있으면 로그인 후 자동 재개 ───
  // 토큰 만료/미로그인 에러 공통 처리 → 로그아웃 상태로 전환
  const handleSyncAuthError = useCallback(async (msg: string): Promise<boolean> => {
    if (/Not signed in|401|invalid.?token/i.test(msg)) {
      await disableSync();
      setSyncState("unconfigured");
      setSignedIn(false);
      setLastSyncedAt(null);
      setStatusMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
      return true;
    }
    return false;
  }, []);

  const doUpload = useCallback(async () => {
    setSyncBusy(true);
    setSyncBusyMsg("Drive 에 저장 중...");
    try {
      await uploadToDrive();
      pauseSync();
      setSyncState("off");
      setSignedIn(true);
      setLastSyncedAt(getLastSyncedAt());
      setStatusMsg("✅ Drive 에 저장됨");
    } catch (e) {
      const msg = (e as Error).message;
      if (await handleSyncAuthError(msg)) return;
      alert(`❌ Drive 저장 실패\n\n${msg}\n\n네트워크 문제일 수 있습니다.`);
      setStatusMsg(`⚠️ ${msg}`);
    } finally { setSyncBusy(false); setSyncBusyMsg(""); }
  }, [handleSyncAuthError]);

  const doDownload = useCallback(async () => {
    if (!confirm("Drive 의 데이터로 이 기기를 덮어씁니다. 계속할까요?")) return;
    setSyncBusy(true);
    setSyncBusyMsg("Drive 에서 불러오는 중...");
    try {
      const ok = await downloadFromDrive();
      if (ok) {
        onChanged();
        pauseSync();
        setSyncState("off");
        setSignedIn(true);
        setLastSyncedAt(getLastSyncedAt());
        window.alert("✅ Drive 에서 불러왔습니다.");
        onClose();   // 닫아서 메인 UI(그룹 폴더 등) 즉시 반영
      } else {
        alert("⚠️ Drive 에 저장된 데이터가 없습니다.\n\n먼저 [↑ 저장하기] 로 현재 기기 데이터를 Drive 에 저장하세요.");
        setStatusMsg("⚠️ Drive 에 데이터 없음");
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (await handleSyncAuthError(msg)) return;
      alert(`❌ Drive 가져오기 실패\n\n${msg}\n\n네트워크 문제일 수 있습니다.`);
      setStatusMsg(`⚠️ ${msg}`);
    } finally { setSyncBusy(false); setSyncBusyMsg(""); }
  }, [handleSyncAuthError, onChanged, onClose]);

  // 미로그인 시 — 동작 저장 후 로그인 redirect. 돌아오면 resume 효과가 자동 실행.
  const startLoginThen = useCallback((action: PendingSyncAction) => {
    setPendingSyncAction(action);
    setStatusMsg("Google 로그인 중...");
    setSyncBusy(true);
    setSyncBusyMsg("Google 로그인 중...");
    signIn();   // 전체 페이지 redirect — 이후 코드는 실행 안 됨
  }, []);

  const onUploadClick = useCallback(() => {
    if (isSignedIn()) void doUpload();
    else startLoginThen("upload");
  }, [doUpload, startLoginThen]);

  const onDownloadClick = useCallback(() => {
    if (isSignedIn()) void doDownload();
    else startLoginThen("download");
  }, [doDownload, startLoginThen]);

  // 로그인 redirect 복귀 후 설정이 다시 열리면 — 저장해둔 동작 자동 재개
  useEffect(() => {
    if (!isOpen) return;
    const pending = peekPendingSyncAction();
    if (!pending) return;
    clearPendingSyncAction();
    if (!isSignedIn()) return;   // 로그인 취소/실패 — 조용히 폐기
    // effect 본문에서 직접 setState 회피 — 다음 tick 에 실행
    const t = setTimeout(() => {
      if (pending === "upload") void doUpload();
      else void doDownload();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 행 편집 헬퍼
  const updateProxy = (i: number, patch: Partial<PersonalProxy>) =>
    setProxies(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  const removeProxy = (i: number) => setProxies(ps => ps.filter((_, idx) => idx !== i));
  const addProxy = () => setProxies(ps => [...ps, { url: "", enabled: true }]);
  const hasEnabledProxy = proxies.some(p => p.enabled && p.url.trim() !== "");

  // 켜진 프록시들 사용량 조회 (워커 /usage)
  const refreshUsage = (list: PersonalProxy[]) => {
    for (const p of list) {
      const url = p.url.trim().replace(/\/+$/, "");
      if (!p.enabled || !url) continue;
      setUsage(u => ({ ...u, [url]: "loading" }));
      void fetchProxyUsage(url).then(r => setUsage(u => ({ ...u, [url]: r ?? "unsupported" })));
    }
  };

  // 한 프록시 실제 호출 검증 (Naver 검색 health check)
  const verifyOne = async (v: string): Promise<boolean> => {
    try {
      const testTarget = "https://m.stock.naver.com/api/json/search/searchListJson.nhn?keyword=samsung";
      const resp = await fetch(`${v}/?url=${encodeURIComponent(testTarget)}`, {
        method: "GET", signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return false;
      const text = await resp.text();
      return text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
    } catch { return false; }
  };

  const saveProxies = async () => {
    // 형식 검증 (비어있지 않은 url 만)
    for (const p of proxies) {
      const v = p.url.trim();
      if (!v) continue;
      try {
        const u = new URL(v);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("proto");
      } catch {
        alert(`❌ 잘못된 URL 형식\n입력: ${v}\n\n예: https://your-proxy.workers.dev`);
        return;
      }
    }
    const cleaned = proxies
      .map(p => ({ url: p.url.trim().replace(/\/+$/, ""), enabled: !!p.enabled }))
      .filter(p => p.url);

    // 켜진 프록시들 실제 호출 검증 (하나라도 실패하면 경고만, 저장은 진행)
    const enabled = cleaned.filter(p => p.enabled);
    if (enabled.length > 0) {
      setStatusMsg("⏳ 프록시 검증 중...");
      const results = await Promise.all(enabled.map(p => verifyOne(p.url)));
      const failed = enabled.filter((_, i) => !results[i]).map(p => p.url);
      if (failed.length > 0) {
        const ok = confirm(`⚠️ 응답 확인 실패한 프록시:\n${failed.join("\n")}\n\n그래도 저장할까요? (오타·미배포 가능)`);
        if (!ok) { setStatusMsg(""); return; }
      }
    }

    setPersonalProxies(cleaned);
    const saved = getPersonalProxies();
    setProxies(saved);
    refreshUsage(saved);
    resetProxyStats();              // 옛 down 상태 제거 → 적응형 polling 즉시 정상화
    queryClient.invalidateQueries();
    invalidatePersonalProxyStatusCache();
    setProxyStatus("checking");
    void checkPersonalProxyPostSupport().then(setProxyStatus);
    setInvestStatus("checking");
    void checkPersonalProxyInvestingSupport().then(setInvestStatus);
    setFolders(getGroupFolders());
    onChanged();
    const n = cleaned.filter(p => p.enabled).length;
    setStatusMsg(n === 0
      ? "✅ 전용 프록시 없음 — 공개 4-way 사용"
      : `✅ 전용 프록시 ${n}개 적용${n > 1 ? " (요청마다 랜덤 분산)" : ""}`);
  };

  const handlePollChange = (ms: number) => {
    setPollMs(ms);
    setPersonalPollMs(ms);
    setStatusMsg(ms === 0
      ? "✅ 수동 모드 — 자동 갱신 끔 (갱신 버튼/탭 진입 시에만)"
      : `✅ 폴링 주기 ${ms / 1000}초 적용`);
    onChanged();
  };

  if (!isOpen) return null;

  // 파일로 저장 — 현재 전체 데이터/설정을 .json 파일로 다운로드
  const handleDownloadFile = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg("💾 파일로 저장됨");
  };

  // 파싱된 데이터 적용 (덮어쓰기)
  const applyResult = async (result: ReturnType<typeof detectPortfolioJson>) => {
    if (!result || result.kind === "error") {
      alert(`❌ 불러올 수 없는 파일입니다\n\n${result?.kind === "error" ? result.error : ""}`);
      return;
    }
    if (!window.confirm(
      "이 파일로 덮어쓸까요?\n\n"
      + "⚠️ 현재 보유·예수금·그룹·폴더·탭 등 모든 데이터/설정이 교체됩니다.\n"
      + "되돌릴 수 없습니다."
    )) return;
    setBusy(true);
    try {
      if (result.kind === "holdings" || result.kind === "combined") await replaceAllHoldings(result.stocks);
      if (result.kind === "peaks" || result.kind === "combined") await replaceAllPeaks(result.peaks);
      if (result.kind === "holdings" || result.kind === "combined") {
        applyImportedSettings(result.settings);
        if (result.memos) await replaceAllMemos(result.memos);
        if (result.trades) await replaceAllTrades(result.trades);
      }
      setStatusMsg("💾 가져오기 완료");
      onChanged();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`❌ 적용 실패\n\n${msg}`);
    } finally {
      setBusy(false);
    }
  };

  // 파일에서 불러오기 — .json 선택 → 파싱 → 적용
  const handleLoadFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        await applyResult(detectPortfolioJson(await f.text()));
      } catch {
        alert("❌ 파일 읽기 실패");
      }
    };
    input.click();
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
          <h2 className="text-lg font-bold shrink-0 inline-flex items-center gap-1.5">
            <Settings size={18} strokeWidth={2.2} className="text-slate-700" /> 설정
          </h2>
          <span className="text-xs text-gray-500 truncate">{statusMsg}</span>
          {/* 개발이력 — GitHub commit 로그 (외부 링크: 새 탭).
              헤더 우측에 border 박스 + ↗ 으로 외부 링크임을 명시 */}
          <a href="https://github.com/hanjungwoo3/portfolio-web/commits/main/"
             target="_blank" rel="noopener noreferrer"
             className="ml-auto inline-flex items-center gap-1 px-2 py-1
                        border border-blue-200 rounded
                        text-[11px] text-blue-700 bg-blue-50/50
                        hover:bg-blue-100/70 hover:border-blue-300
                        whitespace-nowrap">
            GitHub 의 최근 변경/수정 commit 목록 <span className="text-[9px]">↗</span>
          </a>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-5 py-3 space-y-3 flex-1 flex flex-col min-h-0 overflow-y-auto">
          {/* Google Drive 동기화 */}
          <div className="border border-gray-200 rounded p-2.5 bg-emerald-50/40 space-y-1.5">
            <div className="text-xs font-bold text-gray-700">
              💾 Google Drive 동기화
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              내 드라이브에 저장하고 다른 기기에서 불러와 공유합니다.
            </div>
            {/* 로그인 안 돼 있어도 저장/불러오기 항상 노출 — 누르면 로그인 후 자동 실행 */}
            <div className="space-y-1.5">
              {signedIn && lastSyncedAt && (
                <div className="text-[11px] text-gray-500">
                  마지막 동기화: {new Date(lastSyncedAt).toLocaleString("ko-KR")}
                </div>
              )}
              {!signedIn && (
                <div className="text-[11px] text-amber-700">
                  🔐 로그인 안 됨 — 저장/가져오기를 누르면 Google 로그인 후 그대로 실행됩니다.
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <button disabled={syncBusy}
                  onClick={onUploadClick}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                  ↑ 저장하기
                </button>
                <button disabled={syncBusy}
                  onClick={onDownloadClick}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                  ↓ 가져오기
                </button>
                {signedIn && (
                  <button disabled={syncBusy}
                    onClick={async () => {
                      if (!confirm("로그아웃 + 동기화 설정 해제?")) return;
                      setSyncBusy(true);
                      try {
                        await disableSync();
                        setSyncState("unconfigured");
                        setSignedIn(false);
                        setLastSyncedAt(null);
                      } finally { setSyncBusy(false); }
                    }}
                    className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs rounded ml-auto">
                    🚪 로그아웃
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 파일 백업 — 저장 / 불러오기 */}
          <div className="border border-gray-200 rounded p-2.5 bg-gray-50/60 space-y-1.5">
            <div className="text-xs font-bold text-gray-700">📁 파일 백업 (전체 데이터·설정)</div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => void handleDownloadFile()}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium">
                💾 파일로 저장하기
              </button>
              <button onClick={handleLoadFile}
                      disabled={busy}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40
                                 text-gray-700 rounded text-xs font-medium">
                📂 파일에서 가져오기
              </button>
            </div>
            <div className="text-[10px] text-gray-500">
              보유·예수금·그룹·폴더·탭·거래기록 등 모든 데이터를 .json 파일로 백업/복원합니다. (가져오기 = 전체 덮어쓰기)
            </div>
          </div>

          {/* 전용 프록시 URL */}
          <div className="border border-gray-200 rounded p-2.5 bg-blue-50/30 space-y-1">
            <div className="text-xs font-bold text-gray-700">
              🔧 내 전용 프록시 (여러 개 가능)
            </div>
            <div className="text-[11px] text-gray-500">
              없으면 공개 4-way (Cloudflare/Vercel/Deno/Render). 본인 worker URL 등록 시
              본인만 사용 — 공개 부담 0, 본인 100k/일 무료. <b>여러 개 등록 후 각각 켜고 끌 수 있고,
              켜진 게 여러 개면 요청마다 랜덤 분산</b>됩니다. 가이드:&nbsp;
              <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md"
                 target="_blank" rel="noopener noreferrer"
                 className="text-blue-600 underline">
                Cloudflare Worker 1-click 배포
              </a>
            </div>
            <div className="space-y-1.5">
              {proxies.length === 0 && (
                <div className="text-[11px] text-gray-400 py-1">
                  등록된 전용 프록시 없음 — 공개 4-way 사용 중
                </div>
              )}
              {proxies.map((p, i) => {
                const url = p.url.trim().replace(/\/+$/, "");
                const u = p.enabled && url ? usage[url] : undefined;
                return (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <input type="checkbox" checked={p.enabled}
                             onChange={e => updateProxy(i, { enabled: e.target.checked })}
                             title={p.enabled ? "사용 중 — 끄려면 클릭" : "꺼짐 — 켜려면 클릭"}
                             className="shrink-0 w-4 h-4 accent-blue-600" />
                      <input type="text" value={p.url}
                             onChange={e => updateProxy(i, { url: e.target.value })}
                             placeholder="예: https://your-proxy.workers.dev"
                             className={`flex-1 border rounded px-2 py-1 text-xs font-mono
                                         focus:outline-none focus:border-blue-500
                                         ${p.enabled ? "" : "opacity-50 line-through"}`} />
                      <button onClick={() => removeProxy(i)} title="삭제"
                              className="shrink-0 px-1.5 py-1 text-gray-400 hover:text-rose-600 text-xs">
                        ✕
                      </button>
                    </div>
                    {/* 사용량 — 신버전 워커(/usage) 만. 구버전이면 안내 */}
                    {u && u !== "loading" && (
                      u === "unsupported" ? (
                        <div className="text-[10px] text-amber-600 pl-6">
                          사용량 표시하려면 워커 업데이트 필요(/usage).&nbsp;
                          <a href={USAGE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="underline">가이드 ↗</a>
                        </div>
                      ) : (() => {
                        const pct = u.limit > 0 ? Math.min(100, (u.requests / u.limit) * 100) : 0;
                        return (
                          <div className="pl-6 flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-600 tabular-nums shrink-0">
                              오늘 {u.requests.toLocaleString()} / {u.limit.toLocaleString()}
                            </span>
                            <span className="flex-1 h-1 bg-gray-200 rounded overflow-hidden">
                              <span className={`block h-full ${pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                                    style={{ width: `${pct}%` }} />
                            </span>
                            <span className="text-[9px] text-gray-400 shrink-0" title="Cloudflare 무료 한도는 00:00 UTC(=09:00 KST)에 리셋">매일 09시 리셋</span>
                          </div>
                        );
                      })()
                    )}
                  </div>
                );
              })}
              <div className="flex gap-2 pt-0.5">
                <button onClick={addProxy}
                        className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs
                                   rounded border border-gray-200">
                  ➕ 프록시 추가
                </button>
                <button onClick={saveProxies}
                        className="ml-auto px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded">
                  저장
                </button>
              </div>
            </div>
            {/* POST 미지원 (구버전) 워커 경고 */}
            {proxyStatus === "outdated" && (
              <div className="p-2 bg-amber-50 border border-amber-300 rounded text-[11px]">
                <p className="font-bold text-amber-800">
                  ⚠️ 등록하신 워커가 구버전 (POST 미지원) 입니다
                </p>
                <p className="text-amber-700 mt-0.5 leading-relaxed">
                  기존 기능은 정상 작동합니다. 컨센서스 예상치 차트만 비어 보입니다.
                </p>
                <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer"
                   className="inline-block mt-1.5 text-amber-700 underline font-bold">
                  📘 5분 업데이트 가이드 ↗
                </a>
              </div>
            )}
            {/* investing 호스트 미허용 (구버전) 워커 경고 — V-KOSPI */}
            {investStatus === "outdated" && (
              <div className="p-2 bg-amber-50 border border-amber-300 rounded text-[11px]">
                <p className="font-bold text-amber-800">
                  ⚠️ 등록하신 워커가 구버전 (V-KOSPI 미지원) 입니다
                </p>
                <p className="text-amber-700 mt-0.5 leading-relaxed">
                  기존 기능은 정상 작동합니다. V-KOSPI 등 일부 지수(investing.com)만 비어 보입니다.
                </p>
                <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer"
                   className="inline-block mt-1.5 text-amber-700 underline font-bold">
                  📘 5분 업데이트 가이드 ↗
                </a>
              </div>
            )}
            {/* 폴링 주기 — 공개는 30/60초·수동 선택, 5/10초는 전용 프록시 전용 */}
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] ${hasEnabledProxy ? "text-gray-700" : "text-gray-400"}`}>
                폴링 주기:
              </span>
              {POLL_OPTIONS.map(ms => {
                const active = pollMs === ms;
                // 수동(0)·공개 허용 주기(30초 이상=30/60초)는 프록시 무관 선택 가능.
                // 더 빠른 5/10초는 전용 프록시일 때만.
                const enabled = ms === 0 || ms >= PUBLIC_MIN_POLL_MS ? true : hasEnabledProxy;
                return (
                  <button key={ms}
                          onClick={() => handlePollChange(ms)}
                          disabled={!enabled}
                          className={`px-2 py-0.5 text-[11px] rounded border transition
                                      ${active
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
                                      ${!enabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                    {ms === 0 ? "수동" : `${ms / 1000}초`}
                  </button>
                );
              })}
              {!hasEnabledProxy && (
                <span className="text-[10px] text-gray-400 ml-1">
                  (공개: 기본 60초 · 30·60·수동 선택 · 5·10초는 전용 프록시)
                </span>
              )}
            </div>

            {/* 이 브라우저 호출량 — 일자별 카운터 (cache 히트 제외, 실제 네트워크 호출만) */}
            <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-600">
              <span className="text-gray-500">이 브라우저 호출</span>
              <span className="tabular-nums">
                오늘 <b className="text-gray-800">{getTodayProxyCalls().toLocaleString()}</b>회
              </span>
              <span className="tabular-nums">
                최근 7일 <b className="text-gray-800">{getRecentProxyCalls(7).toLocaleString()}</b>회
              </span>
              <span className="text-[10px] text-gray-400">
                {hasEnabledProxy ? "(전용 프록시 호출수)" : "(공개 프록시 합계)"}
              </span>
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

            {/* 코스피/코스닥 분리 보기 */}
            <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" defaultChecked={getMarketSplit()}
                     onChange={e => {
                       setMarketSplit(e.target.checked);
                       setStatusMsg(`✅ 시장 분리 보기: ${e.target.checked ? "ON" : "OFF"}`);
                       onChanged();
                     }}
                     className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
              <span className="flex-1">
                <span className="text-[11px] text-gray-700 font-medium block">
                  코스피 / 코스닥 분리 보기
                </span>
                <span className="text-[10px] text-gray-500">
                  ON: 그룹 종목을 코스피·코스닥·ETF·기타(미국상장 등)로 나눠 표시하고
                  상단 점프바로 각 섹션으로 이동합니다. 끄면 한 목록으로 봅니다.
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

            {/* 시스템 탭 표시/숨김 — 지수 / 반도체 / 내주식 */}
            <div className="mt-3 pt-2 border-t border-gray-200">
              <div className="text-[11px] text-gray-700 font-medium mb-1.5">
                상단 탭 표시
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tabVis.usMarket}
                         onChange={e => toggleTab("usMarket", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">📈 지수</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tabVis.sectorRank}
                         onChange={e => toggleTab("sectorRank", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">🧩 섹터</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tabVis.consensus}
                         onChange={e => toggleTab("consensus", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">🎯 컨센서스</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tabVis.etfReverse}
                         onChange={e => toggleTab("etfReverse", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">🍱 ETF검색</span>
                </label>
                {/* 내주식 / 내거래 — 묶음에서 빠진 개별 탭이라 구분선 뒤(오른쪽)에 한 묶음으로 배치 */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none pl-3 ml-1 border-l border-gray-200">
                  <input type="checkbox" checked={tabVis.myStocks}
                         onChange={e => toggleTab("myStocks", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">📦 내주식 (개별 탭)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tabVis.myTrades}
                         onChange={e => toggleTab("myTrades", e.target.checked)}
                         className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] text-gray-700">🧾 내거래 (개별 탭)</span>
                </label>
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                꺼두면 해당 탭이 상단 메뉴에서 사라집니다. 데이터는 보존됩니다.
                <br/>표시된 탭들은 상단에서 <b>📊 선택박스 하나</b>로 묶여 나옵니다.
              </div>
            </div>

            {/* 그룹 폴더 — 그룹을 폴더로 묶어 탭 단순화 */}
            {groups.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-200">
                <div className="text-[11px] text-gray-700 font-medium mb-1.5">📁 그룹 폴더</div>
                {folders.map(f => (
                  <div key={f.name} className="mb-2 p-2 border border-gray-200 rounded">
                    <div className="flex items-center mb-1">
                      <span className="text-xs font-bold text-gray-800">📁 {f.name}</span>
                      <button onClick={() => persistFolders(folders.filter(x => x.name !== f.name))}
                              className="ml-auto text-[10px] text-rose-500 hover:underline">폴더 삭제</button>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {groups.map(g => (
                        <label key={g} className="flex items-center gap-1 cursor-pointer select-none">
                          <input type="checkbox" checked={f.groups.includes(g)}
                                 onChange={e => toggleGroupInFolder(f.name, g, e.target.checked)}
                                 className="w-3.5 h-3.5 accent-blue-600" />
                          <span className="text-[11px] text-gray-700">{g}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 mt-1">
                  <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                         onKeyDown={e => { if (e.key === "Enter") addFolder(); }}
                         placeholder="새 폴더 이름 (예: 보따리)"
                         className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs
                                    focus:outline-none focus:border-blue-400" />
                  <button onClick={addFolder}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium">
                    추가
                  </button>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                  그룹을 폴더에 담으면 상단 탭에서 "📁 폴더 ▾" 드롭다운으로 합쳐 보입니다. (그룹은 한 폴더에만)
                </div>
              </div>
            )}
          </div>

        </div>

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
