import { expect, test } from 'claude-code/testing'
import type { EngineInterface, Hook, Next, On, PromptSubmitInput, PromptAttachmentInput, SkillPromptInput } from 'claude-code'
import { register } from '../hooks/jev-skill-suggestion.ts'
import { trialArm } from '../hooks/policy.ts'

/**
 * The mod registered with `options`, driven through its hooks against a `$`
 * that answers from memory; `down` makes every backend request fail.
 */
function seat(
  options: Record<string, unknown>,
  world: { sid?: string; env?: Record<string, string>; files?: Record<string, string>; fits?: number; gate?: number; down?: boolean; raw?: (request: 'ranking' | 'rerank') => string | undefined },
) {
  const hooks: Record<string, unknown> = {}
  // A matcher, when given, sits between the event and the hook.
  register(((event: string, ...rest: unknown[]) => {
    hooks[event] = rest[rest.length - 1]
  }) as On, { logDecisions: false, ...options })
  const submit = hooks['prompt.submit'] as Hook<'prompt.submit'>

  const auth: string[] = []
  const bodies: string[] = []
  const files = world.files ?? {}
  const $ = {
    command: { list: async () => [{ name: 'test-runner', description: 'Fix failing tests', source: 'user' }] },
    http: {
      fetch: async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        auth.push(init.headers.authorization as string)
        bodies.push(init.body)
        if (world.down) return { ok: false, status: 503, text: '' }
        const raw = world.raw?.(init.body.includes('fits::') ? 'rerank' : 'ranking')
        if (raw !== undefined) return { ok: true, text: raw }
        return {
          ok: true,
          text: JSON.stringify({ model: 'jev-1.13.0', answers: {
            which: { type: 'choice', choice: 'test-runner' },
            'fits::test-runner': { type: 'noul', noul: world.fits ?? 0.9 },
            // Gate answers only when the gate was asked, as the API does.
            ...(world.gate === undefined || !init.body.includes('gate::')
              ? {}
              : {
                  'gate::acts_on_user_system': { type: 'noul', noul: world.gate },
                  'gate::would_follow_documented_procedure': { type: 'noul', noul: world.gate },
                  'gate::prose_suffices': { type: 'noul', noul: 1 - world.gate },
                }),
          } }),
        }
      },
    },
    clock: { now: async () => 0, sleep: () => Promise.race([]) },
    fs: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path] as string,
      write: async (path: string, text: string) => void (files[path] = text),
    },
    env: { get: async (name: string) => (world.env ?? {})[name] },
    session: {
      cwd: async () => '/work',
      id: async () => world.sid ?? 's1',
      messages: async () => [
        { role: 'user', text: 'the CI run is red', toolUses: [] },
        { role: 'assistant', text: 'Three tests fail in parser.test.ts.', toolUses: [] },
      ],
    },
    ui: { log: () => {}, status: () => {} },
  } as unknown as EngineInterface
  const next = (async (e: PromptSubmitInput) => e) as unknown as Next<'prompt.submit'>
  const ask = (text: string) => submit($, { text, wait: false, origin: { kind: 'composer' } }, next)
  const pass = (async (e: unknown) => e) as never
  const listing = (text: string, agentId?: string) =>
    (hooks['prompt.attachment'] as Hook<'prompt.attachment'>)(
      $,
      { type: 'skill_listing', text, origin: { kind: 'engine' }, agentId } as unknown as PromptAttachmentInput,
      pass,
    )
  const load = (skill: string) =>
    (hooks['skill.prompt'] as Hook<'skill.prompt'>)($, { skill, text: '' } as unknown as SkillPromptInput, pass)
  const compact = () => (hooks['session.compact'] as Hook<'session.compact'>)($, {} as never, pass)
  return { ask, auth, bodies, listing, load, compact, files }
}

test('with no key option the key comes from TYPESAFE_API_KEY, and a bare go-ahead is never ranked', async () => {
  const { ask, auth } = seat({ inject: 'suggest' }, { env: { HOME: '/home/u', TYPESAFE_API_KEY: 'from-env' } })
  await ask('繼續')
  expect(auth).toEqual([])
  const result = await ask('fix the failing tests')
  expect(auth).toEqual(['Bearer from-env', 'Bearer from-env'])
  expect('context' in result && result.context?.join('\n')).toContain('test-runner')
})

