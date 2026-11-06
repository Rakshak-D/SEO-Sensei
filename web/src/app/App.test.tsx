import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import auditFixture from "../../public/fixtures/audit.json";
import { App } from "./App";
import { sampleUrl } from "../features/analysis/schema";

const sourceHtml = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "  <head>",
  "    <meta charset=\"utf-8\">",
  "    <meta name=\"robots\" content=\"noindex, follow\">",
  "  </head>",
  "</html>",
].join("\n");

function response(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
    text: async () => String(body),
  } as Response;
}

function mockFixtureFetch(options: { firstAuditFailure?: boolean; audit?: unknown; html?: string } = {}) {
  let auditRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/fixtures/audit.json") {
      auditRequests += 1;
      if (options.firstAuditFailure && auditRequests === 1) return response(null, false);
      return {
        ok: true,
        status: 200,
        json: async () => options.audit ?? auditFixture,
        text: async () => JSON.stringify(options.audit ?? auditFixture),
      } as Response;
    }
    if (url === "/fixtures/northstar-solar.html") {
      return response(options.html ?? sourceHtml);
    }
    throw new Error("Unexpected network request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openLocalSample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Open local sample" }));
  await screen.findByRole("heading", { name: "Home Solar Installation: Planning Guide" });
}

describe("Evidence Ledger app", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("announces local fixture loading before the report controls are available", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch);
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the bundled fixture files");
    expect(screen.queryByRole("button", { name: "Open local sample" })).not.toBeInTheDocument();
  });

  it("opens the local fixture and prioritizes noindex over the qualified score", async () => {
    mockFixtureFetch();
    const user = userEvent.setup();
    render(<App />);
    await openLocalSample(user);

    expect(screen.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();
    expect(screen.getByText(/Weighted heuristic/)).toBeVisible();
    expect(screen.getByText(/Not a Google ranking or index score/)).toBeVisible();
    expect(screen.getByText(/Fixture transport context · mocked/)).toBeVisible();
    expect(screen.getByText(/No provider was contacted/)).toBeVisible();
    expect(screen.getByText(/92 \/ 100/)).toBeVisible();
  });

  it("shows failed checks before warnings and preserves all 23 source-order checks", async () => {
    mockFixtureFetch();
    window.history.replaceState({}, "", "/?view=findings&mode=review");
    render(<App />);
    await screen.findByRole("heading", { name: "Findings investigation" });

    const reviewList = document.querySelector(".finding-groups")!;
    expect(Array.from(reviewList.querySelectorAll("[data-finding-id]")).map((row) => row.getAttribute("data-finding-id")))
      .toEqual(["robots_directives", "visible_text", "open_graph", "twitter_metadata"]);
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Showing 4 of 4 review checks");

    await userEvent.setup().click(screen.getByRole("link", { name: /All checks/ }));
    const allChecks = await screen.findByRole("list", { name: "All analyzer checks in fixture order" });
    expect(within(allChecks).getAllByRole("listitem")).toHaveLength(23);
    expect(within(allChecks).getByRole("link", { name: /Rule status: Not applicable/ })).toBeInTheDocument();
    expect(allChecks.querySelector("[data-finding-id='retrieval_success']")).toBe(allChecks.querySelectorAll("[data-finding-id]")[0]);
  });

  it("intersects search and status, preserves both across scopes, and recovers from no matches", async () => {
    mockFixtureFetch();
    window.history.replaceState({}, "", "/?view=findings&mode=review");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Findings investigation" });
    await user.type(screen.getByRole("searchbox", { name: "Search findings" }), "twitter");
    await user.selectOptions(screen.getByLabelText("Rule status"), "warning");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 review checks");
    expect(screen.getByRole("link", { name: /Twitter metadata/ })).toBeVisible();

    await user.click(screen.getByRole("link", { name: /All checks/ }));
    expect(screen.getByRole("searchbox", { name: "Search findings" })).toHaveValue("twitter");
    expect(screen.getByLabelText("Rule status")).toHaveValue("warning");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 available checks");

    await user.clear(screen.getByRole("searchbox", { name: "Search findings" }));
    await user.type(screen.getByRole("searchbox", { name: "Search findings" }), "not-a-real-rule");
    expect(screen.getByRole("heading", { name: "No checks match this view." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear search and status" }));
    expect(screen.getByRole("searchbox", { name: "Search findings" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 23 of 23 available checks");
  });

  it("opens evidence and returns to the same filtered list with focus restored", async () => {
    mockFixtureFetch();
    window.history.replaceState({}, "", "/?view=findings&mode=review");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Findings investigation" });
    await user.type(screen.getByRole("searchbox", { name: "Search findings" }), "robots");
    const findingLink = screen.getByRole("link", { name: /Robots directives are reported/ });
    await user.click(findingLink);

    expect(await screen.findByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
    expect(screen.getByText("Detected directives: noindex, follow.")).toBeVisible();
    expect(screen.getByText(/Static HTML · fictional fixture/)).toBeVisible();
    expect(screen.getByText(/Suggested · not applied/)).toBeVisible();
    expect(screen.getByText(/SEO Sensei has not changed the page/)).toBeVisible();

    await user.click(screen.getByRole("link", { name: /Back to findings/ }));
    await screen.findByRole("heading", { name: "Findings investigation" });
    expect(screen.getByRole("searchbox", { name: "Search findings" })).toHaveValue("robots");
    await waitFor(() => expect(document.querySelector("[data-finding-id='robots_directives']")).toHaveFocus());
  });

  it("validates entry without contacting the typed address", async () => {
    const fetchMock = mockFixtureFetch();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "A clearer view of what a page returns." });

    const input = screen.getByLabelText("Page address");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Open review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the Northstar sample address");
    await user.clear(input);
    await user.type(input, "https://another.example/page/");
    await user.click(screen.getByRole("button", { name: "Open review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This address was not requested");
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/fixtures/"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await user.clear(input);
    await user.type(input, sampleUrl);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Home Solar Installation: Planning Guide" })).toBeVisible();
  });

  it("recovers from a missing fixture on a direct report URL", async () => {
    mockFixtureFetch({ firstAuditFailure: true });
    window.history.replaceState({}, "", "/?view=overview");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
    expect(screen.getByText("No website was requested. Restore the bundled Northstar example files, then retry.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try loading the local example again" }));
    expect(await screen.findByRole("heading", { name: "A noindex directive is present." })).toBeVisible();
  });

  it("rejects a malformed fixture with an explanatory recovery state", async () => {
    mockFixtureFetch({ audit: { fixture_notice: "truncated" } });
    window.history.replaceState({}, "", "/?view=findings&mode=all");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("unexpected shape or status count");
  });

  it("renders hostile-looking fixture evidence as text, never HTML", async () => {
    const hostile = structuredClone(auditFixture);
    const robots = hostile.analysis.checks.find((check) => check.id === "robots_directives")!;
    robots.evidence.observed = "Detected noindex. <img src=x onerror=alert(1)>";
    mockFixtureFetch({ audit: hostile });
    window.history.replaceState({}, "", "/?view=detail&mode=review&check=robots_directives");
    render(<App />);

    expect(await screen.findByText(hostile.analysis.checks.find((check) => check.id === "robots_directives")!.evidence.observed)).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("announces only a local recheck simulation and keeps AI unavailable", async () => {
    const fetchMock = mockFixtureFetch();
    const user = userEvent.setup();
    render(<App />);
    await openLocalSample(user);
    expect(screen.getByText(/Optional AI suggestions are unavailable/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show recheck simulation" }));
    expect(screen.getByRole("status")).toHaveTextContent("No request is running");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No recheck was performed"), { timeout: 2_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
