# jev-skill-suggestion

[TypeSafe Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), a System One decision model, picks at most one skill for each prompt you send and attaches that skill's `SKILL.md` to the prompt. Every other skill stays loadable: the model still sees each one by name and can load it with the Skill tool, so a skill that says "now use `/other-skill`" keeps working.

This is a Claude Code **mod** (a plugin whose behaviour lives in a hooks module). It started as a fork of [`jev-skill-suggestion` in davila7/claude-code-templates](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-skill-suggestion) at [`55457cfcc7`](https://github.com/davila7/claude-code-templates/commit/55457cfcc7) (tag `upstream-55457cf` in this repository). See [What changed from upstream](#what-changed-from-upstream).

## Why the fork

Upstream's setup set every skill to `user-invocable-only` and turned on `disableBundledSkills`. That takes skills off the listing, and it also makes the Skill tool refuse every hidden skill. So the model could use only the one skill the mod injected ([upstream #1013](https://github.com/davila7/claude-code-templates/issues/1013)):

- a skill that tells the model to load a second skill fails at that step;
- a project rule such as "run `/code-review` before you commit" fails;
- subagents cannot load any hidden skill;
- when Jev picks the wrong skill, or none, the model cannot load the right one;
- `/simplify`, `/loop` and the other bundled skills disappear, typed or not.

Claude Code has a gentler state: `"name-only"` in `skillOverrides` keeps the skill in the listing as `- name`, without its description, and the Skill tool still loads it. That keeps most of the context saving, because the descriptions are most of the listing. This fork's setup writes `name-only`, keeps the listing in place by default, and never touches the bundled skills.

## Install

Requires Claude Code 2.1.287 or newer (mods load by default from there). The `find_skill` tool was verified on 2.1.299.

**From the marketplace** (any machine):

```
/plugin install jev-skill-suggestion --marketplace audichuang/jev-skill-suggestion
```

or from a shell:

```sh
claude plugin marketplace add audichuang/jev-skill-suggestion
claude plugin install jev-skill-suggestion@jev-skill-suggestion
```

**From a clone, for every project** (what you want while you edit it):

```sh
git clone https://github.com/audichuang/jev-skill-suggestion
ln -s "$PWD/jev-skill-suggestion" ~/.claude/skills/jev-skill-suggestion
```

A plugin folder under `~/.claude/skills/` loads in every project as `jev-skill-suggestion@skills-dir`. Under a project's own `.claude/skills/` it loads only there, and only once you trust the project. Keep one copy: two plugins with the same name shadow each other, and `/plugin` reports the one it dropped.

**Switching from `npx claude-code-templates --mod`**: delete the project's `.claude/skills/jev-skill-suggestion` first. If you ran upstream's setup, change its `user-invocable-only` entries in `~/.claude/settings.json` to `name-only` by hand (this fork's setup leaves existing `user-invocable-only` entries alone), and remove `"disableBundledSkills": true` if you want the bundled skills back.

## Configure

**The key.** Set `TYPESAFE_API_KEY` (or `AI_GATEWAY_API_KEY` for the Vercel AI Gateway) in the environment Claude Code starts from, and the mod uses it. A key in the plugin options wins over the environment. Options live in user settings only (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`), under the plugin's id:

```json
{ "pluginConfigs": { "jev-skill-suggestion@skills-dir": { "options": { "rerankTimeoutMs": 2500 } } } }
```

The id follows how the plugin was loaded: `jev-skill-suggestion@skills-dir` from a skills folder, `jev-skill-suggestion@jev-skill-suggestion` from the marketplace, `jev-skill-suggestion` with `--plugin-dir`. Under the wrong id every option stays at its default.

Two things to know about a key stored as an option. Claude Code reads a plaintext key from `settings.json`, but a value saved through `/config` goes to the keychain, wins over the file, and removes the plaintext copy. The environment variable avoids both: it never lands in a settings file you might commit.

With no key at all, the mod falls back to Claude Code's built-in classifier: one request, no gate, no rerank, and no time limit.

**Trim the listing (optional).** Run `/jev-skill-suggestion:setup`. It shows the user and project skills it will set to `name-only` and asks before it edits anything. It writes the old values to `jev-skill-suggestion.skill-overrides.backup.json` next to your settings. `/jev-skill-suggestion:setup restore` puts them back. Skills that are already `name-only`, `user-invocable-only` or `off` stay as they are. Plugin skills cannot be trimmed this way.

Restart Claude Code after either step.

## Check that it works

Send a prompt in any project. The transcript should show:

```
[jev-skill-suggestion] ready on typesafe (https://api.typesafe.ai/v1/systemone); leaving the skill listing in place
[jev-skill-suggestion] jev: needs a skill 0.76 · top of 58: pptx-author (0.70), … · 160ms
```

- `ready on the built-in classifier, no key set`: the key was not found. Check the environment Claude Code was started from, or the `pluginConfigs` id.
- `typesafe responded 401 to the ranking`: the key is wrong. The prompt goes through with no suggestion.
- No lines at all: the plugin did not load. Run `claude --debug` and look for `hooks module jev-skill-suggestion@… loaded`.

## How it works

| Hook | What it does |
|---|---|
| `prompt.submit` | Runs the two requests below on the prompt you sent. It attaches the winner, if any, as a `<skill_relevance>` block the model reads and you never see. With `inject: "content"` (the default) the block holds the skill's `SKILL.md`; with `inject: "suggest"` it holds only the name, and the model loads the skill itself. |
| `prompt.attachment` on `skill_listing` | Leaves the listing alone by default. With `hideListing: true` it withholds the listing, or trims it to the names in `alwaysListed`. |
| `session.start`, `tool.describe`, `tool.call` | The `find_skill` tool (see below): registered when the session starts, kept out of ToolSearch so the model sees its description from the first request, and answered with the same two requests. |
| `skill.prompt` | Logs whether a skill the model loaded was the suggested one, and writes the prompt of `/jev-skill-suggestion:setup`. |

**When it decides.** Once per prompt you send, from that prompt's text alone. A long turn can run into sub-tasks the prompt never named, and with `name-only` the model sees those skills by name only. For that, the mod gives the model a `find_skill` tool. The model calls it with the sub-task in one sentence, and Jev answers with at most one skill: its name and the description the listing leaves out. The model then loads it with the Skill tool, or ignores it. Nothing is pushed mid-turn. A skill that hands off to another skill works as it does without the mod.

`find_skill` offers only skills the main conversation's listing names, because the Skill tool loads only those. It leaves out the gate questions a prompt must pass: a model that calls `find_skill` has already decided it wants a skill, and one sub-task sentence without its conversation scores low on them. The rerank's `fits` check is then the only check, so a pick the rerank never read is not answered, and the tool is offered only with a TypeSafe or Gateway key and `rerank` on. When a request fails or times out, it says the lookup is unavailable rather than "no skill fits". It answers a name and never a SKILL.md: a skill loaded with the Skill tool is attached again after a compaction, and one attached by the mod is not. `findSkill: false` turns the tool off. The tool's description and schema cost about 160 tokens in every session.

**What it attaches:**

```
<skill_relevance>
Relevant to the current request: commit. Ignore this if it does not fit what the user actually asked for.
Its instructions follow: follow them now, including any setup steps. Do not load it again with the Skill tool: it is already loaded here. Its files are in /home/me/.claude/skills/commit.
<skill name="commit" dir="/home/me/.claude/skills/commit">
…the SKILL.md body, frontmatter off, ${CLAUDE_SKILL_DIR} and ${CLAUDE_PROJECT_DIR} filled in…
</skill>
</skill_relevance>
```

A skill already injected is only named again on later prompts, until `/clear`, a resume or a compaction. When nothing is picked, nothing is attached, so the model is free to load a skill from the listing.

**Candidates.** Every skill `$.command.list()` reports, except built-ins, names in `neverSuggested`, and skills set to `off` in your user settings. A skill whose frontmatter says `disable-model-invocation: true` is never picked.

**Known limits.**
- An injected skill skips what the Skill tool does: the skill's `allowed-tools` are not applied.
- The mod cannot see which skills the model loaded itself, so a skill the model already loaded can be injected a second time later.
- TypeSafe's choice question takes at most 255 options, so a roster larger than that gets HTTP 400 ([upstream #965](https://github.com/davila7/claude-code-templates/issues/965)).

## How it decides

Two requests, in the cookbook's shape. Each may come back empty-handed.

**Request 1 — skim every skill.** One `choice` (`which`) over every candidate, with its one-line description as the criterion; its probability distribution is the ranking. Beside it, three `noul`s about the *request*, not about any skill:

| noul | asks |
|---|---|
| `acts_on_user_system` | Is the assistant being asked to act on the user's files, accounts, devices or services, rather than only to explain or advise? |
| `would_follow_documented_procedure` | Would a careful expert consult a specific documented procedure or set of commands, rather than answer from general understanding? |
| `prose_suffices` | Could a knowledgeable generalist fully satisfy this in prose, with no tools and no access to the user's files? (counts the other way round) |

Their mean is the gate: under `gateThreshold` (0.30) nothing is suggested, whatever the ranking said. Questions about subject matter would not do this job — *explain what a monad is* and a task that needs a skill are both software.

**Request 2 — read the top three properly.** The same `choice` over the shortlist (`shortlist`, 3), now with each skill's full frontmatter description and the first `excerptChars` (700) of its SKILL.md as the criterion, and one `noul` per candidate — *does this skill do the specific thing the request asks for?* — answered on its own, so all of them can come back low. A shortlist whose best `fits` is under `fitsThreshold` (0.30) is dropped entirely; otherwise the `choice`'s winner is suggested. The two decide different things: the `choice` settles *which*, the `noul`s settle *whether*.

This is where lookalikes separate — on one line the skill that *edits* `.pptx` files reads nearly the same as the one that *authors* them; on 700 characters they do not.

The skill bodies come from disk, by where Claude Code keeps them: `.claude/skills/<name>/SKILL.md` and `.claude/commands/<name>.md` in the project and under `~`, `~/.claude/skills/synced/<account>/<name>/SKILL.md` for a skill synced from claude.ai, and for a plugin's skill its install path from `~/.claude/plugins/installed_plugins.json`. A body that cannot be found leaves that candidate with its one-line description; the request still goes out. Bodies are read once per session, and the same read is what gets injected.

- The Gateway answers a `noul` as a `boolean` with a `probability`; both shapes are read.
- `rerank: false` skips the second request and suggests the top of the ranking, once the gate passes. A second request that was *attempted* and failed suggests nothing: the ranking's winner has not had its false-positive check.
- A skill whose frontmatter says `disable-model-invocation: true` is never suggested, whichever path picked it: the engine leaves it out of the listing and the Skill tool refuses it. Before the first listing has been seen the candidates come from `$.command.list()`, which also names such skills, so their SKILL.md is the check (read for the shortlist and for the winner).
- The built-in classifier answers one label from the descriptions, with no gate and no second request.

Every failure — a non-2xx response, a timeout past `timeoutMs` (ranking) or `rerankTimeoutMs` (rerank), a thrown error, a malformed body — lets the prompt through with no suggestion. The mod never blocks a prompt.

Prompts that are not a task get no suggestion: notifications, peer messages, observer reports, a prompt that is itself a `/name` (its skill is already named), and a reply with no task of its own — no letters at all (`2`, `👍`), or a stock go-ahead such as `ok`, `continue`, `好`, `繼續`. The decision model reads the prompt alone, so it could only guess at those; the model keeps whatever the task already loaded.


## What you see in the transcript

With `logDecisions` on (the default), the mod reports every step of its own work, because nothing else in Claude Code shows it — a listing that was never sent leaves no trace:

```
[jev-skill-suggestion] ready on typesafe (https://api.typesafe.ai/v1/systemone); leaving the skill listing in place
[jev-skill-suggestion] jev: needs a skill 0.76 · top of 58: powerpoint (0.70), pptx-author (0.30), chroma (0.00) · 160ms
[jev-skill-suggestion] jev: rerank → pptx-author (0.81) · fits powerpoint 0.73, pptx-author 0.38, chroma 0.02 · 90ms · 3/3 bodies read
[jev-skill-suggestion] suggesting /pptx-author: rerank of 3, fits 0.38
[jev-skill-suggestion] injected /pptx-author from /home/me/.claude/skills/pptx-author/SKILL.md (4210 characters)
[jev-skill-suggestion] jev: needs a skill 0.12 · top of 58: debug (0.41), code-review (0.22), commit (0.05) · 150ms
[jev-skill-suggestion] no suggestion: needs a skill 0.12 < 0.3
```

- The first line appears once per session, the first time a hook runs. It is the proof the module loaded and which backend answers it.
- The two `jev:` lines are what the decision model replied to each request, before any policy is applied — the gate, the top of the ranking, then the rerank's winner and every `fits`, with how long each call took and how many SKILL.md bodies were found.
- `injected /name from <file>` is the skill going in with the prompt; `already injected this session; named again` on a repeat.
- `withheld the skill listing` appears only with `hideListing: true`: the listing hook firing, with what it cost the context and what it kept. While some listed skills still bring their whole description, the mod adds `N skills are still listed with a full description; run /jev-skill-suggestion:setup …` once per session.
- `find_skill "<sub-task>": suggesting /name` (or `no suggestion`, or `lookup unavailable`) is the model calling `find_skill` mid-turn, after the same `jev:` lines.
- `skill /name loaded` is the model calling the Skill tool on its own (`inject: "suggest"`, or a typed `/name`): `as suggested`, or which skill was suggested instead when it reached for another.

It also keeps a one-line status on screen, replaced as it goes:

```
jev · skill: pptx-author
jev · no skill
```

## Reading decisions back

The transcript lines scroll away, and a headless run writes them only to its debug log. With `recordDecisions` on (the default), every decision also goes to one file per session, `~/.claude/jev-skill-suggestion/decisions/<session id>.jsonl` (under `CLAUDE_CONFIG_DIR` when set), one JSON object per line:

```json
{"at":"2026-10-16T08:12:03.120Z","source":"prompt","text":"畫一張 web 服務的架構圖","pick":"drawio-skill","reason":"rerank of 3, fits 0.91","answered":true,"ms":1180,"model":"jev-1.13.0","gate":0.71,"gateValues":{…},"top":[{"name":"drawio-skill","probability":0.62},…],"rerank":{"winner":"drawio-skill","confidence":0.88,"fits":{…}}}
{"at":"2026-10-16T08:12:09.402Z","loaded":"drawio-skill","suggested":"drawio-skill"}
```

`source` is `prompt` or `find_skill`; a `loaded` line is the model calling the Skill tool, with the pick it was made under. The file holds the request text as typed: it never leaves the machine, and is there so a wrong suggestion can be read back and turned into a test case. Set `recordDecisions: false` to keep nothing.

To list every recorded decision, newest session files included:

```bash
cat ~/.claude/jev-skill-suggestion/decisions/*.jsonl | jq -c 'select(.source) | {source, pick, reason, text: .text[0:60]}'
```

**No lines at all** has three causes, and only the last is the module failing to load. Check them in this order:

1. **You ran `claude -p` (or the SDK).** A headless run has no transcript and no status row: every line still goes to the debug log, `~/.claude/debug/<session-id>.txt` (a `.txt`, not a `.log`; `latest` is a symlink to the newest), and an SDK host receives each one as `ui_log`.
2. **The plugin was never loaded.** Claude Code adopts a plugin from a project's `.claude/skills/` only once the project is trusted: it is repository content, so an untrusted folder's `.claude/` is not read at all, and `claude -p` never asks. Open `claude` interactively in the folder and accept the trust prompt, or name the plugin explicitly with `--plugin-dir` (see Install). `claude --debug` settles it: a loaded module prints `hooks module jev-skill-suggestion@skills-dir loaded (worker, …); events: prompt.attachment,prompt.submit,skill.prompt` (`@inline` when loaded with `--plugin-dir`); `Found N plugins` without it means the plugin is not in the session.
3. **Claude Code is too old.** Mods are on by default from 2.1.287; on an older build the debug log says `installed plugins' hooks modules not loaded: rollout flag (tengu_plugin_hooks_modules) is off`. Update Claude Code (this mod needs 2.1.278+, see below).

A `ready on the built-in classifier, no key set` line when you did set a key means the key sits under the wrong `pluginConfigs` entry: the key must match the plugin's id, which depends on how it was loaded (see Options).


## Privacy

With a key set, the prompt text and every candidate skill's name and one-line description leave the machine on the first request, and the first `excerptChars` of each shortlisted skill's SKILL.md on the second, to whichever backend the key belongs to. Nothing else. With no key set, nothing leaves the machine.


## Options

```
  typesafeApiKey:   string  TypeSafe API key; empty reads TYPESAFE_API_KEY
  gatewayApiKey:    string  Vercel AI Gateway key; empty reads AI_GATEWAY_API_KEY
  provider:         string  "auto" | "typesafe" | "gateway" | "builtin"
  typesafeBaseUrl:  string  empty uses https://api.typesafe.ai
  typesafeModel:    string  empty uses jev-latest
  gatewayBaseUrl:   string  empty uses https://ai-gateway.vercel.sh/v4/ai
  gatewayModel:     string  empty uses typesafe-ai/jev
  inject:           string  "content" attaches the chosen SKILL.md (default); "suggest" names it for the Skill tool
  hideListing:      boolean withhold the engine's skill listing (default false)
  rerank:           boolean second request over the shortlist (default true)
  shortlist:        number  how many of the ranking the second request re-reads (default 3)
  gateThreshold:    number  gate mean under which nothing is suggested (default 0.3)
  fitsThreshold:    number  best `fits` under which the shortlist is dropped (default 0.3)
  excerptChars:     number  SKILL.md characters each candidate brings (default 700)
  alwaysListed:     string  comma-separated names kept when hideListing is on
  neverSuggested:   string  comma-separated names never offered to the decision model
  timeoutMs:        number  latency budget for the ranking request (default 800)
  rerankTimeoutMs:  number  latency budget for the rerank request (default 2500)
  findSkill:        boolean give the model the find_skill tool for mid-turn sub-tasks (default true; needs a key and rerank on)
  logDecisions:     boolean log each decision (default true)
  recordDecisions:  boolean keep every decision in a file per session (default true)
```

## What changed from upstream

| Change | Upstream reference |
|---|---|
| Setup writes `name-only`, treats `name-only` as already done, and never sets `disableBundledSkills`. Restore leaves `disableBundledSkills` alone. | [#1013](https://github.com/davila7/claude-code-templates/issues/1013) |
| `hideListing` defaults to `false`. The "run setup" hint fires only while listed skills still carry a description. | #1013 |
| Content mode attaches nothing when nothing is picked. Upstream attached "No skill in the roster appears relevant", which talked the model out of loading one itself. | — |
| A key can come from `TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY`. | [#954](https://github.com/davila7/claude-code-templates/pull/954) (closed upstream) |
| Gateway requests send `ai-gateway-protocol-version`. | [#1123](https://github.com/davila7/claude-code-templates/issues/1123) |
| Setup also trims project skills. | #1123 |
| The rerank request gets its own budget, `rerankTimeoutMs`, default 2500 ms. | [#962](https://github.com/davila7/claude-code-templates/issues/962) |
| Settings, skills, plugin records and the backup follow `CLAUDE_CONFIG_DIR`. | [#1042](https://github.com/davila7/claude-code-templates/pull/1042) |
| Replies with no task of their own (`ok`, `2`, `繼續`) are not ranked. | [#1081](https://github.com/davila7/claude-code-templates/pull/1081) |
| Skills set to `off` are never injected. | — |
| A `find_skill` tool lets the model ask Jev mid-turn, so a sub-task that turns up after the prompt is not left to a guess from bare names. | — |
| Every decision, with the request text and the ranking, is kept in a file per session (`recordDecisions`), so a wrong pick can be read back. | — |

To see upstream's later changes: `gh api "repos/davila7/claude-code-templates/commits?path=cli-tool/components/mods/productivity/jev-skill-suggestion"`, then diff the new upstream copy against the `upstream-*` tag.

## Tests

```sh
claude plugin test .
claude plugin validate .
```

## License

MIT. Original work © Daniel (San) Ávila and the claude-code-templates contributors; changes © audichuang. See [LICENSE](LICENSE).
