const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const keyCache = new Map();
function hexBytes(value) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2)
    throw new Error("Invalid encrypted data");
  return Uint8Array.from(value.match(/../g), (part) =>
    Number.parseInt(part, 16),
  );
}
function hex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
async function keyFor(key) {
  if (!keyCache.has(key))
    keyCache.set(
      key,
      crypto.subtle.importKey(
        "raw",
        hexBytes(key),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    );
  return keyCache.get(key);
}
function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 16_384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(text);
}
function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
async function transform(bytes, stream) {
  return new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(stream),
    ).arrayBuffer(),
  );
}
export async function documentId(namespace, workspace) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${namespace}:${workspace}`),
      ),
    ),
  );
}
export async function packCloudState(state, key) {
  let plain = JSON.stringify(state);
  if (typeof CompressionStream !== "undefined")
    plain = `gzip1:${base64(await transform(encoder.encode(plain), new CompressionStream("gzip")))}`;
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      await keyFor(key),
      encoder.encode(plain),
    ),
  );
  const output = new Uint8Array(16 + encrypted.length);
  output.set(iv);
  output.set(encrypted.subarray(encrypted.length - 16), 16);
  output.set(encrypted.subarray(0, encrypted.length - 16), 32);
  return `sync1:${hex(output)}`;
}
export async function unpackCloudState(payload, key) {
  if (!payload.startsWith("sync1:"))
    throw new Error("Invalid encrypted snapshot");
  const bytes = hexBytes(payload.slice(6));
  if (bytes.length < 32) throw new Error("Invalid encrypted snapshot");
  const combined = new Uint8Array(bytes.length - 16);
  combined.set(bytes.subarray(32));
  combined.set(bytes.subarray(16, 32), bytes.length - 32);
  let plain = decoder.decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 16), tagLength: 128 },
      await keyFor(key),
      combined,
    ),
  );
  if (plain.startsWith("gzip1:"))
    plain = decoder.decode(
      await transform(
        fromBase64(plain.slice(6)),
        new DecompressionStream("gzip"),
      ),
    );
  return JSON.parse(plain);
}
