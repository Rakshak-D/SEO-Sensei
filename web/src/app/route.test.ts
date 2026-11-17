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
});