test('content mode with nothing picked attaches nothing, so the model can still pick from the listing', async () => {
  const { ask, auth } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, fits: 0.05 })
  const e = await ask('fix the failing tests')
  expect(auth.length).toBe(2)
  expect('context' in e ? e.context : undefined).toBeUndefined()
})

test('a skill turned off in the user settings is never offered, under CLAUDE_CONFIG_DIR too', async () => {
  const settings = JSON.stringify({ skillOverrides: { 'test-runner': 'off' } })
  const { ask, auth } = seat(
    { typesafeApiKey: 'k' },
    { env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg' }, files: { '/cfg/settings.json': settings } },
  )
  await ask('fix the failing tests')
  expect(auth).toEqual([])
})

test('a 200 whose body is not an object (null, 42, "x") fails open for the ranking and the rerank', async () => {
  for (const body of ['null', '42', '"x"']) {
    for (const stage of ['ranking', 'rerank'] as const) {
      const { ask } = seat(
        { typesafeApiKey: 'k' },
        { env: { HOME: '/home/u' }, raw: (request) => (request === stage ? body : undefined) },
      )
      const e = await ask('fix the failing tests')
      expect(e.text).toBe('fix the failing tests')
      expect('context' in e ? e.context : undefined).toBeUndefined()
    }
  }
})

const LISTING = 'Skills:\n- test-runner'

test('a skill named past the first word is named back with no request to the backend, not attached', async () => {
  const { ask, auth } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { '/home/u/.claude/skills/test-runner/SKILL.md': 'Run them.' } })
  const out = await ask('修好再跑 /test-runner')
  expect(auth.length).toBe(0)
  const block = 'context' in out ? String(out.context) : ''
  expect(block).toContain('skill: "test-runner"')
  expect(block).not.toContain('Run them.')
})

test('a long SKILL.md is named, not attached, and the record says how much went in', async () => {
  const path = '/home/u/.claude/jev-skill-suggestion/decisions/s1.jsonl'
  const big = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { '/home/u/.claude/skills/test-runner/SKILL.md': 'x'.repeat(10_001) } })
  const out = await big.ask('fix the failing tests')
  expect(String('context' in out ? out.context : '')).not.toContain('xxxx')
  expect(JSON.parse((big.files[path] as string).trim())).toMatchObject({ inject: 'content', attachedChars: 0, pick: 'test-runner' })
  const small = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { '/home/u/.claude/skills/test-runner/SKILL.md': 'Run them.' } })
  await small.ask('fix the failing tests')
  expect(JSON.parse((small.files[path] as string).trim()).attachedChars).toBe(9)
})

test('a failed request records why', async () => {
  const path = '/home/u/.claude/jev-skill-suggestion/decisions/s1.jsonl'
  const down = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, down: true })
  await down.ask('fix the failing tests')
  expect(JSON.parse((down.files[path] as string).trim())).toMatchObject({ answered: false, failure: 'ranking 503' })
})

test('the trial attaches, names or sends nothing by session, and records the pick either way', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `session-${i}`)
  const seen = new Set<string>()
  for (const sid of ids) {
    const { ask, files } = seat({ typesafeApiKey: 'k', injectTrial: true }, { sid, env: { HOME: '/home/u' }, files: { '/home/u/.claude/skills/test-runner/SKILL.md': 'Run them.' } })
    const out = await ask('fix the failing tests')
    const line = JSON.parse((files[`/home/u/.claude/jev-skill-suggestion/decisions/${sid}.jsonl`] as string).trim())
    const block = 'context' in out ? String(out.context) : ''
    expect(line.inject).toBe(trialArm(sid))
    expect(line.pick).toBe('test-runner')
    if (line.inject === 'off') expect('context' in out ? out.context : undefined).toBeUndefined()
    if (line.inject === 'content') expect(block).toContain('Run them.')
    if (line.inject === 'suggest') expect(block).toContain('test-runner')
    seen.add(line.inject)
  }
  expect(seen.size).toBe(3)
})

