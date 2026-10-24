package io.github.hanjungwoo3.portfolio;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // 로컬 플러그인은 자동 등록이 안 된다(노드 패키지가 아니라서) — 여기서 직접 등록한다.
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(SystemUiPlugin.class);   // 창 바탕색(야간 막대·컷아웃 띠)
        super.onCreate(savedInstanceState);
        // 전체 화면에서 화면 끝을 쓸면 막대가 '잠깐' 반투명하게 나왔다가 저절로 다시 숨게 — 기본값은 한 번 나오면 계속 남았다(사용자 지적 2026-10-25)
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
