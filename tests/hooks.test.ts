import { expect, test } from 'claude-code/testing'
import type { EngineInterface, Hook, Next, On, PromptSubmitInput, SessionStartInput, ToolCallInput, ToolDescribeInput } from 'claude-code'
import { register } from '../hooks/jev-skill-suggestion.ts'

/** The mod's prompt.submit hook, registered with `options`, and a `$` that answers from memory. */
function seat(options: Record<string, unknown>, world: { env?: Record<string, string>; files?: Record<string, string>; fits?: number }) {
  const hooks: Record<string, unknown> = {}
  register(((event: string, hook: unknown) => {
    hooks[event] = hook
  }) as On, { logDecisions: false, ...options })
  const submit = hooks['prompt.submit'] as Hook<'prompt.submit'>

  const auth: string[] = []
  const files = world.files ?? {}
  const $ = {
    command: { list: async () => [{ name: 'test-runner', description: 'Fix failing tests', source: 'user' }] },
    http: {
      fetch: async (_url: string, init: { headers: Record<string, string> }) => {
        auth.push(init.headers.authorization as string)
        return {
          ok: true,
          text: JSON.stringify({ answers: {
            which: { type: 'choice', choice: 'test-runner' },
            'fits::test-runner': { type: 'noul', noul: world.fits ?? 0.9 },
          } }),
        }
      },
    },
    clock: { now: async () => 0, sleep: () => Promise.race([]) },
    fs: { exists: async (path: string) => path in files, read: async (path: string) => files[path] as string },
    env: { get: async (name: string) => (world.env ?? {})[name] },
    session: { cwd: async () => '/work' },
    tool: { register: async (spec: { name: string }) => ({ tool: `mcp__jev__${spec.name}` }) },
    ui: { log: () => {}, status: () => {} },
  } as unknown as EngineInterface
  const next = (async (e: PromptSubmitInput) => e) as unknown as Next<'prompt.submit'>
  const ask = (text: string) => submit($, { text, wait: false, origin: { kind: 'composer' } }, next)
  return { ask, auth, hooks, $ }
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

test('find_skill is registered at session start, kept out of ToolSearch, and answers with the pick for the Skill tool', async () => {
  const { hooks, $, auth } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  const pass = (async (e: unknown) => e) as never
  await (hooks['session.start'] as Hook<'session.start'>)($, {} as SessionStartInput, pass)
  const described = await (hooks['tool.describe'] as Hook<'tool.describe'>)(
    $,
    { tool: 'mcp__jev__find_skill', description: 'd' } as ToolDescribeInput,
    pass,
  )
  expect('isDeferred' in described && described.isDeferred).toBe(false)
  const other = await (hooks['tool.describe'] as Hook<'tool.describe'>)($, { tool: 'Bash', description: 'd' } as ToolDescribeInput, pass)
  expect('isDeferred' in other).toBe(false)

  const call = hooks['tool.call'] as Hook<'tool.call'>
  const answer = await call($, { tool: 'mcp__jev__find_skill', tool_use_id: 't', task: 'fix the failing tests' } as unknown as ToolCallInput, pass)
  expect(auth.length).toBe(2)
  expect('result' in answer && String(answer.result)).toContain('skill: "test-runner"')
  const bash = { tool: 'Bash', tool_use_id: 'b', command: 'ls' } as unknown as ToolCallInput
  expect(await call($, bash, pass)).toBe(bash)
})

test('find_skill is not registered with findSkill off', async () => {
  const { hooks, $ } = seat({ findSkill: false }, {})
  const registered: unknown[] = []
  const withSpy = { ...$, tool: { register: async (spec: unknown) => (registered.push(spec), { tool: 'x' }) } } as unknown as EngineInterface
  await (hooks['session.start'] as Hook<'session.start'>)(withSpy, {} as SessionStartInput, (async (e: unknown) => e) as never)
  expect(registered).toEqual([])
})
