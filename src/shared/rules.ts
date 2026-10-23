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
  SOURCE_REMOVED: '已删除（同步推断）', SOURCE_MISSING: '疑似删除，待复核', SOURCE_UNAVAILABLE: '来源暂无法核对',
  INACTIVE: '来源记录不可用', KIND: '类型不符',
  TIME_MISSING: '来源创建时间缺失', DATE: '不在日期范围内', EXCLUDE: '命中排除词', INCLUDE: '未满足包含词条件',
  BEFORE_ACTIVATION: '尚未建立新增基准', EXISTING_NOTE: '基准之前已入库',
};
