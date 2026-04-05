# greed-compute-mcp

MCP server that gives LLMs stateful Python execution. Connect it to Claude, GPT, or any MCP-compatible agent and they can create sessions, run code, checkpoint state, fork workers, and run parallel MapReduce — all through natural tool calls.

## Setup

```bash
npm install -g greed-compute-mcp
```

Set your API key:

```bash
export GREED_API_KEY=gc_your_key_here
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "greed-compute": {
      "command": "greed-compute-mcp",
      "env": {
        "GREED_API_KEY": "gc_your_key_here"
      }
    }
  }
}
```

## Usage with Claude Code

```bash
claude mcp add greed-compute -- greed-compute-mcp
```

Set the env var in your shell or `.env`.

## Available Tools

| Tool | What it does |
|------|-------------|
| `create_session` | Spin up a Python interpreter (blank, data-science, ML, or scraping template) |
| `execute_code` | Run Python in a session. State persists between calls |
| `session_status` | Check TTL and activity |
| `terminate_session` | Kill a session |
| `install_packages` | pip install into a running session |
| `create_checkpoint` | Snapshot all interpreter state |
| `restore_checkpoint` | Load a checkpoint into a session |
| `list_checkpoints` | See all saved checkpoints |
| `delete_checkpoint` | Free checkpoint storage |
| `create_swarm` | Parallel MapReduce across N workers |
| `get_swarm` | Poll swarm progress |
| `create_workspace` | Persistent shared environment |
| `execute_in_workspace` | Run code in shared workspace |
| `list_workspaces` | See your workspaces |
| `upload_file` | Push files into a session |
| `download_file` | Pull files out of a session |
| `get_usage` | Check plan limits and usage |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `GREED_API_KEY` | Yes | — |
| `GREED_COMPUTE_URL` | No | `https://compute.deep-ml.com` |

## License

MIT
