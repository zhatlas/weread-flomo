import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date, message, messages } from './api';
import { deliveryLabels, deliveryState, type AutomationState, type Delivery } from '../shared/automation';

type Detail = { delivery: Delivery; attempts: { id: number; started_at: number; outcome: string; error_code: string | null; http_status: number | null; content: string }[] };
export function Automation() {
  const loadSequence = useRef(0);
  const [state, setState] = useState<AutomationState>();
  const [draft, setDraft] = useState<AutomationState['config']>();
  const [revision, setRevision] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [result, setResult] = useState<{ items: Delivery[]; total: number; page: number }>();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<Detail>();
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const [s, r] = await Promise.all([api<AutomationState>('/automation'), api<typeof result>(`/deliveries?page=${page}${filter ? `&status=${filter}` : ''}`)]);
    if (sequence === loadSequence.current) { setState(s); setResult(r); }
    return s;
  }, [page, filter]);
  useEffect(() => { let current = true; const load = () => { if (current) void refresh().catch((e) => { if (current) setError(message(e)); }); }; load(); const timer = setInterval(load, 5000); return () => { current = false; clearInterval(timer); }; }, [refresh]);
  useEffect(() => { if (state && !draft) { setDraft(state.config); setRevision(state.revision); } }, [state, draft]);
  function adopt(s: AutomationState) { setState(s); setDraft(s.config); setRevision(s.revision); setConfirmed(false); }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { const s = await api<AutomationState>('/automation', { config: draft, revision, confirmSend: confirmed }); adopt(s); setNotice('自动任务设置已保存。关闭浏览器后，后台仍会按设置运行。'); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function acknowledgeRecovery() {
    setBusy(true); setError('');
    try { adopt(await api<AutomationState>('/automation/recovery', { confirm: recoveryConfirmed })); setRecoveryConfirmed(false); setNotice('已解除恢复保护，启用的导入将在完整同步成功后继续。'); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setNotice('');
    try { await api('/deliveries/prepare', {}); await refresh(); setNotice('队列已按当前规则更新。准备队列本身不发送；已启用自动导入时后台会继续处理。'); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function open(id: number) { try { setDetail(await api(`/deliveries/${id}`)); setResolved(false); } catch (e) { setError(message(e)); } }
  async function resolve(action: 'mark_sent' | 'retry') {
    if (!detail) return;
    setBusy(true); setError('');
    try { setDetail(await api(`/deliveries/${detail.delivery.id}/resolve`, { action, confirm: resolved })); setResolved(false); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (!state || !draft) return <p role="status">{error || '正在加载自动任务…'}</p>;
  const sync = state.jobs.find((job) => job.name === 'sync'); const send = state.jobs.find((job) => job.name === 'deliver');
  return <div className="rules-workspace">
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {state.recoveryRequired && <section className="panel" aria-label="备份恢复保护"><h2>备份恢复保护</h2><p className="alert">数据库与独立发送检查记录不一致，或通过恢复工具还原了备份。自动导入已锁定；普通保存设置不能解除。</p><p>旧备份可能缺少后来已导入的记录。请先在 flomo 核对，并调整规则范围，排除可能重复的历史笔记。解除后，已启用的自动导入会在完整同步成功后继续。</p><label className="check"><input type="checkbox" checked={recoveryConfirmed} onChange={(e) => setRecoveryConfirmed(e.target.checked)} />我已核对 flomo 历史记录并排除可能重复的笔记</label><button disabled={busy || !recoveryConfirmed} onClick={() => void acknowledgeRecovery()}>确认核对，解除恢复保护</button></section>}
    <section className="panel rule-editor"><div className="section-heading"><h2>自动任务设置</h2><span className="muted">服务器后台运行</span></div>
      <p className="muted">默认关闭。同步只更新本地库；自动导入会把已启用规则选中的笔记发送到你保存的 flomo 地址。</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
        <label className="check"><input type="checkbox" checked={draft.syncEnabled} onChange={(e) => setDraft({ ...draft, syncEnabled: e.target.checked })} />启用自动同步微信读书</label>
        <div className="rule-grid">
          <label>运行方式<select value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value as 'interval' | 'daily' })}><option value="interval">每隔一段时间</option><option value="daily">每天指定时刻</option></select></label>
          {draft.schedule === 'interval' ? <label>同步间隔（分钟）<input type="number" min={5} max={10080} required value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} /></label> : <label>每天运行时间<input type="time" required value={draft.dailyTime} onChange={(e) => setDraft({ ...draft, dailyTime: e.target.value })} /></label>}
          <label>任务时区<input required value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
          <label>读取模式<select value={draft.syncMode} onChange={(e) => setDraft({ ...draft, syncMode: e.target.value as 'full' | 'light' })}><option value="full">每次完整读取（推荐）</option><option value="light">轻量检查＋每 24 小时完整读取</option></select></label>
        </div><p className="muted">轻量模式根据笔记本概览变化选择书籍，可能延迟发现未反映在概览中的修改或删除；待复核和无法核对的想法所在书籍会强制重查。手动“立即同步”始终完整读取。任务不重叠；错过多次计划时只补一次。</p>
        <label className="check"><input type="checkbox" checked={draft.deliveryEnabled} onChange={(e) => { setDraft({ ...draft, deliveryEnabled: e.target.checked }); setConfirmed(false); }} />启用按规则自动导入 flomo</label>
        <div className="rule-grid"><label>本应用每 24 小时请求上限<input type="number" min={1} max={100} required value={draft.dailyLimit} onChange={(e) => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></label><label>本应用单条字数保护上限<input type="number" min={1} max={100000} required value={draft.maxContentChars} onChange={(e) => setDraft({ ...draft, maxContentChars: Number(e.target.value) })} /></label></div>
        <p className="muted">所有写入尝试计入滚动 24 小时额度，至少间隔 5 秒；其他工具的用量不可见。字数上限是本应用保护值，不代表官方限制；超限会阻塞，不截断。明确未发送的失败最多自动尝试 5 次；超时及不明确结果需人工核对。</p>
        {draft.deliveryEnabled && (!state.config.deliveryEnabled || state.blocks.deliver) && <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我确认按已启用规则向 flomo 发送，包含规则中已确认纳入的历史笔记</label>}
        <p className="muted">启用设置会保留，设备重启后自动恢复。每次启动后，导入前先完整同步微信读书；结果不确定的笔记单独待核对，其他正常任务继续。恢复旧备份时需核对后解除保护。暂停不会撤回已发出的请求。</p>
        {revision !== state.revision && <p className="alert">设置已在后台或其他页面变更，请先重新载入。</p>}
        <div className="rule-actions"><button className="primary" disabled={busy || (draft.deliveryEnabled && ((!state.config.deliveryEnabled || !!state.blocks.deliver) && !confirmed || state.recoveryRequired))}>保存自动任务设置</button><button type="button" disabled={busy} onClick={() => { adopt(state); setError(''); }}>重新载入设置</button></div>
      </fieldset></form>
    </section>
    <section className="panel rules-list"><h2>运行状态</h2><div className="scope-list">
      <div><span>自动同步：{!state.config.syncEnabled ? '已关闭' : state.blocks.sync ? '已启用，运行暂停' : '已启用'} · 下次：{sync?.next_due_at ? date(sync.next_due_at) : '未安排'}</span><span>最近完成：{date(sync?.finished_at)} {sync?.error_code && (messages[sync.error_code] ?? sync.error_code)}</span></div>
      <div><span>自动导入：{!state.config.deliveryEnabled ? '已关闭' : state.blocks.deliver ? '已启用，运行暂停' : state.startupSyncPending ? '已启用，等待完整同步' : '已启用'} · 下次检查：{send?.next_due_at ? date(send.next_due_at) : '未安排'}</span><span>{(state.blocks.deliver || send?.error_code) && (messages[state.blocks.deliver || send!.error_code!] ?? state.blocks.deliver ?? send?.error_code)}</span></div>
      <div><span>最近 24 小时写入尝试</span><strong>{state.usedQuota} / {state.config.dailyLimit}</strong></div>
    </div></section>
    <section className="panel rule-preview" aria-label="导入记录"><div className="section-heading"><h2>导入记录</h2><button disabled={busy} onClick={() => void prepare()}>按规则准备队列</button></div>
      <p className="muted">同一笔记到同一目标只保留一个任务。多规则命中时，使用最早创建的规则生成文本；列表详情保留所有命中规则。想法首次缺失会暂停任务，连续两次完整核对仍缺失则取消；已导入笔记不会因来源删除而更改，也不会因重复同步再次发送。</p>
      <p className="preview-counts">{Object.entries(deliveryLabels).map(([key, label]) => `${label} ${state.counts[key] ?? 0}`).join(' · ')}</p>
      <label>导入状态<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="">全部状态</option>{Object.entries(deliveryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {!result?.items.length && <p className="empty">暂无此类任务。启用规则后，可先准备队列查看内容。</p>}
      {result?.items.map((item) => <article className="preview-note" key={item.id}><div className="section-heading"><strong>{item.title || '书名缺失'} · {item.kind === 'thought' ? '想法' : '划线'}</strong><span className="badge">{deliveryLabels[deliveryState(item)]}</span></div><p className="muted">更新于 {date(item.updated_at)}{item.next_attempt_at ? ` · 下次尝试 ${date(item.next_attempt_at)}` : ''}</p>{item.source_hold && <p className="notice">{messages[item.source_hold] ?? item.source_hold}</p>}{item.error_code && <p className="error-text">{messages[item.error_code] ?? item.error_code}</p>}<p className="clamp preserve">{item.content}</p><button onClick={() => void open(item.id)}>查看导入详情 #{item.id}</button></article>)}
      <div className="pagination"><span>第 {page} / {Math.max(1, Math.ceil((result?.total ?? 0) / 20))} 页</span><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button disabled={page * 20 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>
    {detail && <section className="panel rule-preview" aria-label="导入详情"><div className="section-heading"><h2>任务 #{detail.delivery.id} · {deliveryLabels[deliveryState(detail.delivery)]}</h2><button onClick={() => setDetail(undefined)}>关闭导入详情</button></div><pre className="delivery-content">{detail.delivery.content}</pre><p className="muted">命中规则：{(JSON.parse(detail.delivery.matched_rules_json) as { name: string; revision: number }[]).map((r) => `${r.name}（修订 ${r.revision}）`).join('、')}</p>
      {detail.delivery.source_hold && <p className="notice">{messages[detail.delivery.source_hold] ?? detail.delivery.source_hold}</p>}{!detail.delivery.source_hold && ['uncertain','blocked','retry'].includes(detail.delivery.status) && <><label className="check"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />我已在 flomo 核对这条笔记；允许重试可能产生重复笔记</label><div className="rule-actions">{detail.delivery.status === 'uncertain' && <button disabled={!resolved || busy} onClick={() => void resolve('mark_sent')}>已在 flomo 找到，标记完成</button>}<button disabled={!resolved || busy} onClick={() => void resolve('retry')}>确认未导入，允许重试</button></div><p className="muted">允许重试仅恢复队列。仍需启用自动导入，并遵守额度、退避和当前规则。</p></>}
      <h3>尝试记录</h3>{!detail.attempts.length && <p className="muted">尚未发起写入请求。</p>}{detail.attempts.map((attempt) => <details key={attempt.id}><summary>{date(attempt.started_at)} · {deliveryLabels[attempt.outcome] ?? attempt.outcome} {attempt.http_status ? `· HTTP ${attempt.http_status}` : ''} {attempt.error_code && (messages[attempt.error_code] ?? attempt.error_code)}</summary><pre className="delivery-content">{attempt.content}</pre></details>)}
    </section>}
  </div>;
}
