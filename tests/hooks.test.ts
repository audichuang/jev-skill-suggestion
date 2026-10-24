import { expect, test } from 'claude-code/testing'
import type { EngineInterface, Hook, Next, On, PromptSubmitInput, PromptAttachmentInput, SessionStartInput, SkillPromptInput, ToolCallInput, ToolDescribeInput } from 'claude-code'
import { register } from '../hooks/jev-skill-suggestion.ts'

/**
 * The mod registered with `options`, driven through its hooks against a `$`
 * that answers from memory; `down` makes every backend request fail.
 */
function seat(
  options: Record<string, unknown>,
  world: { env?: Record<string, string>; files?: Record<string, string>; fits?: number; gate?: number; down?: boolean; raw?: (request: 'ranking' | 'rerank') => string | undefined },
) {
  const hooks: Record<string, unknown> = {}
  // A matcher, when given, sits between the event and the hook.
  register(((event: string, ...rest: unknown[]) => {
    hooks[event] = rest[rest.length - 1]
  }) as On, { logDecisions: false, ...options })
  const submit = hooks['prompt.submit'] as Hook<'prompt.submit'>

  const auth: string[] = []
  const bodies: string[] = []
  const registered: string[] = []
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
      id: async () => 's1',
      messages: async () => [
        { role: 'user', text: 'the CI run is red', toolUses: [] },
        { role: 'assistant', text: 'Three tests fail in parser.test.ts.', toolUses: [] },
      ],
    },
    tool: {
      register: async (spec: { name: string }) => (registered.push(spec.name), { tool: `mcp__jev__${spec.name}` }),
    },
    ui: { log: () => {}, status: () => {} },
  } as unknown as EngineInterface
  const next = (async (e: PromptSubmitInput) => e) as unknown as Next<'prompt.submit'>
  const ask = (text: string) => submit($, { text, wait: false, origin: { kind: 'composer' } }, next)
  const pass = (async (e: unknown) => e) as never
  const start = () => (hooks['session.start'] as Hook<'session.start'>)($, {} as SessionStartInput, pass)
  const describe = (tool: string) =>
    (hooks['tool.describe'] as Hook<'tool.describe'>)($, { tool, description: 'd' } as ToolDescribeInput, pass)
  // The fakes stand in for engine events only in the fields the mod reads.
  const call = (e: Record<string, unknown>) =>
    (hooks['tool.call'] as Hook<'tool.call'>)($, { tool_use_id: 't', ...e } as unknown as ToolCallInput, pass)
  const listing = (text: string, agentId?: string) =>
    (hooks['prompt.attachment'] as Hook<'prompt.attachment'>)(
      $,
      { type: 'skill_listing', text, origin: { kind: 'engine' }, agentId } as unknown as PromptAttachmentInput,
      pass,
    )
  const load = (skill: string) =>
    (hooks['skill.prompt'] as Hook<'skill.prompt'>)($, { skill, text: '' } as unknown as SkillPromptInput, pass)
  const compact = () => (hooks['session.compact'] as Hook<'session.compact'>)($, {} as never, pass)
  return { ask, auth, bodies, registered, start, describe, call, listing, load, compact, files }
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
const FIND = { tool: 'mcp__jev__find_skill', task: 'fix the failing tests' }
const text = (answer: unknown) => (typeof answer === 'object' && answer && 'result' in answer ? String(answer.result) : '')

test('find_skill is registered at session start, kept out of ToolSearch, and answers with the pick for the Skill tool', async () => {
  const { start, describe, call, listing, auth } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  await start()
  const described = await describe('mcp__jev__find_skill')
  expect('isDeferred' in described && described.isDeferred).toBe(false)
  expect('isDeferred' in (await describe('Bash'))).toBe(false)

  await listing(LISTING)
  expect(text(await call(FIND))).toContain('skill: "test-runner"')
  expect(auth.length).toBe(2)
  const bash = { tool: 'Bash', command: 'ls' }
  expect(await call(bash)).toEqual({ tool_use_id: 't', ...bash })
})

test('find_skill is not offered with findSkill off, or with no backend to rerank its pick', async () => {
  const off = seat({ findSkill: false, typesafeApiKey: 'k' }, {})
  await off.start()
  expect(off.registered).toEqual([])
  const keyless = seat({}, {})
  await keyless.start()
  expect(keyless.registered).toEqual([])
  const noRerank = seat({ typesafeApiKey: 'k', rerank: false }, {})
  await noRerank.start()
  expect(noRerank.registered).toEqual([])
})

test('find_skill skips the gate a prompt must pass: the model calling it already wants a skill', async () => {
  const { ask, start, call, listing } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, gate: 0.1 })
  const prompted = await ask('fix the failing tests')
  expect('context' in prompted ? prompted.context : undefined).toBeUndefined()
  await start()
  await listing(LISTING)
  expect(text(await call(FIND))).toContain('skill: "test-runner"')
})

test('find_skill says the lookup is unavailable, not "none", when a request fails or no listing was seen', async () => {
  const down = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, down: true })
  await down.start()
  await down.listing(LISTING)
  expect(text(await down.call(FIND))).toContain('unavailable')

  const unlisted = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  await unlisted.start()
  await unlisted.listing(LISTING, 'subagent-1')
  expect(text(await unlisted.call(FIND))).toContain('unavailable')
})

test('every decision and every load goes to the session record file, appended to what a resumed session left', async () => {
  const path = '/home/u/.claude/jev-skill-suggestion/decisions/s1.jsonl'
  const { ask, start, listing, call, load, files } = seat(
    { typesafeApiKey: 'k' },
    { env: { HOME: '/home/u' }, files: { [path]: '{"earlier":true}\n' } },
  )
  await ask('fix the failing tests')
  await start()
  await listing(LISTING)
  await call(FIND)
  await load('test-runner')
  const lines = (files[path] as string).trim().split('\n').map((line) => JSON.parse(line))
  expect(lines[0]).toEqual({ earlier: true })
  expect(lines[1]).toMatchObject({ source: 'prompt', text: 'fix the failing tests', pick: 'test-runner', answered: true, model: 'jev-1.13.0' })
  expect(lines[1].top[0].name).toBe('test-runner')
  expect(lines[2]).toMatchObject({ source: 'find_skill', pick: 'test-runner' })
  expect(lines[3]).toMatchObject({ loaded: 'test-runner', suggested: 'test-runner' })

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

  // In the listing, so the Skill tool can load it: named, and still named after a
  // compaction, since the engine re-attaches what the Skill tool loaded.
  const listed = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { ...files } })
  await listed.listing(LISTING)
  await listed.load('test-runner')
  const after = blockOf(await listed.ask('fix the failing tests'))
  expect(after).toContain('was loaded with the Skill tool earlier in this session')
  expect(after).toContain('load it with the Skill tool (skill: "test-runner")')
  expect(after).not.toContain('RUN THE TESTS')
  await listed.compact()
  expect(blockOf(await listed.ask('fix the failing tests'))).not.toContain('RUN THE TESTS')

  // Not in the listing (user-invocable-only, or no listing seen yet): the Skill tool
  // may refuse it, so the body goes in whole.
  const unlisted = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, files: { ...files } })
  await unlisted.load('test-runner')
  expect(blockOf(await unlisted.ask('fix the failing tests'))).toContain('RUN THE TESTS')
})
