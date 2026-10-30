import { t } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date, message, errorMessage, type Connection } from './api';
import { defaultRule, reasonLabels, type Rule, type RuleConfig, type Preview } from '../shared/rules';

const stateLabel = (rule: Rule) => rule.enabled ? t("Enabled") : rule.activatedAt === null ? t("Draft") : t("Disabled");
const toggle = <T,>(items: T[], value: T) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

export function Rules({ connections, revision }: { connections: Connection[]; revision: number }) {
  const source = connections.find((c) => c.provider === 'weread' && c.enabled)?.id ?? '';
  const destination = connections.find((c) => c.provider === 'flomo' && c.enabled)?.id ?? '';
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Rule>();
  const [config, setConfig] = useState<RuleConfig>(() => ({ ...defaultRule(source, destination), name: t('New import rule') }));
  const [preview, setPreview] = useState<Preview>();
  const [view, setView] = useState<'matched' | 'excluded' | 'eligible'>('matched');
  const [error, setError] = useState('');
  const [savedRule, setSavedRule] = useState<Rule>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => { const result = await api<{ items: Rule[] }>('/rules'); setRules(result.items); }, []);
  useEffect(() => { void refresh().catch((e) => setError(message(e))); }, [refresh, revision]);
  useEffect(() => {
    setPreview(undefined); generation.current++;
  }, [config.sourceConnectionId, revision]);
  function change(next: RuleConfig) { setConfig(next); setPreview(undefined); setSavedRule(undefined); setConfirmed(false); generation.current++; }
  function filters(next: Partial<RuleConfig['filters']>) { change({ ...config, filters: { ...config.filters, ...next } }); }
  function open(rule?: Rule, copy = false) {
    setEditing(copy ? undefined : rule);
    setConfig(rule ? { ...rule.config, name: copy ? t("{{value0}} copy", { value0: rule.config.name.slice(0, 95) }) : rule.config.name } : ({ ...defaultRule(source, destination), name: t('New import rule') }));
    setPreview(undefined); setError(''); setSavedRule(undefined); setConfirmed(false); setView('matched'); generation.current++;
  }
  function input() { return { ...config, output: { ...config.output, tags: config.output.tags.filter((tag) => tag.trim()) } }; }
  async function save(enabled: boolean) {
    setBusy(true); setError(''); setSavedRule(undefined);
    try {
      const rule = await api<Rule>(editing ? `/rules/${editing.id}` : '/rules', { config: input(), enabled, ...(editing ? { revision: editing.revision } : {}), confirmHistory: confirmed });
      setEditing(rule); setConfig(rule.config); setPreview(undefined); setConfirmed(false); generation.current++;
      setSavedRule(rule);
      await refresh();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function inspect(page = 1, nextView = view) {
    const token = ++generation.current;
    setBusy(true); setError(''); setSavedRule(undefined);
    try {
      const result = await api<Preview>('/rules/preview', { config: input(), ...(editing ? { id: editing.id, revision: editing.revision } : {}), page, view: nextView });
      if (token === generation.current) { setPreview(result); setView(nextView); }
    } catch (e) { if (token === generation.current) setError(message(e)); } finally { setBusy(false); }
  }
  const unavailable = !config.sourceConnectionId || !config.destinationId;
  return <div className="rules-workspace">
    <p className="notice">{t("Filter, then preview. After saving rules, enable delivery on the Automation page or prepare the queue to inspect its contents.")}</p>
    {!destination && <p className="alert">{t("Save your flomo API URL in Settings first.")}</p>}
    <section className="panel rules-list" aria-label={t("Saved rules")}><div className="section-heading"><h2>{t("My rules")} <small>{t('ruleCount', { count: rules.length })}</small></h2><button disabled={busy} onClick={() => open()}>{t("New rule")}</button></div>
      {!rules.length && <p className="muted">{t("No rules yet. Create your first rule using the editor below.")}</p>}
      {rules.map((rule) => <div className="rule-row" key={rule.id}><div><strong>{rule.config.name}</strong><small>{stateLabel(rule)}  {t("· Revision")} {rule.revision} · {rule.config.history === 'new_only' ? t("New only") : t("Include history")}{rule.config.sourceConnectionId !== source || rule.config.destinationId !== destination ? t(" · Previous connection") : ''}</small></div><button disabled={busy} onClick={() => open(rule)}>{t("Edit")}</button><button disabled={busy} onClick={() => open(rule, true)}>{t("Copy")}</button></div>)}
    </section>
    <form className="panel rule-editor" onSubmit={(e) => { e.preventDefault(); void save(editing?.enabled ?? false); }}>
      <div className="section-heading"><h2>{editing ? t("Edit rule") : t("New import rule")}</h2><span className="muted">{editing ? t("{{value0}} · Revision {{value1}}", { value0: stateLabel(editing), value1: editing.revision }) : t("Not saved")}</span></div>
      <fieldset disabled={busy}><legend>{t("Basic settings")}</legend><div className="rule-grid">
        <label>{t("Rule name")}<input value={config.name} required maxLength={100} onChange={(e) => change({ ...config, name: e.target.value })} /></label>
        <label>{t("Rule time zone")}<input value={config.timezone} required list="rule-timezones" onChange={(e) => change({ ...config, timezone: e.target.value })} /><datalist id="rule-timezones"><option value="Asia/Shanghai" /><option value="UTC" /><option value="America/New_York" /><option value="Europe/London" /></datalist><small>{t("A valid IANA time zone; defaults to Beijing time.")}</small></label>
        <label>{t("Source connection")}<select value={config.sourceConnectionId} disabled={!!editing} onChange={(e) => change({ ...config, sourceConnectionId: e.target.value })}><option value="">{t("Select a WeRead connection")}</option>{connections.filter((c) => c.provider === 'weread').map((c) => <option key={c.id} value={c.id} disabled={!c.enabled}>{c.enabled ? t("Current") : t("Previous")}{t("WeRead ·")} {date(c.created_at)}</option>)}</select></label>
        <label>{t("Destination connection")}<select value={config.destinationId} disabled={!!editing} onChange={(e) => change({ ...config, destinationId: e.target.value })}><option value="">{t("Select a flomo connection")}</option>{connections.filter((c) => c.provider === 'flomo').map((c) => <option key={c.id} value={c.id} disabled={!c.enabled}>{c.enabled ? t("Current") : t("Previous")}  {t("flomo · Saved address")}</option>)}</select></label>
      </div></fieldset>
      <fieldset disabled={busy}><legend>{t("Filters")}</legend><p className="muted">{t("All conditions must match; empty fields impose no restriction. Keywords are literal text, case-insensitive for English letters.")}</p>
        <div className="rule-checks">{(['highlight', 'thought'] as const).map((kind) => <label className="check" key={kind}><input type="checkbox" checked={config.filters.kinds.includes(kind)} onChange={() => filters({ kinds: toggle(config.filters.kinds, kind) })} />{kind === 'highlight' ? t("Highlights") : t("Thoughts")}</label>)}</div>
        <div className="rule-grid"><label>{t("Source start date")}<input type="date" value={config.filters.startDate} onChange={(e) => filters({ startDate: e.target.value })} /></label><label>{t("Source end date")}<input type="date" value={config.filters.endDate} onChange={(e) => filters({ endDate: e.target.value })} /></label>
          <label>{t("Keyword search scope")}<select value={config.filters.keywordFields.length === 2 ? 'both' : config.filters.keywordFields[0]} onChange={(e) => filters({ keywordFields: e.target.value === 'both' ? ['content', 'original_text'] : [e.target.value as 'content' | 'original_text'] })}><option value="both">{t("Thoughts and passages")}</option><option value="content">{t("Thoughts only")}</option><option value="original_text">{t("Passages only")}</option></select></label>
          <label>{t("Include keyword mode")}<select value={config.filters.includeMode} onChange={(e) => filters({ includeMode: e.target.value as 'any' | 'all' })}><option value="any">{t("Match any keyword")}</option><option value="all">{t("Match all keywords")}</option></select></label>
          <label>{t("Include keywords")}<textarea rows={3} value={config.filters.include.join('\n')} onChange={(e) => filters({ include: e.target.value.split('\n') })} placeholder={t("One keyword per line")} /></label><label>{t("Exclude keywords")}<textarea rows={3} value={config.filters.exclude.join('\n')} onChange={(e) => filters({ exclude: e.target.value.split('\n') })} placeholder={t("One keyword per line; any match excludes the note")} /></label>
        </div><p className="muted">{t("Dates include both endpoints in the rule time zone. Notes without source dates do not match a date filter. Books and authors are unrestricted.")}</p>
      </fieldset>
      <fieldset disabled={busy}><legend>{t("Import content")}</legend>
        <p className="muted">{t("Fixed format: book title, author and chapter, followed by the quoted passage and a thought when present. No extra blank lines or creation dates are added; line breaks in the original content are preserved. The outgoing template stays in Chinese in either interface language.")}</p>
        <p>{t("Automatic book tag:")}<code>{t("#微信读书/Book_title")}</code></p>
        <p className="muted">{t("Whitespace, # and / in the book tag become underscores. The displayed book title stays unchanged.")}</p>
        <label>{t("Extra flomo tags")}<textarea rows={2} value={config.output.tags.join('\n')} onChange={(e) => change({ ...config, output: { ...config.output, tags: e.target.value.split('\n') } })} placeholder={t("Optional, one tag per line, no spaces; nested tags such as Reading/Thoughts are supported")} /></label>
        <p className="muted">{t("Missing titles, authors, chapters or passages are marked explicitly. Empty thoughts are omitted. Highlights and thoughts produce separate notes and may share a passage. Preview shows the full text; delivery checks the character limit configured on the Automation page.")}</p>
      </fieldset>
      <fieldset disabled={busy}><legend>{t("History scope")}</legend>
        <label>{t("Processing scope")}<select value={config.history} disabled={editing?.activatedAt != null} onChange={(e) => change({ ...config, history: e.target.value as RuleConfig['history'] })}><option value="new_only">{t("Only notes first discovered after activation")}</option><option value="include_history">{t("Include existing and future matching notes")}</option></select></label>
        <p className="muted">{t("A complete sync is required before activation. “New” means source IDs first saved after the baseline, regardless of creation dates in the book. Disabling and re-enabling preserves the baseline. Copy an activated rule to change its history scope.")}</p>
        {editing?.activatedAt != null && <p className="muted">{t("Baseline created on")} {date(editing.activatedAt)}{t(". Replacing a connection does not reuse this baseline.")}</p>}
        {config.history === 'include_history' && editing?.activatedAt == null && <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("I confirm that matching historical notes will be included and sent when automatic delivery is enabled")}</label>}
      </fieldset>
      {error && <p className="alert" role="alert">{errorMessage(error)}</p>}{savedRule && <p className="notice" role="status">{t('Rule saved · {{value0}} · Revision {{value1}}. Enabled rules will run when automatic delivery is enabled.', { value0: stateLabel(savedRule), value1: savedRule.revision })}</p>}
      <div className="rule-actions"><button type="button" disabled={busy || unavailable} onClick={() => void inspect()}>{t("Preview matches and import text")}</button><button type="submit" disabled={busy || unavailable}>{editing ? t("Save changes") : t("Save draft")}</button><button type="button" className="primary" disabled={busy || unavailable || (!editing?.enabled && config.history === 'include_history' && editing?.activatedAt == null && !confirmed)} onClick={() => void save(!editing?.enabled)}>{editing?.enabled ? t("Save and disable") : t("Save and enable")}</button></div>
    </form>
    {preview && <section className="panel rule-preview" aria-label={t("Import preview")}><div className="section-heading"><h2>{t("Import preview")}</h2><small>{t('Local snapshot at {{time}}', { time: date(preview.snapshotAt) })}</small></div>
      <p className="preview-counts">{t('Total {{total}} · Matching {{matched}} · In scope {{eligible}} · Excluded {{excluded}}', { total: preview.total, matched: preview.matched, eligible: preview.eligible, excluded: preview.excluded })}</p>
      {preview.baselinePending && <p className="notice">{t("These are matching examples. Activation creates the new-note baseline; notes already stored are not included in the new-note scope.")}</p>}
      <p className="muted">{t("This previews one rule's content and scope, not sent notes or the deduplicated delivery count across rules. Draft and disabled rules do not run. Delivery is controlled on the Automation page.")}</p>
      {Object.keys(preview.reasons).length > 0 && <ul className="reason-list">{Object.entries(preview.reasons).map(([reason, count]) => <li key={reason}>{t(reasonLabels[reason] ?? reason) ?? reason}：{count}  {t("notes")}</li>)}</ul>}
      <label>{t("View results")}<select disabled={busy} value={view} onChange={(e) => void inspect(1, e.target.value as typeof view)}><option value="matched">{t("Matching notes")}</option><option value="eligible">{t("Notes in scope")}</option><option value="excluded">{t("Excluded notes")}</option></select></label>
      {!preview.items.length && <p className="empty">{t("No notes in this view. Adjust the filters and preview again.")}</p>}
      {preview.items.map((item) => <article key={item.id} className="preview-note"><div className="section-heading"><strong>{item.title || t("Missing book title")}</strong><span className="note-kind">{item.kind === 'thought' ? t("Thoughts") : t("Highlights")}</span></div><p className="muted">{item.author || t("Missing author")} · {item.chapter_name || t("Missing chapter")}</p><p>{item.reasons.length ? item.reasons.map((reason) => t(reasonLabels[reason] ?? reason)).join(t('semicolonSeparator')) : t("Matches all conditions and is included in the selected scope")}</p>
        {item.missing.length > 0 && <p className="error-text">{t("Missing fields:")}{item.missing.map((field) => t(({ '原文': 'Passage', '书名': 'Book title', '作者': 'Author', '章节': 'Chapter', '创建时间': 'Creation time' } as Record<string, string>)[field] ?? field)).join(t('commaSeparator'))}</p>}
        <details open><summary>{t('Import text · {{count}} characters', { count: Array.from(item.text).length })}</summary><div className="preview-text">{item.blocks.map((block, index) => <p className="preview-block" key={index}>{block}</p>)}</div></details>
      </article>)}
      <div className="pagination"><span>{t('Page {{page}} of {{total}}', { page: preview.page, total: preview.pageTotal })}</span><button disabled={busy || preview.page <= 1} onClick={() => void inspect(preview.page - 1)}>{t("Previous")}</button><button disabled={busy || preview.page >= preview.pageTotal} onClick={() => void inspect(preview.page + 1)}>{t("Next")}</button></div>
    </section>}
  </div>;
}
