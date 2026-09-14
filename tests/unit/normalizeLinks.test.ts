import { describe, expect, it } from "vitest";
import { rewriteHref, urlToRoutePath } from "../../src/normalize/normalizeLinks.js";

const SRC = "https://example.com";

describe("rewriteHref", () => {
  it("preserves fragment-only links", () => {
    expect(rewriteHref("#features", SRC)).toBe("#features");
    expect(rewriteHref("#", SRC)).toBe("#");
  });

  it("returns mailto / tel / javascript untouched", () => {
    expect(rewriteHref("mailto:hi@example.com", SRC)).toBe("mailto:hi@example.com");
    expect(rewriteHref("tel:+1-555-0100", SRC)).toBe("tel:+1-555-0100");
    expect(rewriteHref("javascript:void(0)", SRC)).toBe("javascript:void(0)");
  });

  it("rewrites same-host pathnames to a real route path with trailing slash", () => {
    expect(rewriteHref("https://example.com/privacy", SRC)).toBe("/privacy/");
    expect(rewriteHref("https://example.com/terms-and-conditions", SRC)).toBe(
      "/terms-and-conditions/",
    );
    expect(rewriteHref("https://example.com/blog/post-1", SRC)).toBe("/blog/post-1/");
  });

  it("collapses same-host root to /", () => {
    expect(rewriteHref("https://example.com/", SRC)).toBe("/");
    expect(rewriteHref("https://example.com", SRC)).toBe("/");
  });

  it("preserves fragment on same-host root and on subpages", () => {
    expect(rewriteHref("https://example.com/#features", SRC)).toBe("/#features");
    expect(rewriteHref("https://example.com/blog/#x", SRC)).toBe("/blog/#x");
  });

  it("treats relative paths as same-host route paths", () => {
    expect(rewriteHref("/about", SRC)).toBe("/about/");
    expect(rewriteHref("./contact", SRC)).toBe("/contact/");
  });

  it("leaves external absolute URLs untouched", () => {
    expect(rewriteHref("https://outside.example/app/id123", SRC)).toBe(
      "https://outside.example/app/id123",
    );
  });

  it("normalizes trailing slashes", () => {
    expect(rewriteHref("https://example.com/blog/", SRC)).toBe("/blog/");
  });
});

describe("urlToRoutePath", () => {
  it("returns the empty string for the root URL", () => {
    expect(urlToRoutePath("https://example.com/", SRC)).toBe("");
    expect(urlToRoutePath("https://example.com", SRC)).toBe("");
  });

  it("returns the path joined by '/' for subpages", () => {
    expect(urlToRoutePath("https://example.com/privacy", SRC)).toBe("privacy");
    expect(urlToRoutePath("https://example.com/blog/post-1", SRC)).toBe("blog/post-1");
  });

  it("returns null for external, fragment-only, or non-http", () => {
    expect(urlToRoutePath("https://other.com/x", SRC)).toBeNull();
    expect(urlToRoutePath("#features", SRC)).toBeNull();
    expect(urlToRoutePath("mailto:a@b.c", SRC)).toBeNull();
  });
});
