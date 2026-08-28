import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 웹 빌드.
 *
 * 산출물은 `dist/` 에 떨어지고 Fastify 가 그대로 제공한다. 외부 CDN 을 쓰지
 * 않는 것이 전제라 Monaco 를 포함해 전부 번들에 넣는다 — 서버 CSP 가
 * `script-src 'self'` 이므로 CDN 을 참조하는 순간 화면이 안 뜬다.
 */
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // 소스맵을 배포물에 넣지 않는다. 원본 경로가 그대로 노출된다.
        sourcemap: false,
        // Monaco 는 원래 크다. 로컬에서만 받는 파일이라 경고를 끄고 간다.
        chunkSizeWarningLimit: 3000,
        rollupOptions: {
            output: {
                // Monaco 는 크다. 앱 코드와 나눠 두면 앱만 고칠 때 캐시가 산다.
                manualChunks: (id) => (id.includes('monaco-editor') ? 'monaco' : undefined),
            },
        },
    },
    server: {
        host: '127.0.0.1',
    },
});
