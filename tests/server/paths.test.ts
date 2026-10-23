import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { defaultRuntimeRoot, externalPath, runtimePaths } from '../../src/server/paths.js';

test('default storage follows the local account and ignores relative XDG paths', () => {
  assert.equal(defaultRuntimeRoot({}, 'linux', '/users/reader'), '/users/reader/.local/share/weread-flomo');
  assert.equal(defaultRuntimeRoot({ XDG_DATA_HOME: '/private/appdata' }, 'linux', '/users/reader'), '/private/appdata/weread-flomo');
  assert.equal(defaultRuntimeRoot({ XDG_DATA_HOME: 'data' }, 'linux', '/users/reader'), '/users/reader/.local/share/weread-flomo');
  assert.equal(defaultRuntimeRoot({}, 'darwin', '/users/reader'), '/users/reader/Library/Application Support/weread-flomo');
  assert.equal(defaultRuntimeRoot({ LOCALAPPDATA: '/users/reader/Local' }, 'win32', '/users/reader'), '/users/reader/Local/weread-flomo');
});

test('storage paths reject the source tree and symlink aliases before creating files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-paths-'));
  try {
    const source = join(directory, 'source'); mkdirSync(source);
    const alias = join(directory, 'alias'); symlinkSync(source, alias);
    const dangling = join(directory, 'dangling'); symlinkSync(join(source, 'future'), dangling);
    for (const path of [source, join(source, 'data'), join(alias, 'secrets', 'nested'), join(dangling, 'data')]) assert.throws(() => externalPath(path, source), /源码目录之外/);
    const data = join(directory, 'private', 'data'); const secrets = join(directory, 'private', 'secrets');
    assert.deepEqual(runtimePaths({ DATA_DIR: data, SECRETS_DIR: secrets }, source), { data, secrets });
    assert.throws(() => runtimePaths({ DATA_DIR: data, SECRETS_DIR: join(alias, 'secrets') }, source), /源码目录之外/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('legacy source-local databases require migration instead of silently starting empty', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-legacy-'));
  try {
    mkdirSync(join(directory, 'data')); writeFileSync(join(directory, 'data', 'app.sqlite'), 'synthetic');
    assert.throws(() => runtimePaths({}, directory), /不会自动创建空库/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
