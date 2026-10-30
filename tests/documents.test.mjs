import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const documents = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'AGENTS.md', '.github/PULL_REQUEST_TEMPLATE.md',
  ...readdirSync(resolve(root, 'docs')).filter((name) => name.endsWith('.md') && !name.endsWith('.zh-CN.md')).map((name) => `docs/${name}`),
  '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md'];

test('public documentation has linked English and Chinese editions and valid local anchors', () => {
  for (const name of documents) {
    const chinese = name.replace(/\.md$/, '.zh-CN.md');
    for (const [current, other] of [[name, chinese], [chinese, name]]) {
      const path = resolve(root, current);
      const content = readFileSync(path, 'utf8');
      assert.ok(content.slice(0, 500).includes(other.split('/').at(-1)), `${current}: missing language link`);
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [file, anchor] = target.split('#');
        const destination = resolve(dirname(path), decodeURIComponent(file || current.split('/').at(-1)));
        const linked = readFileSync(destination, 'utf8');
        if (!anchor) continue;
        const headings = [...linked.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '').replace(/ /g, '-'));
        assert.ok(headings.includes(decodeURIComponent(anchor)), `${current}: missing anchor ${target}`);
      }
    }
  }
  assert.match(readFileSync(resolve(root, 'README.md'), 'utf8'), /A self-hosted workspace/);
});
