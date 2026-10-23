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

The catalog is read from disk (user skills, enabled plugins' skills, minus those turned `off`), so Claude Code's bundled skills are not in it, and the results are this machine's.

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

0.7.0: when `names_its_task` is under 0.3, the best `fits` must reach 0.8 (`fitsBar` in `policy.ts`). The six "suggested, none wanted" left were all follow-ups ("都幫我修改完成", "好幫我完成優化吧") with `names_its_task` 0.09–0.23 and `fits` 0.64–0.73, while short real tasks under the same `names_its_task` (a bug hunt, a pasted log) came back `fits` 0.88 or higher. The project sets are `~/.claude/jev-skill-suggestion/evals/cat.jsonl` and `cat-batch.jsonl`, run with `--project`. The plateau below was found on the 34; the final `names_its_task` cut (0.11–0.3 swept) was then chosen on all 70, so the project sets are not held out.

| Run | Right | Wrong skill | Suggested, none wanted | Missed |
|---|---|---|---|---|
| 34 cases, before | 26 | 2 | 5 | 1 |
| 34 cases, after | **31** | 0 | 0 | 3 |
| Project 6, before / after | 2 → 3 | 3 → 1 | 0 → 0 | 1 → 2 |
| Project batch 30, before / after | 23 → 21 | 2 → 2 | 1 → 1 | 4 → 6 |

- Every pair of `names_its_task` 0.2–0.35 × `fits` 0.75–0.85 scored 31 on the 34; 0.3 is where wrong picks reached zero. Across all 70 cases: 51 → 55 right, wrong or unwanted picks 13 → 4, misses 6 → 11.
- The cost is mid-`fits` picks on vague messages: "擬去 /agent-reach …" (the person had typed the command), and in the batch set a review at 0.58 and a `bfs-cloud-onprem` question at 0.54 whose `names_its_task` came back 0.20 though it stands on its own. A miss leaves the model the listing; a wrong pick attaches the wrong SKILL.md.
- `find_skill` asks no gate questions, so it keeps `fitsThreshold`.
- `run.ts` drops `disable-model-invocation` skills before taking the shortlist; the mod takes the top three and then drops them, so a live shortlist can come out empty (0.7.1 then suggests nothing). "好幫我完成優化吧" is skill-creator at 0.71 here and no rerank at all live.

## Tried and dropped, 2026-10-23: `fits` reading the SKILL.md excerpt

The `fits` noul reads only the description; the `choice` beside it reads the description plus the first 700 characters of SKILL.md. Giving `fits` the same detail kept the 35 at 32 right, but the project sets fell from 3 + 21 to 2 + 19 right (misses 2 + 6 → 3 + 9), and the PR case it was meant to rescue went from 0.45 to 0.33. The opening of a SKILL.md is mostly setup, which reads as "does something else" to a yes/no about the request. Not kept.

Kept the same day: the `choice`'s winner must clear the bar on its own `fits` (0.7.2). No case moved; it closes the path where the choice names one skill and a different one carries the best `fits`.

- The `` `request` `` rewording, though the docs suggest naming fields, scored worse and was dropped.
- `names_its_task` is what separated short follow-ups ("好幫我完成優化吧", 0.02–0.13) from tasks; the gate means of the two groups had overlapped almost entirely before it.
- The threshold sweep (`--gate` 0.3–0.45 × `--fits` 0.3–0.7) put `fits` 0.7 at 28 right, but in a sparse band of this one set; 0.6 shipped in 0.5.0 and dropped a plain Excel request the first live hour, so 0.5.1 ships 0.5.
- 1.13 and 1.14 differ by one case here, which this set cannot tell from noise. 1.14 is pinned by preference; `jev-latest` still pointed at 1.13 and an alias moves under tuned thresholds.
- Option order made no difference in totals.
- Left: follow-ups about skills themselves ("幫我看看這個技能…") still draw skillgenie or skill-creator, and two tasks are now missed (`pr`, whose `fits` came back 0.49).
- The turn before helps a follow-up whose task is in that turn ("查無資料ㄟ 為什麼？？" after a pasted SQL), and costs one false positive here among follow-ups that wanted nothing. Kept on: the project turns are where a skill was missing; `sendRecentContext: false` turns it off.
