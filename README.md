# ping-monitor

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
