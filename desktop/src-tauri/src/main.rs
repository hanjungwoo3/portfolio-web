// 포트폴리오 데스크톱 앱(맥·윈도우) — github.io 사이트를 창에 띄우고, 시세 요청은 앱이 직접 보낸다.
//
//   브라우저에서 확장·프록시가 필요한 이유는 CORS 다(토스·네이버가 다른 사이트의 읽기를 막는다).
//   앱의 네이티브 HTTP(reqwest)에는 CORS 가 없다 → 안드로이드 APK(nativeProxy)와 같은 구조.
//   웹은 `window.__PORTFOLIO_DESKTOP__` 로 앱 안인지 알고, `native_fetch` 명령으로 요청을 넘긴다
//   (src/lib/nativeProxy.ts). 헤더 규칙(토스 쿠키·Referer·한경 키 등)은 웹 쪽이 정해서 넘긴다.
//
//   사이트를 그대로 띄우므로 **웹 배포만 하면 앱 화면도 새 버전**이다. 이 파일은 요청 경로가 바뀔 때만 다시 빌드.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const SITE_URL: &str = "https://hanjungwoo3.github.io/portfolio-web/";

// 페이지보다 먼저 도는 스크립트 — ① 앱 표식 ② 새 창(window.open·target=_blank)은 앱 안 '보기 창'으로(open_viewer).
//   보기 창은 별도 창이라 사이트의 iframe 차단(X-Frame-Options)과 상관없다. 받기 파일만 기본 브라우저로.
const INIT_SCRIPT: &str = r##"
(() => {
  window.__PORTFOLIO_DESKTOP__ = true;
  const ext = (u) => {
    try {
      const url = new URL(u, location.href).toString();
      // 앱 안 보기 창(open_viewer)으로 — 뉴스·공시·토스·AI 를 브라우저로 내보내지 않는다(사용자 요청 2026-10-23)
      window.__TAURI_INTERNALS__.invoke("open_viewer", { url }).catch(() => window.__TAURI_INTERNALS__.invoke("open_external", { url }));
    } catch (e) { console.warn("open_external", e); }
  };
  window.open = (u) => { if (u) ext(String(u)); return null; };
  // 맥 WKWebView 는 alert·confirm·prompt 를 띄우지 않는다(confirm 은 바로 false) → Drive 가져오기 등이 '취소'로 끝났다.
  //   alert 는 답이 필요 없어 여기서 앱 대화상자로 바꿔 끼운다. confirm·prompt 는 답을 즉시 돌려줘야 해서
  //   웹 코드가 await appConfirm/appPrompt(src/lib/appDialog.ts → app_dialog 명령)로 부른다.
  //   (동기 XHR 로 앱에 묻는 방식은 https 사이트에서 막혔다 — pfdialog://·127.0.0.1 모두, 실측)
  if (/Mac/.test(navigator.platform)) {
    window.alert = (m) => { window.__TAURI_INTERNALS__.invoke("app_dialog", { kind: "alert", msg: String(m ?? ""), def: "" }); };
  }
  // ★ 버블 단계 + 이미 처리된 클릭은 건너뛴다 — 캡처로 먼저 가로챘더니, 웹이 preventDefault 하고 앱 팝업을 여는 링크
  //   (지수 카드 종목명 = 종목정보 팝업)도 브라우저로 같이 열렸다(2026-10-23). 웹이 안 막은 바깥 링크만 브라우저로.
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return;
    if (a.target === "_blank" || /^https?:/.test(href) && new URL(href, location.href).origin !== location.origin) {
      e.preventDefault();
      ext(a.href);
    }
  });
})();
"##;

#[derive(serde::Serialize)]
struct NativeRes {
    status: u16,
    content_type: String,
    body: String, // base64 — 바이너리(EUC-KR 등) 그대로 넘긴다
}

