import { useEffect, type RefObject } from 'react';

/**
 * 코드 본문 폭 맞춤 (구현서 16.5).
 *
 * **코드 본문에만 건다.** 헤더 이름이 쓰는 `--ct-font-size` 는 건드리지 않는다 —
 * 헤더까지 작아지면 트리 구조가 눈에 안 들어온다. 여기서 세우는 것은
 * `--ct-code-font-size` 하나뿐이고, `.code` 만 그 변수를 읽는다.
 *
 * 노드마다 다른 크기를 쓰지 않는다. 트리 안에서 글자 크기가 들쭉날쭉하면 읽기 나쁘다.
 * 다만 `Ctrl+휠` 로 사용자가 직접 맞춘 노드(`.code[data-fs]`)는 재지도 않고
 * 바꾸지도 않는다 — 손으로 맞춘 것을 자동 계산이 되돌리면 안 된다.
 */

/** `.code` 의 CSS 기본 글자 크기. `trail.css` 의 값과 같아야 한다. */
export const BASE_CODE_FONT_SIZE = 12;

export interface FitOptions {
    /** 0 보다 크면 그 값을 그대로 쓴다. 수동 지정이 폭 맞춤보다 우선한다. */
    fontSize: number;
    fitToWidth: boolean;
    /** 이 아래로는 줄이지 않는다. 여기서도 안 들어가면 가로 스크롤이 생긴다. */
    minFontSize: number;
}

/**
 * 한 줄에서 글자 크기를 따라 줄지 않는 부분(줄 번호 칸 좌우 여백)의 px 합.
 *
 * 폰트만 줄여서는 이 부분이 남으므로, 배율을 구할 때 빼고 계산해야 실제로 들어간다.
 */
function fixedRowPx(code: HTMLElement): number {
    const row = code.querySelector('.cl');
    if (row === null) {
        return 0;
    }
    let px = 0;
    for (const selector of ['.no', '.ct']) {
        const el = row.querySelector(selector);
        if (el === null) {
            continue;
        }
        const style = getComputedStyle(el);
        px += (Number.parseFloat(style.paddingLeft) || 0)
            + (Number.parseFloat(style.paddingRight) || 0);
    }
    return px;
}

/**
 * 지금 보이는 노드 중 **가장 빠듯한 것**에 맞춰 줄일 배율.
 * 1 이면 줄일 필요가 없다.
 */
export function fitRatio(host: HTMLElement): number {
    let ratio = 1;
    host.querySelectorAll('.body').forEach((bodyNode) => {
        const body = bodyNode as HTMLElement;
        const code = body.querySelector('.code') as HTMLElement | null;
        if (code === null || code.dataset['fs'] !== undefined) {
            return;
        }
        const visible = body.clientWidth;
        const needed = code.scrollWidth;
        if (visible <= 0 || needed <= visible) {
            return;
        }
        const fixed = fixedRowPx(code);
        if (visible - fixed <= 0 || needed - fixed <= 0) {
            return;
        }
        ratio = Math.min(ratio, (visible - fixed) / (needed - fixed));
    });
    return ratio;
}

/**
 * 폭이 바뀔 때마다 코드 글자 크기를 다시 맞춘다.
 *
 * 세로만 길어진 경우(노드가 늘었다)까지 다시 재지는 않는다. 재는 일이 싸지 않고,
 * 가로가 그대로면 결과도 그대로다.
 */
export function useFitToWidth(
    hostRef: RefObject<HTMLElement | null>,
    options: FitOptions,
    /** 내용이 바뀌었을 때 다시 재게 하는 값. 노드 수·모드 같은 것을 넣는다. */
    signal: unknown,
): void {
    const { fontSize, fitToWidth, minFontSize } = options;

    useEffect(() => {
        const host = hostRef.current;
        if (host === null) {
            return undefined;
        }

        let frame = 0;
        let lastWidth = -1;

        const apply = (): void => {
            // 수동 지정이 우선이다. 이때도 헤더는 건드리지 않는다.
            if (fontSize > 0) {
                host.style.setProperty('--ct-code-font-size', `${fontSize}px`);
                return;
            }
            // 언제나 기준 크기로 되돌린 뒤 잰다. 그래야 창을 다시 넓혔을 때
            // 원래 크기로 돌아온다.
            host.style.setProperty('--ct-code-font-size', `${BASE_CODE_FONT_SIZE}px`);
            if (!fitToWidth) {
                return;
            }
            const ratio = fitRatio(host);
            if (ratio >= 1) {
                return;
            }
            const floor = minFontSize > 0 ? minFontSize : 8;
            const next = Math.max(floor, Math.floor(BASE_CODE_FONT_SIZE * ratio * 10) / 10);
            host.style.setProperty('--ct-code-font-size', `${next}px`);
        };

        const schedule = (): void => {
            if (frame !== 0) {
                return;
            }
            frame = requestAnimationFrame(() => {
                frame = 0;
                apply();
                lastWidth = host.clientWidth;
            });
        };

        schedule();

        if (typeof ResizeObserver === 'undefined') {
            return () => {
                if (frame !== 0) {
                    cancelAnimationFrame(frame);
                }
            };
        }
        const observer = new ResizeObserver(() => {
            if (host.clientWidth === lastWidth) {
                return;
            }
            schedule();
        });
        observer.observe(host);
        return () => {
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
            observer.disconnect();
        };
    }, [hostRef, fontSize, fitToWidth, minFontSize, signal]);
}
