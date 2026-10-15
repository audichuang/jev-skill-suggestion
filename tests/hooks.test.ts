import { expect, test } from 'claude-code/testing'
import type { EngineInterface, Hook, Next, On, PromptSubmitInput, SessionStartInput, ToolCallInput, ToolDescribeInput } from 'claude-code'
import { register } from '../hooks/jev-skill-suggestion.ts'

/** The mod's prompt.submit hook, registered with `options`, and a `$` that answers from memory. */
function seat(options: Record<string, unknown>, world: { env?: Record<string, string>; files?: Record<string, string>; fits?: number; gate?: number }) {
  const hooks: Record<string, unknown> = {}
  register(((event: string, hook: unknown) => {
    hooks[event] = hook
  }) as On, { logDecisions: false, ...options })
  const submit = hooks['prompt.submit'] as Hook<'prompt.submit'>

  const auth: string[] = []
  const registered: string[] = []
  const files = world.files ?? {}
  const $ = {
    command: { list: async () => [{ name: 'test-runner', description: 'Fix failing tests', source: 'user' }] },
    http: {
      fetch: async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        auth.push(init.headers.authorization as string)
        return {
          ok: true,
          text: JSON.stringify({ answers: {
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
    fs: { exists: async (path: string) => path in files, read: async (path: string) => files[path] as string },
    env: { get: async (name: string) => (world.env ?? {})[name] },
    session: { cwd: async () => '/work' },
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
  const call = (e: Record<string, unknown>) =>
    (hooks['tool.call'] as Hook<'tool.call'>)($, { tool_use_id: 't', ...e } as unknown as ToolCallInput, pass)
  return { ask, auth, registered, start, describe, call }
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
  const { start, describe, call, auth } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' } })
  await start()
  const described = await describe('mcp__jev__find_skill')
  expect('isDeferred' in described && described.isDeferred).toBe(false)
  expect('isDeferred' in (await describe('Bash'))).toBe(false)

  const answer = await call({ tool: 'mcp__jev__find_skill', task: 'fix the failing tests' })
  expect(auth.length).toBe(2)
  expect('result' in answer && String(answer.result)).toContain('skill: "test-runner"')
  const bash = { tool: 'Bash', command: 'ls' }
  expect(await call(bash)).toEqual({ tool_use_id: 't', ...bash })
})

test('find_skill is not registered with findSkill off', async () => {
  const { start, registered } = seat({ findSkill: false }, {})
  await start()
  expect(registered).toEqual([])
})

test('find_skill skips the gate a prompt must pass: the model calling it already wants a skill', async () => {
  const { ask, start, call } = seat({ typesafeApiKey: 'k' }, { env: { HOME: '/home/u' }, gate: 0.1 })
  const prompted = await ask('fix the failing tests')
  expect('context' in prompted ? prompted.context : undefined).toBeUndefined()
  await start()
  const answer = await call({ tool: 'mcp__jev__find_skill', task: 'fix the failing tests' })
  expect('result' in answer && String(answer.result)).toContain('skill: "test-runner"')
})
