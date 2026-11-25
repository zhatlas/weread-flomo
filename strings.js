export const copy = {
  en: {
    title: 'Interactive demo', library: 'Reading library', notes: 'Notes', book: 'Book', kind: 'Type',
    intro: 'Explore fictional notes and preview how they would appear in flomo. All interactions stay in this browser.',
    search: 'Search', searchHint: 'Book, passage or thought', allBooks: 'All books', allKinds: 'All types',
    highlight: 'Highlight', thought: 'Thought', empty: 'No matching notes. Try another search or filter.',
    preview: 'flomo import preview', previewHint: 'Preview only. The demo uses fictional notes and never sends them to flomo.',
    noSelection: 'Select a matching note to see its import text.', count: n => n === 1 ? '1 note' : n + ' notes'
  },
  'zh-CN': {
    title: '互动演示', library: '阅读笔记库', notes: '笔记', book: '书籍', kind: '类型',
    intro: '浏览虚构的阅读笔记，查看它们导入 flomo 时的样子。所有操作都在当前浏览器中完成。',
    search: '搜索', searchHint: '书名、摘录或想法', allBooks: '所有书籍', allKinds: '全部类型',
    highlight: '划线', thought: '想法', empty: '没有匹配的笔记，试试其他关键词或筛选条件。',
    preview: 'flomo 导入预览', previewHint: '此处仅作预览。演示中的笔记均为虚构，不会发送至 flomo。',
    noSelection: '选择一条匹配的笔记，查看导入内容。', count: n => n + ' 条笔记'
  }
};
