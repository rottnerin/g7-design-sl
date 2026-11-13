const $ = (id) => document.getElementById(id);
const KEY = 'sdb.sessionId';
let config, session, pendingImage = null, busy = false;

const saved = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};

function show(view) {
  for (const v of ['start', 'chat', 'result']) $(v).hidden = v !== view;
  $('leave').hidden = view === 'start';
  $('who').textContent = session && view !== 'start' ? `${session.firstName} · ${session.groupName}` : '';
}

function addMessage(m) {
  const node = messageNode(m);
  $('log').append(node);
  $('log').scrollTop = $('log').scrollHeight;
  return node;
}

function openChat(data) {
  session = data.session;
  saved.set(session.id);
  $('log').replaceChildren();
  data.messages.forEach(addMessage);
  show('chat');
  $('text').focus();
}

async function init() {
  config = await api('/api/config');
  for (const s of config.sections) $('section').append(el('option', {}, s));
  for (const g of config.groups) $('group').append(el('option', { value: g.id }, g.name));
  $('group').addEventListener('change', () => {
    const g = config.groups.find((x) => x.id === $('group').value);
    $('mission').textContent = g ? g.mission : '';
  });

  show('start');
  const id = saved.get();
  if (id) {
    try {
      const data = await api(`/api/sessions/${id}`);
      $('resumeText').textContent =
        `${data.session.firstName}, you have a chat with ${data.session.groupName} on this computer.`;
      $('resume').hidden = false;
      $('resumeBtn').onclick = () => openChat(data);
      $('freshBtn').onclick = () => { saved.set(null); $('resume').hidden = true; };
    } catch { saved.set(null); }
  }
}

$('startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('startError').textContent = '';
  $('startBtn').disabled = true;
  $('startBtn').textContent = 'Finding your client…';
  try {
    openChat(await api('/api/sessions', {
      firstName: $('firstName').value, lastName: $('lastName').value,
      section: $('section').value, groupId: $('group').value,
    }));
  } catch (err) { $('startError').textContent = err.message; }
  $('startBtn').disabled = false;
  $('startBtn').textContent = 'Meet my client';
});

function setBusy(b) {
  busy = b;
  for (const id of ['send', 'makeOnePager', 'attach']) $(id).disabled = b;
}

async function send() {
  const text = $('text').value.trim();
  if (busy || (!text && !pendingImage)) return;
  $('chatError').textContent = '';
  setBusy(true);
  const mine = addMessage({ role: 'student', text, image: pendingImage });
  const typing = addMessage({ role: 'client typing', text: 'Typing…' });
  const sentImage = pendingImage;
  $('text').value = '';
  clearImage();
  autoGrow();
  try {
    const data = await api(`/api/sessions/${session.id}/messages`, { text, image: sentImage });
    typing.remove();
    addMessage(data.messages[1]);
  } catch (err) {
    typing.remove();
    mine.remove();
    $('text').value = text;
    if (sentImage) setImage(sentImage);
    $('chatError').textContent = err.message;
  }
  setBusy(false);
  $('text').focus();
}
$('send').onclick = send;
$('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
function autoGrow() {
  const t = $('text');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 160)}px`;
}
$('text').addEventListener('input', autoGrow);

// ----- drawings: shrink in the browser before sending -----
function setImage(dataUrl) {
  pendingImage = dataUrl;
  $('preview').querySelector('img').src = dataUrl;
  $('preview').hidden = false;
}
function clearImage() { pendingImage = null; $('preview').hidden = true; $('file').value = ''; }
$('attach').onclick = () => $('file').click();
$('removeImg').onclick = clearImage;
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    let size = 1024, quality = 0.8, out;
    do {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', quality);
      size = Math.round(size * 0.8);
    } while (out.length > 600000 && size > 300);
    URL.revokeObjectURL(img.src);
    setImage(out);
  };
  img.onerror = () => { $('chatError').textContent = 'That file could not be opened as a picture.'; };
  img.src = URL.createObjectURL(file);
});

// ----- one-pager -----
function showOnePager() {
  $('onePager').replaceChildren(onePagerNode(session, config.accessFm));
  show('result');
}
$('makeOnePager').onclick = async () => {
  if (busy) return;
  $('chatError').textContent = '';
  setBusy(true);
  $('makeOnePager').textContent = 'Writing it up…';
  try {
    Object.assign(session, await api(`/api/sessions/${session.id}/onepager`, {}));
    showOnePager();
  } catch (err) { $('chatError').textContent = err.message; }
  $('makeOnePager').textContent = 'Create my one-pager';
  setBusy(false);
};
$('back').onclick = () => show('chat');
$('print').onclick = () => window.print();
$('leave').onclick = () => {
  if (confirm('Leave this chat and start over? Your teacher will still be able to see it.')) {
    saved.set(null);
    location.reload();
  }
};

init().catch((err) => { show('start'); $('startError').textContent = err.message; });