#[tauri::command]
async fn native_fetch(
    client: tauri::State<'_, reqwest::Client>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<NativeRes, String> {
    let m = reqwest::Method::from_bytes(method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut req = client.request(m, &url);
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    #[cfg(debug_assertions)]
    eprintln!("native_fetch {status} {}", url.split('?').next().unwrap_or(""));   // 개발 빌드만 — 앱 직결로 나가는지 확인용
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(NativeRes { status, content_type, body: STANDARD.encode(&bytes) })
}

// ─── 구글 로그인(Drive 동기화) ─────────────────────────────────────────────
//   구글은 앱 안 웹뷰 로그인을 막는다(disallowed_useragent). 데스크톱 표준 = 기본 브라우저 + 루프백:
//   127.0.0.1 임시 포트를 열고, 브라우저 로그인 결과(code)를 그 포트로 받아, PKCE 로 토큰을 바꾼다.
//   refresh_token 도 받아 1시간마다 다시 로그인할 필요가 없다(웹 GIS 와 다른 점).
//   클라이언트 = 구글 콘솔 '데스크톱 앱' 유형. 보안 비밀번호는 저장소에 두지 않고 빌드 때 env 로 넣는다
//   (공개 저장소에 GOCSPX- 값이 올라가면 유출로 보고 막힐 수 있다). 비면 로그인만 안 된다.
const GOOGLE_CLIENT_ID: &str = "329003207663-2rfjkqui4cs077033pidt5o71gitdndj.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("GOOGLE_DESKTOP_CLIENT_SECRET");
const GOOGLE_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

#[derive(serde::Serialize)]
struct GoogleToken {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

fn rand_url_safe(n: usize) -> String {
    use rand::Rng;
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut r = rand::thread_rng();
    (0..n).map(|_| A[r.gen_range(0..A.len())] as char).collect()
}

async fn token_request(client: &reqwest::Client, form: &[(&str, &str)]) -> Result<GoogleToken, String> {
    let res = client.post("https://oauth2.googleapis.com/token").form(form).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let v: serde_json::Value = serde_json::from_slice(&res.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("token {}: {}", status.as_u16(), v.get("error").and_then(|e| e.as_str()).unwrap_or("?")));
    }
    Ok(GoogleToken {
        access_token: v["access_token"].as_str().ok_or("no access_token")?.to_string(),
        expires_in: v["expires_in"].as_u64().unwrap_or(3600),
        refresh_token: v["refresh_token"].as_str().map(|s| s.to_string()),
    })
}

#[tauri::command]
async fn google_login(client: tauri::State<'_, reqwest::Client>) -> Result<GoogleToken, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let secret = GOOGLE_CLIENT_SECRET.ok_or("이 빌드에는 구글 로그인 키가 없다")?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = rand_url_safe(64);
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = rand_url_safe(24);
    let mut auth = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth.query_pairs_mut()
        .append_pair("client_id", GOOGLE_CLIENT_ID)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", GOOGLE_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    open::that_detached(auth.as_str()).map_err(|e| e.to_string())?;

    // 브라우저가 돌아올 때까지(최대 5분) 한 요청만 받는다
    let want_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        listener.set_nonblocking(false).ok();
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        loop {
            if std::time::Instant::now() > deadline { return Err("로그인 시간 초과".into()); }
            let (mut s, _) = listener.accept().map_err(|e| e.to_string())?;
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req.split_whitespace().nth(1).unwrap_or("/");
            let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
            let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
            if q.get("code").is_none() && q.get("error").is_none() { // 파비콘 등 — 무시
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                continue;
            }
            let ok = q.get("state") == Some(&want_state) && q.get("code").is_some();
            let msg = if ok { "로그인 완료 — 이 창을 닫고 포트폴리오 앱으로 돌아가세요." } else { "로그인 실패 — 앱에서 다시 시도하세요." };
            let html = format!("<!doctype html><meta charset=utf-8><title>포트폴리오</title><body style='font-family:sans-serif;padding:40px'><h2>{msg}</h2>");
            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}", html.len(), html).as_bytes());
            return if ok { Ok(q["code"].clone()) } else { Err(q.get("error").cloned().unwrap_or("state 불일치".into())) };
        }
    }).await.map_err(|e| e.to_string())??;

    token_request(&client, &[
        ("client_id", GOOGLE_CLIENT_ID), ("client_secret", secret), ("code", &code),
        ("code_verifier", &verifier), ("redirect_uri", &redirect), ("grant_type", "authorization_code"),
    ]).await
}

