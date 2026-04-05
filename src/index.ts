#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = process.env.GREED_COMPUTE_URL || 'https://compute.deep-ml.com'
const API_KEY = process.env.GREED_API_KEY || ''

if (!API_KEY) {
  console.error(`
  greed-compute-mcp needs your API key.

  Get one at: https://greed-compute-ui.vercel.app/login

  Then run with:
    GREED_API_KEY=gc_your_key npx greed-compute-mcp

  Or add to Claude Desktop config:
    {
      "mcpServers": {
        "greed-compute": {
          "command": "npx",
          "args": ["greed-compute-mcp"],
          "env": { "GREED_API_KEY": "gc_your_key" }
        }
      }
    }

  Or Claude Code:
    claude mcp add greed-compute -e GREED_API_KEY=gc_your_key -- npx greed-compute-mcp
`)
  process.exit(1)
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

function text(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'greed-compute',
  version: '0.1.0',
})

// ── Session tools ────────────────────────────────────────────────────────────

server.tool(
  'create_session',
  'Create a stateful Python session. State persists between execute calls.',
  {
    template: z.enum(['blank', 'data-science', 'machine-learning', 'web-scraping']).default('blank').describe('Pre-loaded library template'),
    ttl_seconds: z.number().optional().describe('Session lifetime in seconds (default 120)'),
  },
  async ({ template, ttl_seconds }) => {
    const result = await api('POST', '/session/create', { template, ttl_seconds })
    return text(result)
  }
)

server.tool(
  'execute_code',
  'Run Python code in a session. Variables persist between calls. Returns stdout, result, errors, and plots.',
  {
    session_id: z.string().describe('Session ID from create_session'),
    code: z.string().describe('Python code to execute'),
  },
  async ({ session_id, code }) => {
    const result = await api('POST', `/session/${session_id}/execute`, { code })
    return text(result)
  }
)

server.tool(
  'session_status',
  'Check if a session is alive and how much TTL remains.',
  {
    session_id: z.string().describe('Session ID'),
  },
  async ({ session_id }) => {
    const result = await api('GET', `/session/${session_id}/status`)
    return text(result)
  }
)

server.tool(
  'terminate_session',
  'Kill a session and free its resources.',
  {
    session_id: z.string().describe('Session ID'),
  },
  async ({ session_id }) => {
    const result = await api('DELETE', `/session/${session_id}`)
    return text(result)
  }
)

server.tool(
  'install_packages',
  'Install pip packages into a running session without restarting it.',
  {
    session_id: z.string().describe('Session ID'),
    packages: z.array(z.string()).describe('Package names to install'),
  },
  async ({ session_id, packages }) => {
    const result = await api('POST', `/session/${session_id}/install`, { packages })
    return text(result)
  }
)

// ── Checkpoint tools ─────────────────────────────────────────────────────────

server.tool(
  'create_checkpoint',
  'Snapshot the entire Python interpreter state (all variables, imports, models). Can be restored later or forked into multiple sessions.',
  {
    session_id: z.string().describe('Session ID to checkpoint'),
    name: z.string().optional().describe('Human-readable name for the checkpoint'),
  },
  async ({ session_id, name }) => {
    const result = await api('POST', `/session/${session_id}/checkpoint`, { name })
    return text(result)
  }
)

server.tool(
  'restore_checkpoint',
  'Load a previously saved checkpoint into a running session. All variables are restored.',
  {
    session_id: z.string().describe('Session to restore into'),
    checkpoint_id: z.string().describe('Checkpoint ID to restore'),
  },
  async ({ session_id, checkpoint_id }) => {
    const result = await api('POST', `/session/${session_id}/restore/${checkpoint_id}`)
    return text(result)
  }
)

server.tool(
  'list_checkpoints',
  'List all saved checkpoints for your API key.',
  {},
  async () => {
    const result = await api('GET', '/checkpoints')
    return text(result)
  }
)

server.tool(
  'delete_checkpoint',
  'Delete a checkpoint and free the storage it uses.',
  {
    checkpoint_id: z.string().describe('Checkpoint ID to delete'),
  },
  async ({ checkpoint_id }) => {
    const result = await api('DELETE', `/checkpoints/${checkpoint_id}`)
    return text(result)
  }
)

// ── Swarm tools ──────────────────────────────────────────────────────────────

server.tool(
  'create_swarm',
  'Run parallel MapReduce across N workers. Setup code runs once and is cloned to all workers. Each worker processes one data partition.',
  {
    template_code: z.string().optional().describe('Setup code that runs once and gets cloned to all workers (imports, model loading)'),
    map_fn: z.string().describe('Code each worker runs. Has access to `partition` variable.'),
    data: z.array(z.any()).describe('Array of items, one per worker. Each item is injected as `partition`.'),
    reduce_fn: z.string().optional().describe('Code to combine results. Has access to `results` list.'),
    webhook_url: z.string().optional().describe('URL to POST results when swarm finishes'),
  },
  async ({ template_code, map_fn, data, reduce_fn, webhook_url }) => {
    const result = await api('POST', '/swarm', { template_code, map_fn, data, reduce_fn, webhook_url })
    return text(result)
  }
)

server.tool(
  'get_swarm',
  'Check swarm progress and get results.',
  {
    swarm_id: z.string().describe('Swarm ID'),
  },
  async ({ swarm_id }) => {
    const result = await api('GET', `/swarm/${swarm_id}`)
    return text(result)
  }
)

// ── Workspace tools ──────────────────────────────────────────────────────────

server.tool(
  'create_workspace',
  'Create a persistent shared Python environment. Multiple API keys can execute in the same workspace. State auto-saves.',
  {
    name: z.string().describe('Workspace name'),
  },
  async ({ name }) => {
    const result = await api('POST', '/workspaces', { name })
    return text(result)
  }
)

server.tool(
  'execute_in_workspace',
  'Run code in a shared workspace. All members see the same state.',
  {
    workspace_id: z.string().describe('Workspace ID'),
    code: z.string().describe('Python code to execute'),
  },
  async ({ workspace_id, code }) => {
    const result = await api('POST', `/workspaces/${workspace_id}/execute`, { code })
    return text(result)
  }
)

server.tool(
  'list_workspaces',
  'List all workspaces you own or have access to.',
  {},
  async () => {
    const result = await api('GET', '/workspaces')
    return text(result)
  }
)

// ── File tools ───────────────────────────────────────────────────────────────

server.tool(
  'upload_file',
  'Upload a file to a session workspace. Your code can then read it by filename.',
  {
    session_id: z.string().describe('Session ID'),
    filename: z.string().describe('Filename in the workspace'),
    content_base64: z.string().describe('File content, base64 encoded'),
  },
  async ({ session_id, filename, content_base64 }) => {
    const result = await api('POST', `/session/${session_id}/files`, { filename, content: content_base64 })
    return text(result)
  }
)

server.tool(
  'download_file',
  'Download a file from a session workspace. Returns base64 encoded content.',
  {
    session_id: z.string().describe('Session ID'),
    filename: z.string().describe('Filename to download'),
  },
  async ({ session_id, filename }) => {
    const result = await api('GET', `/session/${session_id}/output/${filename}`)
    return text(result)
  }
)

// ── Usage tool ───────────────────────────────────────────────────────────────

server.tool(
  'get_usage',
  'Check your current API usage, plan limits, and billing status.',
  {},
  async () => {
    const result = await api('GET', '/usage')
    return text(result)
  }
)

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('greed-compute MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
