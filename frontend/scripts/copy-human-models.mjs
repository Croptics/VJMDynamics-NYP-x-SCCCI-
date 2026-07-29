// Copies the face-recognition model weights we use from the installed
// @vladmandic/human package into public/models/human/, so the app self-hosts
// them (offline-capable, no CDN) without committing ~10MB of binaries to git.
// Runs automatically via the `predev` / `prebuild` npm hooks; idempotent.
import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");
const src = join(frontend, "node_modules", "@vladmandic", "human", "models");
const dest = join(frontend, "public", "models", "human");

// Only the models the face pipeline needs (detector + landmarks + embedding +
// anti-spoof + liveness) — not the body/hand/emotion/iris/centernet weights.
const MODELS = ["blazeface", "facemesh", "faceres", "antispoof", "liveness"];

if (!existsSync(src)) {
  console.warn("[human-models] source not found (is @vladmandic/human installed?):", src);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });

let copied = 0;
for (const m of MODELS) {
  for (const ext of ["json", "bin"]) {
    const from = join(src, `${m}.${ext}`);
    const to = join(dest, `${m}.${ext}`);
    if (!existsSync(from)) { console.warn("[human-models] missing:", from); continue; }
    // Skip if the destination already matches (size check — models never change in place).
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    copied += 1;
  }
}
console.log(`[human-models] ready in public/models/human/ (${copied} file(s) copied)`);
