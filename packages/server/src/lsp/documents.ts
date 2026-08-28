import { URI } from 'vscode-uri';

import { sha256 } from '../workspace/documents.js';
import type { LspClient } from './client.js';

/**
 * 언어 서버에 열어둔 문서 (구현서 11.4).
 *
 * 언어 서버는 "열려 있는 문서" 라는 개념을 갖고, 열지 않은 파일에 대한 요청에는
 * 대답하지 않거나 디스크 내용을 추측한다. 그래서 어떤 요청이든 그 전에 문서를 연다.
 *
 * 웹이 읽기 전용이라 incremental edit 을 계산할 일이 없다. 파일이 밖에서 바뀌면
 * version 을 올려 **전체 내용**으로 `didChange` 를 보낸다 — 우리가 만든 변경이
 * 아니므로 diff 를 만들 근거가 없고, full sync 가 언제나 옳다.
 */

/**
 * 동시에 열어둘 문서 수.
 *
 * 넉넉하게 잡는다. 언어 서버는 열린 문서를 기준으로 분석을 유지하는 경우가 많아
 * 공격적으로 닫으면 다음 요청이 매번 느려진다(구현서 11.4).
 */
export const MAX_OPEN_DOCUMENTS = 200;

interface OpenDocument {
    uri: string;
    languageId: string;
    version: number;
    contentHash: string;
    text: string;
    /** LRU 판정용. 값이 클수록 최근이다. */
    touchedAt: number;
}

export interface DocumentSyncOptions {
    client: LspClient;
    /** 파일 경로에서 원문을 읽는다. BOM 은 디코딩에서만 처리한다. */
    readFile: (uri: string) => Promise<{ text: string; languageId: string }>;
}

export class DocumentSync {
    private readonly open = new Map<string, OpenDocument>();
    private clock = 0;

    constructor(private readonly options: DocumentSyncOptions) {}

    get openCount(): number {
        return this.open.size;
    }

    /** 지금 열려 있는 문서 URI 전부. 재시작 후 복원에 쓴다. */
    openUris(): string[] {
        return [...this.open.keys()];
    }

    /**
     * 요청 전에 문서가 열려 있게 만든다.
     *
     * 이미 열려 있고 내용이 그대로면 아무것도 보내지 않는다. 내용이 달라졌으면
     * version 을 올려 `didChange` 를 보낸다.
     */
    async ensureOpen(uri: string): Promise<void> {
        const { text, languageId } = await this.options.readFile(uri);
        const hash = sha256(text);
        const existing = this.open.get(uri);

        if (existing) {
            existing.touchedAt = ++this.clock;
            if (existing.contentHash === hash) {
                return;
            }
            existing.version += 1;
            existing.contentHash = hash;
            existing.text = text;
            this.options.client.notify('textDocument/didChange', {
                textDocument: { uri, version: existing.version },
                // full-content sync. 읽기 전용이라 diff 를 만들 이유가 없다.
                contentChanges: [{ text }],
            });
            return;
        }

        const document: OpenDocument = {
            uri,
            languageId,
            version: 1,
            contentHash: hash,
            text,
            touchedAt: ++this.clock,
        };
        this.open.set(uri, document);
        this.options.client.notify('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text },
        });

        this.evictIfNeeded();
    }

    /** 파일이 지워졌다. */
    close(uri: string): void {
        if (!this.open.delete(uri)) {
            return;
        }
        this.options.client.notify('textDocument/didClose', {
            textDocument: { uri },
        });
    }

    /** 파일 감시가 알려준 변경. 열려 있는 것만 다시 보낸다. */
    async refresh(uri: string): Promise<void> {
        if (!this.open.has(uri)) {
            return;
        }
        await this.ensureOpen(uri);
    }

    /**
     * 서버가 다시 떴다. 열려 있던 문서를 새 세션에 다시 연다 (구현서 11.4).
     *
     * 새 프로세스는 우리가 무엇을 열었는지 모른다. 복원하지 않으면 재시작 직후의
     * 요청이 전부 "문서를 모른다" 로 실패한다.
     */
    async reopenAll(): Promise<void> {
        const uris = [...this.open.keys()];
        this.open.clear();
        this.clock = 0;
        for (const uri of uris) {
            try {
                await this.ensureOpen(uri);
            } catch {
                // 그 사이 지워진 파일이다. 조용히 건너뛴다.
            }
        }
    }

    /** 프로세스가 죽었다. 보낼 곳이 없으므로 알림 없이 기억만 지운다. */
    forgetAll(): void {
        this.open.clear();
        this.clock = 0;
    }

    private evictIfNeeded(): void {
        while (this.open.size > MAX_OPEN_DOCUMENTS) {
            let oldestUri: string | undefined;
            let oldestAt = Number.POSITIVE_INFINITY;
            for (const [uri, document] of this.open) {
                if (document.touchedAt < oldestAt) {
                    oldestAt = document.touchedAt;
                    oldestUri = uri;
                }
            }
            if (oldestUri === undefined) {
                return;
            }
            this.close(oldestUri);
        }
    }
}

/**
 * 파일 경로 → `file:` URI.
 *
 * `vscode-uri` 를 쓴다. Windows 드라이브 문자, UNC 경로, 퍼센트 인코딩 규칙이
 * 언어 서버마다 미묘하게 다른데, 그 차이를 우리가 다시 구현하면 반드시 틀린다.
 */
export function pathToUri(fsPath: string): string {
    return URI.file(fsPath).toString();
}

/** `file:` URI → 파일 경로. `file:` 이 아니면 `null`. */
export function uriToPath(uri: string): string | null {
    try {
        const parsed = URI.parse(uri);
        return parsed.scheme === 'file' ? parsed.fsPath : null;
    } catch {
        return null;
    }
}

/**
 * 같은 파일을 가리키는 URI 를 한 형태로 맞춘다.
 *
 * 언어 서버는 `file:///c:/x` 와 `file:///C%3A/x` 를 섞어 쓴다. 중복 제거를
 * 문자열 비교로 하려면 먼저 표준형으로 바꿔야 한다. **표시용 경로는 이 값이
 * 아니라 원래 경로를 쓴다**(구현서 11.5).
 */
export function normalizeUri(uri: string): string {
    try {
        const parsed = URI.parse(uri);
        if (parsed.scheme !== 'file') {
            return parsed.toString();
        }
        // fsPath 로 한 번 내렸다 올리면 드라이브 문자와 인코딩이 정규화된다.
        const normalized = URI.file(parsed.fsPath).toString();
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    } catch {
        return uri;
    }
}
