import { test, expect } from "bun:test";

import {
  buildNodeTransitionSubject,
  computeStalenessStatus,
  formatDurationShort,
  buildTestEmailMessage,
  getBasicAuthCredentials,
  renderNodeStatusPage,
  resolveEmailFromAddress,
} from "./index";

test("formatDurationShort renders minutes and hours", () => {
  expect(formatDurationShort(8 * 60_000)).toBe("8m");
  expect(formatDurationShort(60 * 60_000)).toBe("1h");
  expect(formatDurationShort(82 * 60_000)).toBe("1h 22m");
});

test("buildNodeTransitionSubject includes downtime in title", () => {
  expect(
    buildNodeTransitionSubject({
      nodeId: "node-a",
      status: "down",
      downDurationMs: 7 * 60_000,
    }),
  ).toBe("NODE DOWN: node-a (Down for 7m)");

  expect(
    buildNodeTransitionSubject({
      nodeId: "node-a",
      status: "up",
      downDurationMs: 72 * 60_000,
    }),
  ).toBe("NODE UP: node-a (Up after 1h 12m down)");
});

test("computeStalenessStatus marks node down when ping is stale", () => {
  const now = 1_000_000;
  const staleThresholdMs = 75_000;

  const status = computeStalenessStatus(now - staleThresholdMs, now, staleThresholdMs);

  expect(status).toBe("down");
});

test("computeStalenessStatus keeps node up when ping is recent", () => {
  const now = 1_000_000;
  const staleThresholdMs = 75_000;

  const status = computeStalenessStatus(now - 30_000, now, staleThresholdMs);

  expect(status).toBe("up");
});

test("computeStalenessStatus marks node down with no ping", () => {
  const status = computeStalenessStatus(null, 1_000_000, 75_000);

  expect(status).toBe("down");
});

test("getBasicAuthCredentials reads primary env vars", () => {
  const credentials = getBasicAuthCredentials({
    BASIC_AUTH_USERNAME: "agent",
    BASIC_AUTH_PASSWORD: "secret",
  });

  expect(credentials).toEqual({
    username: "agent",
    password: "secret",
  });
});

test("getBasicAuthCredentials falls back to legacy var names", () => {
  const credentials = getBasicAuthCredentials({
    BASIC_AUTH_USER: "legacy-user",
    BASIC_AUTH_PASS: "legacy-pass",
  });

  expect(credentials).toEqual({
    username: "legacy-user",
    password: "legacy-pass",
  });
});

test("getBasicAuthCredentials supports mixed naming", () => {
  const credentials = getBasicAuthCredentials({
    BASIC_AUTH_USERNAME: "agent",
    BASIC_AUTH_PASS: "fallback-pass",
  });

  expect(credentials).toEqual({
    username: "agent",
    password: "fallback-pass",
  });
});

test("getBasicAuthCredentials returns null when incomplete", () => {
  const credentials = getBasicAuthCredentials({ BASIC_AUTH_USERNAME: "agent" });

  expect(credentials).toBeNull();
});

test("buildTestEmailMessage builds predictable email content", () => {
  const message = buildTestEmailMessage({
    from: "worker@network-internal.hugeshop.com",
    to: "ops@hugeshop.com",
    host: "network-internal.hugeshop.com",
    sentAt: "2026-05-03T01:02:03.000Z",
  });

  expect(message.from).toBe("worker@network-internal.hugeshop.com");
  expect(message.to).toBe("ops@hugeshop.com");
  expect(message.subject).toBe("Ping monitor email test UP (worker@network-internal.hugeshop.com)");
  expect(typeof message.text).toBe("string");
  expect(typeof message.html).toBe("string");

  expect(message.text).toContain("Event - NODE UP");
  expect(message.text).toContain("Recorded At (ISO) - 2026-05-03T01:02:03.000Z");
  expect(message.text).toContain("Recorded At (Sydney) - ");
  expect(message.html).toContain("<table");
  expect(message.html).toContain("Status Indicator");
  expect(message.subject).toBe("Ping monitor email test UP (worker@network-internal.hugeshop.com)");
});

test("buildTestEmailMessage supports NODE DOWN format", () => {
  const message = buildTestEmailMessage({
    from: "worker@network-internal.hugeshop.com",
    to: "ops@hugeshop.com",
    host: "network-internal.hugeshop.com",
    status: "down",
    sentAt: "2026-05-03T01:02:03.000Z",
    reason: "No healthy ping",
  });

  expect(message.subject).toBe("Ping monitor email test DOWN (worker@network-internal.hugeshop.com)");
  expect(message.text).toContain("Event - NODE DOWN");
  expect(message.text).toContain("Reason - No healthy ping");
  expect(message.text).toContain("Action - Please verify node process/network path and check");
  expect(message.html).toContain("#dc2626");
});

test("buildTestEmailMessage shows green for up and red for down", () => {
  const upMessage = buildTestEmailMessage({
    from: "worker@network-internal.hugeshop.com",
    to: "ops@hugeshop.com",
    host: "network-internal.hugeshop.com",
    status: "up",
    sentAt: "2026-05-03T01:02:03.000Z",
  });

  const downMessage = buildTestEmailMessage({
    from: "worker@network-internal.hugeshop.com",
    to: "ops@hugeshop.com",
    host: "network-internal.hugeshop.com",
    status: "down",
    sentAt: "2026-05-03T01:02:03.000Z",
  });

  expect(upMessage.html).toContain("GREEN (UP)");
  expect(upMessage.html).toContain("#16a34a");
  expect(downMessage.html).toContain("RED (DOWN)");
  expect(downMessage.html).toContain("#dc2626");
});

test("resolveEmailFromAddress supports comma-separated list", () => {
  const from = resolveEmailFromAddress(
    "https://network-internal.hugeshop.com/ping",
    {
      EMAIL_FROM_ADDRESS: "primary@hugeshop.com, backup@hugeshop.com",
    },
  );

  expect(from).toBe("primary@hugeshop.com");
});

test("resolveEmailFromAddress falls back when list is empty", () => {
  const from = resolveEmailFromAddress(
    "https://network-internal.hugeshop.com/ping",
    {
      EMAIL_FROM_ADDRESS: "   ,  ",
    },
  );

  expect(from).toBe("ping-monitor@network-internal.hugeshop.com");
});

test("renderNodeStatusPage shows reason as tooltip", () => {
  const html = renderNodeStatusPage(
    [
      {
        target: "8.8.8.8",
        hostname: "node-a",
        status: "connected",
        avgMs: 2.2,
        recordedAt: Date.parse("2026-05-03T11:19:22.994Z"),
        reason: "Latest ping report has reachable packets",
      },
    ],
    "asc",
  );

  expect(html).toContain('class="reason-text"');
  expect(html).toContain('title="Latest ping report has reachable packets"');
});
