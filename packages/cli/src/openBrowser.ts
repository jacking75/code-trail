import { spawn } from 'node:child_process';

/**
 * 기본 브라우저로 URL 을 연다.
 *
 * 외부 패키지를 쓰지 않는다. 하는 일은 플랫폼별 명령 하나를 부르는 것뿐이고,
 * 그 한 줄을 위해 의존성을 늘리면 그 패키지의 실행 방식까지 우리 보안 표면이 된다.
 *
 * **`shell: false` 로 부른다.** URL 에는 토큰이 들어 있다. 셸을 거치면 따옴표와
 * `&` 같은 문자가 셸 문법으로 해석되고, 명령행이 다른 프로세스에서 보인다.
 */

export interface OpenBrowserResult {
    ok: boolean;
    /** 실패했을 때 사용자에게 보여줄 짧은 이유. */
    reason?: string;
}

export interface BrowserCommand {
    command: string;
    args: string[];
}

/**
 * 플랫폼별로 부를 명령. 실행과 분리해 둬 테스트가 실제로 브라우저를 띄우지
 * 않고도 "무엇을 부르는지" 를 확인할 수 있게 한다.
 */
export function browserCommand(url: string, platform: NodeJS.Platform): BrowserCommand {
    switch (platform) {
        case 'win32':
            // `start` 는 cmd 내장 명령이라 직접 실행할 수 없다. `rundll32` 를 쓰면
            // 셸 없이 기본 브라우저를 띄울 수 있다.
            return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
        case 'darwin':
            return { command: 'open', args: [url] };
        default:
            return { command: 'xdg-open', args: [url] };
    }
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): OpenBrowserResult {
    const { command, args } = browserCommand(url, platform);

    try {
        const child = spawn(command, args, {
            shell: false,
            stdio: 'ignore',
            // 브라우저가 우리 프로세스를 붙잡고 있으면 서버를 끌 때 같이 멈춘다.
            detached: true,
        });
        child.on('error', () => undefined);
        child.unref();
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
