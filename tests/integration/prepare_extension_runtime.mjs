import { createHash, generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
  throw new Error("Usage: node prepare_extension_runtime.mjs <frontend-dir> <new-temp-output-dir>");
}

const sourceDirectory = resolve(sourceArgument);
const outputDirectory = resolve(outputArgument);
if (existsSync(outputDirectory)) {
  throw new Error("Refusing to overwrite an existing extension runtime directory.");
}

mkdirSync(outputDirectory, { recursive: false });
const extensionDirectory = join(outputDirectory, "extension");
cpSync(sourceDirectory, extensionDirectory, { recursive: true, errorOnExist: true });

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
const manifestPath = join(extensionDirectory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.key = publicKeyDer.toString("base64");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });

const digest = createHash("sha256").update(publicKeyDer).digest();
const extensionId = [...digest.subarray(0, 16)]
  .flatMap((byte) => [byte >> 4, byte & 0x0f])
  .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
  .join("");

const composeOverride = join(outputDirectory, "compose.extension-runtime.yaml");
const fixedPhase2dOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const runtimeOrigin = `chrome-extension://${extensionId}`;
const originList = `${fixedPhase2dOrigin},${runtimeOrigin}`;
const yaml = [
  "services:",
  "  api:",
  "    environment:",
  `      ALLOWED_CORS_ORIGINS: ${JSON.stringify(originList)}`,
  '      API_ACCESS_TOKEN: "${PHASE2E_TEST_API_TOKEN:?Set a disposable runtime-test token}"',
  "",
].join("\n");
writeFileSync(composeOverride, yaml, { flag: "wx" });

process.stdout.write(JSON.stringify({ extensionId, extensionDirectory, composeOverride }));
