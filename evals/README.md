# evals

`run.ts` replays `cases.jsonl` through the mod's own requests (built by `hooks/policy.ts`) and policy, against the skills installed on this machine, and scores each pick.

```bash
bun evals/run.ts                                 # production defaults
bun evals/run.ts --model jev-1.13.0 --fits 0.3   # another model or threshold
bun evals/run.ts --reverse                       # catalog in reverse: how much option order moves picks
```

Needs `TYPESAFE_API_KEY`. Answers are cached in `evals/.cache` by request body, so re-running unchanged questions, or sweeping `--gate` and `--fits`, costs nothing. A question change in `policy.ts` is what gets measured: edit, rerun, compare the `right · wrong skill · suggested when none wanted · missed` line.

Cases taken from a project's sessions carry that project's code and data: keep them outside this repo (for example `~/.claude/jev-skill-suggestion/evals/<project>.jsonl`) and pass them with `--cases`, with `--project` for its skills.

`cases.jsonl` is one case per line: `text`, `expect` (every acceptable answer, `null` for "suggest nothing") and `note`. The `session:` cases are real prompts where the mod made a pick, labelled after the fact; the rest are handwritten. Add a case whenever a wrong suggestion shows up in `~/.claude/jev-skill-suggestion/decisions/`.

The catalog is read from disk (user skills, enabled plugins' skills, minus those turned `off`), so Claude Code's bundled skills are not in it, and the results are this machine's. Since 0.7.3 the pre-checks, the shortlist and its barred skills, and `decide()` are the hook's own (`routable`, `rerankCandidates` in `policy.ts`): the 71 cases picked exactly as under 0.7.2, case by case. The runner uses `--shortlist` (default 8) and the default `excerptChars` (700), and ignores `neverSuggested`, so a machine that changed those is not what it measures. It also skips `.claude/commands/*.md` and claude.ai-synced skills (`skills/synced/<account>/<name>`), which the hook can suggest; on this machine the first is empty and the synced ones are not in the listing, so the numbers here are unaffected, but a catalog with them is not replayed. Last, the runner waits for every answer and caches it, while the hook gives up after `timeoutMs` (1000) and `rerankTimeoutMs` (2500): the scores measure what Jev answers, not how often the answer arrives in time, and cached replays say nothing about latency.

## Results, 2026-10-16 (33 cases, 83 skills)

One change at a time, each kept only if it did not score worse.

| Run | Right | Wrong skill | Suggested, none wanted | Missed |
|---|---|---|---|---|
| Upstream questions, `jev-1.13.0`, fits 0.3 | 19 | 3 | 9 | 2 |
| Same, `jev-1.14.0` | 20 | 4 | 9 | 0 |
| Questions name the state field (`` `request` ``), `recent_context` dropped | 18 | 4 | 10 | 1 | 
| + gate noul `names_its_task` | **22** | 3 | 8 | 0 |
| `names_its_task` reworded ("…rather than only agreeing, continuing…") | 21 | 4 | 8 | 0 |
| + structured `fits` question (`{ question, skill }`) | 22 | 3 | 8 | 0 |
| + `fitsThreshold` 0.6 (0.5.0, `jev-1.14.0`) | **26** | 1 | 4 | 2 |
| Shipped questions on `jev-1.13.0` | 27 | 2 | 3 | 1 |
| Shipped, catalog reversed | 26 | 1 | 4 | 2 |
| 34th case added (a live Excel prompt 0.6 dropped at `fits` 0.53); `fitsThreshold` 0.5 (shipped in 0.5.1) | **27** of 34 | 2 | 4 | 1 |
| Same 34, `fitsThreshold` 0.6 | 26 | 1 | 4 | 3 |
| 0.6.0: the 13 session cases given the turn before them, as `recent_context` now sends | 26 of 34 | 2 | 5 | 1 |
| Same, `names_its_task` asking about `request` and `recent_context` together | 26 | 2 | 5 | 1 |
| A project's 6 real turns (kept outside the repo), without `recent_context` | 3 of 6 | 2 | 0 | 1 |
| Same 6, with it | 4 of 6 | 1 | 0 | 1 |

## Results, 2026-10-23: a closer fit for messages that lean on earlier turns

0.7.0: when `names_its_task` is under 0.3, the best `fits` must reach 0.8 (`fitsBar` in `policy.ts`). The six "suggested, none wanted" left were all follow-ups ("都幫我修改完成", "好幫我完成優化吧") with `names_its_task` 0.09–0.23 and `fits` 0.64–0.73, while short real tasks under the same `names_its_task` (a bug hunt, a pasted log) came back `fits` 0.88 or higher. The two project sets live in `~/.claude/jev-skill-suggestion/evals/`, outside the repo, and run with `--project`. The plateau below was found on the 34; the final `names_its_task` cut (0.11–0.3 swept) was then chosen on all 70, so the project sets are not held out.

| Run | Right | Wrong skill | Suggested, none wanted | Missed |
|---|---|---|---|---|
| 34 cases, before | 26 | 2 | 5 | 1 |
| 34 cases, after | **31** | 0 | 0 | 3 |
| Project 6, before / after | 2 → 3 | 3 → 1 | 0 → 0 | 1 → 2 |
| Project batch 30, before / after | 23 → 21 | 2 → 2 | 1 → 1 | 4 → 6 |

- Every pair of `names_its_task` 0.2–0.35 × `fits` 0.75–0.85 scored 31 on the 34; 0.3 is where wrong picks reached zero. Across all 70 cases: 51 → 55 right, wrong or unwanted picks 13 → 4, misses 6 → 11.
- The cost is mid-`fits` picks on vague messages: "擬去 /agent-reach …" (the person had typed the command), and in the batch set a review at 0.58 and a project-skill question at 0.54 whose `names_its_task` came back 0.20 though it stands on its own. A miss leaves the model the listing; a wrong pick attaches the wrong SKILL.md.
- Until 0.7.3, `run.ts` dropped `disable-model-invocation` skills before taking the shortlist while the mod drops them after, and it ranked prompts the mod never sends (a typed `/name`, "繼續"). Both now go through `routable` and `rerankCandidates` in `policy.ts`, as the hook does; the three sets scored the same after the change (32 of 35, 3 of 6, 21 of 30), so the numbers above stand.

## Tried and dropped, 2026-10-23: `fits` reading the SKILL.md excerpt

The `fits` noul reads only the description; the `choice` beside it reads the description plus the first 700 characters of SKILL.md. Giving `fits` the same detail kept the 35 at 32 right, but the project sets fell from 3 + 21 to 2 + 19 right (misses 2 + 6 → 3 + 9), and the PR case it was meant to rescue went from 0.45 to 0.33. The opening of a SKILL.md is mostly setup, which reads as "does something else" to a yes/no about the request. Not kept.

Kept the same day: the `choice`'s winner must clear the bar on its own `fits` (0.7.2). No case moved; it closes the path where the choice names one skill and a different one carries the best `fits`.

- The `` `request` `` rewording, though the docs suggest naming fields, scored worse and was dropped.
- `names_its_task` is what separated short follow-ups ("好幫我完成優化吧", 0.02–0.13) from tasks; the gate means of the two groups had overlapped almost entirely before it.
- The threshold sweep (`--gate` 0.3–0.45 × `--fits` 0.3–0.7) put `fits` 0.7 at 28 right, but in a sparse band of this one set; 0.6 shipped in 0.5.0 and dropped a plain Excel request the first live hour, so 0.5.1 ships 0.5.
- 1.13 and 1.14 differ by one case here, which this set cannot tell from noise. 1.14 is pinned by preference; `jev-latest` pointed at 1.13 at the time (1.14.0 by 2026-10-22), and an alias moves under tuned thresholds.
- Option order made no difference in totals.
- Left: follow-ups about skills themselves ("幫我看看這個技能…") still draw skillgenie or skill-creator, and two tasks are now missed (`pr`, whose `fits` came back 0.49).
- The turn before helps a follow-up whose task is in that turn ("查無資料ㄟ 為什麼？？" after a pasted SQL), and costs one false positive here among follow-ups that wanted nothing. Kept on: the project turns are where a skill was missing; `sendRecentContext: false` turns it off.

## Results, 2026-10-23: `names_its_task` asks about earlier messages only

"幫我開一個 PR，描述照我們的格式寫" names its task, yet `names_its_task` came back 0.14 (the "我們的格式" read as something said before), so the 0.8 bar dropped a `fits` of 0.68. The question now says that the user's own files, branch, project or conventions do not count, only earlier messages. Three PR cases were added and "幫我開一個 PR 把這個分支推上去" now accepts `null` too: `pr` writes the body, which that request does not ask for.

| Run | 38 cases | Project 6 | Project batch 30 | Wrong or unwanted, all 74 |
|---|---|---|---|---|
| Old wording | 35 | 3 | 21 | 4 |
| Listing pointer words ("it", "do it", "continue") | 30 | 2 | 23 | 13 |
| **Earlier messages only (0.7.4)** | **36** | 2 | **26** | 5 |

- Misses across the 74 went from 11 to 5. The extra wrong pick is in the project 6: a domain question drew a neighbouring domain skill at `fits` 0.73.
- Why it is kept although the project 6 fell from 3 to 2 and wrong or unwanted picks rose from 4 to 5: right answers across the 74 rose from 59 to 64, and the batch 30, which played no part in choosing the wording, rose from 21 to 26. One more wrong pick against six fewer misses suits a mod whose misses leave the model to pick from the listing. Six cases are too few to call the drop a trend; it is the first thing to recheck.
- `VAGUE_TASK` 0.3 to 0.4 scored the same on the 38 and the batch; 0.3 kept, but it is the edge of that plateau, not its middle: the unwanted follow-ups with a mid `fits` (0.65–0.72) now come back at `names_its_task` 0.15–0.29, one at 0.29, so 0.25 lets one back in and 0.2 three. Check these first when the model changes.
- Case by case on the 38, only two picks moved: the PR case, and a case that accepts either answer went from none to `research`.
- The pointer-word version brought back five unwanted picks on the 38.

## Results, 2026-10-24: prompts that open with a path, and the follow-up bar swept

`routable()` read any prompt starting with `/` as a typed `/name`, so "/Users/me/app/src 你要參考源碼嗎" was never ranked. On one machine, 106 of 3,209 recent prompts (3.3%) opened with a path. None of the three sets had such a case, because they were built from the decision records, and a dropped prompt never reached the record. The fix reads a first word with no second `/` as a command; dropped prompts are now recorded with a `not routed:` reason, so the next set built from the records can see them.

| Run | Right | Wrong skill | Suggested, none wanted | Missed |
|---|---|---|---|---|
| The 38 cases (`--gate 0.3`, the runner default), before / after the fix | 35 → 35 | 0 → 0 | 1 → 1 | 2 → 2 |
| Same, plus one handwritten path-leading case, after | **36** of 39 | 0 | 1 | 2 |
| A project's 108 front-end cases (kept outside the repo), before / after | the one path-leading case: not routed → its skill | — | — | — |

The follow-up bar (`VAGUE_FITS`, now sweepable with `--vague-fits`) at 0.65 / 0.7 / 0.75 / 0.8, on all four sets at `--gate 0.2` (that machine's setting): the 35 scored 30 / 32 / 34 / 34 right; the project batch 30 stayed at 26; the project 6 went 1 / 1 / 2 / 2; the 108 front-end set picked its target skills identically at every value. Lowering the bar buys nothing and costs wrong picks, so 0.8 stays.

## Results, 2026-11-01: from live traffic, and flat against grouped

246 live prompts were sampled from a week of records and labelled blind by two LLM raters, one lenient and one strict (they agreed on whether a skill was needed on 171), then replayed against each session's own catalog of 83–109 skills. Thresholds were chosen on the even case ids and checked on the odd ones, though both were in view, so this is not a clean holdout. The cases hold private text and stay outside this repo. A pick counts as right if either rater accepted it; "no skill" counts as right if either said so; the unpicked sample is reweighted to the week's traffic. F0.5 weighs precision over recall, because a wrong pick attaches a whole SKILL.md and a miss leaves the listing.

| Run | Precision | Recall | F0.5 |
|---|---|---|---|
| Before (shortlist 3, `fits` 0.5 / 0.8) | 0.66 | 0.52 | 0.62 |
| + a `/name` in the prompt | 0.68 | 0.57 | 0.65 |
| + `fits` asks about what is wanted next, with `recent_context` | 0.68 | 0.68 | 0.68 |
| + shortlist 8, `fits` 0.6 / 0.85 | 0.79 | 0.65 | 0.76 |
| **+ `none` in the ranking (0.8.0, before the examples below)** | **0.84** | **0.62** | **0.79** |

The four older sets at `--gate 0.2`, before → 0.8.0: the 39 went 35 → 37 right (wrong or unwanted 2 → 2, missed 2 → 0); the project 14 stayed 10; the project batch 30 stayed 28 (one unwanted became one miss); the 108 front-end set went 58 → 63 (wrong or unwanted 46 → 42).

Tried and not kept, each compared on the same cases:

- **Grouping first (the question was whether picking from hundreds at once works).** Ten topics, every skill assigned by Jev; beam search over the top 2 or 3 groups, or a yes/no per group followed by one `choice` over what is left. At the real size: flat F0.5 0.75, beam-2 0.74, beam-3 0.78, keep/drop 0.74. Padded to 250 with unrelated public skills: flat 0.68, beam-2 0.71, beam-3 0.69, keep/drop 0.64. A larger catalog does cost precision (0.78 → 0.70), but no grouping's lead cleared the noise (beam-2 at 250: +0.03, 95% interval −0.04 to +0.11), each adds a request, and the flat ranking already holds an acceptable skill in its top 8 on every case. The rerank's false positives are what is left to fix. The keep/drop noul kept 7 of 10 groups, so it filtered little. Recheck beam search when a catalog passes 200.
- **Second round without the first three, and a mean over shuffled option orders.** Top-of-list recall rose, final scores did not.
- **One `fits` per catalog skill, no ranking.** F0.5 0.49–0.57.
- **`fits` rewordings.** "Would following it materially change…" lost recall; a true/false statement on the action scored 0.69; a `focus` field 0.73.
- **Ranking rewordings.** Naming the fields 0.74; "would most change how it is done" 0.77 (+0.02, interval −0.01 to +0.06), not enough to move.
- **The winner by highest `fits` instead of the `choice`.** 0.55–0.57. Note what that leaves: a `fits` of 0.93 on another skill does not rescue a winner under the bar.
- **`named` (the cookbook's) and a "states a concrete action" noul opening the follow-up bar.** Both gave back precision (0.57–0.65 on the odd ids).

The replay catalog has a plugin's `skill-creator`, which never appears in that machine's live records (its `skill-creator` override is `off`); it took 7 of the 19 wrong or unwanted picks at 0.8.0, so the live precision may be higher. `run.ts` now drops a `plugin:name` whose short name is `off`; the 0.8.0 numbers in the older sets below it were taken before that.

A second round, on the same 246 with that `skill-creator` left out, so 0.8.0 reads 0.81 here (0.75 against the strict rater alone); intervals are paired against that row:

| Run | F0.5, either rater | F0.5, strict rater | Kept |
|---|---|---|---|
| Ten example follow-ups in the `none` option | 0.83 (+0.03, 0.005 to 0.06) | 0.77 (+0.03, 0.005 to 0.06) | Yes |
| A distinctive-paragraph excerpt in place of the first 700 characters, read by the `choice` | 0.82 (+0.01, −0.01 to 0.05) | 0.76 (+0.02, −0.02 to 0.05) | No: within noise |
| The same excerpt read by `fits` too | 0.79 | 0.75 | No |
| A follow-up rewritten offline into a standalone request | 0.74 (−0.07, −0.14 to 0.01) | 0.65 (−0.09, −0.17 to −0.01) | No |
| The same, with the bar at 0.6 | 0.70 | 0.58 | No |
| The bar 0.1 lower for a skill the model loaded itself in three other sessions of the project | 0.82 (+0.02, 0.00 to 0.04) | 0.74 (0.00, −0.04 to 0.03) | No: only the lenient labels gain |

The rewrite was given to the model as an upper bound, and it lost: recall rose to 0.75 but picks the raters wanted none for went from 13 to 38, because a rewritten follow-up reads like a task whether or not it needs a procedure. Short follow-ups stating so is the signal, and the rewrite removes it.

The examples took the older sets from 138 to 138 right of 191, wrong or unwanted 46 → 44, missed 7 → 9. They are invented, none copied from a scored case, but were written after reading such prompts, so this is not a clean test.

TypeSafe warns that a `none` option "may not work well in many use cases", so it is the first thing to recheck on a new model. The labels are LLMs', not the person's, and 75 of 246 cases split the raters.

Removing the three gate questions other than `names_its_task` saved no time (50 requests each, p50 232 ms with them, 292 ms without), so they stay. No case of the 246 fell under a gate of 0.2, and 0.3 lost picks the raters wanted, so the default is 0.2. `timeoutMs` went to 1000: 16 of 1,157 live requests failed at 802–845 ms, and nothing in the records says what 800 protected.

Not measured: naming rather than attaching a SKILL.md over 10,000 characters saves context on a wrong pick and adds a Skill tool round trip on a right one, and the model may not take it up. `attachedChars` and the `loaded` rows will show that.

The released 0.8.0 on the four older sets, `plugin:name` `off` check included: 37 of 39 (one unwanted, one wrong), 10 of 14, 28 of 30, 64 of 108 (wrong or unwanted 40, missed 4).
