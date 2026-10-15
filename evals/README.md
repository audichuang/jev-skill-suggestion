# evals

`run.ts` replays `cases.jsonl` through the mod's own requests (built by `hooks/policy.ts`) and policy, against the skills installed on this machine, and scores each pick.

```bash
bun evals/run.ts                                 # production defaults
bun evals/run.ts --model jev-1.13.0 --fits 0.3   # another model or threshold
bun evals/run.ts --reverse                       # catalog in reverse: how much option order moves picks
```

Needs `TYPESAFE_API_KEY`. Answers are cached in `evals/.cache` by request body, so re-running unchanged questions, or sweeping `--gate` and `--fits`, costs nothing. A question change in `policy.ts` is what gets measured: edit, rerun, compare the `right · wrong skill · suggested when none wanted · missed` line.

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
| + `fitsThreshold` 0.6 (shipped, `jev-1.14.0`) | **26** | 1 | 4 | 2 |
| Shipped questions on `jev-1.13.0` | 27 | 2 | 3 | 1 |
| Shipped, catalog reversed | 26 | 1 | 4 | 2 |

- The `` `request` `` rewording, though the docs suggest naming fields, scored worse and was dropped.
- `names_its_task` is what separated short follow-ups ("好幫我完成優化吧", 0.02–0.13) from tasks; the gate means of the two groups had overlapped almost entirely before it.
- The threshold sweep (`--gate` 0.3–0.45 × `--fits` 0.3–0.7) put `fits` 0.7 at 28 right, but in a sparse band of this one set; 0.6 is the shipped value, with less riding on 33 cases.
- 1.13 and 1.14 differ by one case here, which this set cannot tell from noise. 1.14 is pinned by preference; `jev-latest` still pointed at 1.13 and an alias moves under tuned thresholds.
- Option order made no difference in totals.
- Left: follow-ups about skills themselves ("幫我看看這個技能…") still draw skillgenie or skill-creator, and two tasks are now missed (`pr`, whose `fits` came back 0.49).
