import { z } from 'zod';

const words = z.array(z.string().trim().max(200)).max(100).transform((items) => [...new Set(items.filter(Boolean))]);
export const ruleConfigSchema = z.strictObject({
  schemaVersion: z.literal(2),
  name: z.string().trim().min(1).max(100),
  sourceConnectionId: z.string().uuid(),
  destinationId: z.string().uuid(),
  timezone: z.string().trim().min(1).max(100),
  history: z.enum(['new_only', 'include_history']),
  filters: z.strictObject({
    kinds: z.array(z.enum(['highlight', 'thought'])).max(2),
    startDate: z.string().regex(/^(|\d{4}-\d{2}-\d{2})$/),
    endDate: z.string().regex(/^(|\d{4}-\d{2}-\d{2})$/),
    keywordFields: z.array(z.enum(['content', 'original_text'])).min(1).max(2),
    include: words,
    includeMode: z.enum(['any', 'all']),
    exclude: words,
  }),
  output: z.strictObject({
    tags: z.array(z.string().trim().transform((tag) => tag.replace(/^#/, '')).pipe(z.string().min(1).max(64).regex(/^[^\s#]+$/))).max(20),
  }),
});
export type RuleConfig = z.infer<typeof ruleConfigSchema>;
export type Rule = {
  id: string; config: RuleConfig; enabled: boolean; revision: number;
  baselineRunId: string | null; baselineNoteId: number | null; activatedAt: number | null;
  createdAt: number; updatedAt: number;
};
export type PreviewItem = {
  id: number; kind: 'highlight' | 'thought'; title: string | null; author: string | null;
  content: string | null; original_text: string | null; chapter_name: string | null;
  source_created_at: number | null; matched: boolean; eligible: boolean;
  reasons: string[]; missing: string[]; blocks: string[]; text: string;
};
export type Preview = {
  total: number; matched: number; eligible: number; excluded: number;
  reasons: Record<string, number>; items: PreviewItem[]; page: number; pageTotal: number;
  baselineAt: number | null; baselinePending: boolean; snapshotAt: number;
};
export function defaultRule(sourceConnectionId = '', destinationId = ''): RuleConfig {
  return { schemaVersion: 2, name: '新的导入规则', sourceConnectionId, destinationId, timezone: 'Asia/Shanghai', history: 'new_only',
    filters: { kinds: [], startDate: '', endDate: '', keywordFields: ['content', 'original_text'], include: [], includeMode: 'any', exclude: [] },
    output: { tags: [] } };
}
export const reasonLabels: Record<string, string> = {
  SOURCE_REMOVED: "Deleted (inferred from sync)", SOURCE_MISSING: "Possibly deleted, pending review", SOURCE_UNAVAILABLE: "Source cannot be checked",
  INACTIVE: "Source record unavailable", KIND: "Note type does not match",
  TIME_MISSING: "Source creation time missing", DATE: "Outside date range", EXCLUDE: "Excluded keyword matched", INCLUDE: "Include keywords do not match",
  BEFORE_ACTIVATION: "New-note baseline not yet established", EXISTING_NOTE: "Saved before the baseline",
};
