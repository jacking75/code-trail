import * as vscode from 'vscode';
import { Trail, TrailNode } from './trail';
import { ResolveMode, resolveAt, resolveImplementationsAt, kindName } from './symbols';

interface ClientConfig {
    clickTarget: string;
    maxCodeLines: number;
    showAbsolutePath: boolean;
    fontSize: number;
    childOrder: string;
}

function readConfig(): ClientConfig {
    const c = vscode.workspace.getConfiguration('codeTrail');
    return {
        clickTarget: c.get<string>('clickTarget', 'allSymbols'),
        maxCodeLines: c.get<number>('maxCodeLines', 250),
        showAbsolutePath: c.get<boolean>('showAbsolutePath', false),
        fontSize: c.get<number>('fontSize', 0),
        childOrder: c.get<string>('childOrder', 'source'),
    };
}

/** Roslyn 등이 "Foo(int) : Task<T>" 형태로 주는 이름에서 식별자만 뽑는다. */
function shortName(name: string): string {
    const cut = name.indexOf('(');
    return cut > 0 ? name.slice(0, cut).trim() : name;
}

function nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

/** 웹뷰로 보낼 때는 children 구조를 그대로 쓰되 필요한 필드만 추린다. */
function serialize(n: TrailNode): unknown {
    return {
        id: n.id,
        parentId: n.parentId,
        origin: n.origin,
        collapsed: n.collapsed,
        recursive: n.recursive,
        symbol: { ...n.symbol, kindName: kindName(n.symbol.kind) },
        children: n.children.map(serialize),
    };
}

export class TrailPanel {
    static current: TrailPanel | undefined;
    private static readonly viewType = 'codeTrail.panel';

    readonly trail = new Trail();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private ready = false;
    private pending: unknown[] = [];

