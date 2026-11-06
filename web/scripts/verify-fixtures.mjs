import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const pairs = [
  ["design/seo-sensei/fixtures/audit.json", "web/public/fixtures/audit.json"],
  ["design/seo-sensei/fixtures/northstar-solar.html", "web/public/fixtures/northstar-solar.html"],
];

for (const [sourcePath, copyPath] of pairs) {
  const [source, copy] = await Promise.all([
    readFile(resolve(root, sourcePath)),
    readFile(resolve(root, copyPath)),
  ]);
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const copyHash = createHash("sha256").update(copy).digest("hex");
  if (sourceHash !== copyHash) {
    throw new Error(`Fixture copy differs from its approved source: ${copyPath}`);
  }
  process.stdout.write(`${copyPath}: ${copyHash}\n`);
}
