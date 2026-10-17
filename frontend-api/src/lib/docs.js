export const ENDPOINTS = [
  {
    id: "generate",
    method: "POST",
    path: "/generate",
    title: "Generate a part",
    desc: "Turn a text description into a 3D CAD file. Returns a download link for STEP or STL and a preview image.",
    params: [
      { name: "prompt", type: "string", req: true, desc: "Natural-language description of the part with dimensions." },
      { name: "material", type: "string", desc: "AL6061, STEEL, STAINLESS, TITANIUM, ABS or PLA. Default AL6061." },
      { name: "format", type: "string", desc: "step or stl. Default step." },
      { name: "units", type: "string", desc: "mm, cm or in. Default mm." },
      { name: "webhook_url", type: "string", desc: "Optional. We POST the finished generation here instead of you polling." },
    ],
    response: `{
  "id": "gen_8f2a91c4",
  "object": "generation",
  "status": "complete",
  "download_url": "https://files.brepline.com/gen_8f2a91c4.step",
  "preview_url": "https://files.brepline.com/gen_8f2a91c4.png",
  "dimensions": { "x": 60, "y": 40, "z": 40, "units": "mm" },
  "credits_used": 1
}`,
  },
  {
    id: "get-generation",
    method: "GET",
    path: "/generations/{id}",
    title: "Retrieve a generation",
    desc: "Fetch a previous generation by ID. Use this to poll when you queued a job.",
    params: [{ name: "id", type: "string", req: true, desc: "Generation ID returned by /generate." }],
    response: `{
  "id": "gen_8f2a91c4",
  "object": "generation",
  "status": "complete",
  "created_at": "2026-10-16T04:21:09Z",
  "download_url": "https://files.brepline.com/gen_8f2a91c4.step"
}`,
  },
  {
    id: "list-generations",
    method: "GET",
    path: "/generations",
    title: "List generations",
    desc: "Returns your generations, newest first. Cursor-paginated.",
    params: [
      { name: "limit", type: "integer", desc: "1 to 100. Default 20." },
      { name: "starting_after", type: "string", desc: "Generation ID to continue from." },
      { name: "status", type: "string", desc: "Filter by queued, running, complete or failed." },
    ],
    response: `{
  "object": "list",
  "data": [ { "id": "gen_8f2a91c4", "status": "complete" } ],
  "has_more": true,
  "next_cursor": "gen_8f2a91c4"
}`,
  },
  {
    id: "usage",
    method: "GET",
    path: "/usage",
    title: "Get usage",
    desc: "Credits consumed this billing period and your current rate limit.",
    params: [],
    response: `{
  "plan": "free",
  "credits_used": 12,
  "credits_limit": 50,
  "rate_limit_per_min": 10,
  "period_ends": "2026-11-01T00:00:00Z"
}`,
  },
];

export const ERRORS = [
  ["400", "invalid_request", "A parameter is missing or malformed."],
  ["401", "unauthorized", "API key is missing, invalid or revoked."],
  ["402", "insufficient_credits", "You have used all credits for this period."],
  ["404", "not_found", "The requested generation does not exist."],
  ["422", "unbuildable_part", "The description could not be turned into valid geometry."],
  ["429", "rate_limited", "Too many requests. Retry after the Retry-After header."],
  ["500", "engine_error", "Something went wrong on our side. Safe to retry."],
];

export const WEBHOOK_EVENTS = [
  ["generation.completed", "A part finished generating."],
  ["generation.failed", "A generation could not be completed."],
  ["credits.low", "Credits dropped below 10% of your plan."],
  ["key.revoked", "An API key was revoked."],
];

export const CHANGELOG = [
  ["Oct 14", "Added STAINLESS and TITANIUM materials."],
  ["Oct 02", "Webhooks are now signed with HMAC SHA-256."],
  ["Sep 21", "New /generations list endpoint with cursor pagination."],
];
