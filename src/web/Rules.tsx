import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date, message, type Connection } from './api';
import { defaultRule, reasonLabels, type Rule, type RuleConfig, type Preview } from '../shared/rules';

const stateLabel = (rule: Rule) => rule.enabled ? '已启用' : rule.activatedAt === null ? '草稿' : '已停用';
const toggle = <T,>(items: T[], value: T) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

export function Rules({ connections, revision }: { connections: Connection[]; revision: number }) {
  const source = connections.find((c) => c.provider === 'weread' && c.enabled)?.id ?? '';
  const destination = connections.find((c) => c.provider === 'flomo' && c.enabled)?.id ?? '';
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Rule>();
  const [config, setConfig] = useState<RuleConfig>(() => defaultRule(source, destination));
  const [preview, setPreview] = useState<Preview>();
  const [view, setView] = useState<'matched' | 'excluded' | 'eligible'>('matched');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => { const result = await api<{ items: Rule[] }>('/rules'); setRules(result.items); }, []);
  useEffect(() => { void refresh().catch((e) => setError(message(e))); }, [refresh, revision]);
  useEffect(() => {
    setPreview(undefined); generation.current++;
  }, [config.sourceConnectionId, revision]);
  function change(next: RuleConfig) { setConfig(next); setPreview(undefined); setNotice(''); setConfirmed(false); generation.current++; }
  function filters(next: Partial<RuleConfig['filters']>) { change({ ...config, filters: { ...config.filters, ...next } }); }
  function open(rule?: Rule, copy = false) {
    setEditing(copy ? undefined : rule);
    setConfig(rule ? { ...rule.config, name: copy ? `${rule.config.name.slice(0, 95)} 副本` : rule.config.name } : defaultRule(source, destination));
    setPreview(undefined); setError(''); setNotice(''); setConfirmed(false); setView('matched'); generation.current++;
  }
  function input() { return { ...config, output: { ...config.output, tags: config.output.tags.filter((tag) => tag.trim()) } }; }
  async function save(enabled: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      const rule = await api<Rule>(editing ? `/rules/${editing.id}` : '/rules', { config: input(), enabled, ...(editing ? { revision: editing.revision } : {}), confirmHistory: confirmed });
      setEditing(rule); setConfig(rule.config); setPreview(undefined); setConfirmed(false); generation.current++;
      setNotice(`规则已保存 · ${stateLabel(rule)} · 修订 ${rule.revision}。自动导入启用后，后台会按已启用规则处理。`);
      await refresh();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function inspect(page = 1, nextView = view) {
    const token = ++generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<Preview>('/rules/preview', { config: input(), ...(editing ? { id: editing.id, revision: editing.revision } : {}), page, view: nextView });
      if (token === generation.current) { setPreview(result); setView(nextView); }
    } catch (e) { if (token === generation.current) setError(message(e)); } finally { setBusy(false); }
  }
  const unavailable = !config.sourceConnectionId || !config.destinationId;
  return <div className="rules-workspace">
    <p className="notice">先筛选，再预览。保存规则后，在“自动任务”页启用导入或先准备队列查看内容。</p>
    {!destination && <p className="alert">请先在设置中保存 flomo 专属 API 地址。</p>}
    <section className="panel rules-list" aria-label="已保存的规则"><div className="section-heading"><h2>我的规则 <small>{rules.length} 条</small></h2><button disabled={busy} onClick={() => open()}>新建规则</button></div>
      {!rules.length && <p className="muted">还没有规则。用下面的编辑器创建第一条。</p>}
      {rules.map((rule) => <div className="rule-row" key={rule.id}><div><strong>{rule.config.name}</strong><small>{stateLabel(rule)} · 修订 {rule.revision} · {rule.config.history === 'new_only' ? '仅新增' : '包含历史'}{rule.config.sourceConnectionId !== source || rule.config.destinationId !== destination ? ' · 历史连接' : ''}</small></div><button disabled={busy} onClick={() => open(rule)}>编辑</button><button disabled={busy} onClick={() => open(rule, true)}>复制</button></div>)}
    </section>
    <form className="panel rule-editor" onSubmit={(e) => { e.preventDefault(); void save(editing?.enabled ?? false); }}>
      <div className="section-heading"><h2>{editing ? '编辑规则' : '新建导入规则'}</h2><span className="muted">{editing ? `${stateLabel(editing)} · 修订 ${editing.revision}` : '尚未保存'}</span></div>
      <fieldset disabled={busy}><legend>基本设置</legend><div className="rule-grid">
        <label>规则名称<input value={config.name} required maxLength={100} onChange={(e) => change({ ...config, name: e.target.value })} /></label>
        <label>规则时区<input value={config.timezone} required list="rule-timezones" onChange={(e) => change({ ...config, timezone: e.target.value })} /><datalist id="rule-timezones"><option value="Asia/Shanghai" /><option value="UTC" /><option value="America/New_York" /><option value="Europe/London" /></datalist><small>有效 IANA 时区；默认北京时间。</small></label>
        <label>来源连接<select value={config.sourceConnectionId} disabled={!!editing} onChange={(e) => change({ ...config, sourceConnectionId: e.target.value })}><option value="">请选择微信读书连接</option>{connections.filter((c) => c.provider === 'weread').map((c) => <option key={c.id} value={c.id} disabled={!c.enabled}>{c.enabled ? '当前' : '历史'}微信读书 · {date(c.created_at)}</option>)}</select></label>
        <label>目标连接<select value={config.destinationId} disabled={!!editing} onChange={(e) => change({ ...config, destinationId: e.target.value })}><option value="">请选择 flomo 连接</option>{connections.filter((c) => c.provider === 'flomo').map((c) => <option key={c.id} value={c.id} disabled={!c.enabled}>{c.enabled ? '当前' : '历史'} flomo · 已保存地址</option>)}</select></label>
      </div></fieldset>
      <fieldset disabled={busy}><legend>筛选条件</legend><p className="muted">各项条件同时满足才命中；留空表示不限制。关键词是字面量，英文字母不区分大小写。</p>
        <div className="rule-checks">{(['highlight', 'thought'] as const).map((kind) => <label className="check" key={kind}><input type="checkbox" checked={config.filters.kinds.includes(kind)} onChange={() => filters({ kinds: toggle(config.filters.kinds, kind) })} />{kind === 'highlight' ? '划线' : '想法'}</label>)}</div>
        <div className="rule-grid"><label>来源开始日期<input type="date" value={config.filters.startDate} onChange={(e) => filters({ startDate: e.target.value })} /></label><label>来源结束日期<input type="date" value={config.filters.endDate} onChange={(e) => filters({ endDate: e.target.value })} /></label>
          <label>关键词搜索范围<select value={config.filters.keywordFields.length === 2 ? 'both' : config.filters.keywordFields[0]} onChange={(e) => filters({ keywordFields: e.target.value === 'both' ? ['content', 'original_text'] : [e.target.value as 'content' | 'original_text'] })}><option value="both">想法正文与原文</option><option value="content">仅想法正文</option><option value="original_text">仅原文</option></select></label>
          <label>包含词组合<select value={config.filters.includeMode} onChange={(e) => filters({ includeMode: e.target.value as 'any' | 'all' })}><option value="any">命中任意一个词</option><option value="all">命中全部词</option></select></label>
          <label>包含关键词<textarea rows={3} value={config.filters.include.join('\n')} onChange={(e) => filters({ include: e.target.value.split('\n') })} placeholder="每行一个词" /></label><label>排除关键词<textarea rows={3} value={config.filters.exclude.join('\n')} onChange={(e) => filters({ exclude: e.target.value.split('\n') })} placeholder="每行一个词；任意命中即排除" /></label>
        </div><p className="muted">日期包含首尾两天，按规则时区计算。有日期条件时，缺少来源时间的笔记不匹配。书籍和作者均不限制。</p>
      </fieldset>
      <fieldset disabled={busy}><legend>导入内容</legend>
        <p className="muted">固定格式：《书名》 作者 · 章节，下一行展示引用原文，有想法时再展示“📝 想法：正文”。模块间不额外加空行，保留正文自身换行；不附加创建时间。</p>
        <p>自动书名标签：<code>#微信读书/书名</code></p>
        <p className="muted">书名中的空白转换为下划线，标签中的 # 和 / 也转换为下划线；正文中的书名保留原样。</p>
        <label>额外 flomo 标签<textarea rows={2} value={config.output.tags.join('\n')} onChange={(e) => change({ ...config, output: { ...config.output, tags: e.target.value.split('\n') } })} placeholder="可选，每行一个标签，不含空格；支持 阅读/想法" /></label>
        <p className="muted">缺少书名、作者、章节或原文时会明确标注；没有想法正文就省略想法段。划线与想法分别生成一条笔记，可能包含相同原文。预览保留全文；发送前会校验自动任务页设置的字数保护上限。</p>
      </fieldset>
      <fieldset disabled={busy}><legend>历史处理范围</legend>
        <label>处理范围<select value={config.history} disabled={editing?.activatedAt != null} onChange={(e) => change({ ...config, history: e.target.value as RuleConfig['history'] })}><option value="new_only">只处理启用后新发现的笔记</option><option value="include_history">包含当前历史及后续匹配笔记</option></select></label>
        <p className="muted">启用前必须完成一轮完整同步。“新增”按基准之后首次入库的来源 ID 判断，不按书里的创建日期判断。停用再启用保留原基准；已启用过的规则若要更换处理范围，请复制为新规则。</p>
        {editing?.activatedAt != null && <p className="muted">基准建立于 {date(editing.activatedAt)}。更换连接不会沿用此基准。</p>}
        {config.history === 'include_history' && editing?.activatedAt == null && <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我确认将匹配的历史笔记纳入处理范围（自动导入启用后会发送）</label>}
      </fieldset>
      {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <div className="rule-actions"><button type="button" disabled={busy || unavailable} onClick={() => void inspect()}>预览匹配与导入文本</button><button type="submit" disabled={busy || unavailable}>{editing ? '保存修改' : '保存草稿'}</button><button type="button" className="primary" disabled={busy || unavailable || (!editing?.enabled && config.history === 'include_history' && editing?.activatedAt == null && !confirmed)} onClick={() => void save(!editing?.enabled)}>{editing?.enabled ? '保存并停用' : '保存并启用'}</button></div>
    </form>
    {preview && <section className="panel rule-preview" aria-label="导入预览"><div className="section-heading"><h2>导入预览</h2><small>{date(preview.snapshotAt)} 的本地快照</small></div>
      <p className="preview-counts">共 {preview.total} 条 · 条件命中 {preview.matched} 条 · 纳入范围 {preview.eligible} 条 · 条件不符 {preview.excluded} 条</p>
      {preview.baselinePending && <p className="notice">当前展示条件匹配样例。启用后才建立新增基准，当前已入库笔记不会纳入新增范围。</p>}
      <p className="muted">这是单条规则的内容与范围预览，不代表已发送或跨规则去重后的发送数量。草稿及停用规则不会执行；是否执行由“自动任务”页的导入开关控制。</p>
      {Object.keys(preview.reasons).length > 0 && <ul className="reason-list">{Object.entries(preview.reasons).map(([reason, count]) => <li key={reason}>{reasonLabels[reason] ?? reason}：{count} 条</li>)}</ul>}
      <label>查看结果<select disabled={busy} value={view} onChange={(e) => void inspect(1, e.target.value as typeof view)}><option value="matched">条件命中的笔记</option><option value="eligible">纳入处理范围的笔记</option><option value="excluded">条件不符的笔记</option></select></label>
      {!preview.items.length && <p className="empty">此视图没有笔记，可以调整条件后重新预览。</p>}
      {preview.items.map((item) => <article key={item.id} className="preview-note"><div className="section-heading"><strong>{item.title || '书名缺失'}</strong><span className="note-kind">{item.kind === 'thought' ? '想法' : '划线'}</span></div><p className="muted">{item.author || '作者缺失'} · {item.chapter_name || '章节缺失'}</p><p>{item.reasons.length ? item.reasons.map((reason) => reasonLabels[reason]).join('；') : '满足所有条件，并已纳入所选处理范围'}</p>
        {item.missing.length > 0 && <p className="error-text">缺失字段：{item.missing.join('、')}</p>}
        <details open><summary>导入文本 · {Array.from(item.text).length} 个字符</summary><div className="preview-text">{item.blocks.map((block, index) => <p className="preview-block" key={index}>{block}</p>)}</div></details>
      </article>)}
      <div className="pagination"><span>第 {preview.page} / {preview.pageTotal} 页</span><button disabled={busy || preview.page <= 1} onClick={() => void inspect(preview.page - 1)}>上一页</button><button disabled={busy || preview.page >= preview.pageTotal} onClick={() => void inspect(preview.page + 1)}>下一页</button></div>
    </section>}
  </div>;
}
