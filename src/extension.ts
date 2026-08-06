import * as vscode from 'vscode';
import { TrailPanel } from './panel';
import { resolveEnclosing, diagnose } from './symbols';

export function activate(context: vscode.ExtensionContext): void {
    const reg = (id: string, fn: (...a: any[]) => any) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    reg('codeTrail.openPanel', () => {
        TrailPanel.show(context).reveal();
    });

    reg('codeTrail.startFromCursor', async () => {
        await startFrom(context, false);
    });

    reg('codeTrail.addRootFromCursor', async () => {
        await startFrom(context, true);
    });

    reg('codeTrail.clear', () => {
        TrailPanel.current?.clear();
    });

    reg('codeTrail.diagnose', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage('Code Trail: 진단할 파일을 먼저 연다.');
            return;
        }
        const report = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Code Trail: 언어 서버 점검 중…' },
            () => diagnose(editor),
        );
        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
    });

    reg('codeTrail.exportMarkdown', async () => {
        const panel = TrailPanel.current;
        if (!panel || panel.trail.isEmpty) {
            void vscode.window.showInformationMessage('Code Trail: 내보낼 내용이 없다.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument({
            content: panel.trail.toMarkdown(),
            language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    });

    reg('codeTrail.exportJson', async () => {
        const panel = TrailPanel.current;
        if (!panel || panel.trail.isEmpty) {
            void vscode.window.showInformationMessage('Code Trail: 저장할 내용이 없다.');
            return;
        }
        const target = await vscode.window.showSaveDialog({
            filters: { JSON: ['json'] },
            saveLabel: '트레일 저장',
        });
        if (!target) {
            return;
        }
        await vscode.workspace.fs.writeFile(target, Buffer.from(panel.trail.toJSON(), 'utf8'));
        void vscode.window.showInformationMessage(`Code Trail: ${target.fsPath} 에 저장했다.`);
    });

    reg('codeTrail.importJson', async () => {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { JSON: ['json'] },
            openLabel: '트레일 불러오기',
        });
        if (!picked || picked.length === 0) {
            return;
        }
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        const panel = TrailPanel.show(context);
        try {
            panel.loadJSON(Buffer.from(bytes).toString('utf8'));
        } catch (err) {
            void vscode.window.showErrorMessage(
                `Code Trail: 불러오기 실패 — ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });
}

async function startFrom(context: vscode.ExtensionContext, forceNewRoot: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showWarningMessage('Code Trail: 활성 에디터가 없다.');
        return;
    }

    const panel = TrailPanel.show(context);

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Code Trail: 심볼 해석 중…' },
        async () => {
            const resolved = await resolveEnclosing(editor);
            if (!resolved) {
                void vscode.window.showWarningMessage(
                    'Code Trail: 심볼을 찾지 못했다. 해당 언어의 언어 서버(clangd, C# Dev Kit, gopls, rust-analyzer 등)가 활성화됐는지 확인 필요.',
                );
                return;
            }
            if (!forceNewRoot && !panel.trail.isEmpty) {
                // 같은 심볼이 이미 루트로 있으면 중복 추가하지 않는다.
                const dup = panel.trail.roots.find(
                    (r) => r.symbol.uri === resolved.uri && r.symbol.anchorLine === resolved.anchorLine,
                );
                if (dup) {
                    panel.reveal();
                    return;
                }
            }
            panel.pushRoot(resolved);
        },
    );
}

export function deactivate(): void {
    /* noop */
}
