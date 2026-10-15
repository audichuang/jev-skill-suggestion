# Mid-turn skill suggestion：只在 prompt 時決定，還是 turn 中途也決定？

調查日期：2026-10-15。Claude Code 版本：2.1.299。所有結論都附來源；凡是「推論」都會標出來。文中的 `claude-code.d.ts:NNNN` 都是指 `~/.claude/plugins/marketplaces/claude-code-plugins/mods/types/claude-code.d.ts`（隨 2.1.299 安裝的版本）。

背景：本 mod 在 `prompt.submit` 時請 TypeSafe Jev（約 0.2–2.5s）從 88 個設成 `name-only` 的 skill 中挑 ≤1 個，再把該 SKILL.md 以 `context` 附在 prompt 後面（`hooks/jev-skill-suggestion.ts:499-525`）。要回答的問題是：一個長 turn 進行到一半，模型需要別的 skill 卻只看得到名稱時，mod 該不該在 turn 中途再決定一次。

---

## 1. anthropics/claude-code issues：使用者回報什麼

| Issue | 內容 | 跟本題的關係 |
|---|---|---|
| [#38588](https://github.com/anthropics/claude-code/issues/38588) | 描述明明符合，skill 在第一個 turn 就是沒被呼叫。使用者問「為什麼不用我的 skill」之後，模型才呼叫 `Skill(helm)`。log 顯示 `ToolSearchTool: selected Glob, Read, Edit`，第二輪才 `selected Skill`；回報者推測是 Haiku 做的 ToolSearch 前置篩選不支援 `tool_reference`。 | Claude Code 在 Skill tool 前面本來就有一層搜尋（pull）。這層一漏掉，skill 就不會被用。 |
| [#10768](https://github.com/anthropics/claude-code/issues/10768) | 回報自然語言的意圖比對「完全失效」。留言區有人用 UserPromptSubmit hook 每個 prompt 強制做一次 skill 評估當 workaround；也有人說「Claude will not evaluate the skills if it thinks it can complete the task without」。 | 社群的 workaround 都是在 prompt 層 push，跟本 mod 目前的做法一樣。沒有人提到 mid-turn。 |
| [#47598](https://github.com/anthropics/claude-code/issues/47598) | Opus 4.6 不再自動載入 skill、也不委派給 subagent，回報者說是 regression。 | 模型主動 pull skill 的意願會隨模型版本改變。 |
| [#54049](https://github.com/anthropics/claude-code/issues/54049) | 有 skill 不用，自己照記憶跑流程，漏掉其中一個 phase。 | 同上。 |
| [#95582](https://github.com/anthropics/claude-code/issues/95582) | listing 裡偶爾只剩裸名 `- skill-name`，描述不見了，自然語言觸發就壞掉，只能用名字呼叫。 | **name-only 的效果和這個 bug 一樣**：模型只能從名字猜。 |
| [#56710](https://github.com/anthropics/claude-code/issues/56710)、[#59103](https://github.com/anthropics/claude-code/issues/59103)、[#79503](https://github.com/anthropics/claude-code/issues/79503) | 預算截斷的實際案例：「122 descriptions dropped」；約 230 個 skill 只登錄了 123 個；`/doctor` 對截斷不發警告。 | skill 一多，描述被砍是結構性問題。 |
| [#56700](https://github.com/anthropics/claude-code/issues/56700) | 1141 個 skill 在 1M context、1% 預算下約 10k 字元，超出 34 倍，「1262 descriptions dropped」。所有 agent 共用同一份 listing。 | 用規模說明「靠 listing 讓模型自己挑」撐不住。 |
| [#89724](https://github.com/anthropics/claude-code/issues/89724) | `skillOverrides` 的 `name-only` 對 `plugin:skill` 形式的 key 沒有作用。 | 跟 AGENTS.md 記的「plugin skill 不能用 skillOverrides 縮短」一致。 |
| [#89327](https://github.com/anthropics/claude-code/issues/89327) | skill 目錄重複出現在 Skill tool schema 和 `skill_listing` attachment 兩處。247 個 skill 時兩處合計約 36.3k tokens。 | listing 的成本很實際。 |

**Anthropic 的回應**：上面讀過的 issue 沒有一則有 Anthropic 成員留言，全部由 github-actions 以「inactive」關閉或標成 duplicate。官方對「skill 不觸發」的回應只見於文件（第 2 節的 troubleshooting）。

**沒找到**：直接回報「turn 進行到一半需要另一個 skill 卻沒載入」的 issue。用「mid task」「later in conversation」「during task」等詞搜尋都沒有結果。

---

## 2. Anthropic 官方文件

### 2.1 Agent Skills 與 listing

- 漸進揭露（progressive disclosure）：「At startup, the agent pre-loads the `name` and `description` of every installed skill into its system prompt」；「If Claude thinks the skill is relevant to the current task, it will load the skill」。[Anthropic engineering: Equipping agents…](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- 模型靠 description 決定要不要用：「Claude uses this to decide when to apply the skill」；description 加 `when_to_use` 在 listing 中合計上限 1,536 字元。[code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)
- `skillOverrides` 的 `"name-only"` 是「Listed to Claude: Name only」。[同上](https://code.claude.com/docs/en/skills)
- **預算**：「The listing always contains every skill name, but if you have many skills, Claude Code drops some descriptions to fit the listing's character budget, which removes the keywords Claude needs to match your request. The budget scales at 1% of the model's context window.」超出時從最少用的 skill 開始砍描述。可調 `skillListingBudgetFraction` 或 `SLASH_COMMAND_TOOL_CHAR_BUDGET`；文件也建議把低優先的 skill 設成 `"name-only"`。[同上，Skill descriptions are cut short](https://code.claude.com/docs/en/skills)。官方在這裡明說：沒有描述等於沒有比對用的關鍵字。
- **skill 內容的生命週期**：「the rendered `SKILL.md` content enters the conversation as a single message and stays there across later turns」。compaction 後，Claude Code 會把每個用過的 skill 最近一次的呼叫重新附上，每個保留前 5,000 tokens，全部合計上限 25,000 tokens。[同上](https://code.claude.com/docs/en/skills)
  - **對本 mod 的影響**：mod 是在 `prompt.submit` 用 `context` 附上 SKILL.md（`hooks/jev-skill-suggestion.ts:525`），不是透過 Skill tool 呼叫，所以**拿不到**上面那個 compaction 重新附上的保障。程式註解自己也寫了「a compaction may summarize the block away」（`:528-530`）。`session.compact` 會清掉 `injected`（`:536-539`），所以下一次 `prompt.submit` 挑中時會重新整份注入。真正的缺口在於：如果 turn 進行到一半發生 auto-compaction，這個 turn 剩下的部分就沒有那份 SKILL.md 可看，要等到下一個 prompt 才會補回來。
- **Claude Code 本身就會在 turn 中途 push skill**（以事件為界）：
  - `paths` frontmatter：「When set, Claude loads the skill automatically only when working with files matching the patterns.」[skills 文件](https://code.claude.com/docs/en/skills)。2.1.299 binary 裡有對應字串 `Activated conditional skill ' ' (matched path:`。
  - 子目錄裡的 `.claude/skills`：「They load the first time Claude reads or edits a file in that subdirectory」。[同上](https://code.claude.com/docs/en/skills)
  - binary 裡的 `skill_listing` attachment 分 `initial` 和 `dynamic` 兩種（`Sending ${n} skills via attachment (${initial|dynamic})`），也就是 listing 會用增量方式在對話中途補送。
- 官方對「Claude stops following a skill」的建議：規則必須每次都成立的，改用 hook；需要判斷的指引，寫成適用於整個任務的形式；compaction 之後要重新呼叫一次 skill。[同上](https://code.claude.com/docs/en/skills)

### 2.2 Hooks：PostToolUse 能不能在 turn 中途注入

- 「wraps the string in a system reminder and inserts it into the conversation at the point where the hook fired. Claude reads the reminder on the next model request」。PreToolUse、PostToolUse、PostToolUseFailure、PostToolBatch 的注入點都在「next to the tool result」。[code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)。**結論：可以在 turn 中途注入，模型在下一次 request 就會讀到。**
- 每個 `additionalContext` 字串上限 10,000 字元，沒有設定可以調高；超過時改存成檔案，模型只看到路徑和前 2,000 字元的預覽。[同上](https://code.claude.com/docs/en/hooks)
- **措辭警告**：「Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as context.」[同上](https://code.claude.com/docs/en/hooks)。turn 中途反覆插入「請用某某 skill」，正好是這種形狀。
- mod API 方面：`tool.call` 結果上的 `context` 是「One reminder, as a PostToolUse hook's is」，上限 100,000 字元（合計 200,000），超過就只保留開頭加路徑（`claude-code.d.ts:9853-9861`）。`turn.step` 的 input 除了 `model`、`effort` 以外都是 pinned（`claude-code.d.ts:10419-10461`），**不能用 `turn.step` 注入 context**，`messageCount` 只能拿來當觸發條件。mid-turn 的注入點只有 `tool.call` 的結果（以及 `SubagentStart` 的 `additionalContext`，`claude-code.d.ts:1067`）。

### 2.3 Prompt caching

[platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- 價格：5 分鐘 cache write 是 base input 的 **1.25×**，1 小時 write 是 **2×**，cache read 是 **0.1×**。註腳另外寫明 Opus 5.5 和 Sonnet 5.5 的 cache 命中與刷新是 **0.05×**，Fable 5.1 和 Mythos 5.1 是 0.025×。
- 前綴規則：依 `tools` → `system` → `messages` 的順序；「Cache hits require 100% identical prompt segments」。每個 breakpoint 最多往回檢查 20 個位置，最多 4 個 breakpoint，預設 TTL 5 分鐘，每次使用會刷新。
- 什麼會讓 cache 失效：改 tool definitions 會讓整個 cache 失效（tools、system、messages 全部）；改 `tool_choice`、加減圖片、改 thinking 或 effort 會讓 messages 那一層失效。**往 messages 尾端附加內容不在失效清單裡**。文件甚至建議改用往 `messages` 附加 `{"role":"system"}` 訊息，而不是去改頂層的 `system`，「so the cached prefix stays unchanged」。
- 推論：mid-turn 注入接在 tool result 後面，屬於尾端附加，既有前綴的 cache 不受影響。新增的那段在第一次送出時以 write 計價，之後每個 step 以 read 計價。

### 2.4 Tool Search Tool / `defer_loading`

- [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)：58 個 tool 約 55K tokens；改成 Tool Search 後先載入的只有約 500 tokens，每次發現 3–5 個 tool 約 3K，總 token 量減少 85%（約 77K 降到約 8.7K）。內部 MCP 評測的準確率：Opus 4 從 49% 升到 74%，Opus 4.5 從 79.5% 升到 88.1%。建議在 tool 超過 10 個、或 tool definitions 超過 10K tokens 時使用；最常用的 3–5 個 tool 不要 defer。「Tool Search Tool doesn't break prompt caching because deferred tools are excluded from the initial prompt entirely.」
- [Tool search tool 文件](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)：「Claude's ability to pick the right tool degrades once you exceed 30–50 available tools」。每次搜尋預設回傳 5 個；deferred tools 上限 10,000 個；有 regex 和 BM25 兩種變體。被發現的 tool 會以 `tool_reference` 的形式**附在對話裡**（inline），「The prefix is untouched, so prompt caching is preserved」。也支援自訂的 client-side 搜尋，例如 embedding。
- 這是 Anthropic 處理大量能力時的官方答案：**pull**。模型主動搜尋，結果附在尾端。

### 2.5 Context engineering

[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：context 是「a finite resource with diminishing marginal returns」，文中稱為 context rot 和 attention budget。文章推薦 just-in-time 檢索：保留輕量的識別資訊，執行時再用 tool 載入。Claude Code 被描述為混合式：CLAUDE.md 一開始就放進去，glob 和 grep 則是 just-in-time。

---

## 3. 其他 agent 怎麼做 mid-task capability discovery

| 系統 | 機制 | push / pull | 來源 |
|---|---|---|---|
| Cursor rules | 四種：Always Apply、Apply Intelligently（「When Agent decides it's relevant based on description」）、Apply to Specific Files（「Auto-attached when a matching file is in context」）、Apply Manually | 依描述的是 **pull**；依 glob 的是**事件觸發的 push** | [cursor.com/docs/context/rules](https://cursor.com/docs/context/rules) |
| OpenAI Codex skills | 開場列出名稱、描述、路徑；預設預算是 context 的 2%，未知時 8,000 字元，`skills.max_context_tokens` 最多 10,000 tokens；先縮短描述，太多時省略並警告；靠描述做隱式呼叫（`allow_implicit_invocation`） | **pull** | [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills)（由 developers.openai.com/codex/skills 308 轉址） |
| OpenAI `tool_search` | hosted 或 client-executed；「When new tools are discovered by the model, they are injected at the end of the context window」，好讓 cache 保留；「changing the loaded tool set will break the model's cache from that point forward」 | **pull** | [OpenAI tool search guide](https://developers.openai.com/api/docs/guides/tools-tool-search) |
| Cline | 開場載入名稱和描述（每個 skill 約 100 tokens）；比對到時用 `skills` tool 載入 SKILL.md（建議 <5k tokens） | **pull** | [docs.cline.bot/features/skills](https://docs.cline.bot/features/skills) |
| Letta Code | 「Letta Code automatically decides when to load a relevant skill」，透過 tool call 載入；memory 的 `system/` 目錄每個 turn 都會放進 prompt | skill 是 **pull**；記憶是 push | [docs.letta.com/letta-code/skills](https://docs.letta.com/letta-code/skills)、[Letta agent skills](https://docs.letta.com/letta-agent/skills/index.md) |
| Goose | skill：開場把名稱和描述加進 instructions，任務符合時載入全文。**MOIM**（turn context）：每個 turn 注入時間、cwd、compaction 狀態、turn budget、todo、extension 提供的 context，以及使用者設定的 persistent instructions（上限 64 KB）。「Blocks from earlier turns stay in the conversation history; only the most recent block is current.」 | skill 是 **pull**；營運資訊是**每個 turn push** | [goose using-skills.md](https://github.com/block/goose/blob/main/documentation/docs/guides/context-engineering/using-skills.md)、[using-persistent-instructions.md](https://github.com/block/goose/blob/main/documentation/docs/guides/context-engineering/using-persistent-instructions.md)、[moim.rs](https://github.com/block/goose/blob/main/crates/goose/src/agents/moim.rs) |
| Claude Code | listing 加上 Skill tool（**pull**）；`paths` 條件 skill 和子目錄 skill 在碰到檔案時才加入（**事件觸發的 push**）；todo_reminder 和 plan_mode 提醒按間隔 push（見第 5 節） | 混合 | 見 2.1、第 5 節 |

**結論**：在找得到的正式產品裡，**「依語意判斷該用哪個 skill」一律是 pull**，靠模型讀描述或搜尋。engine push 只出現在兩種情況：(1) 確定性的事件，例如檔案路徑命中 glob、第一次碰到某個子目錄；(2) 不涉及能力選擇的營運提醒，例如 Goose MOIM、Claude Code 的 todo reminder。**沒找到任何正式產品在每個 step 用分類器 push 能力建議**。

---

## 4. 論文

| 論文 | 設定 | 數字 | 注意事項（caveat） |
|---|---|---|---|
| **TRAJECT-Bench** [arXiv 2510.04550](https://arxiv.org/abs/2510.04550)（[HTML](https://arxiv.org/html/2510.04550)） | 1,228 個 tool、10 個 domain；比較只在開頭檢索一次（static）和每輪都檢索（dynamic） | Table 6（parallel, hard, EM）：**Claude-4：domain pool 0.463 / static 0.031 / dynamic 0.472**；Claude-3.7：0.186 / 0.093 / 0.296。Table 4：給全部 tool 比只給 domain pool 差（Claude-3.7 hard，bge-large 的 Acc 從 0.127 降到 0.098）。準確率下降最陡的地方在一條軌跡用到 3 到 5 個 tool 之間。 | 每輪檢索 ≈ 一開始就給「對的小 pool」。static 檢索之所以崩，是因為只檢索一次就固定、窄掉了。套到 skill 上，「domain pool」對應的是 listing 裡有好的描述，而 name-only 拿掉的正是這個。 |
| **DTDR** [arXiv 2512.17052](https://arxiv.org/abs/2512.17052)（[HTML](https://arxiv.org/html/2512.17052)，ACL 2026 Findings） | 根據 query 加上演進中的 plan 動態檢索，對照 static 檢索 | 摘要：function-calling 成功率比 static 檢索高 **23%–104%**。TinyAgent FSA：Qwen3-0.6B 從 22.0（static DR）升到 46.1（DTDR-L）；GPT-4o 從 85.9 升到 94.2。 | 主要針對 on-device 小模型；0.6B 的絕對成功率只有 0.2%–4.2%。模型越強，增益越小。 |
| **ITR** [arXiv 2602.17046](https://arxiv.org/abs/2602.17046) | 每個 step 檢索 system prompt 片段和 tool 子集，對照整包載入 | 每步 context **−95%**、正確 routing 相對 **+32%**、整個 episode 成本 **−70%**、可多跑 2–20 倍的 loop | 單一作者；「controlled benchmark with internally consistent numbers」；摘要沒寫 benchmark 和模型。**權重低**。 |
| **ToolQP** [arXiv 2601.07782](https://arxiv.org/abs/2601.07782)（[HTML](https://arxiv.org/html/2601.07782)） | 把檢索拆成子任務，做多步 query planning | ToolRet（約 44k 個 tool）平均 N@10 從 29.8 升到 36.9；StableToolBench I2 從 51.9 升到 60.2、I3 從 40.3 升到 48.3 | 論文自己寫「iterative planning may be unnecessary for smaller toolsets」，88 個 skill 屬於小集合。 |
| **Drift No More?** [arXiv 2510.07777](https://arxiv.org/abs/2510.07777)（[HTML](https://arxiv.org/html/2510.07777)） | 多輪對話的 drift；在 τ-bench 第 4、7 輪插入「重述 user goal」的提醒 | Table 2：KL 降低 6.45%–11.81%；o1 judge 分數提高 16.39%–27.40%（LLaMA 3.1 8B/70B、Qwen2 7B）。drift 會收斂到一個平衡點，不會失控。 | 只測了開源小模型；內文說「up to 30%」，但表格是 7.47%；LLaMA-70B 的平衡點加了提醒後反而上升；圖說寫「drift resumes in later turns despite interventions」。**不能推到 Claude 身上**。 |
| **Lost in the Middle** [arXiv 2307.03172](https://arxiv.org/abs/2307.03172)（TACL） | 相關資訊在 context 中的位置 | 「performance … degrades by more than 20%—in the worst case, performance in 20- and 30-document settings is lower than performance without any input documents (i.e., closed-book performance; 56.1%)」（GPT-3.5-Turbo） | 2023 年的模型；講的是位置效應。跟本題的關係：在 turn 開頭注入的內容，到長 turn 的中段時已經落在 context 中間。 |

---

## 5. 注入的成本與重複注入

- **cache**：接在 tool result 後面屬於尾端附加，前綴 cache 不會失效（2.3）。代價只有新增的 tokens：寫入一次以 1.25× 計，之後每個 step 以 read 計（Opus 5.5 是 0.05×）。
  - 試算（推論）：一份 4k tokens 的 SKILL.md 在 40 步 turn 的第 5 步注入。寫入約 4k × 1.25 = 5k 等價 tokens；之後 35 步 × 4k × 0.05 ≈ 7k 等價 tokens。單次可以接受，但**每多注入一份，成本就線性增加**，而且注入的內容會一直留在 history 裡，直到 compaction（2.1）。
- **會讓 cache 失效的情況**：mid-session 用 `$.tool.register` 新增 tool，會改到 tool definitions，整個 cache 失效。如果在 `session.start` 就註冊，「a `$.tool.register` is listed by turn one」（`claude-code.d.ts:3544`），不會有問題。
- **Claude Code 自己的重複注入節奏**（取自 2.1.299 binary 字串，不是官方文件）：
  - `todo_reminder`：`RRe={TURNS_SINCE_WRITE:10,TURNS_BETWEEN_REMINDERS:10}`。條件是距離上次 TodoWrite 已經 ≥10 則 assistant 訊息，**而且**距離上次提醒也 ≥10 則；可用 `CLAUDE_CODE_TODO_REMINDER_MODE` 或 feature flag `tengu_soft_slate_nudge` 關掉。計數的單位是 transcript 裡的 assistant 訊息，也就是 loop 的 step，不是使用者送出的 prompt。
  - plan mode 提醒：`TURNS_BETWEEN_ATTACHMENTS:5`、`FULL_REMINDER_EVERY_N_ATTACHMENTS:5`，平常送精簡版（sparse），每第 5 次送完整版（full）。
  - 推論：Anthropic 自己的做法是**以距離為界、有冷卻時間、先精簡後完整**，而不是每個 step 都注入。
- Goose MOIM 每個 turn 都注入，但舊的 block 留在 history，只有最新的那個算數（第 3 節）。這是另一種模式，代價是 context 線性增長。Goose 原始碼有常數 `MIN_CONTEXT_FOR_MOIM = 32_000`，並呼叫 `should_skip_moim(context_limit)`。推測是 context window 小於 32k 的模型會略過 MOIM，但函式本體沒有讀過。
- Hook 文件的措辭建議（2.2）：用陳述事實的寫法，不要寫成命令，以免觸發 prompt-injection 防禦。

---

## 6. 尚未確定的事（What's not established）

1. 沒有任何資料直接比較「skill 建議 per-prompt」和「per-step」的效果。TRAJECT 和 DTDR 測的是 tool，不是 skill（SKILL.md 是指引，不是可呼叫的函式）。模型也不是現在的 Claude 版本。
2. 在 Claude Code 裡，name-only 會讓 skill 的使用率掉多少，沒有官方或第三方的量測。只有 #95582 的定性描述，和文件那句「removes the keywords Claude needs」。
3. mod 用 `$.tool.register` 註冊的 tool 在 Claude Code 裡會不會被 ToolSearch defer，連帶出現 #38588 那種「前置篩選把它漏掉」的情況。型別檔沒有寫，需要實機驗證。
4. `tool.call` 的 `context` 在 subagent 的 loop 裡，是由 subagent 看到，還是只有主對話看到。從 `agentId` 推測各 loop 分開處理，但沒有驗證。用 `Task` 或 `Agent` 的 `tool.call` 掛 `context` 的話，內容會在 subagent **結束後**才出現在父對話，送錯對象了；要給 subagent 看應該用 `SubagentStart`。
5. 多次 mid-turn push 對 Claude 有沒有 prompt-injection 防禦或「被打斷」的副作用，只有文件的定性警告，沒有數字。
6. 第 1 節的 issue 沒有一則有 Anthropic 回應，產品方向不明。官方文件推的是改善描述、hook、`paths`。
7. Goose 的 MOIM「每個 turn」究竟是每次 model request 還是每個使用者訊息，從 `turns_taken`/`max_turns` 推測是 loop 的 step，但沒有逐行驗證。
8. Roo Code 沒有調查。

---

## 7. 設計比較

前提限制：`turn.step` 不能注入。所以 mid-turn 的 (b)、(d)、(e) 都只能透過 `tool.call` 的 `context` 送出（注入點是下一個 tool result），或在 subagent 用 `SubagentStart`。Jev 需要 0.2–2.5s：在 `tool.call` hook 裡同步等待，會把這段延遲加到每個 tool result 上；改成第 N 步發出請求、第 N+1 步才附上，又會讓建議晚一步，而且要處理競態。

| 設計 | 準確度的依據 | 成本、延遲 | 風險 | 有沒有正式產品的先例 |
|---|---|---|---|---|
| **(a) 只在 per-prompt 時決定（現狀）** | 第一步就把對的 skill 放進來，等於 TRAJECT 的「domain pool」那一欄 | 每個 prompt 一次 Jev 延遲，注入一次 | 長 turn 中出現新的子任務時沒有覆蓋；以 `context` 注入**沒有** compaction 後的重新附上 | 社群在 #10768 用的 workaround 就是這個 |
| **(b) 每個 step 都 push** | DTDR、ITR、TRAJECT 的 dynamic 檢索都比 static 好，但那是 tool 檢索 | 每個 step 一次 Jev 延遲（或延後一步）；每注入一份就是一份新的 history 成本 | 文件明說這種形狀可能觸發 prompt-injection 防禦；重複注入會稀釋注意力（context rot）；找不到能力建議類的正式先例 | 無（Goose MOIM 每個 turn push 的是營運資訊，不是能力建議） |
| **(c) pull tool（用 Jev 做後端的 `find_skill`）** | Anthropic 的 Tool Search 數據（49→74%、79.5→88.1%）；Codex、Cline、Letta、OpenAI 全都用 pull；結果附在尾端，不傷 cache | 只有模型主動呼叫時才付成本；在 `session.start` 註冊不會讓 cache 失效 | 模型要「想到去搜」，而 #10768、#47598 顯示它常常不會；也可能被 ToolSearch defer（第 6 節第 3 點） | 有：Tool Search、OpenAI tool_search、Codex、Cline |
| **(d) 在子任務邊界有限度地 push（TodoWrite、Task 的輸入）** | 子任務邊界就是 TRAJECT 所說「從短軌跡跨到中長軌跡」的地方；TodoWrite 的 `todos` 是現成的子任務文字，可以拿去問 Jev | 次數受子任務數量限制（通常每個 turn 個位數） | 用 `Task`/`Agent` 掛 `context` 會送錯對象，要改用 `SubagentStart`；TodoWrite 可能根本沒被呼叫 | 有，而且最接近：Claude Code 自己的 `paths` 條件 skill 和子目錄 skill（碰到檔案才加入）、Cursor 的 glob 規則，都是以事件為界的 push |
| **(e) 依距離重新注入** | Drift 論文：提醒能降低 drift，但只測了小模型，數字也不一致；Lost in the Middle 支持「注入的內容會被埋在中間」 | 次數受間隔限制 | 只能「重提」已經選過的 skill，處理不了新需求；要靠 `messageCount` 和自己計數 | 有：Claude Code 的 todo_reminder（10/10）、plan mode（5，每第 5 次完整版） |

**綜合判斷**（推論，不是已驗證的結論）：證據最支持的是 **(a) 保留，加上 (c) 和 (d)**。

- (c) 把語意判斷交還給模型，同時用 Jev 補上 name-only 拿掉的描述比對，這是業界一致的做法。
- (d) 只在確定性的子任務邊界 push，跟 Claude Code 自己在 turn 中途 push skill 的方式一致。
- (b) 沒有正式先例，延遲和 prompt-injection 的風險都已有文件記載，不建議。
- (e) 只適合「重提」已經注入的 skill，而且應該參考 todo_reminder 的冷卻參數，優先順序最低。

另外一個獨立的弱點值得單獨處理：(a) 注入的內容在 compaction 後會消失，而 Skill tool 呼叫有 5k/25k tokens 的重新附上保障。

---

## 8. 補充：本機實測與開源實作

### 8.1 skill listing 在快取的哪一段（本 session transcript 實測）

讀 `~/.claude/projects/<repo>/621a2e1a-….jsonl`：

- `skill_listing` 在整個 session 只出現一次（第 26 筆，`attachment` 型別），位置在第一則 user 訊息前後。內容 14,902 字元、65 行；user skill 是 name-only 的裸名，plugin/內建 skill 仍帶描述。所以它屬於**穩定前綴**，之後每次請求都是 cache read。
- 每個 assistant 回應的 usage：`cache_read` 從 26k 一路漲到 12 萬，`cache_creation` 每步只有幾百到幾千（新加的 tool result 或注入內容）。第一次 prompt 的 `<skill_relevance>`（aghub-cli 全文，約 1.5–2k tokens）包含在第一次請求的 28,818 write 裡；第三次請求的 22,542 write 則是 Read 了兩個檔案（約 850 行）的結果。佐證 2.3：**接在尾端的注入不會打破快取，只付自己的 tokens**。
- 推論：「讓模型中途看得到描述」有兩種做法。一種是把描述放回 listing（改 `name-only`），只在 session 開頭付一次，之後是 0.05× 的 read。另一種是中途注入，每次都是新的 write，而且會一直留在 history 裡。

- 把描述放回去的代價（實測）：88 個 name-only skill 中，在 `~/.claude/skills/` 找到 57 個 SKILL.md，它們的「名字加描述」合計 16,141 字元。照比例外推，88 個約 2.5 萬字元（約 6k tokens），會讓 listing 從 1.5 萬字元變成約 4 萬字元。listing 預算是 context 的 1%，全部放回很可能超過預算，Claude Code 就會從最少用的 skill 開始砍描述。所以「放回描述」只適合挑十幾個，不能全部放回。

### 8.2 GitHub 上的實作先例（`gh search repos`）

| 專案 | 判斷時機 | 備註 |
|---|---|---|
| [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase)（約 1 萬星） | `UserPromptSubmit` 每則 prompt 判斷；另外用 `PreToolUse`（Edit/Write）的 `skill-verification-guard` 分析要寫入的程式碼，在 turn 中途**強制**載入 skill；`PostToolUse`（Skill）追蹤哪些已載入 | 是 (d) 的先例，觸發點是「要動檔案」而不是 TodoWrite。分類器可用 regex 或 Gemini/Haiku 等，有 strict、balanced、aggressive 三種保守程度 |
| [zhengyanzhao1997/SkillRouter](https://github.com/zhengyanzhao1997/SkillRouter) | 離線 benchmark（約 8 萬個 skill，75 題） | 核心發現：「只用名字加描述不夠，**SKILL.md 全文才是決定性的路由訊號**」。0.6B embedding 加 0.6B reranker（rerank 讀全文），Hit@1 74.0%。支持 Jev 的第二輪 rerank 要讀本文 |
| [foryourhealth111-pixel/Vibe-Skills](https://github.com/foryourhealth111-pixel/Vibe-Skills) | 先確認需求、拆計畫，**依計畫的每一部分**挑 skill，只讀入選的 SKILL.md | 規劃階段的 (d)。SkillsBench（DeepSeekV4Flash + OpenHands）mean reward +21.12 pp、tokens −29.6%，屬於自報數字 |
| [juew/Skill-Routing-Kit](https://github.com/juew/Skill-Routing-Kit)（Codex） | pull：`AGENTS.md` 的 routing guard 讓 agent 自己跑 `route_request.py`（recall 加 rerank，含反例） | 刻意「不裝 hook、不常駐」，是 (c) 的輕量版 |

沒找到在每個 step 用分類器推送 skill 的實作，和第 3 節的結論一致。

（社群討論：Reddit 和 X 需要瀏覽器擴充或 cookie，這次沒查；Exa 沒設定，改用內建 WebSearch。）

---

## 9. 第 0 階段實機驗證（2026-10-15，Claude Code 2.1.299）

探針 mod 放在 session scratchpad 的 `probe/`，不在 repo 裡。用 `claude --debug --plugin-dir <probe> -p …` 跑了兩次。

| 問題 | 結果 | 證據 |
|---|---|---|
| `$.tool.register` 的工具會不會被延後載入？ | **預設會**：`isDeferred` 是 true，模型只看到名字，要先用 ToolSearch 才能呼叫 | 第一次跑：模型回答 DEFERRED；debug 有 `ToolSearchTool: selected mcp__probe__find_skill` |
| 能不能讓它不被延後？ | **可以**：在 `tool.describe` hook 回傳 `{ ...out, isDeferred: false }` 後，schema 和描述一開始就在工具清單裡，模型直接呼叫，不經過 ToolSearch | 第二次跑：debug 有 `isDeferred was true; pinning`；模型回答 DIRECT 並引述了描述 |
| `tool.call` 附加的 `context` 在回合中途讀不讀得到？ | **讀得到**：在 Bash 結果後附上的 `PROBE-CONTEXT-4412` 被模型逐字引述 | 第一次跑 |
| 工具參數在哪裡？ | 直接攤在 `e` 的頂層：`e.task`，沒有 `e.input` | debug：`e={"task":"convert a pdf into slides","tool":"mcp__probe__find_skill",...}` |
| 註冊後的完整名稱 | 用 `--plugin-dir` 載入時是 `mcp__probe__find_skill`。官方範例的 fixture 寫的是 `mcp__plugin_<plugin>__<name>`，名稱可能依載入來源而不同，程式要用 `register()` 回傳的 `tool` | `[probe] registered mcp__probe__find_skill` |

附帶觀察：

- 模型會拿工具結果去對照 skill 清單。探針回了一個不存在的 `pdf-to-slides`，模型主動指出它不在可載入的清單裡。所以 `find_skill` 只能回傳真實存在、可以載入的名字。
- pin 之後，模型說這個名字「也出現在後來的 deferred 清單裡」，但不影響直接呼叫，原因沒有追查。
- 還沒驗證的：子代理呼叫 `find_skill` 時 `agentId` 會不會帶上；pin 對 prompt cache 的影響。`tool.describe` 每個 session 只算一次並快取，理論上是穩定的。

---

## 10. 第 1 階段已實作（0.3.0）

- `find_skill` 工具：在 `session.start` 註冊，在 `tool.describe` 設 `isDeferred: false`，在 `tool.call` 用同樣兩輪 Jev 回答。只提供 listing 裡有的 skill，回傳名字加描述，不附 SKILL.md。
- 實機驗證（2.1.299，`--plugin-dir`）：
  1. 明確要求呼叫：工具是 DIRECT；Jev 選了 `document-skills:xlsx`（fits 0.91），回傳名字和描述。
  2. 不提示的情境（n=1，刻意設計成讀了 README 才出現需求）：prompt 時 Jev「nothing fits」，沒有注入；模型讀完 README 後自己呼叫 `find_skill`，Jev 回答 `domain-modeling`，模型用 Skill tool 載入（log 是 `as suggested`），照它的格式寫出 ADR。
- 第 2 階段（量測一週真實使用：`find_skill` 的 log 行、被採用的比例）還沒做。第 3 階段（TodoWrite 邊界推送）要看第 2 階段的結果再決定。
