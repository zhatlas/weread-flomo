export type AutomationConfig = {
  syncEnabled: boolean; deliveryEnabled: boolean; schedule: 'interval' | 'daily';
  intervalMinutes: number; dailyTime: string; timezone: string; syncMode: 'full' | 'light';
  dailyLimit: number; maxContentChars: number;
};
export type Job = { name: 'sync' | 'deliver'; next_due_at: number | null; started_at: number | null; finished_at: number | null; last_result: string | null; error_code: string | null; failures: number };
export type AutomationState = { blocks: { sync: string | null; deliver: string | null }; recoveryRequired: boolean; startupSyncPending: boolean; config: AutomationConfig; revision: number; jobs: Job[]; busy: boolean; usedQuota: number; counts: Record<string, number> };
export type Delivery = { id: number; note_id: number; destination_id: string; status: string; source_hold: string | null; content: string; matched_rules_json: string; created_at: number; updated_at: number; next_attempt_at: number | null; sent_at: number | null; remote_id: string | null; error_code: string | null; retries: number; title: string | null; kind: string };
export const deliveryLabels: Record<string, string> = { held: '来源待复核', queued: '待发送', sending: '发送中', sent: '已导入', retry: '等待重试', uncertain: '待核对', blocked: '已阻塞', cancelled: '已取消' };

export const deliveryState = (delivery: Delivery) => delivery.source_hold && ['queued','retry','blocked'].includes(delivery.status) ? 'held' : delivery.status;
