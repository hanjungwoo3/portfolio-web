fn main() {
    // 구글 로그인 보안 비밀번호는 빌드 때 env 로 들어온다(main.rs option_env!) — 값이 바뀌면 다시 빌드
    println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_SECRET");
    // 앱 명령을 권한으로 등록 — 원격 사이트(github.io)에서 부르려면 capabilities 에 allow-* 로 열어야 한다
    //   (안 하면 "<명령> not allowed. Plugin not found")
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["native_fetch", "open_external", "google_login", "google_refresh", "app_update_check", "app_update_install", "app_dialog"]),
    ))
    .expect("tauri build script");
}
