import { t, i18n } from './i18n';
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
  PASSWORD_CHANGED: "The password changed while this request was running. Sign in again.",
  PAGINATION_LIMIT: "The page limit was reached. This read stopped without assuming the remaining data is empty.",
  UPSTREAM_BOOK_MISMATCH: "The API returned a note for a different book. This read was stopped.",
  UPSTREAM_DUPLICATE: "The API returned duplicate book records. This read was stopped.",
  UPSTREAM_HTTP: "The upstream HTTP request failed. Try again later.",

  NETWORK_ERROR: 'Connection interrupted. Check that the service is running.',
  INTERNAL_ERROR: 'The server could not complete this request. Try again later.',

  AUTOMATION_VALIDATION: "Check the time, interval, character limit and request quota. Sync intervals must be at least 5 minutes.",
  AUTOMATION_CONFLICT: "Settings changed. Reload before continuing.", SEND_CONFIRM: "Confirm delivery to flomo using enabled rules first.",
  DELIVERY_STATE: "Task state changed. Reopen its details.", FLOMO_RATE_LIMIT: "flomo requested a lower request rate. A retry has been scheduled.",
  FLOMO_CONNECT: "Connection was not established. Retrying with backoff.", FLOMO_AUTH: "flomo rejected authentication or permissions. Delivery is paused.",
  FLOMO_REJECTED: "flomo rejected the request. Check permissions, content or quota before retrying.", FLOMO_RESPONSE: "The response cannot confirm success. Check flomo first.",
  FLOMO_UNCERTAIN: "Delivery could not be confirmed. Check flomo first; no automatic resend will occur.", SEND_INTERRUPTED: "Delivery was interrupted and may have succeeded. Review it manually.",
  RETRY_EXHAUSTED: "The limit of 5 automatic attempts was reached. Review before manually resuming.", CONTENT_LIMIT: "Content is empty or exceeds this app's character limit. Blocked without truncation.",
  LOCAL_QUOTA: "This app's rolling 24-hour request quota is exhausted. Waiting for capacity.", RULE_NO_MATCH: "No enabled rule matches, or the connection is disabled.",
  RESTART_REVIEW: "Service restarted and delivery paused. Review the queue and confirm delivery again.", CONNECTION_CHANGED: "Connection changed and automation paused. Review rules and schedules.",
  BACKUP_REVIEW: "The delivery checkpoint is missing or inconsistent with the database. Delivery is locked; review the backup restore and sent-note history.",
  SOURCE_MISSING: "A thought is missing for the first time. Delivery is paused until the next complete check.", SOURCE_REMOVED: "A thought is missing in two consecutive complete checks. Deletion has been inferred.",
  SOURCE_UNAVAILABLE: "Source read failed. Delivery is paused until a successful check.", SOURCE_UNVERIFIED: "The source does not provide a complete count. Deletion is not inferred and delivery is paused.",
  SOURCE_ANOMALY: "Many notes are missing or several books became empty. Deletion inference and related delivery are paused; check the source.", SOURCE_NOT_READY: "The source has not recovered. Complete a sync check before retrying delivery.",
  UPSTREAM_COUNT_MISMATCH: "Source counts differ from pagination results. Deletion is not inferred and affected thoughts are paused.",
  SYNC_PARTIAL: "Some scopes failed in this run. Sync will retry with backoff.", MANUALLY_CONFIRMED: "Reviewed by the administrator and marked as sent.",
  RULE_VALIDATION: "Check the rule name, filters and tag format. Refresh an outdated page before retrying.",
  RULE_DATE: "Invalid date or time zone. The start date cannot follow the end date.",
  RULE_CONNECTION: "Rules need valid WeRead and flomo connections. Both must be current when enabling a rule.",
  RULE_IDENTITY: "A saved rule cannot change connections. Copy it into a new rule first.",
  RULE_HISTORY_LOCKED: "A rule with an established baseline cannot change history scope. Copy it first.",
  RULE_BASELINE: "Complete a successful full sync before enabling rules. The latest run must have no failures or interruptions.",
  RULE_HISTORY_CONFIRM: "Explicitly confirm inclusion of matching historical notes.",
  RULE_CONFLICT: "The rule changed elsewhere or was disabled after a connection change. Reopen it to edit.",
  VALIDATION: "Check your input. Passwords must be at least 12 characters.", LOGIN_FAILED: "Incorrect username or password.",
  SETUP_TOKEN_INVALID: "Incorrect setup token. Check its file location in the server startup log.", ALREADY_INITIALIZED: "An administrator already exists. Refresh and sign in.",
  UNAUTHORIZED: "Your session expired. Sign in again.", ORIGIN_DENIED: "The access address differs from APP_ORIGIN. Use the configured address.", CSRF_DENIED: "Session verification failed. Refresh and try again.",
  RATE_LIMIT: "Too many requests. Try again later.", SYNC_BUSY: "A sync or connection check is running. Try again later.", CONNECTION_REQUIRED: "Configure a WeRead connection first.",
  KEY_FORMAT: "Invalid API Key format. It must start with wrk-.", WEBHOOK_FORMAT: "Enter the personal HTTPS API URL provided by flomo.",
  REPLACE_CONFIRMATION: "Confirm connection replacement. Existing notes will remain in their original data space.",
  UPSTREAM_AUTH: "WeRead credentials are no longer valid. Configure the connection again.", UPSTREAM_FORMAT: "Unexpected API response format. Existing data was preserved.",
  UPSTREAM_NETWORK: "Cannot connect to WeRead. Try again later.", UPSTREAM_RATE_LIMIT: "WeRead requested a lower request rate. Try again later.",
  UPSTREAM_UNAVAILABLE: "WeRead is temporarily unavailable.", UPSTREAM_REJECTED: "WeRead rejected the request. Check credentials and API permissions.",
  UPSTREAM_UPGRADE: "WeRead requires a client upgrade. Wait for a compatible application update.", UPSTREAM_TOO_LARGE: "A response exceeded 32 MiB. It was not truncated or saved; check the task.",
  PAGINATION_STALLED: "API pagination did not advance. This read was stopped.", PAGINATION_DUPLICATE: "API pagination returned duplicate records. This read was stopped.",
  SYNC_INTERRUPTED: "Sync was interrupted. You can sync again.", NOT_FOUND: "Record not found.",
};
export const message = (error: unknown) => error instanceof ApiError ? error.code : 'NETWORK_ERROR';
export const errorMessage = (code?: string | null) => code ? t(messages[code] ?? 'Operation incomplete ({{value0}})', { value0: code }) : '';
export const date = (timestamp?: number | null) => timestamp == null ? t("No timestamp") : new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(timestamp);
export const statusText: Record<string, string> = { running: "Syncing", succeeded: "Read complete", partial: "Partially failed", failed: "Read failed", interrupted: "Interrupted" };
export type Connection = { id: string; provider: 'weread' | 'flomo'; enabled: number; created_at: number };
export type Run = { mode: 'full' | 'light'; id: string; connection_id: string; status: string; started_at: number; finished_at: number | null; error_code: string | null; coverage_json: string; counts_json: string };
export type Overview = { running: boolean; stats: { total: number; highlights: number; thoughts: number; books: number }; runs: Run[] };
export type Note = { id: number; kind: 'highlight' | 'thought'; content: string | null; original_text: string | null; chapter_name: string | null; source_created_at: number | null; title: string | null; author: string | null; status: string; missing_scans: number; first_missing_at: number | null; removed_at: number | null; source_error_code: string | null };

export const noteLabels: Record<string, string> = { active: "Active", missing: "Possibly deleted, pending review", removed: "Deleted (inferred from sync)", unavailable: "Source cannot be checked" };
