**This plugin is currently in Preview.**

# Datadog OpenCode Plugin

Query your Datadog data directly from OpenCode using natural language. Ask about logs, metrics, traces, dashboards, monitors, and more.

## What you need

- A [Datadog](https://www.datadoghq.com/) account
- [OpenCode](https://opencode.ai/) CLI

## Getting started

> If you already have the Datadog MCP server registered separately in your `opencode.json`, disable or remove it first to avoid conflicts.

**1. Add the plugin to your `opencode.json`** (create the file if it doesn't exist):

```json
{ "plugin": ["@datadog/opencode-plugin"] }
```

If you already have a `plugin` array, add `"@datadog/opencode-plugin"` to the existing list.

**2. Restart OpenCode.**

OpenCode runs `bun install` at startup, so the package is fetched from npm automatically — no separate install command needed.

The plugin provides three custom tools (`ddsetup`, `ddconfig`, `ddtoolsets`) that the agent can use to manage the Datadog MCP server.

Before you can start querying your Datadog data, the agent needs to set up the connection. Ask any Datadog-related question or tell the agent to run `ddsetup` — it will guide you through selecting your Datadog site and write the MCP server configuration to `opencode.json`.

After setup, restart OpenCode to activate the MCP server and complete authentication when prompted.

## Using the plugin

Once connected, just ask the agent anything about your Datadog data:

```
Show me error logs from the last hour
```

```
What monitors are currently alerting?
```

```
Find traces for service "api-gateway" with latency > 500ms
```

```
List my dashboards
```

## Can't connect?

**Never connected before?** Tell the agent to run `ddsetup`. It will configure the Datadog MCP server in your `opencode.json`.

**Was working before but stopped?** Tell the agent to run `ddconfig` with the troubleshoot action. It will check your domain, authentication status, and help diagnose the issue.

## Changing settings

The plugin provides tools the agent can use to manage configuration:

- `ddconfig` — change your Datadog site or view connection details
- `ddtoolsets` — enable or disable groups of tools

## Advanced usage

### Key authentication

Instead of OAuth, you can authenticate using a Datadog API key and application key. Add the MCP server entry to your `opencode.json` manually with OAuth disabled:

```json
{
  "mcp": {
    "datadog": {
      "type": "remote",
      "url": "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      "oauth": false,
      "headers": { "DD_API_KEY": "{env:DD_API_KEY}", "DD_APPLICATION_KEY": "{env:DD_APPLICATION_KEY}" }
    }
  }
}
```

Set the environment variables before starting OpenCode:

```bash
DD_API_KEY=your-api-key DD_APPLICATION_KEY=your-application-key opencode
```

Replace the MCP domain in the URL if your organization uses a different Datadog site (e.g. `mcp.datadoghq.eu` for EU).

### Environment variable overrides

OpenCode supports `{env:VARIABLE_NAME}` substitution anywhere inside `opencode.json` — you can hand-edit the `mcp.datadog` entry to read values from the environment (for example, to swap the MCP domain per shell session). This is a manual workflow: the plugin's `ddsetup`, `ddconfig`, and `ddtoolsets` tools always write concrete values, so if you want `{env:…}` placeholders you need to add them yourself and they will be preserved across surgical edits (comments and unrelated keys are preserved too).

## Good to know

- By default, authentication is handled via OAuth in your browser. Key authentication is also [supported](#key-authentication).
- No Datadog credentials are sent to the AI model provider.

## Support

- [Datadog MCP Server Documentation](https://docs.datadoghq.com/bits_ai/mcp_server/)

## Legal

See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files included with this plugin.

For details on how Datadog handles your data, see the [Datadog Privacy Policy](https://www.datadoghq.com/legal/privacy).
