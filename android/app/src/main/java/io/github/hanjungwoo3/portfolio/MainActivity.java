package io.github.hanjungwoo3.portfolio;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // 로컬 플러그인은 자동 등록이 안 된다(노드 패키지가 아니라서) — 여기서 직접 등록한다.
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(SystemUiPlugin.class);   // 창 바탕색(야간 막대·컷아웃 띠)
        super.onCreate(savedInstanceState);
    }
}
