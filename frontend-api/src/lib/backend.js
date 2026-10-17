// Talks to the local FastAPI backend. (Kept separate from your existing lib/api.js)
async function call(path, { method = "GET", body, key } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

export const getHealth       = () => call("/api/health");
export const getStatus       = () => call("/api/status");
export const getUsage        = () => call("/api/usage");
export const getModels       = () => call("/api/models");
export const listKeys        = () => call("/api/keys");
export const createKey       = (payload) => call("/api/keys", { method: "POST", body: payload });
export const deleteKey       = (id) => call(`/api/keys/${id}`, { method: "DELETE" });
export const runPrompt       = (payload) => call("/api/playground", { method: "POST", body: payload });
export const listGenerations = () => call("/api/generations");
export const clearGenerations = () => call("/api/generations", { method: "DELETE" });