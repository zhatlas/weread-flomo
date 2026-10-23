import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'data', 'backups', 'exports', 'secrets'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('local Markdown document links resolve', () => {
  for (const path of files(root).filter((file) => file.endsWith('.md'))) {
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const destination = decodeURIComponent(target.split('#')[0]);
      assert.ok(existsSync(resolve(dirname(path), destination)), `${path}: broken link ${target}`);
    }
  }
});

test('repository source does not contain common credential or private export artifacts', () => {
  const tracked = existsSync(join(root, '.git')) ? execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map((file) => join(root, file)) : [];
  for (const path of new Set([...files(root), ...tracked])) {
    const name = path.slice(root.length);
    assert.doesNotMatch(name, /(?:^|\/)(?:data|secrets|backups|exports|diagnostics)(?:\/|$)|(?:^|\/)(?:master\.key|setup-token|delivery-checkpoint\.json|config\.env)$/, `${path}: private runtime artifact`);
    assert.ok(!/(?:^|\/)\.env(?:\.|$)/.test(name) || name === '.env.example', `${path}: private environment file`);
    assert.doesNotMatch(path, /\.(?:db|sqlite|sqlite3)(?:-|$)|微信读书想法_.*\.md$/, path);
    const content = readFileSync(path, 'utf8');
    const keyPattern = new RegExp('wr' + 'k-[A-Za-z0-9_-]{16,}');
    const webhookPattern = new RegExp('https://(?:v\\.)?flomoapp\\.com/' + 'iwh/[^\\s"<>]+');
    assert.doesNotMatch(content, keyPattern, `${path}: possible WeRead credential`);
    assert.doesNotMatch(content, webhookPattern, `${path}: possible flomo webhook credential`);
  }
});
