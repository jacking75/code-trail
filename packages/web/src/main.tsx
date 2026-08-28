import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { bootstrapSession } from './api/session.js';
import './styles/app.css';
import './styles/trail.css';

/**
 * 브라우저 진입점.
 *
 * **토큰 처리를 가장 먼저 한다.** 화면이 그려지기 전에 fragment 를
 * `sessionStorage` 로 옮기고 주소에서 지운다 — 토큰이 주소창에 보이는 시간을
 * 최대한 줄이고, 그 사이에 사용자가 주소를 복사해 어딘가 붙일 여지를 없앤다.
 */
bootstrapSession();

const host = document.getElementById('root');
if (host === null) {
    throw new Error('#root 를 찾을 수 없다.');
}

createRoot(host).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
