import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const extensionId = process.env.PHASE2E_EXTENSION_ID ?? "";
const extensionDirectory = process.env.PHASE2E_EXTENSION_DIR ?? "";
const apiOrigin = process.env.PHASE2E_API_ORIGIN ?? "";
const apiToken = process.env.PHASE2E_TEST_API_TOKEN ?? "";
const evidenceDirectory = resolve(process.env.PHASE2E_EVIDENCE_DIR ?? "review/evidence/phase-2e-c");
const apiPath = "/analyse-url";
const expectedPopupUrl = extensionId ? `chrome-extension://${extensionId}/popup.html` : "";

mkdirSync(evidenceDirectory, { recursive: true });

type InstalledExtension = {
  context: BrowserContext;
  options: Page;
  pageErrors: string[];
  profileDirectory: string;
  version: string;
};

type CdpEvent = { sessionId: string; message: string };
type PendingCdp = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };
type PopupRequest = { requestId: string; request: { url: string; method: string; postData?: string } };
type PopupRequestHeaders = { requestId: string; headers: Record<string, string> };
type PopupPausedRequest = { requestId: string; request: { url: string; method: string } };
type PopupMock = { status: number; body: string; requestId: string; retryAfter?: number };

class ActionPopup {
  private nextCommandId = 0;
  private readonly pending = new Map<number, PendingCdp>();
  private readonly requestUrls = new Map<string, string>();
  private readonly requestBodies = new Map<string, string>();
  private readonly authorizedRequestIds = new Set<string>();
  private readonly observedResponses = new Map<string, RuntimeResponse>();
  private readonly responseMocks = new Map<string, PopupMock>();
  private readonly responseWaiters: Array<{
    predicate: (response: RuntimeResponse) => boolean;
    resolve: (response: RuntimeResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  readonly uncaughtExceptions: string[] = [];

  constructor(
    private readonly browserSession: Awaited<ReturnType<NonNullable<ReturnType<BrowserContext["browser"]>>["newBrowserCDPSession"]>>,
    private readonly sessionId: string,
    private readonly targetId: string,
    private readonly onAuthorizedOrigin?: (origin: string) => void,
  ) {
    browserSession.on("Target.receivedMessageFromTarget", (event: CdpEvent) => {
      if (event.sessionId !== this.sessionId) return;
      const message = JSON.parse(event.message) as Record<string, unknown>;
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error("Chromium rejected an extension popup operation."));
          else pending.resolve((message.result as Record<string, unknown>) ?? {});
        }
      } else if (message.method === "Network.responseReceived") {
        const params = message.params as { requestId: string; response: { url: string; status: number; headers: Record<string, string> } };
        this.observedResponses.set(params.requestId, new RuntimeResponse(this, params.requestId, params.response));
      } else if (message.method === "Network.loadingFinished") {
        const params = message.params as { requestId: string };
        const response = this.observedResponses.get(params.requestId);
        if (response) {
          const index = this.responseWaiters.findIndex((waiter) => waiter.predicate(response));
          if (index >= 0) this.responseWaiters.splice(index, 1)[0].resolve(response);
        }
      } else if (message.method === "Network.requestWillBeSent") {
        const params = message.params as PopupRequest;
        this.requestUrls.set(params.requestId, params.request.url);
        if (params.request.postData) this.requestBodies.set(params.requestId, params.request.postData);
        if (this.authorizedRequestIds.has(params.requestId)) this.recordAuthorizedOrigin(params.requestId);
      } else if (message.method === "Network.requestWillBeSentExtraInfo") {
        const params = message.params as PopupRequestHeaders;
        const hasAuthorization = Object.keys(params.headers).some((header) => header.toLowerCase() === "authorization");
        if (hasAuthorization) {
          this.authorizedRequestIds.add(params.requestId);
          this.recordAuthorizedOrigin(params.requestId);
        }
      } else if (message.method === "Fetch.requestPaused") {
        const params = message.params as PopupPausedRequest;
        void this.handlePausedRequest(params);
      } else if (message.method === "Runtime.exceptionThrown") {
        const params = message.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
        this.uncaughtExceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Unspecified popup exception");
      }
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.nextCommandId;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    await this.browserSession.send("Target.sendMessageToTarget", {
      sessionId: this.sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return promise;
  }

  private recordAuthorizedOrigin(requestId: string): void {
    const requestUrl = this.requestUrls.get(requestId);
    if (requestUrl) this.onAuthorizedOrigin?.(new URL(requestUrl).origin);
  }

  async mockResponse(path: string, status: number, body: string, requestId: string, retryAfter?: number): Promise<void> {
    this.responseMocks.set(path, { status, body, requestId, retryAfter });
    await this.send("Fetch.enable", { patterns: [{ urlPattern: `*${path}*`, requestStage: "Request" }] });
  }

  async clearMockResponses(): Promise<void> {
    this.responseMocks.clear();
    await this.send("Fetch.disable");
  }

  private async handlePausedRequest(params: PopupPausedRequest): Promise<void> {
    const url = new URL(params.request.url);
    const mock = this.responseMocks.get(url.pathname);
    if (!mock) {
      await this.send("Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    const isPreflight = params.request.method === "OPTIONS";
    const headers = [
      { name: "Access-Control-Allow-Origin", value: `chrome-extension://${extensionId}` },
      { name: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
      { name: "Access-Control-Allow-Headers", value: "authorization, content-type, x-request-id" },
      { name: "Access-Control-Expose-Headers", value: "retry-after, x-request-id" },
      { name: "Content-Type", value: "application/json" },
      { name: "X-Request-ID", value: mock.requestId },
      ...(mock.retryAfter === undefined ? [] : [{ name: "Retry-After", value: String(mock.retryAfter) }]),
    ];
    await this.send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: isPreflight ? 204 : mock.status,
      responseHeaders: headers,
      body: Buffer.from(isPreflight ? "" : mock.body).toString("base64"),
    });
  }

  async evaluate<T>(fn: (arg: never) => T | Promise<T>, arg?: unknown): Promise<T> {
    const argument = arg === undefined ? "" : JSON.stringify(arg);
    const expression = `(${fn.toString()})(${argument})`;
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const remote = result.result as { value?: T; description?: string } | undefined;
    if (!remote) throw new Error("The extension popup did not return a result.");
    return remote.value as T;
  }

  requestsTo(path: string): number {
    return [...this.requestUrls.values()].filter((url) => new URL(url).pathname === path).length;
  }

  requestBodiesTo(path: string): string[] {
    return [...this.requestUrls.entries()]
      .filter(([, url]) => new URL(url).pathname === path)
      .map(([requestId]) => this.requestBodies.get(requestId) ?? "");
  }

  async text(selector: string, hasText?: string | RegExp, role?: string): Promise<string> {
    return this.evaluate((query) => {
      const elements = Array.from(document.querySelectorAll(query.selector));
      const found = elements.find((element) => {
        const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
        const matchesRole = !query.role || element.getAttribute("role") === query.role || element.tagName.toLowerCase() === query.role;
        const matchesText = query.text == null || (query.text.regex
          ? new RegExp(query.text.source, query.text.flags).test(name)
          : name.includes(query.text.value));
        return matchesRole && matchesText;
      });
      return found?.textContent?.trim() ?? "";
    }, { selector, role, text: hasText instanceof RegExp ? { regex: true, source: hasText.source, flags: hasText.flags } : hasText == null ? null : { regex: false, value: hasText } } as never);
  }

  async visible(selector: string, hasText?: string): Promise<boolean> {
    return this.evaluate((query) => {
      const element = Array.from(document.querySelectorAll(query.selector)).find((item) => !query.text || item.textContent?.includes(query.text));
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && !element.hasAttribute("hidden");
    }, { selector, text: hasText } as never);
  }

  async enabled(selector: string, hasText?: string | RegExp, role?: string): Promise<boolean> {
    return this.evaluate((query) => {
      const elements = Array.from(document.querySelectorAll(query.selector));
      const element = elements.find((item) => {
        const name = item.getAttribute("aria-label") ?? item.textContent ?? "";
        const matchesRole = !query.role || item.getAttribute("role") === query.role || item.tagName.toLowerCase() === query.role;
        const matchesText = query.text == null || (query.text.regex
          ? new RegExp(query.text.source, query.text.flags).test(name)
          : name.includes(query.text.value));
        return matchesRole && matchesText;
      }) as HTMLButtonElement | undefined;
      return Boolean(element && !element.disabled);
    }, { selector, role, text: hasText instanceof RegExp ? { regex: true, source: hasText.source, flags: hasText.flags } : hasText == null ? null : { regex: false, value: hasText } } as never);
  }

  async interact(selector: string, action: "click" | "focus", hasText?: string | RegExp, role?: string): Promise<void> {
    const rect = await this.evaluate((query) => {
      const elements = Array.from(document.querySelectorAll(query.selector));
      const element = elements.find((item) => {
        const name = item.getAttribute("aria-label") ?? item.textContent ?? "";
        const matchesRole = !query.role || item.getAttribute("role") === query.role || item.tagName.toLowerCase() === query.role;
        const matchesText = query.text == null || (query.text.regex
          ? new RegExp(query.text.source, query.text.flags).test(name)
          : name.includes(query.text.value));
        return matchesRole && matchesText;
      }) as HTMLElement | undefined;
      if (!element) throw new Error("The requested control is not present in the extension popup.");
      element.scrollIntoView({ block: "center", inline: "nearest" });
      if (query.action === "focus") {
        element.focus();
        return null;
      }
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }, { selector, role, action, text: hasText instanceof RegExp ? { regex: true, source: hasText.source, flags: hasText.flags } : hasText == null ? null : { regex: false, value: hasText } } as never);
    if (action === "focus" || !rect) return;
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }

  async press(key: "Enter" | "Space" | "Escape" | "Tab" | "Shift+Tab"): Promise<void> {
    const normalized = key === "Space" ? " " : key === "Shift+Tab" ? "Tab" : key;
    const code = normalized === " " ? "Space" : normalized;
    const virtualCode = normalized === "Enter" ? 13 : normalized === "Escape" ? 27 : normalized === "Tab" ? 9 : 32;
    const modifiers = key === "Shift+Tab" ? 8 : 0;
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: normalized, code, windowsVirtualKeyCode: virtualCode, modifiers });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: normalized, code, windowsVirtualKeyCode: virtualCode, modifiers });
  }

