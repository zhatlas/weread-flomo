import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, date, message, messages, setCsrf, statusText, noteLabels, type Connection, type Note, type Overview, type Run } from './api';
import { Rules } from './Rules';
import { Automation } from './Automation';
import './style.css';

type Auth = { initialized: boolean; authenticated: boolean; csrf?: string; username?: string };
const Brand = () => <div className="brand"><span className="brand-mark" aria-hidden="true">阅</span><div>WeRead <span className="arrow">→</span> flomo<small>让阅读留下来</small></div></div>;
function Alert({ children }: { children: string }) { return children ? <p role="alert" className="alert">{children}</p> : null; }
function App() {
  const [auth, setAuth] = useState<Auth>();
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { const state = await api<Auth>('/auth/state'); setCsrf(state.csrf ?? ''); setAuth(state); setError(''); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { void load(); const expired = () => { setCsrf(''); setAuth({ initialized: true, authenticated: false }); }; window.addEventListener('session-expired', expired); return () => window.removeEventListener('session-expired', expired); }, [load]);
  if (!auth) return <div className="auth-shell"><Brand /><p>正在连接本地阅读库…</p><Alert>{error}</Alert>{error && <button onClick={() => void load()}>重试</button>}</div>;
  return auth.authenticated ? <Workspace username={auth.username ?? '管理员'} logout={load} /> : <AuthForm initialized={auth.initialized} onDone={load} />;
}
function AuthForm({ initialized, onDone }: { initialized: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    try { await api(`/auth/${initialized ? 'login' : 'setup'}`, values); form.reset(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="auth-shell"><Brand /><div className="auth-card"><p className="eyebrow">YOUR READING, KEPT CLOSE</p><h1>{initialized ? '欢迎回到阅读库' : '建立你的阅读库'}</h1><p className="muted">{initialized ? '登录后，继续整理那些值得留下的句子。' : '创建唯一管理员。你的笔记与连接凭据保存在自己的服务上。'}</p>
    <form onSubmit={submit}>{!initialized && <label>首次设置令牌<input name="setupToken" type="password" required autoComplete="off" /><small>在服务器启动日志所示的位置读取首次设置令牌。</small></label>}
      <label>管理员账号<input name="username" required maxLength={80} autoComplete="username" /></label>
      <label>密码<input name="password" type="password" required minLength={12} maxLength={256} autoComplete={initialized ? 'current-password' : 'new-password'} /><small>至少 12 个字符。</small></label>
      <Alert>{error}</Alert><button className="primary full" disabled={busy}>{busy ? '正在验证…' : initialized ? '登录阅读库' : '创建管理员'}</button></form></div><p className="auth-foot">自行部署 · 数据由你掌管 · MIT 开源</p></div>;
}
function Workspace({ username, logout }: { username: string; logout: () => Promise<void> }) {
  const [page, setPage] = useState<'overview' | 'notes' | 'rules' | 'automation' | 'settings'>('overview');
  const [overview, setOverview] = useState<Overview>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [run, setRun] = useState<Run>();
  const dataSignature = useRef('');
  const refresh = useCallback(async () => {
    try { const [o, c] = await Promise.all([api<Overview>('/status'), api<{ items: Connection[] }>('/connections')]); setOverview(o); setConnections(c.items); setError(''); const signature = JSON.stringify(o); if (signature !== dataSignature.current) { dataSignature.current = signature; setRevision((v) => v + 1); } } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => void refresh(), overview?.running ? 2000 : 15000); return () => clearInterval(timer); }, [overview?.running, refresh]);
  async function synchronize() { setStarting(true); try { await api('/sync', {}); await refresh(); } catch (e) { setError(message(e)); } finally { setStarting(false); } }
  const active = connections.find((c) => c.provider === 'weread' && c.enabled);
  const titles = { overview: ['阅读总览', '每一次重读，都从这里开始。'], notes: ['笔记库', '把书里的句子，和自己的思考放在一起。'], rules: ['导入规则', '挑选值得留下的笔记，预览送往 flomo 的文字。'], automation: ['自动任务与导入', '让新笔记按你的规则留下来。'], settings: ['连接与设置', '连接你的阅读来源，掌管自己的数据。'] };
  return <div className="workspace"><aside className="sidebar"><Brand /><div className="workspace-label">个人阅读空间</div><nav aria-label="主要导航">{(['overview', 'notes', 'rules', 'automation', 'settings'] as const).map((item, index) => <button key={item} className={page === item ? 'nav-item selected' : 'nav-item'} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}><span aria-hidden="true">{['◫', '▤', '☷', '↻', '⚙'][index]}</span>{['总览', '笔记库', '规则', '自动任务', '设置'][index]}{item === 'notes' && <small>{overview?.stats.total ?? '—'}</small>}</button>)}</nav><div className="sidebar-bottom"><span className="dot" /> 本地数据 · 私人收藏<small>M3 · 自动任务与导入</small></div></aside>
    <div className="main-area"><header className="topbar"><span>我的阅读空间 <span className="slash">/</span> {titles[page][0]}</span><div><span className="avatar">{username.slice(0, 1).toUpperCase()}</span><span className="username">{username}</span><button className="text-button" onClick={async () => { try { await api('/auth/logout', {}); await logout(); } catch (e) { setError(message(e)); } }}>退出</button></div></header>
      <main><div className="page-heading"><div><p className="eyebrow">THE READING ROOM</p><h1>{titles[page][0]}</h1><p className="muted">{titles[page][1]}</p></div><button className="primary" disabled={!active || overview?.running || starting} onClick={() => void synchronize()}>{overview?.running ? '正在同步…' : starting ? '正在启动…' : '↻  立即同步'}</button></div><Alert>{error}</Alert>
        {page === 'overview' && <><div className="hero"><div><span className="pill">阅读，让想法发生</span><h2>读过的文字，<br />成为自己的思考。</h2><p>在这里收集划线与想法，重新发现阅读的线索。</p><button className="outline" onClick={() => setPage(active ? 'notes' : 'settings')}>{active ? '打开笔记库' : '连接微信读书'}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></button></div><div className="book-art" aria-hidden="true"><div className="book-spine"/><div className="book-cover"><small>READ<br />THINK<br />KEEP.</small><span>每一页<br />都有回响</span><i>阅读手记 / 01</i></div><div className="book-shadow" /></div></div>
          <div className="stats">{[['全部笔记', overview?.stats.total], ['划线', overview?.stats.highlights], ['想法', overview?.stats.thoughts], ['有笔记的书籍', overview?.stats.books]].map(([title, value], i) => <div className="stat" key={title}><span>{title}</span><strong>{value ?? '—'}<small>{i === 3 ? '本' : '条'}</small></strong></div>)}</div>
          <div className="section-heading"><h2>同步动态</h2><span className="muted">读取任务 · 当前连接统计</span></div><div className="panel">{!active ? <div className="empty"><span className="empty-icon">↔</span><h3>从连接你的阅读开始</h3><p>添加微信读书 API Key，首次同步后即可查看笔记。</p><button onClick={() => setPage('settings')}>配置连接</button></div> : !overview?.runs.length ? <div className="empty"><h3>连接已就绪</h3><p>点击“立即同步”，将可访问的划线与想法保存到本地。</p></div> : <div className="run-list">{overview.runs.map((item) => <button key={item.id} className="run-row" onClick={() => setRun(item)}><span className={`run-icon ${item.status}`}>{item.status === 'succeeded' ? '✓' : item.status === 'running' ? '↻' : '!'}</span><span><strong>微信读书 · {item.mode === 'light' ? '轻量检查' : '完整遍历'}</strong><small>{date(item.started_at)} · {item.connection_id === active.id ? '当前连接' : '历史连接'}</small></span><span className={`badge ${item.status}`}>{statusText[item.status]}</span><span aria-hidden="true">›</span></button>)}</div>}</div><p className="footnote">同步只更新本地阅读库。想法首次缺失暂停导入，两次完整核对仍缺失则标记删除；划线缺失仍保留。可以在规则页筛选并预览，在自动任务页设置周期和启用导入。</p></>}
        {page === 'notes' && <Notes connections={connections} revision={revision} />}
        {page === 'automation' && <Automation />}
        {page === 'rules' && <Rules connections={connections} revision={revision} />}
        {page === 'settings' && <Settings connections={connections} refresh={refresh} logout={logout} busy={!!overview?.running} />}
      </main><footer>WeRead → flomo <span>让阅读留下来</span></footer></div>{run && <RunDetail run={run} close={() => setRun(undefined)} revision={revision} />}</div>;
}
function Notes({ connections, revision }: { connections: Connection[]; revision: number }) {
  const [filters, setFilters] = useState({ q: '', kind: '', status: '', bookId: '', connectionId: '', start: '', end: '' });
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState<{ book_id: string; title: string | null }[]>([]);
  const [result, setResult] = useState<{ items: Note[]; total: number }>();
  const [detail, setDetail] = useState<Note & { source_id: string; raw_json: string; first_seen_at: number; updated_at: number }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { let current = true; api<{ items: typeof books }>(`/books?${new URLSearchParams(filters.connectionId ? { connectionId: filters.connectionId } : {})}`).then((r) => { if (current) setBooks(r.items); }).catch((e) => { if (current) setError(message(e)); }); return () => { current = false; }; }, [filters.connectionId, revision]);
  useEffect(() => {
    let current = true; setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    for (const key of ['q', 'kind', 'status', 'bookId', 'connectionId'] as const) if (filters[key]) params.set(key, filters[key]);
    if (filters.start) params.set('from', String(new Date(`${filters.start}T00:00:00+08:00`).getTime()));
    if (filters.end) params.set('to', String(new Date(`${filters.end}T00:00:00+08:00`).getTime() + 86_400_000));
    api<{ items: Note[]; total: number }>(`/notes?${params}`).then((r) => { if (current) { setResult(r); setError(''); } }).catch((e) => { if (current) setError(message(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [filters, page, revision]);
  async function open(id: number) { try { setDetail(await api(`/notes/${id}`)); } catch (e) { setError(message(e)); } }
  return <><form className="panel filters" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as typeof filters; if (values.connectionId !== filters.connectionId) values.bookId = ''; setFilters(values); setPage(1); }}>
    <label className="search-field">关键词<input name="q" placeholder="搜索想法、原文、书名或作者" defaultValue={filters.q} /></label>
    <label>笔记类型<select name="kind" defaultValue=""><option value="">全部笔记</option><option value="highlight">划线</option><option value="thought">想法</option></select></label>
    <label>来源状态<select name="status" defaultValue=""><option value="">全部状态</option>{Object.entries(noteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>书籍<select name="bookId" key={filters.connectionId} defaultValue=""><option value="">全部书籍</option>{books.map((b) => <option key={b.book_id} value={b.book_id}>{b.title || '书名缺失'}</option>)}</select></label>
    <label>开始日期<input name="start" type="date" /></label><label>结束日期<input name="end" type="date" /></label>
    <label>数据空间<select name="connectionId" defaultValue=""><option value="">当前连接</option>{connections.filter((c) => c.provider === 'weread').map((c) => <option value={c.id} key={c.id}>{c.enabled ? '当前' : '历史'} · {date(c.created_at)} · {c.id.slice(0, 6)}</option>)}</select></label>
    <button type="submit">应用筛选</button><small className="filter-hint">按来源创建日期筛选，北京时间，包含首尾两天。</small></form><Alert>{error}</Alert>
    <div className="section-heading"><h2>{filters.kind === 'thought' ? '我的想法' : filters.kind === 'highlight' ? '我的划线' : '全部笔记'} <small>{result?.total ?? '—'} 条</small></h2><span className="muted" role="status">{loading ? '加载中…' : '最近记录在前'}</span></div>
    {!result?.items.length ? <div className="panel empty"><span className="empty-icon">▤</span><h3>{loading ? '正在读取笔记' : '这里还没有笔记'}</h3><p>同步阅读数据，或调整筛选条件，再来看看。</p></div> : <div className="note-grid">{result.items.map((note) => <button className="note-card" key={note.id} onClick={() => void open(note.id)}><div className="note-meta"><span className={`note-kind ${note.kind}`}>{note.kind === 'thought' ? '想法' : '划线'}</span><time>{date(note.source_created_at)}</time></div>{note.status !== 'active' && <p className="notice">{noteLabels[note.status]}</p>}{note.content && <p className="thought-text clamp">{note.content}</p>}{note.original_text ? <blockquote className="clamp">{note.original_text}</blockquote> : <p className="muted">接口未提供对应原文</p>}<div className="note-book"><span className="book-icon">▥</span><div><strong>{note.title || '书名缺失'}</strong><small>{note.author || '作者缺失'} · {note.chapter_name || '章节缺失'}</small></div><span>↗</span></div></button>)}</div>}
    <div className="pagination"><span>第 {page} / {Math.max(1, Math.ceil((result?.total ?? 0) / 20))} 页</span><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>上一页</button><button disabled={!result || page * 20 >= result.total || loading} onClick={() => setPage(page + 1)}>下一页</button></div>
    {detail && <Modal title={detail.kind === 'thought' ? '想法详情' : '划线详情'} close={() => setDetail(undefined)}><p className="muted">{date(detail.source_created_at)} · 北京时间</p><p className="notice">来源状态：{noteLabels[detail.status]}{detail.source_error_code && ` · ${messages[detail.source_error_code] ?? detail.source_error_code}`}</p>{detail.first_missing_at && <p className="muted">首次发现缺失：{date(detail.first_missing_at)} · 连续有效核对缺失 {detail.missing_scans} 次{detail.removed_at && ` · 标记删除：${date(detail.removed_at)}`}</p>}{detail.content && <><h3>我的想法</h3><p className="preserve">{detail.content}</p></>}<h3>标记的原文</h3><blockquote className="preserve">{detail.original_text || '接口未提供原文'}</blockquote><dl><dt>书籍</dt><dd>{detail.title || '缺失'}</dd><dt>作者</dt><dd>{detail.author || '缺失'}</dd><dt>章节</dt><dd>{detail.chapter_name || '缺失'}</dd><dt>来源 ID</dt><dd>{detail.source_id}</dd><dt>首次入库</dt><dd>{date(detail.first_seen_at)}</dd><dt>本地更新</dt><dd>{date(detail.updated_at)}</dd></dl><details><summary>查看接口原始字段</summary><pre>{JSON.stringify(JSON.parse(detail.raw_json), null, 2)}</pre></details></Modal>}
  </>;
}
function Settings({ connections, refresh, logout, busy }: { connections: Connection[]; refresh: () => Promise<void>; logout: () => Promise<void>; busy: boolean }) {
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>, provider: string) {
    event.preventDefault(); setSaving(true); setError(''); setNotice(''); const form = event.currentTarget; const values = new FormData(form);
    try { await api('/connections', { provider, secret: values.get('secret'), confirmReplace: values.has('confirmReplace') }); form.reset(); setNotice(provider === 'weread' ? '微信读书连接已保存并通过只读检查。可以立即同步。' : 'flomo 地址已加密保存，未发送任何笔记。'); await refresh(); } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }
  async function password(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(''); try { await api('/auth/password', Object.fromEntries(new FormData(event.currentTarget))); await logout(); } catch (e) { setError(message(e)); } finally { setSaving(false); } }
  return <><Alert>{error}</Alert>{notice && <p role="status" className="notice">{notice}</p>}<div className="settings-grid">{(['weread', 'flomo'] as const).map((provider) => { const connection = connections.find((c) => c.provider === provider && c.enabled); return <section className="panel settings-card" key={provider}><div className="section-heading"><h2>{provider === 'weread' ? '微信读书' : 'flomo'}</h2><span className={`badge ${connection ? 'succeeded' : ''}`}>{connection ? '已配置' : '未配置'}</span></div><p className="muted">{provider === 'weread' ? '读取你有权访问的划线、想法和书籍信息。' : '保存导入使用的专属 API 地址。可在规则页筛选并预览，保存地址本身不发送。'}</p>{connection && <p className="config-date">配置于 {date(connection.created_at)} · 密钥不回显</p>}<form onSubmit={(e) => void save(e, provider)}><label>{provider === 'weread' ? '微信读书 API Key' : 'flomo 专属 API 地址'}<input name="secret" type="password" required autoComplete="off" placeholder={connection ? '输入新的凭据以更换连接' : '粘贴你的专属凭据'} /></label>{connection && <label className="check"><input name="confirmReplace" type="checkbox" />确认更换连接{provider === 'weread' && '，保留旧数据并建立独立空间'}</label>}<button disabled={saving || busy}>{saving ? '正在处理…' : provider === 'weread' ? '检查并保存连接' : '保存地址'}</button></form></section>; })}
    <section className="panel settings-card password-card"><h2>管理员密码</h2><p className="muted">修改后所有设备会退出登录。</p><form onSubmit={(e) => void password(e)}><label>当前密码<input type="password" name="currentPassword" required autoComplete="current-password" /></label><label>新密码<input type="password" name="password" minLength={12} maxLength={256} required autoComplete="new-password" /></label><button disabled={saving}>修改密码并退出</button></form></section></div><p className="footnote">凭据在数据库中加密存储。备份时需要同时保管数据目录和独立的主密钥。自动同步和导入可在“自动任务”页面设置。</p></>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = document.querySelector<HTMLDialogElement>('dialog'); dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return <dialog className="dialog" aria-label={title} onCancel={close}><div className="dialog-heading"><h2>{title}</h2><button autoFocus aria-label="关闭详情" onClick={close}>×</button></div><div className="dialog-body">{children}</div></dialog>;
}
function RunDetail({ run, close, revision }: { run: Run; close: () => void; revision: number }) {
  const [data, setData] = useState<{ run: Run; items: { book_id: string; title: string | null; kind: string; status: string; count: number; error_code: string | null }[] }>();
  const [error, setError] = useState('');
  useEffect(() => { let current = true; api<typeof data>(`/runs/${run.id}`).then((r) => { if (current) setData(r); }).catch((e) => { if (current) setError(message(e)); }); return () => { current = false; }; }, [run.id, revision]);
  const coverage = JSON.parse(data?.run.coverage_json ?? '{}') as { expectedBooks?: number; listComplete?: boolean };
  return <Modal title="同步详情" close={close}><Alert>{error}</Alert><p><span className={`badge ${data?.run.status ?? run.status}`}>{statusText[data?.run.status ?? run.status]}</span> {date(run.started_at)}</p><p>书籍列表：{coverage.listComplete ? '遍历完成' : '未完成'} · 计划读取 {coverage.expectedBooks ?? '—'} 本书</p>{data?.run.error_code && <Alert>{messages[data.run.error_code] ?? data.run.error_code}</Alert>}<p className="muted">完成表示本次可返回数据已保存，不代表已确认来源删除情况。</p><div className="scope-list">{data?.items.map((item) => <div key={`${item.book_id}:${item.kind}`}><span>{item.title || `书籍 ${item.book_id}`} · {item.kind === 'highlight' ? '划线' : item.kind === 'thought' ? '想法' : '书籍信息'}</span><strong className={item.status === 'failed' ? 'error-text' : ''}>{item.status === 'failed' ? messages[item.error_code ?? ''] ?? item.error_code : `${item.count} 条`}</strong></div>)}</div></Modal>;
}

createRoot(document.getElementById('root')!).render(<App />);
