# code-trail

Read code as a trail: expand a function inline, click an identifier, and its definition nests underneath.
Symbols come from your language server; Code Trail never edits files.
UI and documentation are in Korean.

코드를 읽어 내려간 경로 그 자체를 트리로 남기는 로컬 도구다. 편집기가 아니다.

## Install and run

```
npx code-trail ./my-project
npm install -g code-trail
code-trail <project-path>
```

Node.js 22.12 or later. A local server starts on 127.0.0.1 and the browser opens.
In the code view press `Ctrl+Alt+T` on a function to start a trail.

## Language servers

Code Trail does **not** download language servers. Install the one for your language and it is found automatically
(or set its path in the settings screen).

| Language | Server | Install guide |
| --- | --- | --- |
| C / C++ | clangd | https://clangd.llvm.org/installation |
| C# | roslyn-language-server | https://learn.microsoft.com/dotnet/core/tools/dotnet-tool-install |
| Go | gopls | https://go.dev/gopls |
| Rust | rust-analyzer | https://rust-analyzer.github.io/book/installation.html |
| TypeScript | typescript-language-server | https://github.com/typescript-language-server/typescript-language-server |

## More

- Documentation (Korean): [README](https://github.com/jacking75/code-trail/blob/main/README.md)
- First review guide: [first-review-guide](https://github.com/jacking75/code-trail/blob/main/docs/first-review-guide.md)
- Changes: [CHANGELOG](https://github.com/jacking75/code-trail/blob/main/CHANGELOG.md)
- Issues: https://github.com/jacking75/code-trail/issues

MIT License.
