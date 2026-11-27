import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

function runServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not exit; stdout=' + stdout + ' stderr=' + stderr)) }, 20000)
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.on('error', reject)
  })
}

test('a credential-bearing connection string never appears in startup output', async () => {
  const secret = 's3cret-pass-' + Date.now()
  const { code, stdout, stderr } = await runServer({ MONGODB_URI: `mongodb://user:${secret}@127.0.0.1:27099/trailhead`, PORT: '0' })
  assert.equal(code, 1)
  assert.ok(!stdout.includes(secret) && !stderr.includes(secret), 'credential leaked into output')
  assert.ok(!stdout.includes('mongodb://') && !stderr.includes('mongodb://'), 'connection string leaked into output')
  assert.match(stderr, /MongoDB startup failed at connect/)
})

test('an invalid connection string fails fast without printing it', async () => {
  const { code, stdout, stderr } = await runServer({ MONGODB_URI: 'not-a-valid-uri', PORT: '0' })
  assert.equal(code, 1)
  assert.ok(!stdout.includes('not-a-valid-uri') && !stderr.includes('not-a-valid-uri'), 'bad URI printed')
  assert.match(stderr, /MongoDB startup failed at parse connection string/)
})
