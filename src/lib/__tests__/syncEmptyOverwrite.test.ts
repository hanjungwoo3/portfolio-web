// 빈 기기가 Drive 를 덮어쓰지 못하게 — 2026-10-20 사고 재발 방지.
//
// 실제로 있었던 일: 새 폰에 앱을 깔고 로그인했더니 Drive 의 기존 데이터가 사라졌다.
//   ① autoPush 는 '기준 시각(lastTs)이 없으면' Drive 가 앞서 있는지 검사를 건너뛰고 그냥 올렸다(새 설치 = 기준 없음).
//   ② 수동 ↑ 저장·충돌 배너 '이 기기 것'도 빈 로컬을 그대로 올릴 수 있었다.
//   → 업로드 직전 한 곳(guardedUpload)에서 막고, autoPush 는 기준이 없으면 충돌로 돌린다.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExportPayload } from "../db";

const drive = { file: null as null | { data: ExportPayload; modifiedTime: string }, uploads: 0 };
let local: ExportPayload;
const empty = (): ExportPayload => ({ holdings: [], peaks: {}, memos: [], trades: [], exported_at: "x" });
const full = (): ExportPayload => ({
  holdings: [{ ticker: "005930", name: "삼성전자", shares: 10, avg_price: 70000, account: "A" } as ExportPayload["holdings"][number]],
  peaks: {}, memos: [], trades: [], exported_at: "x",
});

vi.mock("../googleDrive", () => ({
  getFileMeta: async () => (drive.file ? { id: "f", name: "portfolio.json", modifiedTime: drive.file.modifiedTime } : null),
  downloadFile: async () => drive.file,
  uploadFile: async (p: ExportPayload) => { drive.uploads++; drive.file = { data: p, modifiedTime: "2026-10-20T00:00:01Z" }; return "2026-10-20T00:00:01Z"; },
  deleteFile: async () => {},
  listRevisions: async () => [],
  downloadRevision: async () => empty(),
}));
vi.mock("../googleAuth", () => ({
  signIn: () => {}, signOut: async () => {}, wasSignedIn: () => true, getAccessToken: async () => "tok",
}));
vi.mock("../db", () => ({
  exportAll: async () => local,
  replaceAllHoldings: async () => {}, replaceAllPeaks: async () => {}, replaceAllMemos: async () => {},
  replaceAllTrades: async () => {}, applyImportedSettings: () => {},
}));

// localStorage 대용 — 새 설치 기기 = 기준 시각·지문 없음
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("CustomEvent", class { type: string; constructor(type: string) { this.type = type; } });

const sm = await import("../syncManager");

beforeEach(() => {
  store.clear(); drive.uploads = 0;
  drive.file = { data: full(), modifiedTime: "2026-10-19T00:00:00Z" };   // Drive 엔 데이터가 있다
  local = empty();                                                        // 이 기기는 새로 깔아 비어 있다
});

describe("빈 기기 → Drive 덮어쓰기 차단", () => {
  it("새 설치(기준 시각 없음) 기기의 자동 올리기는 올리지 않고 충돌로 돌린다", async () => {
    store.set("gdrive_sync_mode", "on");
    expect(await sm.autoPush()).toBe("conflict");
    expect(drive.uploads).toBe(0);
    expect(drive.file?.data.holdings.length).toBe(1);
  });

  it("수동 ↑ 저장도 빈 로컬로 데이터 든 Drive 를 덮지 않는다", async () => {
    await expect(sm.uploadToDrive()).rejects.toBeInstanceOf(sm.EmptyOverwriteError);
    expect(drive.uploads).toBe(0);
  });

  it("충돌 배너 '이 기기 것'도 빈 로컬이면 거부한다", async () => {
    await expect(sm.resolveConflict("local")).rejects.toBeInstanceOf(sm.EmptyOverwriteError);
    expect(drive.uploads).toBe(0);
  });

  it("로컬에 데이터가 있으면 정상으로 올린다(가드가 정상 저장을 막지 않는다)", async () => {
    local = full(); local.holdings[0].shares = 20;
    await sm.uploadToDrive();
    expect(drive.uploads).toBe(1);
  });

  it("Drive 가 비어 있으면 빈 로컬도 올릴 수 있다(첫 저장)", async () => {
    drive.file = null;
    await sm.uploadToDrive();
    expect(drive.uploads).toBe(1);
  });
});
