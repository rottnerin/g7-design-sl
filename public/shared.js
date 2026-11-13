// Helpers used by both the student page and the teacher page.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

async function api(url, body) {
  const res = await fetch(url, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Message text with **bold** support; everything else is shown as plain text.
function richText(text) {
  const frag = document.createDocumentFragment();
  String(text || '').split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(el('strong', {}, part.slice(2, -2)));
    else frag.append(part.replace(/^\* /gm, '• '));
  });
  return frag;
}

function messageNode(m, showTime) {
  const node = el('div', { class: `msg ${m.role}` });
  if (m.image) node.append(el('img', { src: m.image, alt: 'Uploaded drawing' }));
  node.append(richText(m.text));
  if (showTime && m.at) node.append(el('time', {}, new Date(m.at).toLocaleString()));
  return node;
}

function onePagerNode(session, accessFm) {
  const op = session.onePager;
  const cell = (key, label) => el('div', { class: 'cell' },
    el('h3', {}, el('b', {}, label[0]), label.slice(1)), el('p', {}, op[key] || 'Not decided yet'));
  return el('div', { class: 'onepager' },
    el('div', { class: 'op-head' },
      el('h2', {}, op.projectTitle || 'My design'),
      el('div', { class: 'meta' },
        `${session.firstName} ${session.lastName} · Design ${session.section} · Client: ${session.groupName}` +
        (op.clientName ? ` (${op.clientName})` : '') +
        ` · ${new Date(session.onePagerAt).toLocaleDateString()}`)),
    el('h3', {}, 'What the client needs'), el('p', {}, op.clientNeed),
    el('h3', {}, 'My idea'), el('p', {}, op.summary),
    el('h3', {}, 'Skills I will combine'),
    el('div', { class: 'chips' }, ...(op.skills || []).map((s) => el('span', {}, s))),
    el('div', { class: 'grid' }, ...accessFm.map((a) => cell(a.key, a.label))),
    el('h3', {}, 'Questions to ask my client'),
    el('ul', {}, ...(op.questionsForClient || []).map((q) => el('li', {}, q))),
    op.drawing ? el('h3', {}, 'My drawing') : null,
    op.drawing ? el('img', { class: 'drawing', src: op.drawing, alt: 'Design drawing' }) : null);
}
