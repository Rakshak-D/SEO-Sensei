import { describe, expect, it } from "vitest";
import { routeFromSearch, routeSearch, type AppRoute } from "./route";

describe("guest report routes", () => {
  it("preserves guest mode when a report subroute is reloaded", () => {
    const fixListRoute: AppRoute = {
      view: "findings",
      mode: "review",
      q: "",
      status: "all",
      check: "meta_description",
      source: "guest",
      operator: false,
    };

    const search = routeSearch(fixListRoute);
    const reloadedRoute = routeFromSearch(search);

    expect(search).toContain("source=guest");
    expect(reloadedRoute).toMatchObject({ view: "findings", source: "guest", operator: false, check: "meta_description" });
  });

  it("reloads Page X-ray routes with source and selected check but never puts a page URL in the route", () => {
    const xrayRoute: AppRoute = {
      view: "xray",
      mode: "review",
      q: "",
      status: "all",
      check: "meta_description",
      source: "guest",
      operator: false,
    };

    const search = routeSearch(xrayRoute);
    const reloaded = routeFromSearch(search);

    expect(search).toBe("?view=xray&source=guest&check=meta_description");
    expect(search).not.toContain("https://");
    expect(reloaded).toMatchObject({ view: "xray", source: "guest", check: "meta_description", operator: false });
  });

  it("preserves a deliberate local example source on its X-ray route", () => {
    const search = routeSearch({
      view: "xray",
      mode: "review",
      q: "",
      status: "all",
      check: "robots_directives",
      source: "demo",
      operator: false,
    });
    expect(routeFromSearch(search)).toMatchObject({ view: "xray", source: "demo", check: "robots_directives", operator: false });
  });

  it.each(["on-page", "previews"] as const)("preserves the %s guest route across reload", (view) => {
    const search = routeSearch({
      view,
      mode: "review",
      q: "",
      status: "all",
      check: "",
      source: "guest",
      operator: false,
    });

    expect(search).toBe(`?view=${view}&source=guest`);
    expect(routeFromSearch(search)).toMatchObject({ view, source: "guest", operator: false });
  });

  it.each(["on-page", "previews"] as const)("preserves fictional-example access on the %s route", (view) => {
    const search = routeSearch({
      view,
      mode: "review",
      q: "",
      status: "all",
      check: "",
      source: "demo",
      operator: false,
    });

    expect(search).toBe(`?view=${view}&source=demo&access=guest`);
    expect(routeFromSearch(search)).toMatchObject({ view, source: "demo", operator: false });
  });
});
