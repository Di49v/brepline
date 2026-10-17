import { BASE_URL } from "./config.js";

const DEFAULT = {
  prompt: "L-bracket 60 mm wide, 40 mm base, 40 mm tall, 5 mm thick, two 6 mm holes in the base",
  material: "AL6061",
  format: "step",
  units: "mm",
};

const q = (s) => JSON.stringify(s);

export function buildSnippets(apiKey = "YOUR_API_KEY", body = DEFAULT) {
  const b = { ...DEFAULT, ...body };
  const json = JSON.stringify(b, null, 2);
  const indent = (s, n) => s.split("\n").map((x, i) => (i ? " ".repeat(n) + x : x)).join("\n");

  return {
    cURL: {
      lang: "bash",
      code: `curl -X POST ${BASE_URL}/generate \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`,
    },
    Python: {
      lang: "python",
      code: `import requests

res = requests.post(
    "${BASE_URL}/generate",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "prompt": ${q(b.prompt)},
        "material": ${q(b.material)},
        "format": ${q(b.format)},
        "units": ${q(b.units)},
    },
)

data = res.json()
print(data["download_url"])`,
    },
    JavaScript: {
      lang: "javascript",
      code: `const res = await fetch("${BASE_URL}/generate", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${indent(json, 2)}),
});

const data = await res.json();
console.log(data.download_url);`,
    },
    Node: {
      lang: "javascript",
      code: `import Brepline from "brepline";

const client = new Brepline({ apiKey: "${apiKey}" });

const part = await client.generate({
  prompt: ${q(b.prompt)},
  material: ${q(b.material)},
  format: ${q(b.format)},
  units: ${q(b.units)},
});

console.log(part.download_url);`,
    },
  };
}

export const SAMPLE_RESPONSE = `{
  "id": "gen_8f2a91c4",
  "object": "generation",
  "status": "complete",
  "download_url": "https://files.brepline.com/gen_8f2a91c4.step",
  "preview_url": "https://files.brepline.com/gen_8f2a91c4.png",
  "format": "step",
  "dimensions": { "x": 60, "y": 40, "z": 40, "units": "mm" },
  "material": "AL6061",
  "credits_used": 1,
  "created_at": "2026-10-16T04:21:09Z"
}`;