  waitForResponse(predicate: (response: RuntimeResponse) => boolean): Promise<RuntimeResponse> {
    return new Promise((resolve, reject) => {
      const timer: { id?: ReturnType<typeof setTimeout> } = {};
      const waiter = {
        predicate,
        resolve: (response: RuntimeResponse) => {
          if (timer.id !== undefined) clearTimeout(timer.id);
          resolve(response);
        },
        reject: (error: Error) => {
          if (timer.id !== undefined) clearTimeout(timer.id);
          reject(error);
        },
      };
      timer.id = setTimeout(() => {
        const index = this.responseWaiters.indexOf(waiter);
        if (index >= 0) this.responseWaiters.splice(index, 1);
        reject(new Error("Timed out waiting for the installed extension's matching API response."));
      }, 20_000);
      this.responseWaiters.push(waiter);
    });
  }

  async screenshot(options: { path: string }): Promise<void> {
    const image = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
    writeFileSync(options.path, Buffer.from(image.data as string, "base64"));
  }

  async close(): Promise<void> {
    const exceptions = [...this.uncaughtExceptions];
    await this.browserSession.send("Target.closeTarget", { targetId: this.targetId });
    await this.browserSession.detach();
    expect(exceptions, "The installed extension popup must not throw uncaught JavaScript exceptions.").toEqual([]);
  }

  locator(selector: string, options?: { hasText?: string | RegExp }): PopupElement {
    return new PopupElement(this, selector, options?.hasText);
  }

  getByRole(role: string, options: { name: string | RegExp }): PopupElement {
    return new PopupElement(this, role, options.name, role);
  }
}

class RuntimeResponse {
  constructor(
    private readonly popup: ActionPopup,
    private readonly requestId: string,
    private readonly details: { url: string; status: number; headers: Record<string, string> },
  ) {}

