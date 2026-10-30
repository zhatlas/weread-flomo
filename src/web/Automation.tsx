import { t } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date, message, errorMessage } from './api';
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
    try { const s = await api<AutomationState>('/automation', { config: draft, revision, confirmSend: confirmed }); adopt(s); setNotice("Automation settings saved. Background tasks continue after you close the browser."); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function acknowledgeRecovery() {
    setBusy(true); setError('');
    try { adopt(await api<AutomationState>('/automation/recovery', { confirm: recoveryConfirmed })); setRecoveryConfirmed(false); setNotice("Recovery protection cleared. Enabled delivery will resume after a successful full sync."); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setNotice('');
    try { await api('/deliveries/prepare', {}); await refresh(); setNotice("Queue updated using current rules. Preparing the queue does not send notes; enabled automatic delivery will process it in the background."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function open(id: number) { try { setDetail(await api(`/deliveries/${id}`)); setResolved(false); } catch (e) { setError(message(e)); } }
  async function resolve(action: 'mark_sent' | 'retry') {
    if (!detail) return;
    setBusy(true); setError('');
    try { setDetail(await api(`/deliveries/${detail.delivery.id}/resolve`, { action, confirm: resolved })); setResolved(false); await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (!state || !draft) return <p role="status">{errorMessage(error) || t("Loading automation…")}</p>;
  const sync = state.jobs.find((job) => job.name === 'sync'); const send = state.jobs.find((job) => job.name === 'deliver');
  return <div className="rules-workspace">
    {error && <p role="alert" className="alert">{errorMessage(error)}</p>}{notice && <p role="status" className="notice">{t(notice)}</p>}
    {state.recoveryRequired && <section className="panel" aria-label={t("Backup recovery protection")}><h2>{t("Backup recovery protection")}</h2><p className="alert">{t("The database and independent delivery checkpoint disagree, or a backup was restored. Automatic delivery is locked; saving settings cannot unlock it.")}</p><p>{t("An old backup may omit notes sent later. Check flomo and adjust rule scopes to exclude possible duplicates. Once protection is cleared, enabled delivery resumes after a successful full sync.")}</p><label className="check"><input type="checkbox" checked={recoveryConfirmed} onChange={(e) => setRecoveryConfirmed(e.target.checked)} />{t("I have checked flomo history and excluded potentially duplicate notes")}</label><button disabled={busy || !recoveryConfirmed} onClick={() => void acknowledgeRecovery()}>{t("Confirm review and clear recovery protection")}</button></section>}
    <section className="panel rule-editor"><div className="section-heading"><h2>{t("Automation settings")}</h2><span className="muted">{t("Runs on your server")}</span></div>
      <p className="muted">{t("Off by default. Sync only updates the local library; automatic delivery sends notes selected by enabled rules to your saved flomo address.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
        <label className="check"><input type="checkbox" checked={draft.syncEnabled} onChange={(e) => setDraft({ ...draft, syncEnabled: e.target.checked })} />{t("Enable automatic WeRead sync")}</label>
        <div className="rule-grid">
          <label>{t("Schedule")}<select value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value as 'interval' | 'daily' })}><option value="interval">{t("At regular intervals")}</option><option value="daily">{t("At a daily time")}</option></select></label>
          {draft.schedule === 'interval' ? <label>{t("Sync interval (minutes)")}<input type="number" min={5} max={10080} required value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} /></label> : <label>{t("Daily run time")}<input type="time" required value={draft.dailyTime} onChange={(e) => setDraft({ ...draft, dailyTime: e.target.value })} /></label>}
          <label>{t("Schedule time zone")}<input required value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
          <label>{t("Read mode")}<select value={draft.syncMode} onChange={(e) => setDraft({ ...draft, syncMode: e.target.value as 'full' | 'light' })}><option value="full">{t("Full scan every time (recommended)")}</option><option value="light">{t("Light scans with a full scan every 24 hours")}</option></select></label>
        </div><p className="muted">{t("Light scans select books using notebook overview changes and may detect edits or deletions late. Books with thoughts pending review or unavailable sources are always checked again. “Sync now” always performs a full scan. Jobs never overlap; missed runs are caught up only once.")}</p>
        <label className="check"><input type="checkbox" checked={draft.deliveryEnabled} onChange={(e) => { setDraft({ ...draft, deliveryEnabled: e.target.checked }); setConfirmed(false); }} />{t("Enable rule-based automatic delivery to flomo")}</label>
        <div className="rule-grid"><label>{t("Requests per rolling 24 hours for this app")}<input type="number" min={1} max={100} required value={draft.dailyLimit} onChange={(e) => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></label><label>{t("Maximum characters per note for this app")}<input type="number" min={1} max={100000} required value={draft.maxContentChars} onChange={(e) => setDraft({ ...draft, maxContentChars: Number(e.target.value) })} /></label></div>
        <p className="muted">{t("All write attempts count toward the rolling 24-hour quota and are at least 5 seconds apart. Usage by other tools is unknown. The character limit is this app's safeguard, not an official limit; oversized notes are blocked, not truncated. Definitely unsent failures get up to 5 attempts; timeouts and ambiguous outcomes need manual review.")}</p>
        {draft.deliveryEnabled && (!state.config.deliveryEnabled || state.blocks.deliver) && <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("I confirm delivery to flomo using enabled rules, including explicitly selected historical notes")}</label>}
        <p className="muted">{t("Enabled settings persist across device restarts. Each startup requires a full WeRead sync before delivery. Uncertain notes wait for review while other tasks continue. Old backups require review before recovery protection is cleared. Pausing does not retract requests already sent.")}</p>
        {revision !== state.revision && <p className="alert">{t("Settings changed in the background or another page. Reload them first.")}</p>}
        <div className="rule-actions"><button className="primary" disabled={busy || (draft.deliveryEnabled && ((!state.config.deliveryEnabled || !!state.blocks.deliver) && !confirmed || state.recoveryRequired))}>{t("Save automation settings")}</button><button type="button" disabled={busy} onClick={() => { adopt(state); setError(''); }}>{t("Reload settings")}</button></div>
      </fieldset></form>
    </section>
    <section className="panel rules-list"><h2>{t("Run status")}</h2><div className="scope-list">
      <div><span>{t("Automatic sync:")}{!state.config.syncEnabled ? t("Off") : state.blocks.sync ? t("Enabled, paused") : t("Enabled")}  {t("· Next:")}{sync?.next_due_at ? date(sync.next_due_at) : t("Not scheduled")}</span><span>{t("Last completed:")}{date(sync?.finished_at)} {sync?.error_code && (errorMessage(sync.error_code))}</span></div>
      <div><span>{t("Automatic delivery:")}{!state.config.deliveryEnabled ? t("Off") : state.blocks.deliver ? t("Enabled, paused") : state.startupSyncPending ? t("Enabled, waiting for full sync") : t("Enabled")}  {t("· Next check:")}{send?.next_due_at ? date(send.next_due_at) : t("Not scheduled")}</span><span>{(state.blocks.deliver || send?.error_code) && (errorMessage(state.blocks.deliver || send!.error_code!))}</span></div>
      <div><span>{t("Write attempts in the last 24 hours")}</span><strong>{state.usedQuota} / {state.config.dailyLimit}</strong></div>
    </div></section>
    <section className="panel rule-preview" aria-label={t("Delivery history")}><div className="section-heading"><h2>{t("Delivery history")}</h2><button disabled={busy} onClick={() => void prepare()}>{t("Prepare queue from rules")}</button></div>
      <p className="muted">{t("Each note has one task per destination. If several rules match, the earliest rule formats the text; details retain every matching rule. A first missing thought pauses its task; two complete missing checks cancel it. Source deletion does not change sent notes, and repeated syncs do not resend them.")}</p>
      <p className="preview-counts">{Object.entries(deliveryLabels).map(([key, label]) => `${t(label)} ${state.counts[key] ?? 0}`).join(' · ')}</p>
      <label>{t("Delivery status")}<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="">{t("All statuses")}</option>{Object.entries(deliveryLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
      {!result?.items.length && <p className="empty">{t("No tasks of this type. Enable a rule, then prepare the queue to inspect its contents.")}</p>}
      {result?.items.map((item) => <article className="preview-note" key={item.id}><div className="section-heading"><strong>{item.title || t("Missing book title")} · {item.kind === 'thought' ? t("Thoughts") : t("Highlights")}</strong><span className="badge">{t(deliveryLabels[deliveryState(item)] ?? deliveryState(item))}</span></div><p className="muted">{t("Updated")} {date(item.updated_at)}{item.next_attempt_at ? t(" · Next attempt {{value0}}", { value0: date(item.next_attempt_at) }) : ''}</p>{item.source_hold && <p className="notice">{errorMessage(item.source_hold)}</p>}{item.error_code && <p className="error-text">{errorMessage(item.error_code)}</p>}<p className="clamp preserve">{item.content}</p><button onClick={() => void open(item.id)}>{t("View delivery #")}{item.id}</button></article>)}
      <div className="pagination"><span>{t('Page {{page}} of {{total}}', { page, total: Math.max(1, Math.ceil((result?.total ?? 0) / 20)) })}</span><button disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Previous")}</button><button disabled={page * 20 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)}>{t("Next")}</button></div>
    </section>
    {detail && <section className="panel rule-preview" aria-label={t("Delivery details")}><div className="section-heading"><h2>{t("Task #")}{detail.delivery.id} · {t(deliveryLabels[deliveryState(detail.delivery)] ?? deliveryState(detail.delivery))}</h2><button onClick={() => setDetail(undefined)}>{t("Close delivery details")}</button></div><pre className="delivery-content">{detail.delivery.content}</pre><p className="muted">{t("Matching rules:")}{(JSON.parse(detail.delivery.matched_rules_json) as { name: string; revision: number }[]).map((r) => t("{{value0}} (revision {{value1}})", { value0: r.name, value1: r.revision })).join(t('commaSeparator'))}</p>
      {detail.delivery.source_hold && <p className="notice">{errorMessage(detail.delivery.source_hold)}</p>}{!detail.delivery.source_hold && ['uncertain','blocked','retry'].includes(detail.delivery.status) && <><label className="check"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />{t("I checked this note in flomo; allowing a retry may create a duplicate")}</label><div className="rule-actions">{detail.delivery.status === 'uncertain' && <button disabled={!resolved || busy} onClick={() => void resolve('mark_sent')}>{t("Found in flomo: mark as sent")}</button>}<button disabled={!resolved || busy} onClick={() => void resolve('retry')}>{t("Confirmed not sent: allow retry")}</button></div><p className="muted">{t("Allowing a retry only restores the queue. Automatic delivery must still be enabled; quotas, backoff and current rules still apply.")}</p></>}
      <h3>{t("Attempt history")}</h3>{!detail.attempts.length && <p className="muted">{t("No write requests yet.")}</p>}{detail.attempts.map((attempt) => <details key={attempt.id}><summary>{date(attempt.started_at)} · {t(deliveryLabels[attempt.outcome] ?? ({ started: 'Started', failed: 'Failed' } as Record<string, string>)[attempt.outcome] ?? attempt.outcome) ?? attempt.outcome} {attempt.http_status ? `· HTTP ${attempt.http_status}` : ''} {attempt.error_code && (errorMessage(attempt.error_code))}</summary><pre className="delivery-content">{attempt.content}</pre></details>)}
    </section>}
  </div>;
}