test('a named skill the model may not invoke is not attached', async () => {
  const { ask } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { '/home/u/.claude/skills/test-runner/SKILL.md': '---\ndisable-model-invocation: true\n---\nRun them.' } })
  const out = await ask('修好再跑 /test-runner')
  expect('context' in out ? out.context : undefined).toBeUndefined()
})

test('every decision and every load goes to the session record file, appended to what a resumed session left', async () => {
  const path = '/home/u/.claude/jev-skill-suggestion/decisions/s1.jsonl'
  const { ask, load, files } = seat(
    { typesafeApiKey: 'k' },
    { env: { HOME: '/home/u' }, files: { [path]: '{"earlier":true}\n' } },
  )
  await ask('fix the failing tests')
  await load('test-runner')
  const lines = (files[path] as string).trim().split('\n').map((line) => JSON.parse(line))
  expect(lines[0]).toEqual({ earlier: true })
  expect(lines[1]).toMatchObject({ source: 'prompt', text: 'fix the failing tests', pick: 'test-runner', answered: true, model: 'jev-1.13.0' })
  expect(lines[1].top[0].name).toBe('test-runner')
  expect(lines[1].policy).toMatch(/^[0-9a-f]{8}$/)
  expect(lines[2]).toMatchObject({ loaded: 'test-runner', suggested: 'test-runner' })

  const off = seat({ typesafeApiKey: 'k', recordDecisions: false }, { env: { HOME: '/home/u' } })
  await off.ask('fix the failing tests')
  expect(Object.keys(off.files)).toEqual([])
})

test('a prompt the pre-checks drop is recorded with why, so the record shows what was never asked', async () => {
  const path = '/home/u/.claude/jev-skill-suggestion/decisions/s1.jsonl'
  const { ask, files } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  await ask('/pr fix')
  await ask('繼續')
  const lines = (files[path] as string).trim().split('\n').map((line) => JSON.parse(line))
  expect(lines[0]).toMatchObject({ source: 'prompt', text: '/pr fix', pick: null, reason: 'not routed: a typed /name' })
  expect(lines[1]).toMatchObject({ source: 'prompt', text: '繼續', pick: null, reason: 'not routed: a reply with no task of its own' })
})

test('the turn before goes beside the request, and sendRecentContext off leaves it empty', async () => {
  const on = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  await on.ask('fix them')
  expect(JSON.parse(on.bodies[0] as string).state.recent_context).toEqual({
    previous_user_message: 'the CI run is red',
    assistant_reply: 'Three tests fail in parser.test.ts.',
  })
  const off = seat({ typesafeApiKey: 'k', sendRecentContext: false }, { env: { HOME: '/home/u' } })
  await off.ask('fix them')
  expect(JSON.parse(off.bodies[0] as string).state.recent_context).toBe('')
})

test('a skill the Skill tool already loaded is named with how to load it, not attached whole again', async () => {
  const files = { '/home/u/.claude/skills/test-runner/SKILL.md': '---\nname: test-runner\n---\nRUN THE TESTS' }
  const blockOf = (e: unknown) => (e && typeof e === 'object' && 'context' in e ? ((e as { context?: string[] }).context?.join('\n') ?? '') : '')

  const fresh = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { ...files } })
  expect(blockOf(await fresh.ask('fix the failing tests'))).toContain('RUN THE TESTS')

  // In the listing, so the Skill tool can load it: named. After a compaction the
  // engine keeps only the first 5,000 tokens of it, so the body goes in whole.
  const listed = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { ...files } })
  await listed.listing(LISTING)
  await listed.load('test-runner')
  const after = blockOf(await listed.ask('fix the failing tests'))
  expect(after).toContain('was loaded with the Skill tool earlier in this session')
  expect(after).toContain('load it with the Skill tool (skill: "test-runner")')
  expect(after).not.toContain('RUN THE TESTS')
  await listed.compact()
  expect(blockOf(await listed.ask('fix the failing tests'))).toContain('RUN THE TESTS')

  // Not in the listing (user-invocable-only, or no listing seen yet): the Skill tool
  // may refuse it, so the body goes in whole.
  const unlisted = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { ...files } })
  await unlisted.load('test-runner')
  expect(blockOf(await unlisted.ask('fix the failing tests'))).toContain('RUN THE TESTS')
})