  url(): string { return this.details.url; }
  status(): number { return this.details.status; }
  headers(): Record<string, string> { return this.details.headers; }
  header(name: string): string | undefined {
    const found = Object.entries(this.details.headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }

  async json(): Promise<unknown> {
    const body = await this.popup.send("Network.getResponseBody", { requestId: this.requestId });
    const data = body.body as string;
    return JSON.parse(body.base64Encoded ? Buffer.from(data, "base64").toString("utf8") : data);
  }
}

class PopupElement {
  constructor(private readonly popup: ActionPopup, private readonly selector: string, private readonly textFilter?: string | RegExp, private readonly role?: string) {}
  async click(): Promise<void> { await this.popup.interact(this.selector, "click", this.textFilter, this.role); }
  async focus(): Promise<void> { await this.popup.interact(this.selector, "focus", this.textFilter, this.role); }
  async waitFor(options: { state: "visible" }): Promise<void> {
    await expect.poll(() => this.popup.visible(this.selector, typeof this.textFilter === "string" ? this.textFilter : undefined)).toBe(options.state === "visible");
  }
  async isEnabled(): Promise<boolean> { return this.popup.enabled(this.selector, this.textFilter, this.role); }
}

async function installInIsolatedProfile(): Promise<InstalledExtension> {
  expect(extensionId, "The isolated test copy must provide its generated extension ID.").toMatch(/^[a-p]{32}$/);
  expect(extensionDirectory, "The isolated unpacked extension directory must be set.").not.toBe("");

  const profileDirectory = mkdtempSync(join(tmpdir(), "seo-sensei-phase2e-profile-"));
  const defaultProfile = join(profileDirectory, "Default");
  mkdirSync(defaultProfile, { recursive: true });
  writeFileSync(join(defaultProfile, "Preferences"), JSON.stringify({ extensions: { pinned_extensions: [extensionId] } }));
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const options = await context.newPage();
  const pageErrors: string[] = [];
  options.on("pageerror", (error) => pageErrors.push(error.name));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator("#connectionState")).toHaveText("Not configured");
  const runtimeId = await options.evaluate(() => chrome.runtime.id);
  expect(runtimeId).toBe(extensionId);

  return {
    context,
    options,
    pageErrors,
    profileDirectory,
    version: context.browser()?.version() ?? "unavailable",
  };
}

async function closeIsolatedProfile(installed: InstalledExtension): Promise<void> {
  await installed.context.close();
  const tempDirectory = resolve(tmpdir()).replace(/[\\/]+$/, "") + sep;
  const profile = resolve(installed.profileDirectory);
  if (!profile.startsWith(tempDirectory) || !basename(profile).startsWith("seo-sensei-phase2e-profile-")) {
    throw new Error("Refusing to remove a browser profile outside this test's unique temporary directory.");
  }
  rmSync(profile, { recursive: true, force: true });
  expect(installed.pageErrors, "The installed extension options page must not throw uncaught JavaScript exceptions.").toEqual([]);
}

async function saveConfiguration(page: Page, origin: string, token: string): Promise<void> {
  await page.getByLabel("API base URL").fill(origin);
  await page.getByLabel("API access token").fill(token);
  await page.getByRole("button", { name: "Save configuration" }).click();
}

async function reopenOptionsPage(installed: InstalledExtension): Promise<Page> {
  const options = await installed.context.newPage();
  options.on("pageerror", (error) => installed.pageErrors.push(error.name));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator("#connectionState")).toHaveText("Configured locally");
  return options;
}

async function waitForContextResponse(context: BrowserContext, pathname: string): Promise<import("@playwright/test").Response | null> {
  try {
    return await context.waitForEvent("response", {
      predicate: (response) => new URL(response.url()).pathname === pathname,
      timeout: 10_000,
    });
  } catch {
    return null;
  }
}

async function expectPopupText(popup: ActionPopup, selector: string, expected: string | RegExp, contains = false): Promise<void> {
  const assertion = expect.poll(() => popup.text(selector));
  if (expected instanceof RegExp) await assertion.toMatch(expected);
  else if (contains) await assertion.toContain(expected);
  else await assertion.toBe(expected);
}

async function expectPopupHidden(popup: ActionPopup, selector: string): Promise<void> {
  await expect.poll(() => popup.visible(selector)).toBe(false);
}

async function expectPopupEnabled(popup: ActionPopup, element: PopupElement): Promise<void> {
  await expect.poll(() => element.isEnabled()).toBe(true);
}

async function openActionPopup(
  context: BrowserContext,
  options: Page,
  activeTab: Page,
  onAuthorizedOrigin?: (origin: string) => void,
): Promise<ActionPopup> {
  await activeTab.bringToFront();
  const browser = context.browser();
  if (!browser) throw new Error("The installed extension context has no Chromium browser connection.");
  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send("Target.setDiscoverTargets", { discover: true });
  const activeTitle = await activeTab.title();
  const { windowId, x: windowX, y: windowY, width } = findBrowserWindow(activeTitle);
  const actionSettings = await options.evaluate(() => chrome.action.getUserSettings());
  const toolbarScreenshot = join(evidenceDirectory, "extension-toolbar-before-popup.png");
  execFileSync("scrot", ["--overwrite", toolbarScreenshot]);
  expect(actionSettings.isOnToolbar, "The disposable Chromium profile must pin the real extension action before toolbar testing.").toBe(true);
  console.info(`Installed extension action is pinned; toolbar window width=${width}; screenshot=${toolbarScreenshot}`);
  let targetId = "";
  let observedTargets: Array<{ type: string; url: string }> = [];
  for (const offset of [118, 120, 122, 124, 126, 128, 130, 132, 134]) {
    clickToolbarAt(windowId, width - offset, 64);
    const deadline = Date.now() + 700;
    while (Date.now() < deadline) {
      const { targetInfos } = await browserSession.send("Target.getTargets");
      observedTargets = targetInfos.map((item: { url: string; type: string }) => ({ type: item.type, url: item.url }));
      const target = targetInfos.find((item: { url: string; targetId: string }) => item.url.startsWith(expectedPopupUrl));
      if (target) {
        targetId = target.targetId;
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (targetId) break;
    execFileSync("xdotool", ["key", "Escape"]);
  }
  expect(
    targetId,
    `The toolbar click did not open the extension popup. Window=${windowX},${windowY} ${width}px wide; action pinned=${actionSettings.isOnToolbar}; screenshot=${toolbarScreenshot}; observed targets=${JSON.stringify(observedTargets)}`,
  ).not.toBe("");
  const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId, flatten: false });
  const popup = new ActionPopup(browserSession, sessionId, targetId, onAuthorizedOrigin);
  await popup.send("Runtime.enable");
  await popup.send("Page.enable");
  await popup.send("Network.enable", { maxPostDataSize: 4096 });
  const activeUrl = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url);
  expect(activeUrl).toBe(activeTab.url());
  console.info(`Opened real extension action popup for active tab ${new URL(activeTab.url()).origin}; popup target was ${expectedPopupUrl}`);
  return popup;
}

async function fulfillJson(route: Route, status: number, payload: unknown, requestId: string, retryAfter?: number) {
  const headers: Record<string, string> = {
    "access-control-allow-origin": `chrome-extension://${extensionId}`,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-request-id",
    "access-control-allow-credentials": "true",
    "content-type": "application/json",
    "x-request-id": requestId,
  };
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  await route.fulfill({ status, headers, body: JSON.stringify(payload) });
}

