let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export class ApiError extends Error { constructor(public code: string, public status: number) { super(code); } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && result.error === 'UNAUTHORIZED') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(result.error ?? 'INTERNAL_ERROR', response.status);
  }
  return result as T;
}
export const messages: Record<string, string> = {
  AUTOMATION_VALIDATION: '请检查时间、周期、字数及请求上限；同步间隔至少 5 分钟。',
  AUTOMATION_CONFLICT: '设置已变更，请重新载入后操作。', SEND_CONFIRM: '请先确认允许按已启用规则发送到 flomo。',
  DELIVERY_STATE: '任务状态已改变，请重新打开详情。', FLOMO_RATE_LIMIT: 'flomo 要求降低请求频率，已安排重试。',
  FLOMO_CONNECT: '连接未建立，将自动退避重试。', FLOMO_AUTH: 'flomo 拒绝认证或权限不足，导入已暂停。',
  FLOMO_REJECTED: 'flomo 明确拒绝请求，请检查权限、内容或额度后再试。', FLOMO_RESPONSE: '返回格式无法确认是否成功，请先到 flomo 核对。',
  FLOMO_UNCERTAIN: '无法确认是否已写入，请先到 flomo 核对；不会自动重发。', SEND_INTERRUPTED: '发送中断，可能已写入，请人工核对。',
  RETRY_EXHAUSTED: '已达到 5 次自动尝试上限，请检查后手动恢复。', CONTENT_LIMIT: '内容为空或超过本应用字数上限，已阻塞，未截断。',
  LOCAL_QUOTA: '本应用滚动 24 小时请求额度已用完，等待恢复。', RULE_NO_MATCH: '不再符合已启用规则或连接已停用。',
  RESTART_REVIEW: '服务已重启，发送已暂停。请核对队列后重新确认启用导入。', CONNECTION_CHANGED: '连接已更换，自动任务已暂停，请重新检查规则与计划。',
  BACKUP_REVIEW: '发送检查记录缺失或与数据库不一致，自动导入已锁定，请核对备份恢复和历史导入记录。',
  SOURCE_MISSING: '想法首次缺失，已暂停导入，等待下次完整核对。', SOURCE_REMOVED: '想法连续两次完整核对缺失，已按同步结果推断删除。',
  SOURCE_UNAVAILABLE: '来源读取失败，导入暂停，等待成功核对。', SOURCE_UNVERIFIED: '来源缺少完整数量依据，暂不判定删除，导入暂停。',
  SOURCE_ANOMALY: '发现大量缺失或多本书同时清空，已暂停判定与相关导入，请核对来源。', SOURCE_NOT_READY: '来源尚未恢复正常，不能重试导入。请先完成同步核对。',
  UPSTREAM_COUNT_MISMATCH: '来源数量与分页结果不一致，未判定删除，相关想法暂停导入。',
  SYNC_PARTIAL: '本轮有失败范围，将按退避计划再次同步。', MANUALLY_CONFIRMED: '管理员已核对并标记完成。',
  RULE_VALIDATION: '请检查规则名称、筛选项及标签格式；旧版本页面请刷新后重试。',
  RULE_DATE: '日期或时区无效；开始日期不能晚于结束日期。',
  RULE_CONNECTION: '规则需要有效的微信读书和 flomo 连接；启用时两者都必须是当前连接。',
  RULE_IDENTITY: '已保存规则不能更换连接，请复制为新规则后修改。',
  RULE_HISTORY_LOCKED: '已建立基准的规则不能更换历史范围，请复制为新规则。',
  RULE_BASELINE: '请先完成一轮完整同步，再启用规则；最近一轮不能有失败或中断。',
  RULE_HISTORY_CONFIRM: '请明确确认将匹配历史笔记纳入处理范围。',
  RULE_CONFLICT: '规则已在其他页面修改或因连接变更停用，请重新点击编辑后操作。',
  VALIDATION: '请检查输入内容。密码至少需要 12 个字符。', LOGIN_FAILED: '账号或密码不正确。',
  SETUP_TOKEN_INVALID: '设置令牌不正确，请查看服务器启动日志中的令牌文件位置。', ALREADY_INITIALIZED: '管理员已创建，请刷新后登录。',
  UNAUTHORIZED: '登录已过期，请重新登录。', ORIGIN_DENIED: '访问地址与 APP_ORIGIN 不一致，请使用配置的地址访问。', CSRF_DENIED: '会话校验失败，请刷新页面重试。',
  RATE_LIMIT: '操作过于频繁，请稍后再试。', SYNC_BUSY: '同步或连接检查正在进行，请稍后再试。', CONNECTION_REQUIRED: '请先配置微信读书连接。',
  KEY_FORMAT: 'API Key 格式不正确，应以 wrk- 开头。', WEBHOOK_FORMAT: '请填写 flomo 提供的 HTTPS 专属 API 地址。',
  REPLACE_CONFIRMATION: '请勾选确认更换连接。旧笔记会保留在原数据空间。',
  UPSTREAM_AUTH: '微信读书凭据已失效，请重新配置。', UPSTREAM_FORMAT: '接口返回格式与预期不符，已有数据已保留。',
  UPSTREAM_NETWORK: '无法连接微信读书，请稍后重试。', UPSTREAM_RATE_LIMIT: '微信读书要求降低请求频率，请稍后重试。',
  UPSTREAM_UNAVAILABLE: '微信读书暂时不可用。', UPSTREAM_REJECTED: '微信读书拒绝了请求，请检查凭据或接口权限。',
  UPSTREAM_UPGRADE: '微信读书要求升级接口客户端，请等待项目适配。', UPSTREAM_TOO_LARGE: '单次响应超过 32 MiB，未截断写入，请检查任务。',
  PAGINATION_STALLED: '接口分页未推进，已停止本次读取。', PAGINATION_DUPLICATE: '接口分页出现重复记录，已停止本次读取。',
  SYNC_INTERRUPTED: '同步已中断，可以重新同步。', NOT_FOUND: '记录不存在。',
};
export const message = (error: unknown) => error instanceof ApiError ? messages[error.code] ?? `操作未完成（${error.code}）` : '网络连接中断，请检查服务是否运行。';
export const date = (timestamp?: number | null) => timestamp == null ? '时间缺失' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(timestamp);
export const statusText: Record<string, string> = { running: '同步中', succeeded: '读取完成', partial: '部分失败', failed: '读取失败', interrupted: '已中断' };
export type Connection = { id: string; provider: 'weread' | 'flomo'; enabled: number; created_at: number };
export type Run = { mode: 'full' | 'light'; id: string; connection_id: string; status: string; started_at: number; finished_at: number | null; error_code: string | null; coverage_json: string; counts_json: string };
export type Overview = { running: boolean; stats: { total: number; highlights: number; thoughts: number; books: number }; runs: Run[] };
export type Note = { id: number; kind: 'highlight' | 'thought'; content: string | null; original_text: string | null; chapter_name: string | null; source_created_at: number | null; title: string | null; author: string | null; status: string; missing_scans: number; first_missing_at: number | null; removed_at: number | null; source_error_code: string | null };

export const noteLabels: Record<string, string> = { active: '正常', missing: '疑似删除，待复核', removed: '已删除（同步推断）', unavailable: '来源暂无法核对' };
