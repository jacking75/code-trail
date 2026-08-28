import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { PathDeniedError, isInside, resolveInsideProject, toPosixRelative } from '../security/paths.js';
import { languageIdFor } from './languages.js';

/**
 * 문서 권한 (구현서 8.2).
 *
 * 브라우저에는 절대경로를 주지 않는다. 대신 서버가 발급한 불투명한 `documentId`
 * 를 주고, 파일 본문 API 는 그 ID 만 받는다. 이렇게 하면 브라우저가 "읽고 싶은
 * 파일" 을 스스로 지목할 수 없다 — 서버가 이미 열어준 것만 다시 볼 수 있다.
 *
 * 프로젝트 밖 파일(표준 라이브러리 헤더 등)은 언어 서버가 결과로 돌려줬을 때만
 * 허용 목록에 들어간다. 재시작하면 목록이 비므로 저장된 스냅샷은 보이지만
 * 다시 열기는 새 LSP 결과로 권한을 얻은 뒤에야 된다.
 */

export interface DocumentGrant {
    documentId: string;
    /** 실제 절대경로. **브라우저로 나가지 않는다.** */
    realPath: string;
    /** 프로젝트 안이면 `/` 구분 상대경로, 밖이면 `null`. */
    relPath: string | null;
    /** 화면에 찍는 경로. */
    displayPath: string;
    external: boolean;
    languageId: string;
}

export interface DocumentContent {
    documentId: string;
    relPath: string;
    displayPath: string;
    languageId: string;
    contentHash: string;
    modifiedAt: string;
    text: string;
}

/** 한 파일에서 읽어들일 최대 바이트. 이걸 넘으면 코드 화면을 열지 않는다. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export class DocumentTooLargeError extends Error {
    constructor(readonly bytes: number) {
        super('파일이 너무 크다.');
        this.name = 'DocumentTooLargeError';
    }
}

export function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

function newDocumentId(): string {
    return `doc_${randomBytes(16).toString('base64url')}`;
}

export class DocumentRegistry {
    private readonly byId = new Map<string, DocumentGrant>();
    private readonly byRealPath = new Map<string, string>();

    constructor(private readonly projectRoot: string) {}

    get size(): number {
        return this.byId.size;
    }

    /**
     * 프로젝트 안의 상대경로에 권한을 발급한다.
     *
     * 문자열 검사와 심볼릭 링크 확인을 모두 통과해야 한다. 링크가 프로젝트 밖을
     * 가리키면 여기서 막힌다 — 그 파일이 실제로 존재해도 마찬가지다.
     */
    async grantInsideProject(relPath: string): Promise<DocumentGrant> {
        const realPath = await resolveInsideProject(this.projectRoot, relPath);
        const normalized = toPosixRelative(path.relative(this.projectRoot, realPath));
        return this.remember({
            realPath,
            relPath: normalized,
            displayPath: normalized,
            external: false,
            languageId: languageIdFor(path.basename(realPath)) ?? 'plaintext',
        });
    }

    /**
     * 언어 서버가 돌려준 프로젝트 밖 파일에 권한을 발급한다.
     *
     * **브라우저가 이 함수를 부르게 하는 경로를 만들지 않는다.** 부르는 쪽은
     * 심볼 해석 서비스뿐이고, 인자는 언어 서버가 준 URI 에서 나온다.
     */
    grantExternal(realPath: string): DocumentGrant {
        const absolute = path.resolve(realPath);
        if (isInside(this.projectRoot, absolute)) {
            // 프로젝트 안이면 상대경로 쪽으로 다룬다. 같은 파일에 두 종류의
            // 권한이 생기면 "밖" 규칙이 안쪽 파일에 적용되어 헷갈린다.
            const normalized = toPosixRelative(path.relative(this.projectRoot, absolute));
            return this.remember({
                realPath: absolute,
                relPath: normalized,
                displayPath: normalized,
                external: false,
                languageId: languageIdFor(path.basename(absolute)) ?? 'plaintext',
            });
        }
        return this.remember({
            realPath: absolute,
            relPath: null,
            displayPath: toPosixRelative(absolute),
            external: true,
            languageId: languageIdFor(path.basename(absolute)) ?? 'plaintext',
        });
    }

    get(documentId: string): DocumentGrant | undefined {
        return this.byId.get(documentId);
    }

    /** 이미 권한이 있는 파일인지. 없으면 `undefined`. */
    findByRealPath(realPath: string): DocumentGrant | undefined {
        const id = this.byRealPath.get(path.resolve(realPath));
        return id ? this.byId.get(id) : undefined;
    }

    /**
     * 본문을 읽는다. 원본 문자열을 그대로 준다 —
     * 들여쓰기 제거, 탭 변환, 줄바꿈 정규화를 하지 않는다.
     */
    async read(documentId: string): Promise<DocumentContent> {
        const grant = this.byId.get(documentId);
        if (!grant) {
            throw new PathDeniedError('outsideProject');
        }
        const info = await stat(grant.realPath).catch(() => undefined);
        if (!info || !info.isFile()) {
            throw new PathDeniedError('notFound');
        }
        if (info.size > MAX_DOCUMENT_BYTES) {
            throw new DocumentTooLargeError(info.size);
        }
        const text = await readFile(grant.realPath, 'utf8');
        return {
            documentId: grant.documentId,
            relPath: grant.relPath ?? '',
            displayPath: grant.displayPath,
            languageId: grant.languageId,
            contentHash: sha256(text),
            modifiedAt: info.mtime.toISOString(),
            text,
        };
    }

    private remember(grant: Omit<DocumentGrant, 'documentId'>): DocumentGrant {
        const existingId = this.byRealPath.get(grant.realPath);
        if (existingId) {
            const existing = this.byId.get(existingId);
            if (existing) {
                return existing;
            }
        }
        const full: DocumentGrant = { documentId: newDocumentId(), ...grant };
        this.byId.set(full.documentId, full);
        this.byRealPath.set(full.realPath, full.documentId);
        return full;
    }
}