function focusBrowserWindow(titleFragment: string): void {
  if (process.platform !== "linux") {
    throw new Error("The isolated runtime test needs a headed Linux Chromium window to interact with the real permission prompt.");
  }
  const windowIds = execFileSync("xdotool", ["search", "--onlyvisible", "--name", titleFragment], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches = windowIds.filter((windowId) =>
    execFileSync("xdotool", ["getwindowname", windowId], { encoding: "utf8" }).includes(titleFragment),
  );
  expect(matches).toHaveLength(1);
  execFileSync("xdotool", ["windowfocus", "--sync", matches[0]]);
}

function clickPermissionPromptAllow(): void {
  const { windowId, x: windowX, y: windowY } = findBrowserWindow("SEO-Sensei API settings");
  execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
  const allowX = Math.round(1440 * 0.627) - windowX;
  const allowY = 265 - windowY;
  execFileSync("xdotool", ["mousemove", "--window", windowId, String(allowX), String(allowY), "click", "1"]);
}

function dismissPermissionPromptWithKeyboard(): void {
  focusBrowserWindow("SEO-Sensei API settings");
  execFileSync("xdotool", ["key", "--clearmodifiers", "Escape"]);
}

function pressNativeBrowserKey(tabTitle: string, key: "Return" | "space"): void {
  const { windowId } = findBrowserWindow(tabTitle);
  execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
  execFileSync("xdotool", ["key", "--clearmodifiers", key]);
}

async function capturePage(page: Page, path: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 15_000 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    }
  }
  throw new Error(`Could not capture the isolated extension page screenshot at ${basename(path)}.`, { cause: lastError });
}

function findBrowserWindow(tabTitle: string): { windowId: string; x: number; y: number; width: number } {
  if (process.platform !== "linux") throw new Error("A real toolbar click is available only in the isolated Linux/Xvfb browser job.");
  const windowIds = execFileSync("xdotool", ["search", "--onlyvisible", "--name", tabTitle], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches = windowIds.filter((windowId) =>
    execFileSync("xdotool", ["getwindowname", windowId], { encoding: "utf8" }).includes(tabTitle),
  );
  expect(matches).toHaveLength(1);
  const windowId = matches[0];
  const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], { encoding: "utf8" });
  const x = Number(geometry.match(/^X=(-?\d+)$/m)?.[1]);
  const y = Number(geometry.match(/^Y=(-?\d+)$/m)?.[1]);
  const width = Number(geometry.match(/^WIDTH=(\d+)$/m)?.[1]);
  expect(Number.isFinite(x)).toBe(true);
  expect(Number.isFinite(y)).toBe(true);
  expect(width).toBeGreaterThan(500);
  return { windowId, x, y, width };
}

function clickToolbarAt(windowId: string, x: number, y: number): void {
  execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
  execFileSync("xdotool", ["mousemove", "--window", windowId, String(x), String(y), "click", "1"]);
}

test("loads the unpacked extension and handles local settings safely", async () => {
  test.skip((!extensionId || !extensionDirectory) && !process.env.CI, "Prepare the disposable extension copy before running this browser test.");
  const installed = await installInIsolatedProfile();
  const { context, options } = installed;
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));

  try {
    await expect(options.locator("#savedOrigin")).toHaveText("No API origin saved.");
    await capturePage(options, join(evidenceDirectory, "extension-options-empty.png"));

    const invalidOrigin = "https://user:password@seo-sensei-api.localhost:8443";
    await saveConfiguration(options, invalidOrigin, `unpersisted-${randomUUID()}`);
    await expect(options.locator("#message")).toContainText("credential-free HTTP or HTTPS origin");

    for (const invalidUrl of [
      { value: "not a URL", message: "Enter a valid API URL." },
      { value: "ftp://seo-sensei-api.localhost:8443", message: "The API URL must be a credential-free HTTP or HTTPS origin." },
      { value: "https://seo-sensei-api.localhost:8443?token=sample", message: "The API URL must be a credential-free HTTP or HTTPS origin." },
      { value: "https://seo-sensei-api.localhost:8443#sample", message: "The API URL must be a credential-free HTTP or HTTPS origin." },
    ]) {
      await options.getByLabel("API base URL").fill(invalidUrl.value);
      await options.getByRole("button", { name: "Save configuration" }).click();
      await expect(options.locator("#message")).toHaveText(invalidUrl.message);
    }

    await options.getByLabel("API base URL").fill("https://seo-sensei-api.localhost:8443");
    await options.getByLabel("API access token").fill("");
    await options.getByRole("button", { name: "Save configuration" }).click();
    await expect(options.locator("#message")).toContainText("Enter an API access token.");

    const disposableToken = `offline-${randomUUID()}`;
    await saveConfiguration(options, "https://seo-sensei-api.localhost:8443", disposableToken);
    await expect(options.locator("#apiToken")).toHaveValue("");
    const savedState = await options.evaluate(async () => {
      const stored = await chrome.storage.local.get("seoSenseiApiConfig");
      return {
        baseUrl: stored.seoSenseiApiConfig?.baseUrl ?? "",
        hasToken: Boolean(stored.seoSenseiApiConfig?.token),
      };
    });
    expect(savedState).toEqual({ baseUrl: "https://seo-sensei-api.localhost:8443", hasToken: true });
    await options.reload();
    await expect(options.getByLabel("API base URL")).toHaveValue("https://seo-sensei-api.localhost:8443");
    await expect(options.getByLabel("API access token")).toHaveValue("");
    const tokenDisplayedAfterReload = await options.locator("body").evaluate((body, tokenValue) => body.textContent?.includes(tokenValue) ?? false, disposableToken);
    expect(tokenDisplayedAfterReload).toBe(false);
    await capturePage(options, join(evidenceDirectory, "extension-options-configured.png"));

    await options.getByRole("button", { name: "Clear" }).click();
    await expect(options.locator("#connectionState")).toHaveText("Not configured");
    const clearedState = await options.evaluate(async () => {
      const stored = await chrome.storage.local.get("seoSenseiApiConfig");
      return Boolean(stored.seoSenseiApiConfig);
    });
    expect(clearedState).toBe(false);
    await expect(options.locator("#apiToken")).toHaveValue("");
    await capturePage(options, join(evidenceDirectory, "extension-options-cleared.png"));
    const resultsAfterClear = await options.evaluate(async (url) => {
      const api = (globalThis as typeof globalThis & { SeoSenseiApi: { health: () => Promise<unknown>; boost: (target: string) => Promise<unknown> } }).SeoSenseiApi;
      const results = await Promise.allSettled([api.health(), api.boost(url)]);
      return results.map((result) => result.status === "rejected" ? (result.reason as { code?: string }).code : "unexpected_success");
    }, "https://offline.test/page");
    expect(resultsAfterClear).toEqual(["configuration_error", "configuration_error"]);
    expect(requests.some((url) => new URL(url).origin === "https://seo-sensei-api.localhost:8443")).toBe(false);
    writeFileSync(join(evidenceDirectory, "extension-runtime-offline-metadata.json"), `${JSON.stringify({
      engine: "Playwright Chromium",
      playwrightVersion: "1.65.0",
      browserVersion: installed.version,
      extensionId,
      installation: "unpacked frontend copy loaded by Chromium extension flags in a fresh persistent profile",
      verifiedScope: "options page, Chrome storage, validation, save/reload/clear; no API stack",
    }, null, 2)}\n`);
  } finally {
    await closeIsolatedProfile(installed);
  }
});

