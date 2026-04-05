#!/usr/bin/env node

import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

const BASE = 'https://compute.deep-ml.com'
const FRONTEND = 'https://greed-compute-ui.vercel.app'
const PORT = 19432

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'

function log(msg: string) { console.log(msg) }
function accent(s: string) { return `${GREEN}${s}${RESET}` }
function dim(s: string) { return `${DIM}${s}${RESET}` }
function bold(s: string) { return `${BOLD}${s}${RESET}` }

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`  ${CYAN}›${RESET} ${question} `, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function select(question: string, options: string[]): Promise<number> {
  log(`\n  ${question}`)
  options.forEach((o, i) => log(`    ${dim(`${i + 1})`)} ${o}`))
  const answer = await ask(`Pick [1-${options.length}]:`)
  const idx = parseInt(answer) - 1
  return idx >= 0 && idx < options.length ? idx : 0
}

function openUrl(url: string) {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    execFileSync(cmd, [url], { stdio: 'ignore' })
  } catch {
    log(`\n  Open this URL in your browser:\n  ${accent(url)}`)
  }
}

// ── Auth Flow ────────────────────────────────────────────────────────────────

function waitForAuth(): Promise<{ key: string; login: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${PORT}`)

      if (url.pathname === '/callback') {
        const key = url.searchParams.get('key') || ''
        const login = url.searchParams.get('login') || ''

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <html>
            <body style="background:#0A0A08;color:#EFEFED;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <p style="color:#C8F135;font-size:24px;margin-bottom:8px">&#10003;</p>
                <p style="font-size:14px">Logged in as <strong>@${login}</strong></p>
                <p style="color:#A0A09C;font-size:12px;margin-top:16px">You can close this tab.</p>
              </div>
            </body>
          </html>
        `)

        server.close()
        resolve({ key, login })
      }
    })

    server.listen(PORT, () => {})
    server.on('error', reject)

    setTimeout(() => { server.close(); reject(new Error('Auth timed out')) }, 120_000)
  })
}

// ── Config Writers ───────────────────────────────────────────────────────────

function getClaudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
  }
  return path.join(process.env.HOME || '', '.config', 'claude', 'claude_desktop_config.json')
}

function writeClaudeDesktopConfig(apiKey: string) {
  const configPath = getClaudeDesktopConfigPath()
  let config: Record<string, unknown> = {}

  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch {}

  const servers = (config.mcpServers || {}) as Record<string, unknown>
  servers['greed-compute'] = {
    command: 'npx',
    args: ['greed-compute-mcp'],
    env: { GREED_API_KEY: apiKey },
  }
  config.mcpServers = servers

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  return configPath
}

