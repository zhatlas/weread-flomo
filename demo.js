const { demoCopy: copy, demoBooks: books, demoNotes: notes } = window;
const byId = id => document.getElementById(id);
const language = byId('language');
const book = byId('book');
const kind = byId('kind');
const search = byId('search');
let selected = notes[0];
language.value = navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function render() {
  const labels = copy[language.value];
  const query = search.value.trim().toLowerCase();
  const visible = notes.filter(note => {
    const { title, author } = books[note.book];
    return (!book.value || book.value === note.book) &&
      (!kind.value || kind.value === note.kind) &&
      [title, author, note.chapter, note.passage, note.thought].some(value => value?.toLowerCase().includes(query));
  });
  if (!visible.includes(selected)) selected = visible[0];
  byId('count').textContent = labels.count(visible.length);
  byId('empty').hidden = visible.length !== 0;
  byId('notes').replaceChildren(...visible.map(note => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note';
    button.setAttribute('aria-pressed', String(note === selected));
    button.append(element('span', labels[note.kind], 'kind'),
      element('strong', note.thought || note.passage), element('small', books[note.book].title + ' · ' + note.chapter));
    button.addEventListener('click', () => {
      selected = note;
      for (const sibling of byId('notes').children) sibling.setAttribute('aria-pressed', String(sibling === button));
      renderPreview();
    });
    return button;
  }));
  renderPreview();
}

function renderPreview() {
  const labels = copy[language.value];
  byId('memo').replaceChildren();
  byId('preview-hint').textContent = selected ? labels.previewHint : labels.noSelection;
  if (!selected) return;
  const { title, author } = books[selected.book];
  const parts = [
    element('p', '《' + title + '》 ' + author + ' · ' + selected.chapter, 'source'),
    element('p', '> ' + selected.passage)
  ];
  if (selected.thought) parts.push(element('p', '📝 想法：' + selected.thought));
  parts.push(element('p', '#微信读书/' + title.replace(/[\s#/]+/gu, '_'), 'tags'));
  byId('memo').append(...parts);
}

function localize() {
  const labels = copy[language.value];
  document.documentElement.lang = language.value;
  document.title = 'WeRead → flomo · ' + labels.title;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = labels[node.dataset.i18n];
  search.placeholder = labels.searchHint;
  book.options[0].text = labels.allBooks;
  render();
}

book.add(new Option('', ''));
for (const [id, sample] of Object.entries(books)) book.add(new Option(sample.title, id));
search.addEventListener('input', render);
book.addEventListener('change', render);
kind.addEventListener('change', render);
language.addEventListener('change', localize);
localize();