test("uses real optional origin permission and exercises authenticated API-backed extension flows", async () => {
  test.skip(
    (process.platform !== "linux" || !apiOrigin || !apiToken || !process.env.PHASE2E_API_ORIGIN) && !process.env.CI,
    "The authenticated extension runtime requires Linux/Xvfb toolbar input and the isolated HTTPS Caddy/FastAPI stack.",
  );

  const installed = await installInIsolatedProfile();
  const { context } = installed;
  let options = installed.options;
  const extensionOrigin = `chrome-extension://${extensionId}`;
  const apiUrl = new URL(apiOrigin);
  const permittedPattern = `${apiUrl.origin}/*`;
  const authorizationOrigins: string[] = [];
  const browserLifecycle: string[] = [];
  options.on("close", () => browserLifecycle.push("options-page-closed"));
  context.on("close", () => browserLifecycle.push("browser-context-closed"));
  context.on("request", (request) => {
    if (request.headers().authorization) authorizationOrigins.push(new URL(request.url()).origin);
  });

  try {
    await saveConfiguration(options, apiOrigin, apiToken);
    await expect(options.getByLabel("API access token")).toHaveValue("");

    const beforePermission = await options.evaluate(async (pattern) =>
      chrome.permissions.contains({ origins: [pattern] }), permittedPattern);
    expect(beforePermission).toBe(false);
    expect(
      options.isClosed(),
      `The extension options page closed before the health action. Lifecycle=${browserLifecycle.join(",") || "none"}; remainingPages=${context.pages().map((page) => page.url()).join(",") || "none"}`,
    ).toBe(false);
    const firstHealthResponsePromise = waitForContextResponse(context, "/health");
    await options.getByRole("button", { name: "Test /health" }).click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
    const permissionPromptScreenshot = join(evidenceDirectory, "extension-origin-permission-prompt.png");
    execFileSync("scrot", ["--overwrite", permissionPromptScreenshot]);
    console.info(`Captured isolated Chromium permission state; focused window=${execFileSync("xdotool", ["getwindowfocus", "getwindowname"], { encoding: "utf8" }).trim()}; screenshot=${permissionPromptScreenshot}`);
    clickPermissionPromptAllow();

    const firstHealthResponse = await firstHealthResponsePromise;
    const optionsPageClosedDuringPermission = options.isClosed();
    if (optionsPageClosedDuringPermission) {
      console.info("Chromium closed the options page during permission confirmation; reopened it and retried /health.");
      options = await reopenOptionsPage(installed);
    }
    await expect.poll(async () => options.evaluate(async (pattern) =>
      chrome.permissions.contains({ origins: [pattern] }), permittedPattern)).toBe(true);
    let healthResponse = firstHealthResponse;
    if (!healthResponse || optionsPageClosedDuringPermission) {
      const retryHealthResponsePromise = waitForContextResponse(context, "/health");
      await options.getByRole("button", { name: "Test /health" }).click();
      healthResponse = await retryHealthResponsePromise;
    }
    if (!healthResponse) {
      const message = (await options.locator("#message").textContent())?.trim() || "no connection message";
      throw new Error(`The permitted extension origin did not complete /health: ${message}`);
    }
    expect(healthResponse.status()).toBe(200);
    await expect(options.locator("#message")).toContainText("API reachable");

    const grantedOrigins = await options.evaluate(async () => (await chrome.permissions.getAll()).origins ?? []);
    expect(grantedOrigins).toContain(permittedPattern);
    expect(grantedOrigins).toHaveLength(1);
    await capturePage(options, join(evidenceDirectory, "extension-api-connected.png"));

    const bearerlessLegacyResult = await options.evaluate(async (url) => {
      try {
        const response = await fetch(`${url}/analyse-url`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://phase2d.test/pages/noindex" }),
        });
        return { status: response.status, payload: await response.json() };
      } catch {
        return { status: null, payload: null };
      }
    }, apiOrigin);
    expect(bearerlessLegacyResult.status).toBe(401);
    expect((bearerlessLegacyResult.payload as { error?: { code?: string } }).error?.code).toBe("auth_required");

    await context.route(`${apiUrl.origin}/health`, (route) => route.abort("failed"));
    await options.getByRole("button", { name: "Test /health" }).click();
    await expect(options.locator("#message")).toHaveText("The API could not be reached.");
    await options.screenshot({ path: join(evidenceDirectory, "extension-api-unreachable.png"), fullPage: true });
    await context.unroute(`${apiUrl.origin}/health`);

    let finishTimedHealthRoute: (() => void) | undefined;
    const timedHealthRouteFinished = new Promise<void>((resolve) => { finishTimedHealthRoute = resolve; });
    await context.route(`${apiUrl.origin}/health`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10500));
      try { await route.abort("timedout"); } catch { /* Chromium's client abort already closed this intercepted request. */ }
      finishTimedHealthRoute?.();
    });
    const timeoutResult = await options.evaluate(async () => {
      try {
        await (globalThis as typeof globalThis & { SeoSenseiApi: { health: () => Promise<unknown> } }).SeoSenseiApi.health();
        return { code: "unexpected_success" };
      } catch (error) {
        const failure = error as { code?: string; status?: number };
        return { code: failure.code, status: failure.status };
      }
    });
    expect(timeoutResult.code).toBe("timeout");
    expect(timeoutResult.status).toBeUndefined();
    await timedHealthRouteFinished;
    await context.unroute(`${apiUrl.origin}/health`);

    const loginCookieProbe = await options.evaluate(async ({ url }) => {
      try {
        const response = await fetch(`${url}/api/browser/v1/session`);
        return { status: response.status, corsAccessible: true };
      } catch {
        return { status: null, corsAccessible: false };
      }
    }, { url: apiOrigin });
    expect(loginCookieProbe).toEqual({ status: 404, corsAccessible: true });

    const activeTab = await context.newPage();
    await context.route("https://phase2d.test/pages/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Controlled active tab</title><main><h1>Fixture page</h1></main>",
      }),
    );
    await activeTab.goto("https://phase2d.test/pages/noindex");
    const popup = await openActionPopup(context, options, activeTab, (origin) => authorizationOrigins.push(origin));
    await expectPopupText(popup, "#pageHost", "phase2d.test");
    await expectPopupText(popup, "#pageTitle", "Controlled active tab");
    expect(await popup.evaluate(() => document.getElementById("statusText")?.getAttribute("role"))).toBe("status");
    expect(popup.requestsTo(apiPath)).toBe(0);
    const analyzeButton = popup.getByRole("button", { name: /Analyze current page/ });
    let focusedId = await popup.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? "");
    for (let tabCount = 0; tabCount < 5 && focusedId !== "analyzeBtn"; tabCount += 1) {
      await popup.press("Tab");
      focusedId = await popup.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? "");
    }
    expect(focusedId).toBe("analyzeBtn");
    const focusState = await popup.evaluate(() => {
      const element = document.activeElement;
      const style = element ? getComputedStyle(element) : null;
      return { tag: element?.tagName ?? "", outlineStyle: style?.outlineStyle ?? "none", outlineWidth: style?.outlineWidth ?? "0px" };
    });
    expect(focusState.tag).toBe("BUTTON");
    expect(focusState.outlineStyle).not.toBe("none");
    expect(focusState.outlineWidth).not.toBe("0px");
    await popup.screenshot({ path: join(evidenceDirectory, "extension-popup-ready.png") });

    const responsePromise = popup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    console.info("Activating analysis with Enter in the installed popup.");
    pressNativeBrowserKey("Controlled active tab", "Return");
    console.info("Native Return key sent to the focused Chromium window; waiting for the authenticated analysis response.");
    let analysisResponse: RuntimeResponse;
    try {
      analysisResponse = await responsePromise;
    } catch (error) {
      const state = await popup.evaluate(() => ({
        focusedId: (document.activeElement as HTMLElement | null)?.id ?? "",
        hasFocus: document.hasFocus(),
        status: document.getElementById("statusText")?.textContent?.trim() ?? "",
        errorTitle: document.getElementById("errorTitle")?.textContent?.trim() ?? "",
        errorMessage: document.getElementById("errorMessage")?.textContent?.trim() ?? "",
        buttonDisabled: (document.getElementById("analyzeBtn") as HTMLButtonElement | null)?.disabled ?? null,
      }));
      throw new Error(`${error instanceof Error ? error.message : "Analysis response wait failed."} Popup state: ${JSON.stringify(state)}; matching API requests: ${popup.requestsTo(apiPath)}.`, { cause: error });
    }
    expect(analysisResponse.status()).toBe(200);
    expect(JSON.parse(popup.requestBodiesTo(apiPath)[0])).toEqual({
      url: "https://phase2d.test/pages/noindex",
      include_ai_recommendations: true,
    });
    const result = await analysisResponse.json() as {
      final_url: string;
      deterministic_score: { overall_score: number };
      checks: Array<{ id: string; status: string; evidence?: { observed?: string }; recommendation?: string }>;
      metadata: { title?: string };
      ai_recommendations?: { state?: string; message?: string };
      fetch: { status_code: number; content_type: string; bytes_read: number };
    };
    expect(result.final_url).toBe("https://phase2d.test/pages/noindex");
    expect(result.deterministic_score.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.deterministic_score.overall_score).toBeLessThanOrEqual(100);
    expect(result.metadata.title).toBe("Home Solar Project Planning Guide for Owners");
    const robotsCheck = result.checks.find((check) => check.id === "robots_directives");
    expect(robotsCheck?.status).toBe("fail");
    expect(robotsCheck?.evidence?.observed).toContain("noindex");
    expect(robotsCheck?.recommendation).toBeTruthy();
    expect(result.ai_recommendations?.state).not.toBe("available");
    await expectPopupText(popup, "#scoreValue", `${result.deterministic_score.overall_score}/100`);
    await expectPopupText(popup, "#pageTitle", result.metadata.title!);
    await expectPopupText(popup, "#checksList", "Robots directives are reported", true);
    await expectPopupText(popup, "#checksList", "noindex", true);
    await expectPopupText(popup, "#aiState", /not configured|unavailable|disabled/i);
    await expectPopupText(popup, "#statusText", "Analysis complete.");
    await analyzeButton.waitFor({ state: "visible" });
    await expectPopupEnabled(popup, analyzeButton);
    await popup.screenshot({ path: join(evidenceDirectory, "extension-analysis-results.png"), fullPage: true });
    await popup.locator("summary", { hasText: "Transport" }).click();
    await expectPopupText(popup, "#transportSignals", "200", true);
    await popup.screenshot({ path: join(evidenceDirectory, "extension-analysis-transport.png"), fullPage: true });

    const rateLimitedRequestId = "extension-controlled-rate-limit";
    const rateLimitPayload = {
      error: { code: "rate_limited", message: "Try again after the current limit window.", request_id: rateLimitedRequestId },
    };
    await popup.mockResponse(apiPath, 429, JSON.stringify(rateLimitPayload), rateLimitedRequestId, 37);
    const rateLimitedResponsePromise = popup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    await analyzeButton.focus();
    pressNativeBrowserKey("Controlled active tab", "space");
    const rateLimitedResponse = await rateLimitedResponsePromise;
    expect(rateLimitedResponse.status()).toBe(429);
    expect(rateLimitedResponse.header("retry-after")).toBe("37");
    await expectPopupText(popup, "#errorMessage", "Try again after the current limit window.");
    await expectPopupText(popup, "#errorRequestId", rateLimitedRequestId, true);
    await expectPopupHidden(popup, "#results");
    await expectPopupEnabled(popup, analyzeButton);
    await popup.screenshot({ path: join(evidenceDirectory, "extension-rate-limited.png"), fullPage: true });
    await popup.clearMockResponses();

    await popup.close();
    await options.evaluate(async () => {
      const config = (await chrome.storage.local.get("seoSenseiApiConfig")).seoSenseiApiConfig;
      await chrome.storage.local.set({ seoSenseiApiConfig: { baseUrl: config.baseUrl } });
    });
    const missingTokenPopup = await openActionPopup(context, options, activeTab, (origin) => authorizationOrigins.push(origin));
    const missingTokenButton = missingTokenPopup.getByRole("button", { name: /Analyze current page/ });
    const analysisRequestsBeforeMissingToken = missingTokenPopup.requestsTo(apiPath);
    await missingTokenButton.focus();
    await missingTokenPopup.press("Enter");
    await expectPopupText(missingTokenPopup, "#errorTitle", "API configuration needed");
    await expectPopupText(missingTokenPopup, "#errorMessage", "Configure the API access token in extension settings.");
    expect(missingTokenPopup.requestsTo(apiPath)).toBe(analysisRequestsBeforeMissingToken);
    await expectPopupHidden(missingTokenPopup, "#results");
    await missingTokenPopup.close();

    await options.getByLabel("API access token").fill("incorrect-disposable-test-token");
    await options.getByRole("button", { name: "Save configuration" }).click();
    await expect(options.locator("#apiToken")).toHaveValue("");
    await activeTab.bringToFront();
    const wrongTokenPopup = await openActionPopup(context, options, activeTab, (origin) => authorizationOrigins.push(origin));
    const wrongTokenButton = wrongTokenPopup.getByRole("button", { name: /Analyze current page/ });
    const wrongTokenResponsePromise = wrongTokenPopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    await wrongTokenButton.click();
    const wrongTokenResponse = await wrongTokenResponsePromise;
    expect(wrongTokenResponse.status()).toBe(401);
    await expectPopupText(wrongTokenPopup, "#errorTitle", "API configuration needed");
    await expectPopupText(wrongTokenPopup, "#errorMessage", /username or password|invalid/i);
    await expectPopupText(wrongTokenPopup, "#errorRequestId", "Request ID:", true);
    await expectPopupHidden(wrongTokenPopup, "#results");
    await expectPopupEnabled(wrongTokenPopup, wrongTokenButton);
    await wrongTokenPopup.screenshot({ path: join(evidenceDirectory, "extension-invalid-token.png"), fullPage: true });

    await wrongTokenPopup.close();
    await saveConfiguration(options, apiOrigin, apiToken);
    const blockedTab = await context.newPage();
    await blockedTab.route("https://blocked.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Blocked test tab</title>" }),
    );
    await blockedTab.goto("https://blocked.test/private");
    const blockedPopup = await openActionPopup(context, options, blockedTab, (origin) => authorizationOrigins.push(origin));
    const blockedResponsePromise = blockedPopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    await blockedPopup.getByRole("button", { name: /Analyze current page/ }).click();
    const blockedResponse = await blockedResponsePromise;
    expect(blockedResponse.status()).toBe(422);
    const blockedBody = await blockedResponse.json() as { error: { code: string; message: string; request_id: string } };
    expect(blockedBody.error.code).toBe("destination_blocked");
    expect(blockedBody.error.message).toBe("The requested destination is not permitted.");
    await expectPopupText(blockedPopup, "#errorMessage", blockedBody.error.message);
    await expectPopupText(blockedPopup, "#errorRequestId", blockedBody.error.request_id, true);
    expect(await blockedPopup.evaluate(() => document.getElementById("errorPanel")?.getAttribute("aria-live"))).toBe("polite");
    await expectPopupHidden(blockedPopup, "#results");
    await blockedPopup.getByRole("button", { name: /Analyze current page/ }).waitFor({ state: "visible" });
    await expectPopupEnabled(blockedPopup, blockedPopup.getByRole("button", { name: /Analyze current page/ }));
    await blockedPopup.screenshot({ path: join(evidenceDirectory, "extension-blocked-destination.png"), fullPage: true });

    await blockedPopup.close();
    const unavailableTab = await context.newPage();
    await unavailableTab.route("https://phase2d.test/pages/unavailable", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Unavailable test tab</title>" }),
    );
    await unavailableTab.goto("https://phase2d.test/pages/unavailable");
    const unavailablePopup = await openActionPopup(context, options, unavailableTab, (origin) => authorizationOrigins.push(origin));
    const unavailableResponsePromise = unavailablePopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    await unavailablePopup.getByRole("button", { name: /Analyze current page/ }).click();
    const unavailableResponse = await unavailableResponsePromise;
    expect(unavailableResponse.status()).toBe(502);
    const unavailableBody = await unavailableResponse.json() as { error: { code: string; message: string } };
    expect(unavailableBody.error.code).toBe("resource_unavailable");
    expect(unavailableBody.error.message).toBe("The requested page could not be analyzed.");
    await expectPopupText(unavailablePopup, "#errorMessage", unavailableBody.error.message);
    await unavailablePopup.screenshot({ path: join(evidenceDirectory, "extension-remote-unavailable.png"), fullPage: true });
    await unavailablePopup.close();

    const boostSuccessId = "extension-boost-success";
    await context.route(`${apiUrl.origin}/boost-seo`, async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": extensionOrigin,
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, x-request-id",
            "access-control-allow-credentials": "true",
          },
        });
        return;
      }
      await fulfillJson(route, 200, { suggested_description: "A controlled extension-client result." }, boostSuccessId);
    });
    const boostSuccess = await options.evaluate(async (url) => {
      try {
        return await (globalThis as typeof globalThis & { SeoSenseiApi: { boost: (target: string) => Promise<{ payload: { suggested_description: string } }> } }).SeoSenseiApi.boost(url);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "request failed" };
      }
    }, "https://phase2d.test/pages/noindex");
    expect((boostSuccess as { payload?: { suggested_description: string } }).payload?.suggested_description)
      .toBe("A controlled extension-client result.");
    await context.unroute(`${apiUrl.origin}/boost-seo`);

    const missingGemini = await options.evaluate(async (url) => {
      try {
        await (globalThis as typeof globalThis & { SeoSenseiApi: { boost: (target: string) => Promise<unknown> } }).SeoSenseiApi.boost(url);
        return { code: "unexpected_success", status: 200 };
      } catch (error) {
        const failure = error as { code?: string; status?: number };
        return { code: failure.code, status: failure.status };
      }
    }, "https://phase2d.test/pages/noindex");
    expect(missingGemini).toEqual({ code: "upstream_ai_unavailable", status: 503 });

    const boostLimitResults: Array<{ code?: string; status?: number; retryAfter?: number | null }> = [missingGemini];
    for (let attempt = 1; attempt < 5; attempt += 1) {
      boostLimitResults.push(await options.evaluate(async (url) => {
        try {
          await (globalThis as typeof globalThis & { SeoSenseiApi: { boost: (target: string) => Promise<unknown> } }).SeoSenseiApi.boost(url);
          return { status: 200 };
        } catch (error) {
          const failure = error as { code?: string; status?: number; retryAfter?: number | null };
          return { code: failure.code, status: failure.status, retryAfter: failure.retryAfter };
        }
      }, "https://phase2d.test/pages/noindex"));
    }
    expect(boostLimitResults.every((item) => item.status === 503)).toBe(true);
    const boostRateLimit = await options.evaluate(async (url) => {
      try {
        await (globalThis as typeof globalThis & { SeoSenseiApi: { boost: (target: string) => Promise<unknown> } }).SeoSenseiApi.boost(url);
        return { code: "unexpected_success", status: 200, retryAfter: null };
      } catch (error) {
        const failure = error as { code?: string; status?: number; retryAfter?: number | null };
        return { code: failure.code, status: failure.status, retryAfter: failure.retryAfter };
      }
    }, "https://phase2d.test/pages/noindex");
    expect(boostRateLimit.code).toBe("rate_limited");
    expect(boostRateLimit.status).toBe(429);
    expect(boostRateLimit.retryAfter).toBeGreaterThan(0);

    const malformedPopup = await openActionPopup(context, options, unavailableTab, (origin) => authorizationOrigins.push(origin));
    await malformedPopup.mockResponse(apiPath, 200, "not-json", "extension-malformed-json");
    const malformedResponsePromise = malformedPopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    const malformedButton = malformedPopup.getByRole("button", { name: /Analyze current page/ });
    await malformedButton.click();
    expect((await malformedResponsePromise).status()).toBe(200);
    await expectPopupText(malformedPopup, "#errorMessage", "The API returned an invalid JSON response.");
    await expectPopupHidden(malformedPopup, "#results");
    await expectPopupEnabled(malformedPopup, malformedButton);
    await malformedPopup.close();

    const malformedShapePopup = await openActionPopup(context, options, unavailableTab, (origin) => authorizationOrigins.push(origin));
    await malformedShapePopup.mockResponse(apiPath, 200, JSON.stringify({ final_url: "https://phase2d.test/" }), "extension-malformed-shape");
    const malformedShapeResponsePromise = malformedShapePopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    const malformedShapeButton = malformedShapePopup.getByRole("button", { name: /Analyze current page/ });
    await malformedShapeButton.click();
    expect((await malformedShapeResponsePromise).status()).toBe(200);
    await expectPopupText(malformedShapePopup, "#errorMessage", "The API returned an invalid analysis response.");
    await expectPopupHidden(malformedShapePopup, "#results");
    await expectPopupEnabled(malformedShapePopup, malformedShapeButton);
    await malformedShapePopup.close();

    const hostilePopup = await openActionPopup(context, options, activeTab, (origin) => authorizationOrigins.push(origin));
    const hostileResult = {
      ...result,
      metadata: { ...result.metadata, title: "<img src=x onerror=alert(1)>" },
    };
    await hostilePopup.mockResponse(apiPath, 200, JSON.stringify(hostileResult), "extension-hostile-title");
    const hostileResponsePromise = hostilePopup.waitForResponse((response) => new URL(response.url()).pathname === apiPath);
    await hostilePopup.getByRole("button", { name: /Analyze current page/ }).click();
    expect((await hostileResponsePromise).status()).toBe(200);
    await expectPopupText(hostilePopup, "#pageTitle", "<img src=x onerror=alert(1)>");
    expect(await hostilePopup.evaluate(() => document.querySelectorAll("#pageTitle img").length)).toBe(0);
    await hostilePopup.screenshot({ path: join(evidenceDirectory, "extension-hostile-text-safe.png"), fullPage: true });
    await hostilePopup.clearMockResponses();
    await hostilePopup.close();

    const unsupportedPopup = await openActionPopup(context, options, options, (origin) => authorizationOrigins.push(origin));
    const unsupportedRequestsBefore = unsupportedPopup.requestsTo(apiPath);
    await unsupportedPopup.getByRole("button", { name: /Analyze current page/ }).click();
    await expectPopupText(unsupportedPopup, "#errorMessage", "Only ordinary HTTP and HTTPS pages can be analyzed.");
    expect(unsupportedPopup.requestsTo(apiPath)).toBe(unsupportedRequestsBefore);
    await expectPopupHidden(unsupportedPopup, "#results");
    await unsupportedPopup.close();

    const observedAuthorizedOrigins = [...new Set(authorizationOrigins)];
    expect(observedAuthorizedOrigins).toEqual([apiUrl.origin]);
    const outsideTab = await context.newPage();
    await outsideTab.route("https://unrelated.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Unrelated controlled tab</title>" }),
    );
    await outsideTab.goto("https://unrelated.test/");
    expect(observedAuthorizedOrigins).not.toContain("https://unrelated.test");
    const unrelatedOriginRead = await outsideTab.evaluate(async (url) => {
      try {
        const response = await fetch(`${url}/health`);
        return { readable: true, status: response.status };
      } catch {
        return { readable: false, status: null };
      }
    }, apiOrigin);
    expect(unrelatedOriginRead).toEqual({ readable: false, status: null });

    const metadataPath = join(evidenceDirectory, "extension-runtime-metadata.json");
    writeFileSync(metadataPath, `${JSON.stringify({
      engine: "Playwright Chromium",
      playwrightVersion: "1.65.0",
      browserVersion: installed.version,
      extensionId,
      actionPopupOpenedBy: "real toolbar button click in the installed Chromium profile",
      profileType: "fresh persistent user-data directory created for this test and removed after close",
      httpsCertificateValidation: "enabled; isolated Caddy root installed only in the disposable CI runner",
    }, null, 2)}\n`);
  } finally {
    await closeIsolatedProfile(installed);
  }
});

test("shows recovery guidance when real optional origin access is denied", async () => {
  test.skip(
    (process.platform !== "linux" || !apiOrigin || !apiToken || !process.env.PHASE2E_API_ORIGIN) && !process.env.CI,
    "The real optional-origin permission prompt requires Linux/Xvfb and the isolated HTTPS Caddy/FastAPI stack.",
  );

  const installed = await installInIsolatedProfile();
  const { options } = installed;
  const apiUrl = new URL(apiOrigin);
  const permittedPattern = `${apiUrl.origin}/*`;

  try {
    await saveConfiguration(options, apiOrigin, apiToken);
    await expect(options.getByLabel("API access token")).toHaveValue("");
    expect(await options.evaluate(async (pattern) =>
      chrome.permissions.contains({ origins: [pattern] }), permittedPattern)).toBe(false);

    await options.getByRole("button", { name: "Test /health" }).click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
    dismissPermissionPromptWithKeyboard();
    await expect(options.locator("#message")).toHaveText("Allow API access for the configured origin, then try again.");
    expect(await options.evaluate(async (pattern) =>
      chrome.permissions.contains({ origins: [pattern] }), permittedPattern)).toBe(false);
  } finally {
    await closeIsolatedProfile(installed);
  }
});