    static show(context: vscode.ExtensionContext): TrailPanel {
        if (TrailPanel.current) {
            TrailPanel.current.panel.reveal(undefined, true);
            return TrailPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            TrailPanel.viewType,
            'Code Trail',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
            },
        );
        TrailPanel.current = new TrailPanel(panel, context);
        return TrailPanel.current;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
    ) {
        this.panel = panel;
        this.panel.webview.html = this.html();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (m) => this.onMessage(m),
            null,
            this.disposables,
        );
        vscode.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration('codeTrail')) {
                    this.post({ type: 'config', config: readConfig() });
                }
            },
            null,
            this.disposables,
        );
    }

    private post(msg: unknown): void {
        if (!this.ready) {
            this.pending.push(msg);
            return;
        }
        void this.panel.webview.postMessage(msg);
    }

    private flush(): void {
        this.ready = true;
        for (const m of this.pending) {
            void this.panel.webview.postMessage(m);
        }
        this.pending = [];
    }

    reveal(): void {
        this.panel.reveal(undefined, true);
    }

    pushRoot(symbol: import('./symbols').ResolvedSymbol): void {
        const node = this.trail.addRoot(symbol);
        this.post({ type: 'addRoot', node: serialize(node) });
        this.panel.reveal(undefined, true);
    }

    clear(): void {
        this.trail.clear();
        this.post({ type: 'setState', roots: [], config: readConfig() });
    }

    loadJSON(text: string): void {
        this.trail.loadJSON(text);
        this.post({
            type: 'setState',
            roots: this.trail.roots.map(serialize),
            config: readConfig(),
        });
        this.panel.reveal(undefined, true);
    }

    private async onMessage(msg: any): Promise<void> {
        switch (msg?.type) {
            case 'ready':
                this.flush();
                this.post({
                    type: 'setState',
                    roots: this.trail.roots.map(serialize),
                    config: readConfig(),
                });
                break;

            case 'resolve':
                await this.handleResolve(msg.nodeId, msg.line, msg.char, msg.text, msg.mode);
                break;

            case 'resolveImplementations':
                await this.handleImplementations(msg.nodeId);
                break;

            case 'openInEditor':
                await this.openInEditor(msg.uri, msg.line, msg.char);
                break;

            case 'remove':
                this.trail.remove(msg.nodeId);
                break;

            case 'toggle':
                this.trail.setCollapsed(msg.nodeId, !!msg.collapsed);
                break;

            case 'clear':
                this.clear();
                break;

            case 'exportMarkdown':
                await this.exportMarkdown();
                break;

            case 'exportJson':
                await this.exportJson();
                break;

            case 'importJson':
                await vscode.commands.executeCommand('codeTrail.importJson');
                break;

            case 'error':
                void vscode.window.showErrorMessage(`Code Trail: ${msg.message}`);
                break;
        }
    }

    private async handleResolve(
        nodeId: string,
        line: number,
        char: number,
        text: string,
        mode: ResolveMode,
    ): Promise<void> {
        const parent = this.trail.get(nodeId);
        if (!parent) {
            return;
        }
        this.post({ type: 'busy', nodeId, on: true });
        try {
            const uri = vscode.Uri.parse(parent.symbol.uri);
            const position = new vscode.Position(line, char);
            const resolved = await resolveAt(uri, position, mode ?? 'definition');

            if (!resolved) {
                this.post({
                    type: 'toast',
                    level: 'warn',
                    message: `'${text}' 의 정의를 찾지 못했다. 해당 언어의 언어 서버가 켜져 있는지 확인 필요.`,
                });
                return;
            }

            const existing = this.trail.findExistingChild(nodeId, resolved);
            if (existing) {
                this.post({ type: 'focus', nodeId: existing.id });
                return;
            }

            const node = this.trail.addChild(nodeId, resolved, { line, char, text });
            if (!node) {
                return;
            }
            this.post({ type: 'addChild', parentId: nodeId, node: serialize(node) });

            if (resolved.declarationOnly) {
                this.post({
                    type: 'toast',
                    level: 'info',
                    message: `'${shortName(resolved.name)}' 은 몸통 없는 선언이다. 헤더의 ⚑ 를 눌러 실제 구현을 펼친다.`,
                });
            }

            if (vscode.workspace.getConfiguration('codeTrail').get<boolean>('revealInEditorOnAdd', false)) {
                await this.openInEditor(resolved.uri, resolved.anchorLine, resolved.anchorChar);
            }
        } catch (err) {
            this.post({
                type: 'toast',
                level: 'error',
                message: `해석 실패: ${err instanceof Error ? err.message : String(err)}`,
            });
        } finally {
            this.post({ type: 'busy', nodeId, on: false });
        }
    }

    /** 선언 노드에서 ⚑ 를 눌렀을 때 — 구현체들을 자식으로 붙인다. */
    private async handleImplementations(nodeId: string): Promise<void> {
        const parent = this.trail.get(nodeId);
        if (!parent) {
            return;
        }
        this.post({ type: 'busy', nodeId, on: true });
        try {
            const uri = vscode.Uri.parse(parent.symbol.uri);
            const position = new vscode.Position(
                parent.symbol.anchorLine,
                parent.symbol.anchorChar,
            );
            const impls = await resolveImplementationsAt(uri, position);

            if (impls.length === 0) {
                this.post({
                    type: 'toast',
                    level: 'warn',
                    message: `'${shortName(parent.symbol.name)}' 의 구현을 찾지 못했다. 언어 서버가 프로젝트 전체를 로드했는지 확인 필요.`,
                });
                return;
            }

            let added = 0;
            let firstId: string | undefined;
            for (const impl of impls) {
                if (this.trail.findExistingChild(nodeId, impl)) {
                    continue;
                }
                const node = this.trail.addChild(nodeId, impl, {
                    line: parent.symbol.anchorLine,
                    char: parent.symbol.anchorChar,
                    text: shortName(parent.symbol.name),
                });
                if (!node) {
                    continue;
                }
                added += 1;
                firstId = firstId ?? node.id;
                this.post({ type: 'addChild', parentId: nodeId, node: serialize(node) });
            }

            if (added === 0) {
                this.post({
                    type: 'toast',
                    level: 'info',
                    message: '구현이 이미 전부 펼쳐져 있다.',
                });
            } else {
                this.post({
                    type: 'toast',
                    level: 'info',
                    message: `구현 ${added}개를 붙였다.`,
                });
                if (firstId) {
                    this.post({ type: 'focus', nodeId: firstId, quiet: true });
                }
            }
        } catch (err) {
            this.post({
                type: 'toast',
                level: 'error',
                message: `구현 찾기 실패: ${err instanceof Error ? err.message : String(err)}`,
            });
        } finally {
            this.post({ type: 'busy', nodeId, on: false });
        }
    }

    private async openInEditor(uriStr: string, line: number, char: number): Promise<void> {
        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
        });
        const pos = new vscode.Position(line, char);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    private async exportMarkdown(): Promise<void> {
        if (this.trail.isEmpty) {
            void vscode.window.showInformationMessage('Code Trail: 내보낼 내용이 없다.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument({
            content: this.trail.toMarkdown(),
            language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    }

    private async exportJson(): Promise<void> {
        if (this.trail.isEmpty) {
            void vscode.window.showInformationMessage('Code Trail: 저장할 내용이 없다.');
            return;
        }
        const target = await vscode.window.showSaveDialog({
            filters: { 'Code Trail': ['codetrail.json', 'json'] },
            saveLabel: '트레일 저장',
        });
        if (!target) {
            return;
        }
        await vscode.workspace.fs.writeFile(target, Buffer.from(this.trail.toJSON(), 'utf8'));
        void vscode.window.showInformationMessage(`Code Trail: ${target.fsPath} 에 저장했다.`);
    }

    private html(): string {
        const w = this.panel.webview;
        const media = (name: string) =>
            w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
        const n = nonce();
        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; font-src ${w.cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${media('style.css')}" rel="stylesheet" />
<title>Code Trail</title>
</head>
<body>
<div id="toolbar">
  <button id="btn-expand" title="전체 펼치기">⤢ 전체 펼치기</button>
  <button id="btn-collapse" title="전체 접기">⤡ 전체 접기</button>
  <button id="btn-order" title="형제 노드 정렬 순서">⇅ 코드 순서</button>
  <span class="sep"></span>
  <input id="filter" type="search" placeholder="이름/경로 필터…" />
  <span class="sep"></span>
  <button id="btn-md" title="Markdown으로 내보내기">Markdown</button>
  <button id="btn-save" title="JSON으로 저장">저장</button>
  <button id="btn-load" title="JSON에서 불러오기">불러오기</button>
  <button id="btn-clear" class="danger" title="전체 지우기">지우기</button>
</div>
<div id="breadcrumb"></div>
<div id="root"></div>
<div id="empty">
  <h2>Code Trail</h2>
  <p>에디터에서 함수 위에 커서를 놓고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> 를 누르면 여기에 코드가 펼쳐진다.</p>
  <ul>
    <li>코드 안의 <b>식별자를 클릭</b>하면 그 정의가 자식 노드로 붙는다.</li>
    <li>같은 함수 안에서 여러 개를 클릭하면 <b>형제로 나란히</b> 쌓인다. 부모 코드의 해당 호출부에는 ①②③ 순번이 붙는다.</li>
    <li><kbd>Alt</kbd>+클릭 = 구현(implementation) 찾기. 인터페이스/가상함수에 유용하다.</li>
    <li><kbd>Ctrl</kbd>+클릭 = 트리에 추가하지 않고 실제 에디터에서 열기.</li>
  </ul>
</div>
<div id="toast"></div>
<script nonce="${n}" src="${media('tokenizer.js')}"></script>
<script nonce="${n}" src="${media('main.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        TrailPanel.current = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}
