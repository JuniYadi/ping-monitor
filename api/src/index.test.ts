import { test, expect } from "bun:test";

import { getBasicAuthCredentials } from "./index";

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
