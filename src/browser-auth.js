// One browser session for the document and its API requests. No client-side secret.
const COOKIE_NAME = "__Host-woffu-session";
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export function hasBasicAuthorization(request, env) {
  if (typeof env.ADMIN_PASSWORD !== "string" || !env.ADMIN_PASSWORD) return false;
  const match = /^Basic\s+([^\s,]+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) return false;
  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    return separator !== -1 && decoded.slice(0, separator) === "admin" &&
      decoded.slice(separator + 1) === env.ADMIN_PASSWORD;
  } catch { return false; }
}

export async function isAuthorized(request, env) {
  if (hasBasicAuthorization(request, env)) return true;
  if (typeof env.ADMIN_PASSWORD !== "string" || !env.ADMIN_PASSWORD) return false;
  const cookies = (request.headers.get("Cookie") || "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(COOKIE_NAME + "="));
  if (cookies.length !== 1) return false;
  const token = cookies[0].slice(COOKIE_NAME.length + 1);
  const match = /^(v1\.(\d{10,})\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(match[2]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + SESSION_SECONDS) return false;
  try {
    return await crypto.subtle.verify("HMAC", await signingKey(env), decode(match[3]),
      signedMessage(request, match[1]));
  } catch { return false; }
}

export async function attachBrowserSession(request, env, response) {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" || !["/", "/woffu/punch"].includes(path) ||
      !response.ok || !hasBasicAuthorization(request, env)) return response;
  const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = encode(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${expiry}.${nonce}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), signedMessage(request, payload));
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", `${COOKIE_NAME}=${payload}.${encode(new Uint8Array(signature))}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function unauthorizedResponse(request) {
  const path = new URL(request.url).pathname;
  const documentRequest = request.method === "GET" && ["/", "/woffu/punch"].includes(path);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  // Only the entry page may open the browser's password dialog. Background requests
  // return an explicit error, so an expired session never opens overlapping dialogs.
  if (documentRequest) headers["WWW-Authenticate"] = 'Basic realm="Woffu Clock"';
  return new Response(JSON.stringify({ ok: false, code: "AUTH_REQUIRED", error: "Tu sesión ha caducado. Vuelve a entrar para continuar." }), {
    status: 401, headers,
  });
}

function signingKey(env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function signedMessage(request, payload) {
  // A cookie from another fork/host cannot be reused, even if its password matches.
  return encoder.encode(`woffu-browser-session:${new URL(request.url).origin}:${payload}`);
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "="), (char) => char.charCodeAt(0));
}
