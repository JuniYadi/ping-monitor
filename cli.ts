import { $ } from "bun";
import { CLI_VERSION } from "./cli.version";
import {
  arch,
  hostname,
  networkInterfaces,
  platform,
} from "node:os";

export type PingReply = {
  bytes: number;
  from: string;
  icmpSeq: number;
  ttl: number;
  timeMs: number;
};

export type PingSummary = {
  target: string;
  transmitted: number;
  received: number;
  packetLossPercent: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
  stddevMs: number;
};

export type ParsedPingResult = {
  host: string;
  resolvedAddress: string | null;
  replies: PingReply[];
  summary: PingSummary;
};

export type LocalNodeIdentity = {
  hostname: string;
  platform: string;
  arch: string;
  ipV4s: string[];
  primaryIpV4: string | null;
};

export type PingPayload = {
  summary: PingSummary;
  sourceMeta: LocalNodeIdentity;
};

export type CliOptions = {
  server: string;
  auth: string | null;
  help: boolean;
  version: boolean;
};

const DEFAULT_SERVER = "localhost:8787";
const HELP_TEXT = `Usage: cli.ts [options]\n\nCommands:\n  Send a 5-packet ICMP ping to 8.8.8.8 and POST the parsed result to /ping on the server.\n\nOptions:\n  --help, -h           Show this help message\n  --version, -v        Show version and exit\n  --server <addr>      API server URL or host (default: ${DEFAULT_SERVER})\n  --server=<addr>      Same as --server\n  --auth <cred>        HTTP basic auth as username:password\n  --auth=<cred>        Same as --auth\n`;

export function parseAuthOption(rawAuth: string): string {
  const separatorIndex = rawAuth.indexOf(":");
  const hasCredentials = separatorIndex > 0 && separatorIndex < rawAuth.length - 1;
  if (!hasCredentials) {
    throw new Error('Auth must be in "username:password" format');
  }

  return rawAuth;
}

export function parseCliOptions(argv: string[]): CliOptions {
  let server = DEFAULT_SERVER;
  let auth: string | null = null;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      return { server, auth, help: true, version };
    }

    if (arg === "--version" || arg === "-v") {
      return { server, auth, help, version: true };
    }

    if (arg === "--server") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--server requires a value");
      }

      server = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--server=")) {
      const value = arg.slice("--server=".length);
      if (value === "") {
        throw new Error("--server requires a value");
      }

      server = value;
      continue;
    }

    if (arg === "--auth") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--auth requires username:password");
      }

      auth = parseAuthOption(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--auth=")) {
      const value = arg.slice("--auth=".length);
      if (value === "") {
        throw new Error("--auth requires username:password");
      }

      auth = parseAuthOption(value);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { server, auth, help, version };
}

export function normalizeServer(rawServer: string): string {
  if (rawServer.trim() === "") {
    throw new Error("server cannot be empty");
  }

  const withProtocol = /^https?:\/\//i.test(rawServer) ? rawServer : `http://${rawServer}`;
  const parsed = new URL(withProtocol);
  if (!parsed.pathname || parsed.pathname === "/") {
    return `${parsed.protocol}//${parsed.host}`;
  }

  const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  return `${parsed.protocol}//${parsed.host}${path}`;
}

export function buildBasicAuthHeader(auth: string): string {
  return `Basic ${btoa(auth)}`;
}

export function parsePingOutput(raw: string): ParsedPingResult {
  const lines = raw.split(/\r?\n/);

  let host = "";
  let resolvedAddress: string | null = null;
  const replies: PingReply[] = [];

  let transmitted = 0;
  let received = 0;
  let packetLossPercent = 0;
  let minMs = Number.NaN;
  let avgMs = Number.NaN;
  let maxMs = Number.NaN;
  let stddevMs = Number.NaN;

  for (const line of lines) {
    const headerMatch = line.match(/^PING\s+([^\s]+)\s+\(([^)]+)\):/);
    if (headerMatch) {
      host = headerMatch[1];
      resolvedAddress = headerMatch[2];
      continue;
    }

    const replyMatch = line.match(
      /^(\d+)\s+bytes\s+from\s+([^:]+):\s+icmp_seq=(\d+)\s+ttl=(\d+)\s+time=([0-9.]+)\s+ms/,
    );
    if (replyMatch) {
      replies.push({
        bytes: Number(replyMatch[1]),
        from: replyMatch[2],
        icmpSeq: Number(replyMatch[3]),
        ttl: Number(replyMatch[4]),
        timeMs: Number(replyMatch[5]),
      });
      continue;
    }

    const summaryMatch = line.match(
      /(\d+)\s+packets transmitted,\s*(\d+)\s+packets received,\s*([0-9.]+)% packet loss/i,
    );
    if (summaryMatch) {
      transmitted = Number(summaryMatch[1]);
      received = Number(summaryMatch[2]);
      packetLossPercent = Number(summaryMatch[3]);
      continue;
    }

    const roundTripMatch = line.match(
      /(?:round-trip|min\/max\/avg|rtt).* = ([0-9.]+)\/([0-9.]+)\/([0-9.]+)\/([0-9.]+) ms/i,
    );
    if (roundTripMatch) {
      minMs = Number(roundTripMatch[1]);
      avgMs = Number(roundTripMatch[2]);
      maxMs = Number(roundTripMatch[3]);
      stddevMs = Number(roundTripMatch[4]);
      continue;
    }
  }

  const summary: PingSummary = {
    target: host || "unknown",
    transmitted,
    received,
    packetLossPercent,
    minMs,
    avgMs,
    maxMs,
    stddevMs,
  };

  return {
    host: host || "unknown",
    resolvedAddress,
    replies,
    summary,
  };
}

export function getLocalNodeIdentity(): LocalNodeIdentity {
  const interfaces = networkInterfaces() ?? {};
  const ipV4s: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    for (const iface of addresses ?? []) {
      if (iface.family !== "IPv4" || iface.internal) {
        continue;
      }

      const address = iface.address;
      if (!ipV4s.includes(address)) {
        ipV4s.push(address);
      }
    }
  }

  const primaryIpV4 =
    ipV4s.find((ip) => !ip.startsWith("127.") && !ip.startsWith("169.254.")) ??
    ipV4s[0] ??
    null;

  return {
    hostname: process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? hostname(),
    platform: platform(),
    arch: arch(),
    ipV4s,
    primaryIpV4,
  };
}

export function buildPingPayload(target: string, rawOutput: string): PingPayload {
  const parsedOutput = parsePingOutput(rawOutput);
  return {
    summary: {
      ...parsedOutput.summary,
      target,
    },
    sourceMeta: getLocalNodeIdentity(),
  };
}

if (import.meta.main) {
  const options = parseCliOptions(Bun.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT.trimEnd());
    process.exit(0);
  }

  if (options.version) {
    console.log(`ping-monitor ${CLI_VERSION}`);
    process.exit(0);
  }

  const server = normalizeServer(options.server);
  const headers = {
    "Content-Type": "application/json",
    ...(options.auth === null ? {} : { Authorization: buildBasicAuthHeader(options.auth) }),
  };

  const rawOutput = await $`ping 8.8.8.8 -c 5`.text();
  const parsedOutput = parsePingOutput(rawOutput);
  const payload = buildPingPayload(parsedOutput.summary.target, rawOutput);

  const endpoint = new URL("ping", server.endsWith("/") ? server : `${server}/`).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Unable to send payload to ${endpoint}: ${response.status} ${errorText}`);
  }

  const responseText = await response.text();
  console.log(responseText);
}
