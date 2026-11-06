import { fixtureSchema, type LocalFixture } from "./schema";

export type FixtureBundle = { fixture: LocalFixture; html: string };

export async function loadLocalFixture(): Promise<FixtureBundle> {
  let auditResponse: Response;
  let htmlResponse: Response;
  try {
    [auditResponse, htmlResponse] = await Promise.all([
      fetch("/fixtures/audit.json", { cache: "no-store" }),
      fetch("/fixtures/northstar-solar.html", { cache: "no-store" }),
    ]);
  } catch {
    throw new Error("The bundled local example files could not be reached.");
  }
  if (!auditResponse.ok || !htmlResponse.ok) {
    throw new Error("The local Northstar example files are unavailable.");
  }
  let raw: unknown;
  try {
    raw = await auditResponse.json();
  } catch {
    throw new Error("The local audit fixture is not valid JSON.");
  }
  const parsed = fixtureSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The local audit fixture has an unexpected shape or status count.");
  }
  const html = await htmlResponse.text();
  if (!html.includes("<meta name=\"robots\" content=\"noindex, follow\">")) {
    throw new Error("The local HTML example is incomplete or does not match the audit fixture.");
  }
  return { fixture: parsed.data, html };
}
