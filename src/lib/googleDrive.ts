// Google Drive REST — appdata 폴더 (앱 전용 숨김 영역) CRUD
// 사용자 본인 계정의 Drive 에 저장 / 다른 Drive 파일 접근 불가

import { getAccessToken, recoverFromUnauthorized } from "./googleAuth";

const FILE_NAME = "portfolio.json";
const META_FIELDS = "id,name,modifiedTime,size";

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;  // ISO 8601
  size?: string;
}

interface FileListResp {
  files?: DriveFile[];
}

async function authHeader(): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

// Drive 호출 공통 — 401 이면 토큰을 새로 받아 한 번만 다시 쏜다.
//   앱에서는 플레이 서비스가 무효한 토큰을 캐시에서 계속 돌려주는 경우가 있어
//   (로그아웃 때 revoke 만 하고 캐시를 안 비우면 그렇게 된다) 그냥 실패시키면
//   "로그인은 됐는데 저장/가져오기만 안 되는" 상태에 갇힌다.
//   재시도는 딱 한 번 — 무한 루프를 만들지 않는다.
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeader();
  const resp = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (resp.status !== 401) return resp;
  const fresh = await recoverFromUnauthorized();
  if (!fresh) return resp;
  return await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${fresh}`, ...(init.headers ?? {}) },
  });
}

// portfolio.json 파일 메타데이터 조회 — 없으면 null
export async function getFileMeta(): Promise<DriveFile | null> {
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder`
            + `&fields=files(${META_FIELDS})`
            + `&q=${encodeURIComponent(`name='${FILE_NAME}'`)}`;
  const resp = await driveFetch(url);
  if (!resp.ok) throw new Error(`Drive list 실패: ${resp.status}`);
  const data = await resp.json() as FileListResp;
  return data.files?.[0] ?? null;
}

// 파일 다운로드 — JSON 파싱
export async function downloadFile<T = unknown>(): Promise<{ data: T; modifiedTime: string } | null> {
  const meta = await getFileMeta();
  if (!meta) return null;
  const url = `https://www.googleapis.com/drive/v3/files/${meta.id}?alt=media`;
  const resp = await driveFetch(url);
  if (!resp.ok) throw new Error(`Drive download 실패: ${resp.status}`);
  const data = await resp.json() as T;
  return { data, modifiedTime: meta.modifiedTime };
}

// 파일 업로드 (생성 or 업데이트) — JSON 자동 직렬화
// 반환: 새 modifiedTime
export async function uploadFile<T>(payload: T): Promise<string> {
  const meta = await getFileMeta();
  const body = JSON.stringify(payload);

  // 신규 — multipart upload (metadata + content)
  if (!meta) {
    const boundary = "----portfolio-upload-" + Date.now();
    const metadata = {
      name: FILE_NAME,
      parents: ["appDataFolder"],
    };
    const multipart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      body + `\r\n` +
      `--${boundary}--`;
    const resp = await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${META_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      }
    );
    if (!resp.ok) throw new Error(`Drive create 실패: ${resp.status}`);
    const created = await resp.json() as DriveFile;
    return created.modifiedTime;
  }

  // 기존 파일 — 컨텐츠만 업데이트 (PATCH)
  const resp = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${meta.id}?uploadType=media&fields=${META_FIELDS}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  if (!resp.ok) throw new Error(`Drive update 실패: ${resp.status}`);
  const updated = await resp.json() as DriveFile;
  return updated.modifiedTime;
}

// ─── 이전 버전(revision) — 덮어쓰기 사고 복구용 ─────────────────
//   Drive 는 PATCH 로 내용을 바꿀 때마다 이전 내용을 revision 으로 남긴다(일반 파일은 약 30일·최대 100개).
//   appDataFolder 파일도 같다. 새 기기에서 빈 데이터가 올라가 덮인 경우 여기서 되살린다(2026-10-20 사고).
export interface DriveRevision { id: string; modifiedTime: string; size?: string }
export async function listRevisions(): Promise<DriveRevision[]> {
  const meta = await getFileMeta();
  if (!meta) return [];
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${meta.id}/revisions?fields=revisions(id,modifiedTime,size)&pageSize=200`);
  if (!resp.ok) throw new Error(`Drive 버전 목록 실패: ${resp.status}`);
  const data = await resp.json() as { revisions?: DriveRevision[] };
  return [...(data.revisions ?? [])].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));   // 최신 먼저
}
export async function downloadRevision<T = unknown>(revisionId: string): Promise<T> {
  const meta = await getFileMeta();
  if (!meta) throw new Error("Drive 파일이 없습니다");
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${meta.id}/revisions/${encodeURIComponent(revisionId)}?alt=media`);
  if (!resp.ok) throw new Error(`Drive 버전 받기 실패: ${resp.status}`);
  return await resp.json() as T;
}

// 파일 완전 삭제 (테스트·디버깅용)
export async function deleteFile(): Promise<void> {
  const meta = await getFileMeta();
  if (!meta) return;
  const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${meta.id}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Drive delete 실패: ${resp.status}`);
  }
}