#[tauri::command]
async fn google_refresh(client: tauri::State<'_, reqwest::Client>, refresh_token: String) -> Result<GoogleToken, String> {
    let secret = GOOGLE_CLIENT_SECRET.ok_or("이 빌드에는 구글 로그인 키가 없다")?;
    token_request(&client, &[
        ("client_id", GOOGLE_CLIENT_ID), ("client_secret", secret),
        ("refresh_token", &refresh_token), ("grant_type", "refresh_token"),
    ]).await
}

// 맥 대화상자 명령 — 웹의 appConfirm/appPrompt/alert 가 부른다. "1"/"0"(confirm), 입력값 또는 "\u{0}"(prompt 취소)
#[tauri::command]
async fn app_dialog(kind: String, msg: String, def: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mac_dialog(&kind, &msg, &def)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("http(s) 주소만 연다".into());
    }
    open::that_detached(url).map_err(|e| e.to_string())
}

// ─── 앱 안 보기 창 ───────────────────────────────────────────────────
//   뉴스·공시·토스·네이버·구글 AI 를 브라우저 대신 앱 안의 두 번째 창에 띄운다(사용자 요청 2026-10-23).
//   창은 하나만 — 다시 열면 그 창이 주소만 바꾸고 앞으로 온다. 닫아도 본 창은 그대로.
//   이 창엔 앱 명령 권한이 없다(capabilities/viewer.json 은 open_external 하나만) — 바깥 사이트가 native_fetch 등을 못 부르게.
const VIEWER_SCRIPT: &str = r##"
(() => {
  // 새 창 대신 이 창에서 — 보기 창이 또 창을 만들면 갇히거나 막힌다
  window.open = (u) => { if (u) location.assign(String(u)); return null; };
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const a = e.target && e.target.closest ? e.target.closest("a[target=_blank][href]") : null;
    if (a) { e.preventDefault(); location.assign(a.href); }
  });
  // 작은 도구 막대 — 뒤로·앞으로·브라우저로 열기(창에 주소창이 없어서)
  const bar = () => {
    if (document.getElementById("__pf_viewer_bar")) return;
    const b = document.createElement("div");
    b.id = "__pf_viewer_bar";
    b.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:2147483647;display:flex;gap:4px;padding:4px;border-radius:8px;background:rgba(31,41,55,.85);font:13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.3)";
    const btn = (t, title, f) => { const x = document.createElement("button"); x.textContent = t; x.title = title;
      x.style.cssText = "all:unset;cursor:pointer;color:#fff;padding:2px 8px;border-radius:5px"; x.onmouseenter = () => x.style.background = "rgba(255,255,255,.15)";
      x.onmouseleave = () => x.style.background = ""; x.onclick = f; b.appendChild(x); };
    btn("◀", "뒤로", () => history.back());
    btn("▶", "앞으로", () => history.forward());
    btn("↗ 브라우저로", "기본 브라우저로 열기", () => { try { window.__TAURI_INTERNALS__.invoke("open_external", { url: location.href }); } catch (e) {} });
    document.documentElement.appendChild(b);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bar); else bar();
})();
"##;

// 받기 파일(zip·exe·apk·dmg·GitHub 릴리스 받기)은 보기 창이 아니라 기본 브라우저로 — 웹뷰는 파일 받기를 못 한다
fn is_download(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    let path = l.split(['?', '#']).next().unwrap_or("");
    l.contains("/releases/download/") || [".zip", ".exe", ".apk", ".dmg", ".msi", ".tar.gz"].iter().any(|e| path.ends_with(e))
}

