# ping-monitor

Install as background service (auto-start):

```bash
curl -fsSL https://raw.githubusercontent.com/JuniYadi/ping-monitor/main/install.sh | bash -s -- \
  --server "https://your-server" \
  --auth "username:password"
```

You can also pass values via environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/JuniYadi/ping-monitor/main/install.sh | \
  env PING_MONITOR_SERVER="https://your-server" PING_MONITOR_AUTH="username:password" bash -s --
```

If you want interactive prompts instead, run the installer directly so it can read from the terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/JuniYadi/ping-monitor/main/install.sh -o /tmp/install.sh
bash /tmp/install.sh
```

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Command line options:

```bash
bun run index.ts --server localhost:8787 --auth username:password
```

- `--server`: target API server (default `localhost:8787`)
- `--auth`: HTTP Basic auth header value as `username:password`

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
