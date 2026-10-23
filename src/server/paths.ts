import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export function defaultRuntimeRoot(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'weread-flomo');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'weread-flomo');
  return join(env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'weread-flomo');
}
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) return physicalPath(resolve(dirname(path), readlinkSync(path)));
  return join(physicalPath(dirname(path)), relative(dirname(path), path));
}
export function externalPath(path: string, source = projectRoot) {
  const target = resolve(path);
  const inside = relative(physicalPath(resolve(source)), physicalPath(target));
  if (!inside || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))) throw new Error('运行数据必须保存在源码目录之外，请修改 DATA_DIR / SECRETS_DIR 或应用数据目录。');
  return target;
}
export function loadRuntimeConfig() {
  const config = externalPath(join(defaultRuntimeRoot(), 'config.env'));
  if (existsSync(config)) process.loadEnvFile(config);
}
export function runtimePaths(env = process.env, source = projectRoot) {
  if (existsSync(join(source, 'data', 'app.sqlite'))) throw new Error('发现旧版源码目录中的数据库。请先停机，将 data 和 secrets 完整移至源码目录之外，再设置 DATA_DIR 和 SECRETS_DIR；不会自动创建空库。');
  const base = defaultRuntimeRoot(env);
  return {
    data: externalPath(env.DATA_DIR || join(base, 'data'), source),
    secrets: externalPath(env.SECRETS_DIR || join(base, 'secrets'), source),
  };
}