#[tauri::command]
async fn open_viewer(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("http(s) 주소만 연다".into());
    }
    if is_download(&url) {
        return open::that_detached(url).map_err(|e| e.to_string());
    }
    let parsed: tauri::Url = url.parse().map_err(|e| format!("{e}"))?;
    if let Some(w) = app.get_webview_window("viewer") {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let b = WebviewWindowBuilder::new(&app, "viewer", WebviewUrl::External(parsed));
    // 맥 WKWebView 기본 UA 엔 'Version/… Safari/…' 가 없어 구글이 옛 기본 화면을 줬다 — AI 모드(udm=50)가 그냥 검색으로
    //   떨어졌다(사용자 지적 2026-10-23). 보기 창만 일반 사파리로 소개한다. 윈도우(WebView2)는 이미 Edge UA 라 그대로.
    #[cfg(target_os = "macos")]
    let b = b.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    b.title("포트폴리오 — 보기")
        .inner_size(1100.0, 850.0)
        .min_inner_size(400.0, 400.0)
        .initialization_script(VIEWER_SCRIPT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── 앱 업데이트 ─────────────────────────────────────────────────────
//   고정 릴리스 'apps' 의 latest.json(서명 포함)을 본다(tauri.conf.json plugins.updater).
//   맥 .app·윈도우 설치판은 받아서 바꾸고 재시작. 윈도우 실행형(portfolio.exe)은 스스로 못 바꾼다 —
//   설치판 옆에는 NSIS 가 uninstall.exe 를 두므로 그게 없으면 실행형으로 보고, 새 버전 알림 + 다운로드 링크만.
//   웹 화면은 사이트를 그대로 띄워 웹 배포로 바로 바뀐다 — 이건 앱 자체(요청·로그인 등)가 바뀔 때만.
const RELEASE_PAGE: &str = "https://github.com/hanjungwoo3/portfolio-web/releases/tag/apps";

fn is_portable() -> bool {
    if !cfg!(windows) { return false; }
    std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|d| !d.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

#[derive(serde::Serialize)]
struct AppUpdateInfo {
    current: String,
    latest: Option<String>,
    can_install: bool,   // false = 윈도우 실행형 → 다운로드 페이지로
    page: String,
}

#[tauri::command]
async fn app_update_check(app: tauri::AppHandle) -> Result<AppUpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let latest = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
        .map(|u| u.version.clone());
    Ok(AppUpdateInfo { current, latest, can_install: !is_portable(), page: RELEASE_PAGE.into() })
}

#[tauri::command]
async fn app_update_install(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    if is_portable() {
        let _ = open::that_detached(RELEASE_PAGE);
        return Ok(());
    }
    if let Some(u) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
        u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// 맥 대화상자 — osascript(기본 대화상자). 취소는 종료 코드 1.
//   prompt 취소는 "\u{0}"(빈 문자열 입력과 구분), confirm 은 "1"/"0".
fn mac_dialog(kind: &str, msg: &str, def: &str) -> String {
    let script: &[&str] = match kind {
        "confirm" => &["on run argv", "display dialog (item 1 of argv) with title \"포트폴리오\" buttons {\"취소\", \"확인\"} default button \"확인\" cancel button \"취소\"", "end run"],
        "prompt" => &["on run argv", "text returned of (display dialog (item 1 of argv) with title \"포트폴리오\" default answer (item 2 of argv) buttons {\"취소\", \"확인\"} default button \"확인\" cancel button \"취소\")", "end run"],
        _ => &["on run argv", "display dialog (item 1 of argv) with title \"포트폴리오\" buttons {\"확인\"} default button \"확인\"", "end run"],
    };
    let mut cmd = std::process::Command::new("osascript");
    for l in script { cmd.arg("-e").arg(l); }
    let out = cmd.arg(msg).arg(def).output();
    let ok = out.as_ref().map(|o| o.status.success()).unwrap_or(false);
    match kind {
        "confirm" => (if ok { "1" } else { "0" }).to_string(),
        "prompt" => if ok { String::from_utf8_lossy(&out.unwrap().stdout).trim_end_matches('\n').to_string() } else { "\u{0}".to_string() },
        _ => "1".to_string(),
    }
}

fn main() {
    // 쿠키 저장 — 야후 crumb(쿠키+crumb 짝)이 요청 사이에 이어져야 한다. 압축 응답 자동 해제.
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client");

    // 로컬 확인용 — PORTFOLIO_URL=http://localhost:5173/ 로 띄우면 개발 서버를 연다(배포 전 확인)
    let url = std::env::var("PORTFOLIO_URL").unwrap_or_else(|_| SITE_URL.to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(client)
        .invoke_handler(tauri::generate_handler![native_fetch, open_external, open_viewer, google_login, google_refresh, app_update_check, app_update_install, app_dialog])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("포트폴리오")
                .inner_size(1500.0, 950.0)
                .min_inner_size(400.0, 600.0)
                .initialization_script(INIT_SCRIPT)
                .center()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("앱 실행 실패");
}
