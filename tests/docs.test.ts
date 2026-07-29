import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

type Nav = { pages?: Array<string | Nav>; groups?: Nav[] };

function mdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? mdxFiles(target) : entry.name.endsWith(".mdx") ? [target] : [];
  });
}

function slug(file: string): string {
  return path
    .relative(root, file)
    .replaceAll("\\", "/")
    .replace(/\.mdx$/, "");
}

function pages(node: Nav): string[] {
  return [
    ...(node.pages ?? []).flatMap((page) => (typeof page === "string" ? [page] : pages(page))),
    ...(node.groups ?? []).flatMap(pages),
  ];
}

function rendered(source: string): string {
  return source
    .replace(/^---[\s\S]*?---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function links(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of [
    /href=["'](\/[^"'#?]+(?:[?#][^"']*)?)["']/g,
    /\]\((\/[^)#\s]+(?:[?#][^)]*)?)\)/g,
  ]) {
    for (const match of rendered(source).matchAll(pattern)) {
      const value = match[1]
        ?.split(/[?#]/, 1)[0]
        ?.replace(/^\//, "")
        .replace(/\.(md|mdx)$/, "")
        .replace(/\/$/, "");
      if (value) found.add(value);
    }
  }
  return [...found];
}

describe("Korve public docs", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "docs.json"), "utf8")) as {
    navigation: Nav;
  };
  const files = mdxFiles(root);
  const local = new Set(files.map(slug));
  const published = new Set(pages(config.navigation));

  it("has a local page for every navigation entry", () => {
    expect([...published].filter((page) => !local.has(page))).toEqual([]);
  });

  it("publishes every generated public API resource", () => {
    const generated = fs
      .readdirSync(path.join(root, "api-reference"))
      .filter((file) => file.endsWith(".mdx") && file !== "overview.mdx")
      .map((file) => `api-reference/${file.replace(/\.mdx$/, "")}`);
    expect(generated.filter((page) => !published.has(page))).toEqual([]);
  });

  it("publishes the complete agent-cloud workflow guides", () => {
    for (const page of [
      "agents/oauth",
      "agents/local-agent-setup",
      "starters",
      "concepts/product-telemetry",
      "primitives/app-auth",
      "primitives/app-access",
      "primitives/realtime",
      "primitives/ai-gateway",
      "primitives/customer-payments",
      "primitives/project-operator",
      "primitives/project-maintenance",
    ]) {
      expect(published.has(page), `${page} must be in navigation`).toBe(true);
    }
  });

  it("keeps internal links local and valid", () => {
    const broken = files.flatMap((file) =>
      links(fs.readFileSync(file, "utf8"))
        .filter((target) => !local.has(target))
        .map((target) => `${slug(file)} -> /${target}`),
    );
    expect(broken).toEqual([]);
  });

  it("does not expose infrastructure providers, private packages, or personal contacts", () => {
    const forbidden = [
      /@korve-dev\/(?:provider(?:-[\w-]+)?|db|env|result|observability)\b/gi,
      /\b(?:fly\.io|cloudflare|pulumi)\b/gi,
      /[\w.+-]+@(?:gmail|protonmail|icloud|me|yahoo|hotmail)\.[a-z]+/gi,
    ];
    const leaks = files.flatMap((file) =>
      forbidden.flatMap((pattern) =>
        [...fs.readFileSync(file, "utf8").matchAll(pattern)].map(
          (match) => `${slug(file)} -> ${match[0]}`,
        ),
      ),
    );
    expect(leaks).toEqual([]);
  });

  it("ships the generated public OpenAPI contract without internal routes", () => {
    const openapiPath = path.join(root, "openapi.json");
    expect(fs.existsSync(openapiPath)).toBe(true);

    const document = JSON.parse(fs.readFileSync(openapiPath, "utf8")) as {
      openapi: string;
      servers: Array<{ url: string }>;
      paths: Record<string, Record<string, { operationId?: string; tags?: string[] }>>;
    };
    const operations = Object.values(document.paths).flatMap((pathItem) => Object.values(pathItem));

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://api.korve.dev" }]);
    expect(Object.keys(document.paths).some((route) => route.startsWith("/v1/internal/"))).toBe(
      false,
    );
    expect(operations.some((operation) => operation.operationId === "projects.list")).toBe(true);
    for (const operationId of [
      "aiGateways.list",
      "appauth.signInPassword",
      "customerPayments.getConfig",
      "productTelemetry.getFunnel",
      "realtime.listChannels",
      "storage.runtimeCreateUpload",
    ]) {
      expect(
        operations.some((operation) => operation.operationId === operationId),
        operationId,
      ).toBe(true);
    }
    expect(operations.flatMap((operation) => operation.tags ?? [])).not.toContain(
      "telemetryInternal",
    );
  });

  it("publishes every new menu resource through the API navigation", () => {
    for (const resource of [
      "aiGateways",
      "appauth",
      "customerPayments",
      "productTelemetry",
      "realtime",
      "storage",
    ]) {
      expect(published.has(`api-reference/${resource}`), resource).toBe(true);
    }
  });

  it("does not claim the unreleased TypeScript packages are anonymously installable", () => {
    for (const page of ["sdk/runtime", "sdk/app-auth", "primitives/app-auth"]) {
      const source = fs.readFileSync(path.join(root, `${page}.mdx`), "utf8");
      expect(source, page).toContain("not yet available from");
      expect(source, page).toMatch(/public\s+npm\s+registry/);
      expect(source, page).not.toMatch(/(?:npm|bun|pnpm|yarn)\s+(?:install|add)\s+@korve-dev\//);
    }

    const payments = fs.readFileSync(path.join(root, "primitives/customer-payments.mdx"), "utf8");
    expect(payments).toMatch(/not yet available from the\s+public npm registry/);
  });

  it("gives agents security and delivery constraints for every new runtime surface", () => {
    const llms = fs.readFileSync(path.join(root, "llms.txt"), "utf8");
    for (const phrase of [
      "Realtime live delivery is at most once",
      "runtime token",
      "AI gateway key",
      "customer-payment credential",
      "not yet published to npm",
    ]) {
      expect(llms).toContain(phrase);
    }
  });
});
