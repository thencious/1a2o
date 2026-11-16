import { test } from "node:test";
import assert from "node:assert/strict";
import { signIn } from "./linkedin-sign-in.mjs";

function fixture({ url = "https://www.linkedin.com/feed/", expires = -1, failure = false } = {}) {
  let closed = false;
  const cookies = ["li_at", "JSESSIONID"].map(name => ({ name, value: name === "li_at" ? "fake-private-session" : '"ajax:fake"', domain: ".linkedin.com", path: "/", expires }));
  cookies.push({ name: "unrelated", value: "not-imported", domain: ".example.org", path: "/", expires });
  const page = { on() {}, async goto() { if (failure) throw new Error("private internal details"); }, url: () => url, isClosed: () => false, evaluate: async () => "Fixture browser user agent" };
  const browser = { newContext: async () => ({ newPage: async () => page, cookies: async () => cookies }), isConnected: () => !closed, close: async () => { closed = true; } };
  return { browserType: { launch: async () => browser }, closed: () => closed };
}

test("sign-in captures only its own LinkedIn session and closes its window", async () => {
  const fake = fixture(), messages = [];
  await signIn({ browserType: fake.browserType, send: message => messages.push(message) });
  assert.equal(messages.at(-1).type, "session");
  assert.equal(messages.at(-1).session.cookies.length, 2);
  assert.equal(messages.at(-1).session.csrf, "ajax:fake");
  assert.equal(fake.closed(), true);
});
test("an unfinished challenge expires without capturing a session", async () => {
  const fake = fixture({ url: "https://www.linkedin.com/checkpoint/challenge" }), messages = [];
  await signIn({ browserType: fake.browserType, send: message => messages.push(message), lifetimeMs: 0 });
  assert.equal(messages.at(-1).type, "cancelled");
  assert.equal(messages.some(message => message.type === "session"), false);
  assert.equal(fake.closed(), true);
});
test("sign-in errors do not reveal raw browser or credential details", async () => {
  const fake = fixture({ failure: true }), messages = [];
  await signIn({ browserType: fake.browserType, send: message => messages.push(message) });
  assert.equal(messages.at(-1).type, "error");
  assert.equal(JSON.stringify(messages).includes("private internal details"), false);
});
