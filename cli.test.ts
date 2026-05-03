import { test, expect } from "bun:test";

import {
  buildPingPayload,
  buildBasicAuthHeader,
  normalizeServer,
  parseAuthOption,
  parseCliOptions,
  parsePingOutput,
} from "./cli";

const samplePingOutput = `PING 8.8.8.8 (8.8.8.8): 56 data bytes\n64 bytes from 8.8.8.8: icmp_seq=0 ttl=114 time=217.050 ms\n64 bytes from 8.8.8.8: icmp_seq=1 ttl=114 time=89.146 ms\n64 bytes from 8.8.8.8: icmp_seq=2 ttl=114 time=47.750 ms\n64 bytes from 8.8.8.8: icmp_seq=3 ttl=114 time=179.568 ms\n64 bytes from 8.8.8.8: icmp_seq=4 ttl=114 time=110.620 ms\n\n--- 8.8.8.8 ping statistics ---\n5 packets transmitted, 5 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 47.750/128.827/217.050/61.380 ms\n`;

const timeoutPingOutput = `PING 10.255.255.1 (10.255.255.1): 56 data bytes\nFrom 10.255.255.1 icmp_seq=1 Destination Host Unreachable\nFrom 10.255.255.1 icmp_seq=2 Destination Host Unreachable\n\n--- 10.255.255.1 ping statistics ---\n4 packets transmitted, 0 packets received, 100.0% packet loss\n`;

test("parse ping output to typed values", () => {
  const result = parsePingOutput(samplePingOutput);

  expect(result.host).toBe("8.8.8.8");
  expect(result.resolvedAddress).toBe("8.8.8.8");
  expect(result.summary).toEqual({
    target: "8.8.8.8",
    transmitted: 5,
    received: 5,
    packetLossPercent: 0,
    minMs: 47.75,
    avgMs: 128.827,
    maxMs: 217.05,
    stddevMs: 61.38,
  });
  expect(result.replies).toHaveLength(5);
  expect(result.replies[0]).toEqual({
    bytes: 64,
    from: "8.8.8.8",
    icmpSeq: 0,
    ttl: 114,
    timeMs: 217.05,
  });
  expect(result.replies[4]).toEqual({
    bytes: 64,
    from: "8.8.8.8",
    icmpSeq: 4,
    ttl: 114,
    timeMs: 110.62,
  });
});

test("parse timeout-heavy output without throwing", () => {
  const result = parsePingOutput(timeoutPingOutput);

  expect(result.host).toBe("10.255.255.1");
  expect(result.summary).toEqual({
    target: "10.255.255.1",
    transmitted: 4,
    received: 0,
    packetLossPercent: 100,
    minMs: Number.NaN,
    avgMs: Number.NaN,
    maxMs: Number.NaN,
    stddevMs: Number.NaN,
  });
  expect(result.replies).toHaveLength(0);
});

test("buildPingPayload includes local node identity", () => {
  const result = buildPingPayload("8.8.8.8", samplePingOutput);

  expect(result.summary.target).toBe("8.8.8.8");
  expect(result.sourceMeta.hostname).toEqual(expect.any(String));
  expect(result.sourceMeta.platform).toEqual(expect.any(String));
  expect(result.sourceMeta.arch).toEqual(expect.any(String));
  expect(result.sourceMeta.ipV4s).toEqual(expect.any(Array));
  expect(result.sourceMeta.ipV4s.every((ip) => typeof ip === "string")).toBe(true);
  expect(
    result.sourceMeta.primaryIpV4 === null ||
      typeof result.sourceMeta.primaryIpV4 === "string",
  ).toBe(true);
});

test("parseCliOptions uses defaults when flags are absent", () => {
  const result = parseCliOptions([]);

  expect(result.server).toBe("localhost:8787");
  expect(result.auth).toBeNull();
  expect(result.help).toBe(false);
});

test("parseCliOptions reads --server and --auth flags", () => {
  const result = parseCliOptions([
    "--server",
    "api.internal:8787",
    "--auth",
    "user:secret",
  ]);

  expect(result.server).toBe("api.internal:8787");
  expect(result.auth).toBe("user:secret");
  expect(result.help).toBe(false);
});

test("parseCliOptions reads equals-style flags", () => {
  const result = parseCliOptions(["--server=https://example.internal", "--auth=foo:bar"]);

  expect(result.server).toBe("https://example.internal");
  expect(result.auth).toBe("foo:bar");
  expect(result.help).toBe(false);
});

test("parseCliOptions accepts --help flag", () => {
  const result = parseCliOptions(["--help"]);

  expect(result.help).toBe(true);
  expect(result.version).toBe(false);
  expect(result.server).toBe("localhost:8787");
  expect(result.auth).toBeNull();
});

test("parseCliOptions accepts -h alias", () => {
  const result = parseCliOptions(["-h"]);

  expect(result.help).toBe(true);
  expect(result.version).toBe(false);
});

test("parseCliOptions reads --version flag", () => {
  const result = parseCliOptions(["--version"]);

  expect(result.version).toBe(true);
  expect(result.help).toBe(false);
  expect(result.server).toBe("localhost:8787");
  expect(result.auth).toBeNull();
});

test("parseCliOptions reads -v alias", () => {
  const result = parseCliOptions(["-v"]);

  expect(result.version).toBe(true);
  expect(result.help).toBe(false);
  expect(result.server).toBe("localhost:8787");
  expect(result.auth).toBeNull();
});

test("parseAuthOption requires username:password format", () => {
  expect(() => parseAuthOption("bad-format")).toThrow("username:password");
  expect(parseAuthOption("user:password")).toBe("user:password");
});

test("parseCliOptions rejects unknown flags", () => {
  expect(() => parseCliOptions(["--unknown"])).toThrow();
});

test("normalizeServer adds protocol when absent", () => {
  const server = normalizeServer("api.internal:8787");
  expect(server).toBe("http://api.internal:8787");
});

test("buildBasicAuthHeader supports raw auth strings", () => {
  expect(buildBasicAuthHeader("alice:secret")).toBe("Basic YWxpY2U6c2VjcmV0");
});
