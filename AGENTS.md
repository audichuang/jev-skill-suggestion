# jev-skill-suggestion

Claude Code mod（hooks module plugin），fork 自 davila7/claude-code-templates 的同名 mod。README 寫給安裝的人；這份寫給改 code 的 agent。

## 改完必跑

- `claude plugin test .` 與 `claude plugin validate .`。不要用 `bun test`：`claude-code/testing` 只有 `claude plugin test` 提供。
- 改到 hook 行為時做實機驗證：push 後跑 `claude plugin marketplace update jev-skill-suggestion && claude plugin update jev-skill-suggestion@jev-skill-suggestion`，再用 `claude --debug -p '<需要某個 skill 的任務>'` 開一個 session，到 `~/.claude/debug/` 最新的檔案裡找 `ready on typesafe` 和 `suggesting /…`。headless 模式下 log 只寫進 debug 檔。

## 不可退回的設計

- setup 只寫 `name-only`。不要寫 `user-invocable-only`，也不要碰 `disableBundledSkills`：前者會讓 Skill tool 拒絕載入，skill 接 skill 會斷、子代理也載不到；後者會讓內建 skill 整批消失（上游 #1013，也就是開這個 fork 的原因）。
- `hideListing` 預設 `false`。content 模式沒挑到 skill 時不附任何文字，讓模型自己從清單挑。
- 所有失敗路徑都 fail-open：逾時、非 2xx、例外都只是不給建議，mod 絕不能擋住 prompt。
- plugin 名稱 `jev-skill-suggestion` 不改：使用者 `pluginConfigs` 的 key 是 `<name>@<載入來源>`，改名會讓所有人的設定失效。

## 程式分工

- `hooks/policy.ts` 放純邏輯，不呼叫 `$`、不做 I/O，單元測試都針對它寫。`hooks/jev-skill-suggestion.ts` 只負責 `$` 呼叫和事件串接。新邏輯照這個切法放。
- hook 層的測試在 `tests/hooks.test.ts`，用假的 `$` 呼叫 `register()`，照現有的 `seat()` 寫法擴充。

## mod API 的雷

- `$.env.get('NAME')` 的參數必須是字面字串，傳變數 validator 會擋下來。`register(on, options)` 是同步函式，環境變數只能在第一個 hook 裡讀。
- `skill.prompt` 事件沒有 `agentId`，分不出主對話和子代理，不要拿它做注入去重。
- options 只從 user、`--settings`、managed 三種 settings 讀，不讀專案 settings。
- `$` 只能傳給檔案頂層宣告的函式（function declaration 或綁定函式的 const）。傳給 `register()` 裡的閉包，validator 會擋。要共用的流程寫成頂層函式，狀態用參數傳進去，照 `choose($, state, …)` 的寫法。
- `$.tool.register` 註冊的工具，參數直接攤在 `tool.call` 事件的頂層（`e.task`），沒有 `e.input`。完整名稱要用 `register()` 回傳的 `tool`，名稱會隨載入來源不同。
- plugin 註冊的工具預設 `isDeferred: true`，會被放到 ToolSearch 後面，模型只看得到名字。要在 `tool.describe` 回傳 `isDeferred: false` 才會一開始就帶 schema 和描述。

## 上游與發版

- 上游原版在 tag `upstream-55457cf`。用 `git diff upstream-55457cf -- hooks/` 看本 fork 偏離了哪些地方。改到使用者看得到的行為時，README 的「What changed from upstream」表要一起更新。
- 要讓使用者拿到的改動，`.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json` 的 `version` 一起升。安裝快取依版本號分目錄，不升版的話 `claude plugin update` 可能拿不到新程式。
- 測試只用假 key。真的 key 在使用者的 `TYPESAFE_API_KEY` 環境變數裡，不能進 repo。
