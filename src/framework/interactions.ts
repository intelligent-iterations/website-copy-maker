import type { Page } from "playwright";
import type { ExtractedNode } from "../extract/types.js";
import type { Control, InteractionStep, Target } from "./types.js";

function locate(page: Page, target: Target) {
  return "selector" in target
    ? page.locator(target.selector)
    : page.getByRole(target.role, { name: target.name, exact: true });
}

/** Screenshots suggest intent; these assertions establish observed behavior. */
export async function replayInteractions(
  page: Page,
  steps: readonly InteractionStep[],
): Promise<void> {
  const origin = new URL(page.url()).origin;
  for (const step of steps) {
    if (step.action === "url") {
      await page.waitForURL(
        (url) => url.origin === origin && url.pathname + url.search + url.hash === step.path,
        {
          timeout: 5000,
        },
      );
      continue;
    }
    const target = locate(page, step.target);
    switch (step.action) {
      case "click":
        await target.click({ timeout: 5000 });
        break;
      case "hover":
        await target.hover({ timeout: 5000 });
        break;
      case "fill":
        await target.fill(step.value, { timeout: 5000 });
        break;
      case "press":
        await target.press(step.value, { timeout: 5000 });
        break;
      case "visible":
        await target.waitFor({ state: "visible", timeout: 5000 });
        break;
      case "hidden":
        await target.waitFor({ state: "hidden", timeout: 5000 });
        break;
      case "text": {
        await target.waitFor({ state: "visible", timeout: 5000 });
        const text = await target.innerText();
        if (text !== step.value)
          throw new Error(
            `Expected text ${JSON.stringify(step.value)}, received ${JSON.stringify(text)}`,
          );
        break;
      }
      default:
        throw new Error("Unknown interaction action");
    }
    if (new URL(page.url()).origin !== origin)
      throw new Error("Interaction navigated outside the tested origin");
  }
}

export function collectControls(root: ExtractedNode): readonly Control[] {
  const out: Control[] = [];
  const visit = (node: ExtractedNode): void => {
    for (const part of node.richText ?? []) {
      if (part.href)
        out.push({ nodeId: node.id, tag: "a", label: part.text, href: part.href, rect: node.rect });
    }
    if (
      ["a", "button", "input", "select", "textarea", "summary"].includes(node.tag) ||
      ["button", "link", "tab", "checkbox", "menuitem"].includes(node.role ?? "")
    ) {
      out.push({
        nodeId: node.id,
        tag: node.tag,
        label: node.attributes["aria-label"] ?? node.text ?? node.attributes.title ?? "",
        href: node.href ?? null,
        rect: node.rect,
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

/** Check link contracts separately from pixels. Does not claim click behavior. */
export function compareLinks(
  source: readonly Control[],
  replica: readonly Control[],
  sourceUrl: string,
  replicaUrl: string,
): readonly string[] {
  const issues: string[] = [];
  const normalize = (href: string, base: string): string => {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin ? url.pathname + url.search + url.hash : url.href;
  };
  const available = replica.filter((control) => control.href !== null).slice();
  for (const expected of source.filter((control) => control.href !== null)) {
    const destination = normalize(expected.href!, sourceUrl);
    const match = available.findIndex(
      (control) =>
        control.label === expected.label && normalize(control.href!, replicaUrl) === destination,
    );
    if (match < 0)
      issues.push(`Link ${JSON.stringify(expected.label)} must lead to ${destination}`);
    else available.splice(match, 1);
  }
  return issues;
}
