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
  DEFAULT_MODEL,
  decide,
  detailOf,
  endpoint,
  modelInvocable,
  modelOf,
  passesGate,
  readRerank,
  readWide,
  requestBody,
  requestHeaders,
  rerankQuestions,
  shortlistOf,
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
const config = process.env.CLAUDE_CONFIG_DIR ?? `${home}/.claude`
const settings = JSON.parse(readFileSync(`${config}/settings.json`, 'utf8'))
const off = new Set(Object.entries(settings.skillOverrides ?? {}).filter(([, v]) => v === 'off').map(([k]) => k))
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
const installed = JSON.parse(readFileSync(`${config}/plugins/installed_plugins.json`, 'utf8')).plugins
for (const [key, installs] of Object.entries(installed) as [string, { installPath: string }[]][]) {
  if (settings.enabledPlugins?.[key] !== true) continue
  const plugin = key.split('@')[0] as string
  const dir = `${installs[0]?.installPath}/skills`
  for (const entry of skillDirs(dir)) add(`${plugin}:${entry}`, `${dir}/${entry}/SKILL.md`)
}
if (reverse) skills.reverse()

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

for (const c of cases) {
  const context = noContext ? null : (c.context ?? null)
  const wideAnswer = await ask(c.text, wideQuestions('typesafe', skills), context)
  served ||= modelOf(wideAnswer) ?? ''
  const wide = readWide(wideAnswer)
  let rerank = null
  let rerankAttempted = false
  const offered = skills.filter((skill) => modelInvocable(files.get(skill.name) ?? null))
  if (wide && passesGate(wide, policy)) {
    const candidates: Candidate[] = shortlistOf(wide, offered, policy.shortlist).map((skill) => ({
      ...skill,
      detail: detailOf(skill, files.get(skill.name) ?? null, 700),
    }))
    if (candidates.length > 0) {
      rerankAttempted = true
      rerank = readRerank(await ask(c.text, rerankQuestions('typesafe', candidates), context))
    }
  }
  const pick = decide(wide, rerank, offered, policy, rerankAttempted).name
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
console.log(`\nmodel ${served} (asked ${model})${reverse ? ', catalog reversed' : ''} · ${skills.length} skills · ${cases.length} cases`)
console.log(
  `right ${tally.right} · wrong skill ${tally.wrongSkill} · suggested when none wanted ${tally.falsePositive} · missed ${tally.falseNegative}`,
)
console.log(`gate, skill wanted:    ${spread(true, 'gate')}`)
console.log(`gate, none wanted:     ${spread(false, 'gate')}`)
console.log(`best fits, wanted:     ${spread(true, 'fits')}`)
console.log(`best fits, none wanted: ${spread(false, 'fits')}`)
