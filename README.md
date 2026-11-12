**This plugin is currently in Preview.**

# Datadog OpenCode Plugin

Query your Datadog data directly from OpenCode using natural language. Ask about logs, metrics, traces, dashboards, monitors, and more.

## What you need

- A [Datadog](https://www.datadoghq.com/) account
- [OpenCode](https://opencode.ai/) CLI: 2.x, or 1.x at version 1.18.29 or later

## Getting started

> If you already have the Datadog MCP server registered separately in your `opencode.json`, disable or remove it first to avoid conflicts.

**1. Add the plugin to your `opencode.json`** (create the file if it doesn't exist):

```json
{ "plugins": ["@datadog/opencode-plugin"] }
```

OpenCode 1.x uses the singular key, `"plugin"`. OpenCode 2.x reads either key, so `"plugin"` keeps working after an upgrade. If you already have a plugin array, add `"@datadog/opencode-plugin"` to the existing list.

The same package supports OpenCode 1.x and 2.x, so you don't need to change anything when you upgrade OpenCode.

**2. Restart OpenCode.**

- **OpenCode 2.x:** run `opencode service restart`, or quit and reopen the OpenCode desktop app. OpenCode 2.x runs every session, in the terminal and the desktop app, through one background server that only looks for plugins when it starts. Quitting the terminal UI or opening a new session isn't enough.
- **OpenCode 1.x:** quit and restart OpenCode.

OpenCode runs `bun install` at startup, so the package is fetched from npm automatically — no separate install command needed.

The plugin provides three custom tools (`ddsetup`, `ddconfig`, `ddtoolsets`) that the agent can use to manage the Datadog MCP server.

Before you can start querying your Datadog data, the agent needs to set up the connection. Ask any Datadog-related question or tell the agent to run `ddsetup` — it will guide you through selecting your Datadog site and write the MCP server configuration to `opencode.json`.

After setup, sign in to Datadog in your browser: on OpenCode 2.x, run `/mcp` and select the `datadog` server; on either version, you can run `opencode mcp auth datadog` in a separate terminal, from your project directory, where the Datadog server is configured. If the tools aren't available afterwards, restart OpenCode as in [step 2](#getting-started).

## Using the plugin

Once connected, just ask the agent anything about your Datadog data:

```
Show me error logs for the "checkout" service from the last hour
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

**Don't see the `ddsetup`, `ddconfig` or `ddtoolsets` tools?** OpenCode hasn't loaded the plugin yet. On OpenCode 2.x, run `opencode service restart` (or quit and reopen the desktop app); on 1.x, restart OpenCode. If they're still missing, check the OpenCode log (`~/.local/share/opencode/log/`) for a `loading plugin` line that mentions `datadog`.

If you installed the plugin from a local directory instead of npm: OpenCode 2.x finds a directory placed in `.opencode/plugins/` or `~/.config/opencode/plugins/` automatically, but OpenCode 1.x doesn't. On 1.x, also list the directory's absolute path in the `plugin` array, for example `{ "plugin": ["/path/to/plugins/datadog"] }`.

**Never connected before?** Tell the agent to run `ddsetup`. It will configure the Datadog MCP server in your `opencode.json`.

**Was working before but stopped?** Tell the agent to run `ddconfig`. It will check your domain, authentication status, and help diagnose the issue.

## Changing settings

The plugin provides tools the agent can use to manage configuration:

- `ddconfig` — change your Datadog site, or troubleshoot a broken connection
- `ddtoolsets` — enable or disable groups of tools

### How the tools edit your config

- **Which file:** the tools edit the Datadog entry in the first of `.opencode/opencode.jsonc`, `.opencode/opencode.json`, `opencode.jsonc` and `opencode.json` that has one. That's the same order OpenCode uses. On first setup, they add the entry to the first of those files that exists, or create `opencode.json`. If a file has a syntax error, the tools stop and ask you to fix it.
- **Keep the entry in one file.** OpenCode merges an entry split across files, but the tools only read the first one, so a split entry can lose its key-auth settings.
- **What changes:** only the URL and the `X-Datadog-MCP-*` headers. Other headers, such as API keys, plus comments and `{env:…}` placeholders, are left as they are. One exception: `ddconfig` rewrites the URL when you change sites, so re-add any `{env:…}` placeholder in the URL afterward.
- **Custom URLs:** for a proxy such as `http://localhost:8080`, changing the site keeps your scheme, path and query parameters. Choosing a standard Datadog site sets the URL to `https://<site>/v1/mcp`.

### Upgrading from an earlier version

Earlier versions used the `/api/unstable/mcp-server/mcp` endpoint and put toolsets and the plugin version in the URL. When the plugin loads, it moves those values into headers and keeps the rest of your settings. The new URL takes effect the next time you start OpenCode, which may ask you to sign in again. After that, the URL no longer changes with plugin updates.

If your team shares a committed config, everyone should upgrade, because older versions can undo toolset changes made by this one.

## Advanced usage

### Key authentication

Instead of OAuth, you can authenticate using a Datadog API key and application key. Add the MCP server entry to your `opencode.json` manually with OAuth disabled:

```json
{
  "mcp": {
    "datadog": {
      "type": "remote",
      "url": "https://mcp.datadoghq.com/v1/mcp",
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

On OpenCode 2.x, you can also write this entry in the V2 shape, under `mcp.servers.datadog`. The plugin reads and edits either shape, and writes new entries as `mcp.datadog`, which both versions read.

## Good to know

- By default, authentication is handled via OAuth in your browser. Key authentication is also [supported](#key-authentication).
- No Datadog credentials are sent to the AI model provider.

## Support

- [Datadog MCP Server Documentation](https://docs.datadoghq.com/mcp_server/)

## Acknowledgments

Thanks to [Gabriel M. Dutra](https://github.com/dmdutra), whose [OpenCode v2 migration](https://github.com/datadog-labs/opencode-plugin/pull/19) informed this plugin's OpenCode 2.x support.

## Legal

See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files included with this plugin.

For details on how Datadog handles your data, see the [Datadog Privacy Policy](https://www.datadoghq.com/legal/privacy).