function writeClaudeCodeConfig(apiKey: string) {
  try {
    execFileSync('claude', ['mcp', 'add', 'greed-compute', '-e', `GREED_API_KEY=${apiKey}`, '--', 'npx', 'greed-compute-mcp'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function writeEnvFile(apiKey: string, template: string) {
  const envPath = path.join(process.cwd(), '.env')
  let content = ''
  try { content = fs.readFileSync(envPath, 'utf-8') } catch {}

  if (content.includes('GREED_API_KEY')) {
    content = content.replace(/GREED_API_KEY=.*/g, `GREED_API_KEY=${apiKey}`)
  } else {
    content += `${content.length > 0 ? '\n' : ''}GREED_API_KEY=${apiKey}\n`
  }

  if (!content.includes('GREED_DEFAULT_TEMPLATE')) {
    content += `GREED_DEFAULT_TEMPLATE=${template}\n`
  }

  fs.writeFileSync(envPath, content)
  return envPath
}

// ── Demo Run ─────────────────────────────────────────────────────────────────

async function runDemo(apiKey: string, template: string) {
  log(`\n  ${dim('running a quick demo...')}`)

  const createRes = await fetch(`${BASE}/v1/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ template }),
  })
  const session = await createRes.json() as { session_id: string }

  if (!session.session_id) {
    log(`  ${YELLOW}Demo failed to create session${RESET}`)
    return
  }

  log(`  ${dim('session:')} ${session.session_id.slice(0, 8)}...`)

  const code = template === 'data-science'
    ? 'import numpy as np; print(f"numpy {np.__version__} ready. random: {np.random.randn(3).round(2).tolist()}")'
    : template === 'machine-learning'
    ? 'import sklearn; print(f"scikit-learn {sklearn.__version__} ready")'
    : 'print("hello from greed-compute")'

  const execRes = await fetch(`${BASE}/v1/session/${session.session_id}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ code }),
  })
  const result = await execRes.json() as { stdout?: string; duration_ms?: number; error?: string }

  if (result.stdout) {
    log(`  ${accent('→')} ${result.stdout.trim()}  ${dim(`(${result.duration_ms}ms)`)}`)
  }
  if (result.error) {
    log(`  ${YELLOW}${result.error}${RESET}`)
  }

  // Clean up
  await fetch(`${BASE}/v1/session/${session.session_id}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('')
  log(`  ${bold('greed')}${accent('.')}${bold('compute')}`)
  log(`  ${dim('stateful python for AI agents')}`)
  log('')

  // Step 1: Auth
  log(`  ${dim('step 1/3')} ${bold('authenticate')}`)
  log('')

  const authUrl = `${BASE}/v1/auth/github?redirect_uri=http://localhost:${PORT}/callback`

  log(`  Opening GitHub login...`)
  openUrl(authUrl)
  log(`  ${dim('waiting for auth...')}`)

  let key: string
  let login: string

  try {
    const result = await waitForAuth()
    key = result.key
    login = result.login
  } catch {
    log(`\n  ${YELLOW}Auth timed out.${RESET}`)
    log(`  Get your key at: ${accent(FRONTEND + '/login')}`)
    const manual = await ask('Paste your API key:')
    key = manual
    login = 'unknown'
  }

  log(`  ${accent('✓')} Logged in as ${bold('@' + login)}`)
  log(`  ${dim('key: ' + key.slice(0, 12) + '...')}`)

  // Step 2: Where are you using this?
  log('')
  log(`  ${dim('step 2/3')} ${bold('configure')}`)

  const target = await select('Where do you want to use greed-compute?', [
    'Claude Desktop',
    'Claude Code',
    'Both',
    'Just give me the key',
  ])

  if (target === 0 || target === 2) {
    const configPath = writeClaudeDesktopConfig(key)
    log(`  ${accent('✓')} Added to Claude Desktop`)
    log(`  ${dim(configPath)}`)
  }

  if (target === 1 || target === 2) {
    const ok = writeClaudeCodeConfig(key)
    if (ok) {
      log(`  ${accent('✓')} Added to Claude Code`)
    } else {
      log(`  ${YELLOW}Could not auto-configure Claude Code${RESET}`)
      log(`  ${dim('run: claude mcp add greed-compute -e GREED_API_KEY=' + key + ' -- npx greed-compute-mcp')}`)
    }
  }

  if (target === 3) {
    log(`\n  Your API key: ${accent(key)}`)
  }

  // Step 3: Template
  log('')
  log(`  ${dim('step 3/3')} ${bold('default template')}`)
  log(`  ${dim('your LLM uses this when creating sessions')}`)

  const tmpl = await select('Pick a template:', [
    'blank — clean Python, nothing pre-installed',
    'data-science — numpy, pandas, sklearn, matplotlib',
    'machine-learning — torch, transformers, datasets',
    'web-scraping — requests, beautifulsoup4, lxml',
  ])

  const templates = ['blank', 'data-science', 'machine-learning', 'web-scraping']
  const chosen = templates[tmpl]
  log(`  ${accent('✓')} Default template: ${bold(chosen)}`)

  // Save .env
  const envPath = writeEnvFile(key, chosen)
  log(`  ${accent('✓')} Saved to ${dim(envPath)}`)

  // Demo run
  await runDemo(key, chosen)

  // Done
  log('')
  log(`  ${accent('─'.repeat(45))}`)
  log('')
  log(`  ${accent('✓')} ${bold("you're all set")}`)
  log('')
  log(`  Ask your LLM to ${accent('"create a Python session and run some code"')}`)
  log(`  and it'll just work.`)
  log('')
  log(`  ${dim('docs:')}  ${FRONTEND}/docs`)
  log(`  ${dim('dash:')}  ${FRONTEND}/dashboard`)
  log('')

  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
