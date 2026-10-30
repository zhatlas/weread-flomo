import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { t } from './i18n';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, date, message, errorMessage, setCsrf, statusText, noteLabels, type Connection, type Note, type Overview, type Run } from './api';
import { Rules } from './Rules';
import { Automation } from './Automation';
import './style.css';

type Auth = { initialized: boolean; authenticated: boolean; csrf?: string; username?: string };
const Brand = () => <div className="brand"><span className="brand-mark" aria-hidden="true">{t("Read")}</span><div>WeRead <span className="arrow">→</span> flomo<small>{t("Keep your reading close")}</small></div></div>;
function Alert({ children }: { children: string }) { return children ? <p role="alert" className="alert">{errorMessage(children)}</p> : null; }
function App() {
  useTranslation();
  const [auth, setAuth] = useState<Auth>();
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { const state = await api<Auth>('/auth/state'); setCsrf(state.csrf ?? ''); setAuth(state); setError(''); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { void load(); const expired = () => { setCsrf(''); setAuth({ initialized: true, authenticated: false }); }; window.addEventListener('session-expired', expired); return () => window.removeEventListener('session-expired', expired); }, [load]);
  if (!auth) return <div className="auth-shell"><LanguageSwitcher /><Brand /><p>{t("Connecting to your reading library…")}</p><Alert>{error}</Alert>{error && <button onClick={() => void load()}>{t("Retry")}</button>}</div>;
  return auth.authenticated ? <Workspace username={auth.username ?? t("Administrator")} logout={load} /> : <AuthForm initialized={auth.initialized} onDone={load} />;
}
function AuthForm({ initialized, onDone }: { initialized: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    try { await api(`/auth/${initialized ? 'login' : 'setup'}`, values); form.reset(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="auth-shell"><LanguageSwitcher /><Brand /><div className="auth-card"><p className="eyebrow">{t("YOUR READING, KEPT CLOSE")}</p><h1>{initialized ? t("Welcome back to your library") : t("Create your reading library")}</h1><p className="muted">{initialized ? t("Sign in to keep the words worth remembering.") : t("Create the sole administrator. Notes and credentials stay on your own server.")}</p>
    <form onSubmit={submit}>{!initialized && <label>{t("Setup token")}<input name="setupToken" type="password" required autoComplete="off" /><small>{t("Read the setup token from the location shown in the server startup log.")}</small></label>}
      <label>{t("Administrator username")}<input name="username" required maxLength={80} autoComplete="username" /></label>
      <label>{t("Password")}<input name="password" type="password" required minLength={12} maxLength={256} autoComplete={initialized ? 'current-password' : 'new-password'} /><small>{t("At least 12 characters.")}</small></label>
      <Alert>{error}</Alert><button className="primary full" disabled={busy}>{busy ? t("Verifying…") : initialized ? t("Sign in") : t("Create administrator")}</button></form></div><p className="auth-foot">{t("Self-hosted · Your data, your control · MIT licensed")}</p></div>;
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
  const titles = { overview: [t("Reading overview"), t("Every rereading starts here.")], notes: [t("Library"), t("Keep passages and your own thoughts together.")], rules: [t("Import rules"), t("Choose the notes to keep and preview what will reach flomo.")], automation: [t("Automation and imports"), t("Keep new notes according to your rules.")], settings: [t("Connections and settings"), t("Connect your reading sources and manage your data.")] };
  return <div className="workspace"><aside className="sidebar"><Brand /><div className="workspace-label">{t("PERSONAL READING SPACE")}</div><nav aria-label={t("Main navigation")}>{(['overview', 'notes', 'rules', 'automation', 'settings'] as const).map((item, index) => <button key={item} className={page === item ? 'nav-item selected' : 'nav-item'} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}><span aria-hidden="true">{['◫', '▤', '☷', '↻', '⚙'][index]}</span>{[t("Overview"), t("Library"), t("Rules"), t("Automation"), t("Settings")][index]}{item === 'notes' && <small>{overview?.stats.total ?? '—'}</small>}</button>)}</nav><div className="sidebar-bottom"><span className="dot" />  {t("Local data · Private collection")}<small>{t("M3 · Automation and imports")}</small></div></aside>
    <div className="main-area"><header className="topbar"><span>{t("My reading space")} <span className="slash">/</span> {titles[page][0]}</span><div><LanguageSwitcher /><span className="avatar">{username.slice(0, 1).toUpperCase()}</span><span className="username">{username}</span><button className="text-button" onClick={async () => { try { await api('/auth/logout', {}); await logout(); } catch (e) { setError(message(e)); } }}>{t("Sign out")}</button></div></header>
      <main><div className="page-heading"><div><p className="eyebrow">{t("THE READING ROOM")}</p><h1>{titles[page][0]}</h1><p className="muted">{titles[page][1]}</p></div><button className="primary" disabled={!active || overview?.running || starting} onClick={() => void synchronize()}>{overview?.running ? t("Syncing…") : starting ? t("Starting…") : t("↻  Sync now")}</button></div><Alert>{error}</Alert>
        {page === 'overview' && <><div className="hero"><div><span className="pill">{t("Reading sparks ideas")}</span><h2>{t("The words you read")}<br />{t("become your own thoughts.")}</h2><p>{t("Collect highlights and thoughts, and rediscover your reading.")}</p><button className="outline" onClick={() => setPage(active ? 'notes' : 'settings')}>{active ? t("Open library") : t("Connect WeRead")}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></button></div><div className="book-art" aria-hidden="true"><div className="book-spine"/><div className="book-cover"><small>{t("READ")}<br />{t("THINK")}<br />{t("KEEP.")}</small><span>{t("Every page")}<br />{t("leaves a trace")}</span><i>{t("READING NOTES / 01")}</i></div><div className="book-shadow" /></div></div>
          <div className="stats">{[[t("All notes"), overview?.stats.total], [t("Highlights"), overview?.stats.highlights], [t("Thoughts"), overview?.stats.thoughts], [t("Books with notes"), overview?.stats.books]].map(([title, value], i) => <div className="stat" key={title}><span>{title}</span><strong>{value ?? '—'}<small>{t(i === 3 ? 'bookUnit' : 'noteUnit', { count: Number(value) })}</small></strong></div>)}</div>
          <div className="section-heading"><h2>{t("Sync activity")}</h2><span className="muted">{t("Read tasks · Current connection")}</span></div><div className="panel">{!active ? <div className="empty"><span className="empty-icon">↔</span><h3>{t("Start with a connection")}</h3><p>{t("Add your WeRead API Key, then sync to browse your notes.")}</p><button onClick={() => setPage('settings')}>{t("Configure connection")}</button></div> : !overview?.runs.length ? <div className="empty"><h3>{t("Connection ready")}</h3><p>{t("Click “Sync now” to save accessible highlights and thoughts locally.")}</p></div> : <div className="run-list">{overview.runs.map((item) => <button key={item.id} className="run-row" onClick={() => setRun(item)}><span className={`run-icon ${item.status}`}>{item.status === 'succeeded' ? '✓' : item.status === 'running' ? '↻' : '!'}</span><span><strong>{t("WeRead ·")} {item.mode === 'light' ? t("Light scan") : t("Full scan")}</strong><small>{date(item.started_at)} · {item.connection_id === active.id ? t("Current connection") : t("Previous connection")}</small></span><span className={`badge ${item.status}`}>{t(statusText[item.status] ?? item.status)}</span><span aria-hidden="true">›</span></button>)}</div>}</div><p className="footnote">{t("Sync updates your local library. A first missing thought pauses its import; two complete checks infer deletion. Missing highlights are retained. Preview rules on the Rules page and configure schedules and delivery on the Automation page.")}</p></>}
        {page === 'notes' && <Notes connections={connections} revision={revision} />}
        {page === 'automation' && <Automation />}
        {page === 'rules' && <Rules connections={connections} revision={revision} />}
        {page === 'settings' && <Settings connections={connections} refresh={refresh} logout={logout} busy={!!overview?.running} />}
      </main><footer>WeRead → flomo <span>{t("Keep your reading close")}</span></footer></div>{run && <RunDetail run={run} close={() => setRun(undefined)} revision={revision} />}</div>;
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
    <label className="search-field">{t("Keywords")}<input name="q" placeholder={t("Search thoughts, passages, books or authors")} defaultValue={filters.q} /></label>
    <label>{t("Note type")}<select name="kind" defaultValue=""><option value="">{t("All notes")}</option><option value="highlight">{t("Highlights")}</option><option value="thought">{t("Thoughts")}</option></select></label>
    <label>{t("Source status")}<select name="status" defaultValue=""><option value="">{t("All statuses")}</option>{Object.entries(noteLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
    <label>{t("Book")}<select name="bookId" key={filters.connectionId} defaultValue=""><option value="">{t("All books")}</option>{books.map((b) => <option key={b.book_id} value={b.book_id}>{b.title || t("Missing book title")}</option>)}</select></label>
    <label>{t("Start date")}<input name="start" type="date" /></label><label>{t("End date")}<input name="end" type="date" /></label>
    <label>{t("Data space")}<select name="connectionId" defaultValue=""><option value="">{t("Current connection")}</option>{connections.filter((c) => c.provider === 'weread').map((c) => <option value={c.id} key={c.id}>{c.enabled ? t("Current") : t("Previous")} · {date(c.created_at)} · {c.id.slice(0, 6)}</option>)}</select></label>
    <button type="submit">{t("Apply filters")}</button><small className="filter-hint">{t("Filter by source creation date in Beijing time, including both dates.")}</small></form><Alert>{error}</Alert>
    <div className="section-heading"><h2>{filters.kind === 'thought' ? t("My thoughts") : filters.kind === 'highlight' ? t("My highlights") : t("All notes")} <small>{result ? t('noteCount', { count: result.total }) : '—'}</small></h2><span className="muted" role="status">{loading ? t("Loading…") : t("Newest first")}</span></div>
    {!result?.items.length ? <div className="panel empty"><span className="empty-icon">▤</span><h3>{loading ? t("Loading notes") : t("No notes yet")}</h3><p>{t("Sync your reading data or adjust the filters to see notes here.")}</p></div> : <div className="note-grid">{result.items.map((note) => <button className="note-card" key={note.id} onClick={() => void open(note.id)}><div className="note-meta"><span className={`note-kind ${note.kind}`}>{note.kind === 'thought' ? t("Thoughts") : t("Highlights")}</span><time>{date(note.source_created_at)}</time></div>{note.status !== 'active' && <p className="notice">{t(noteLabels[note.status] ?? note.status)}</p>}{note.content && <p className="thought-text clamp">{note.content}</p>}{note.original_text ? <blockquote className="clamp">{note.original_text}</blockquote> : <p className="muted">{t("The API did not provide the corresponding passage.")}</p>}<div className="note-book"><span className="book-icon">▥</span><div><strong>{note.title || t("Missing book title")}</strong><small>{note.author || t("Missing author")} · {note.chapter_name || t("Missing chapter")}</small></div><span>↗</span></div></button>)}</div>}
    <div className="pagination"><span>{t('Page {{page}} of {{total}}', { page, total: Math.max(1, Math.ceil((result?.total ?? 0) / 20)) })}</span><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>{t("Previous")}</button><button disabled={!result || page * 20 >= result.total || loading} onClick={() => setPage(page + 1)}>{t("Next")}</button></div>
    {detail && <Modal title={detail.kind === 'thought' ? t("Thought details") : t("Highlight details")} close={() => setDetail(undefined)}><p className="muted">{date(detail.source_created_at)}  {t("· Beijing time")}</p><p className="notice">{t("Source status:")}{t(noteLabels[detail.status] ?? detail.status)}{detail.source_error_code && ` · ${errorMessage(detail.source_error_code)}`}</p>{detail.first_missing_at && <p className="muted">{t("First missing:")}{date(detail.first_missing_at)}  {t("· Consecutive complete checks with missing data:")} {detail.missing_scans}  {t("checks")}{detail.removed_at && t(" · Marked deleted: {{value0}}", { value0: date(detail.removed_at) })}</p>}{detail.content && <><h3>{t("My thoughts")}</h3><p className="preserve">{detail.content}</p></>}<h3>{t("Highlighted passage")}</h3><blockquote className="preserve">{detail.original_text || t("The API did not provide a passage.")}</blockquote><dl><dt>{t("Book")}</dt><dd>{detail.title || t("Missing")}</dd><dt>{t("Author")}</dt><dd>{detail.author || t("Missing")}</dd><dt>{t("Chapter")}</dt><dd>{detail.chapter_name || t("Missing")}</dd><dt>{t("Source ID")}</dt><dd>{detail.source_id}</dd><dt>{t("First saved")}</dt><dd>{date(detail.first_seen_at)}</dd><dt>{t("Updated locally")}</dt><dd>{date(detail.updated_at)}</dd></dl><details><summary>{t("View original API fields")}</summary><pre>{JSON.stringify(JSON.parse(detail.raw_json), null, 2)}</pre></details></Modal>}
  </>;
}
function Settings({ connections, refresh, logout, busy }: { connections: Connection[]; refresh: () => Promise<void>; logout: () => Promise<void>; busy: boolean }) {
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>, provider: string) {
    event.preventDefault(); setSaving(true); setError(''); setNotice(''); const form = event.currentTarget; const values = new FormData(form);
    try { await api('/connections', { provider, secret: values.get('secret'), confirmReplace: values.has('confirmReplace') }); form.reset(); setNotice(provider === 'weread' ? "WeRead connection saved and verified with a read-only check. You can sync now." : "flomo address encrypted and saved. No notes were sent."); await refresh(); } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }
  async function password(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(''); try { await api('/auth/password', Object.fromEntries(new FormData(event.currentTarget))); await logout(); } catch (e) { setError(message(e)); } finally { setSaving(false); } }
  return <><Alert>{error}</Alert>{notice && <p role="status" className="notice">{t(notice)}</p>}<div className="settings-grid">{(['weread', 'flomo'] as const).map((provider) => { const connection = connections.find((c) => c.provider === provider && c.enabled); return <section className="panel settings-card" key={provider}><div className="section-heading"><h2>{provider === 'weread' ? t("WeRead") : 'flomo'}</h2><span className={`badge ${connection ? 'succeeded' : ''}`}>{connection ? t("Configured") : t("Not configured")}</span></div><p className="muted">{provider === 'weread' ? t("Read the highlights, thoughts and book information you can access.") : t("Save your personal API address for imports. Filter and preview on the Rules page; saving an address sends nothing.")}</p>{connection && <p className="config-date">{t("Configured on")} {date(connection.created_at)}  {t("· Credentials are not displayed")}</p>}<form onSubmit={(e) => void save(e, provider)}><label>{provider === 'weread' ? t("WeRead API Key") : t("flomo API URL")}<input name="secret" type="password" required autoComplete="off" placeholder={connection ? t("Enter new credentials to replace this connection") : t("Paste your personal credentials")} /></label>{connection && <label className="check"><input name="confirmReplace" type="checkbox" />{t("Confirm connection replacement")}{provider === 'weread' && t("; keep existing data in a separate space")}</label>}<button disabled={saving || busy}>{saving ? t("Processing…") : provider === 'weread' ? t("Check and save connection") : t("Save address")}</button></form></section>; })}
    <section className="panel settings-card password-card"><h2>{t("Administrator password")}</h2><p className="muted">{t("Changing your password signs out all devices.")}</p><form onSubmit={(e) => void password(e)}><label>{t("Current password")}<input type="password" name="currentPassword" required autoComplete="current-password" /></label><label>{t("New password")}<input type="password" name="password" minLength={12} maxLength={256} required autoComplete="new-password" /></label><button disabled={saving}>{t("Change password and sign out")}</button></form></section></div><p className="footnote">{t("Credentials are encrypted in the database. Keep both the data directory and the separate master key when backing up. Configure background sync and imports on the Automation page.")}</p></>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = document.querySelector<HTMLDialogElement>('dialog'); dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return <dialog className="dialog" aria-label={title} onCancel={close}><div className="dialog-heading"><h2>{title}</h2><button autoFocus aria-label={t("Close details")} onClick={close}>×</button></div><div className="dialog-body">{children}</div></dialog>;
}
function RunDetail({ run, close, revision }: { run: Run; close: () => void; revision: number }) {
  const [data, setData] = useState<{ run: Run; items: { book_id: string; title: string | null; kind: string; status: string; count: number; error_code: string | null }[] }>();
  const [error, setError] = useState('');
  useEffect(() => { let current = true; api<typeof data>(`/runs/${run.id}`).then((r) => { if (current) setData(r); }).catch((e) => { if (current) setError(message(e)); }); return () => { current = false; }; }, [run.id, revision]);
  const coverage = JSON.parse(data?.run.coverage_json ?? '{}') as { expectedBooks?: number; listComplete?: boolean };
  type Item = NonNullable<typeof data>['items'][number];
  const books = new Map<string, { title: string; items: Map<string, Item> }>();
  for (const item of data?.items ?? []) {
    const book = books.get(item.book_id) ?? { title: item.title || t("Book {{value0}}", { value0: item.book_id }), items: new Map<string, Item>() };
    book.items.set(item.kind, item);
    books.set(item.book_id, book);
  }
  const result = (item?: Item) => !item ? t('Not read') : item.status === 'failed' ? item.error_code ? errorMessage(item.error_code) : t('Read failed') : t('noteCount', { count: item.count });
  return <Modal title={t("Sync details")} close={close}><Alert>{error}</Alert><p><span className={`badge ${data?.run.status ?? run.status}`}>{t(statusText[data?.run.status ?? run.status] ?? data?.run.status ?? run.status)}</span> {date(run.started_at)}</p><p>{t("Book list:")}{coverage.listComplete ? t("Complete") : t("Incomplete")}  {t("· Planned:")} {coverage.expectedBooks ?? '—'}  {t("books")}</p>{data?.run.error_code && <Alert>{data.run.error_code}</Alert>}<p className="muted">{t("Completed means the data returned in this run was saved; it does not confirm source deletions.")}</p><div className="scope-list sync-books">{[...books].map(([id, book]) => <div key={id}><span>{book.title}</span><strong>{(['highlight', 'thought', ...(book.items.has('metadata') ? ['metadata'] : [])]).map((kind, index) => <span key={kind}>{index > 0 && t('commaSeparator')}<span className={book.items.get(kind)?.status === 'failed' ? 'error-text' : ''}>{kind === 'highlight' ? t("Highlights") : kind === 'thought' ? t("Thoughts") : t("Book metadata")} {result(book.items.get(kind))}</span></span>)}</strong></div>)}</div></Modal>;
}

createRoot(document.getElementById('root')!).render(<App />);
