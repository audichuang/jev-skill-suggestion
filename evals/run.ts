/**
 * Replays evals/cases.jsonl through the mod's own two requests and policy,
 * against the skills installed on this machine, and scores each pick.
 *
 *   bun evals/run.ts [--model jev-1.13.0] [--gate 0.3] [--fits 0.5] [--reverse] [--cases …]
 *                    [--project ~/code/app] [--no-context]
 *
 * The requests are built by hooks/policy.ts, so a change to a question there
 * is what gets measured. Answers are cached by request body in
 * evals/.cache: a rerun of unchanged questions costs nothing. Needs
 * TYPESAFE_API_KEY. `--reverse` sends the catalog in reverse order, to see
 * how many picks the option order alone moves.
 *
 * ponytail: the catalog is read from disk (user skills, enabled plugins' skills,
 * minus those turned off), not from `$.command.list()`: Claude Code's bundled
 * skills are missing from it.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import {
  DEFAULT_BASE_URL,
  DEFAULT_EXCERPT_CHARS,
  DEFAULT_MODEL,
  configDirOf,
  installPathsOf,
  readSkillSettings,
  decide,
  detailOf,
  endpoint,
  modelInvocable,
  modelOf,
  passesGate,
  readRerank,
  readWide,
  rerankCandidates,
  routable,
  requestBody,
  requestHeaders,
  rerankQuestions,
  wideQuestions,
  type Candidate,
  type PolicyConfig,
  type RecentContext,
  type Skill,
} from '../hooks/policy.ts'

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? (process.argv[at + 1] as string) : fallback
}
const model = arg('model', DEFAULT_MODEL.typesafe)
const casesPath = arg('cases', `${import.meta.dir}/cases.jsonl`)
const reverse = process.argv.includes('--reverse')
// A project whose `.claude/skills` joins the catalog, as it would in a session there.
const project = arg('project', '')
// Leave each case's `context` out, to see what the turn before adds.
const noContext = process.argv.includes('--no-context')
const apiKey = process.env.TYPESAFE_API_KEY ?? ''
if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
const policy: PolicyConfig = {
  shortlist: 3,
  gateThreshold: Number(arg('gate', '0.3')),
  fitsThreshold: Number(arg('fits', '0.5')),
}

// The catalog, named the way the engine names it.
const home = process.env.HOME as string
const config = configDirOf(home, process.env.CLAUDE_CONFIG_DIR)
const settingsJson = readFileSync(`${config}/settings.json`, 'utf8')
const off = new Set(
  Object.entries(readSkillSettings(settingsJson).skillOverrides).filter(([, v]) => v === 'off').map(([k]) => k),
)
// readSkillSettings reads only the two fields the setup touches.
const enabled: Record<string, boolean> = JSON.parse(settingsJson).enabledPlugins ?? {}
const files = new Map<string, string>()
const skills: Skill[] = []
const add = (name: string, file: string) => {
  if (off.has(name) || files.has(name)) return
  const markdown = readFileSync(file, 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  const description = front ? String((Bun.YAML.parse(front[1] as string) as { description?: unknown })?.description ?? '') : ''
  files.set(name, markdown)
  skills.push({ name, description: description.replace(/\s+/g, ' ').trim() })
}
const skillDirs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((entry) => existsSync(`${dir}/${entry}/SKILL.md`)) : []
if (project) for (const entry of skillDirs(`${project}/.claude/skills`)) add(entry, `${project}/.claude/skills/${entry}/SKILL.md`)
for (const entry of skillDirs(`${config}/skills`)) add(entry, `${config}/skills/${entry}/SKILL.md`)
const installed = readFileSync(`${config}/plugins/installed_plugins.json`, 'utf8')
for (const key of Object.keys(enabled).filter((key) => enabled[key] === true)) {
  const plugin = key.split('@')[0] as string
  // A malformed install entry skips that plugin, as the hook's `fileOf` does;
  // a broken SKILL.md still stops the run, so the catalog is never short.
  let paths: string[] = []
  try {
    paths = installPathsOf(installed, key)
  } catch {}
  for (const path of paths) {
    const dir = `${path}/skills`
    for (const entry of skillDirs(dir)) add(`${plugin}:${entry}`, `${dir}/${entry}/SKILL.md`)
  }
}

if (reverse) skills.reverse()
const invocable = (name: string) => modelInvocable(files.get(name) ?? null)

// One request, cached by its body.
const url = endpoint('typesafe', DEFAULT_BASE_URL.typesafe)
const cacheDir = `${import.meta.dir}/.cache`
mkdirSync(cacheDir, { recursive: true })
let served = ''
async function ask(prompt: string, questions: Record<string, unknown>, context: RecentContext | null): Promise<string> {
  const body = requestBody('typesafe', prompt, questions, model, context)
  const cached = `${cacheDir}/${createHash('sha256').update(body).digest('hex')}.json`
  if (existsSync(cached)) return readFileSync(cached, 'utf8')
  const response = await fetch(url, { method: 'POST', headers: requestHeaders('typesafe', apiKey, model), body })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 300)}`)
  writeFileSync(cached, text)
  return text
}

type Case = { text: string; expect: (string | null)[]; note: string; context?: RecentContext }
const cases: Case[] = readFileSync(casesPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const tally = { right: 0, wrongSkill: 0, falsePositive: 0, falseNegative: 0 }
const gates: { want: boolean; gate: number | null; fits: number | null }[] = []
const f2 = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(2) : ' n/d')

let notRouted = 0
for (const c of cases) {
  const context = noContext ? null : (c.context ?? null)
  // The hook sends nothing for these, so neither does the replay.
  if (!routable(c.text)) {
    notRouted++
    const ok = c.expect.includes(null)
    if (ok) tally.right++
    else tally.falseNegative++
    gates.push({ want: !c.expect.includes(null), gate: null, fits: null })
    console.log(
      `${ok ? 'ok  ' : 'MISS'} skip (not routed) pick -  want ${c.expect.map((e) => e ?? '-').join('|')}\n     ${c.text.slice(0, 70)}`,
    )
    continue
  }
  const wideAnswer = await ask(c.text, wideQuestions('typesafe', skills), context)
  served ||= modelOf(wideAnswer) ?? ''
  const wide = readWide(wideAnswer)
  let rerank = null
  let rerankAttempted = false
  let offered = skills
  if (wide && passesGate(wide, policy)) {
    const shortlisted = rerankCandidates(wide, skills, policy.shortlist, invocable)
    // A barred skill is left out of what the policy may pick, as live.
    offered = shortlisted.offered
    const candidates: Candidate[] = shortlisted.candidates.map((skill) => ({
      ...skill,
      detail: detailOf(skill, files.get(skill.name) ?? null, DEFAULT_EXCERPT_CHARS),
    }))
    if (candidates.length > 0) {
      rerankAttempted = true
      rerank = readRerank(await ask(c.text, rerankQuestions('typesafe', candidates), context))
    }
  }
  const pick = decide(wide, rerank, offered, policy, { rerankAttempted, rerankOn: true }).name
  const ok = c.expect.includes(pick)
  if (ok) tally.right++
  else if (pick === null) tally.falseNegative++
  else if (c.expect.every((name) => name === null)) tally.falsePositive++
  else tally.wrongSkill++
  const bestFits = rerank ? Math.max(...Object.values(rerank.fits)) : null
  gates.push({ want: !c.expect.includes(null), gate: wide?.gate ?? null, fits: bestFits })
  const top = (wide?.ranked ?? []).slice(0, 3).map((r) => `${r.name} ${f2(r.probability)}`).join(', ')
  const asked = Object.entries(wide?.gateValues ?? {}).map(([key, value]) => `${key} ${f2(value)}`).join(', ')
  console.log(
    `${ok ? 'ok  ' : 'MISS'} gate ${f2(wide?.gate)} fits ${f2(bestFits)} pick ${pick ?? '-'}  want ${c.expect.map((e) => e ?? '-').join('|')}\n     ${c.text.slice(0, 70)}\n     top: ${top}\n     gate: ${asked}`,
  )
}

const spread = (want: boolean, key: 'gate' | 'fits') =>
  gates.filter((g) => g.want === want && g[key] !== null).map((g) => (g[key] as number).toFixed(2)).sort().join(' ')
console.log(`\nmodel ${served} (asked ${model})${reverse ? ', catalog reversed' : ''} · ${skills.length} skills · ${cases.length} cases · ${notRouted} not routed`)
console.log(
  `right ${tally.right} · wrong skill ${tally.wrongSkill} · suggested when none wanted ${tally.falsePositive} · missed ${tally.falseNegative}`,
)
console.log(`gate, skill wanted:    ${spread(true, 'gate')}`)
console.log(`gate, none wanted:     ${spread(false, 'gate')}`)
console.log(`best fits, wanted:     ${spread(true, 'fits')}`)
console.log(`best fits, none wanted: ${spread(false, 'fits')}`)
