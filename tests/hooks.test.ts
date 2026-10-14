import { expect, test } from 'claude-code/testing'
import type { EngineInterface, Hook, Next, On, PromptSubmitInput } from 'claude-code'
import { register } from '../hooks/jev-skill-suggestion.ts'

/** The mod's prompt.submit hook, registered with `options`, and a `$` that answers from memory. */
function seat(options: Record<string, unknown>, world: { env?: Record<string, string>; files?: Record<string, string>; fits?: number }) {
  let submit!: Hook<'prompt.submit'>
  register(((event: string, hook: unknown) => {
    if (event === 'prompt.submit') submit = hook as Hook<'prompt.submit'>
  }) as On, { logDecisions: false, ...options })

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
    ui: { log: () => {}, status: () => {} },
  } as unknown as EngineInterface
  const next = (async (e: PromptSubmitInput) => e) as unknown as Next<'prompt.submit'>
  const ask = (text: string) => submit($, { text, wait: false, origin: { kind: 'composer' } }, next)
  return { ask, auth }
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
