import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  escapeHtml,
  grokOgHeadTags,
  stripShareMetaTags,
  titleFromDocument,
} from "./grok-pwa-shared.mjs";

test("HTML escaping and title decoding are a single-pass inverse", () => {
  const values = [
    `& < > " '`,
    "&amp;lt; &amp;amp;lt;",
    "already encoded: &amp; &lt; &gt; &quot; &#39;",
  ];

  for (const value of values) {
    const title = titleFromDocument(`<title>${escapeHtml(value)}</title>`);
    assert.equal(title, value);
  }
});

test("HTML escaping leaves no raw special characters", () => {
  const escaped = escapeHtml(`<>&"' &amp;lt;`);
  const withoutEntities = escaped.replace(/&(amp|lt|gt|quot|#39);/g, "");

  assert.doesNotMatch(withoutEntities, /[<>&"']/);
});

test("OG placeholder color accepts six hex digits and omits invalid values", () => {
  const cwd = mkdtempSync(join(tmpdir(), "grok-pwa-color-"));
  const previousPublicHostname = process.env.VITE_PUBLIC_HOSTNAME;
  delete process.env.VITE_PUBLIC_HOSTNAME;

  try {
    const makeTags = (site) => grokOgHeadTags({ host: "app.example.com", site, cwd });
    const valid = makeTags({ color: "#a1B2c3" }).find((tag) => tag.includes('property="og:image"'));
    assert.match(valid, /&amp;color=a1B2c3(?:&|\")/);

    for (const site of [{}, { color: "red" }, { color: "" }, { color: "#abc" }]) {
      const image = makeTags(site).find((tag) => tag.includes('property="og:image"'));
      assert.ok(image);
      assert.doesNotMatch(image, /&amp;color=/);
    }
  } finally {
    if (previousPublicHostname === undefined) delete process.env.VITE_PUBLIC_HOSTNAME;
    else process.env.VITE_PUBLIC_HOSTNAME = previousPublicHostname;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("only the share metadata allowlist is stripped", () => {
  const allowed = [
    "og:title",
    "og:description",
    "og:image",
    "og:image:width",
    "og:image:height",
    "og:type",
    "og:url",
    "og:site_name",
    "twitter:card",
    "twitter:title",
    "twitter:image",
    "twitter:description",
    "x:game:image",
    "x:game:image:width",
    "x:game:image:height",
  ];
  const html = [
    ...allowed.map((key) => `<meta property="${key}" content="old">`),
    '<meta name="description" content="keep">',
    '<meta property="custom:keep" content="keep">',
  ].join("");

  const stripped = stripShareMetaTags(html);

  for (const key of allowed) {
    assert.doesNotMatch(stripped, new RegExp(`property="${key}"`));
  }
  assert.match(stripped, /name="description" content="keep"/);
  assert.match(stripped, /property="custom:keep" content="keep"/);
});
