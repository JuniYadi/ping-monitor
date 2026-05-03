import { test, expect } from "bun:test";

import {
  buildTestEmailMessage,
  getBasicAuthCredentials,
  resolveEmailFromAddress,
} from "./index";

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
  expect(message.subject).toBe("Ping monitor email test UP (network-internal.hugeshop.com)");
  expect(typeof message.text).toBe("string");

  expect(message.text).toContain("Event       : NODE UP");
  expect(message.text).toContain("Recorded At (ISO)    : 2026-05-03T01:02:03.000Z");
  expect(message.text).toContain("Recorded At (Sydney) :");
  expect(message.subject).toBe("Ping monitor email test UP (network-internal.hugeshop.com)");
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

  expect(message.subject).toBe("Ping monitor email test DOWN (network-internal.hugeshop.com)");
  expect(message.text).toContain("Event       : NODE DOWN");
  expect(message.text).toContain("Reason      : No healthy ping");
  expect(message.text).toContain("Action      : Please verify node process/network path and check");
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
