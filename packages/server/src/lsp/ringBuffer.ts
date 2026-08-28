/**
 * 크기 제한 줄 버퍼.
 *
 * 언어 서버의 stderr 를 담는다. clangd 나 rust-analyzer 는 프로젝트를 로드하는
 * 동안 수십 MB 를 뱉기도 한다. 전부 들고 있으면 서버 메모리가 그만큼 늘고,
 * 버리면 무엇 때문에 죽었는지 알 수 없다. 그래서 **최근 것만** 남긴다.
 *
 * 줄 수와 바이트 수를 둘 다 제한한다. 한 줄이 아주 긴 경우(스택 트레이스를
 * 한 줄로 찍는 서버가 있다) 줄 수만으로는 못 막는다.
 */

export interface RingBufferOptions {
    maxLines?: number;
    maxBytes?: number;
    /** 한 줄의 최대 길이. 넘으면 잘라 담는다. */
    maxLineLength?: number;
}

export class LineRingBuffer {
    private readonly lines: string[] = [];
    private bytes = 0;
    private droppedLines = 0;

    private readonly maxLines: number;
    private readonly maxBytes: number;
    private readonly maxLineLength: number;

    /** 아직 줄바꿈을 못 만난 꼬리. */
    private partial = '';

    constructor(options: RingBufferOptions = {}) {
        this.maxLines = options.maxLines ?? 500;
        this.maxBytes = options.maxBytes ?? 256 * 1024;
        this.maxLineLength = options.maxLineLength ?? 2000;
    }

    /** stderr 청크를 넣는다. 줄 단위로 잘라 담는다. */
    append(chunk: string): void {
        const text = this.partial + chunk;
        const parts = text.split(/\r?\n/);
        // 마지막 조각은 아직 줄이 안 끝났을 수 있다.
        this.partial = parts.pop() ?? '';
        for (const line of parts) {
            this.push(line);
        }
        // 줄바꿈 없이 끝없이 뱉는 서버를 대비한다.
        if (this.partial.length > this.maxLineLength) {
            this.push(this.partial);
            this.partial = '';
        }
    }

    private push(line: string): void {
        const trimmed = line.length > this.maxLineLength
            ? `${line.slice(0, this.maxLineLength)}…`
            : line;
        this.lines.push(trimmed);
        this.bytes += trimmed.length;
        while (this.lines.length > this.maxLines || this.bytes > this.maxBytes) {
            const dropped = this.lines.shift();
            if (dropped === undefined) {
                break;
            }
            this.bytes -= dropped.length;
            this.droppedLines += 1;
        }
    }

    /** 담긴 줄 전부. 오래된 것이 앞이다. */
    toArray(): string[] {
        return [...this.lines];
    }

    /** 마지막 몇 줄. 오류 요약에 쓴다. */
    tail(count: number): string[] {
        return this.lines.slice(-count);
    }

    /** 자리가 모자라 버린 줄 수. 0 이 아니면 로그가 잘렸다는 뜻이다. */
    get dropped(): number {
        return this.droppedLines;
    }

    get size(): number {
        return this.lines.length;
    }

    clear(): void {
        this.lines.length = 0;
        this.bytes = 0;
        this.droppedLines = 0;
        this.partial = '';
    }
}
