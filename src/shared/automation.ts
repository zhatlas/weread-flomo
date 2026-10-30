export type AutomationConfig = {
  syncEnabled: boolean; deliveryEnabled: boolean; schedule: 'interval' | 'daily';
  intervalMinutes: number; dailyTime: string; timezone: string; syncMode: 'full' | 'light';
  dailyLimit: number; maxContentChars: number;
};
export type Job = { name: 'sync' | 'deliver'; next_due_at: number | null; started_at: number | null; finished_at: number | null; last_result: string | null; error_code: string | null; failures: number };
export type AutomationState = { blocks: { sync: string | null; deliver: string | null }; recoveryRequired: boolean; startupSyncPending: boolean; config: AutomationConfig; revision: number; jobs: Job[]; busy: boolean; usedQuota: number; counts: Record<string, number> };
export type Delivery = { id: number; note_id: number; destination_id: string; status: string; source_hold: string | null; content: string; matched_rules_json: string; created_at: number; updated_at: number; next_attempt_at: number | null; sent_at: number | null; remote_id: string | null; error_code: string | null; retries: number; title: string | null; kind: string };
export const deliveryLabels: Record<string, string> = { held: "Source review pending", queued: "Queued", sending: "Sending", sent: "Sent", retry: "Waiting to retry", uncertain: "Needs review", blocked: "Blocked", cancelled: "Cancelled" };

export const deliveryState = (delivery: Delivery) => delivery.source_hold && ['queued','retry','blocked'].includes(delivery.status) ? 'held' : delivery.status;
