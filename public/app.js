const $ = (id) => document.getElementById(id);
let config, session, pendingImage = null, busy = false;

const remember = (key) => ({
  get() { try { return localStorage.getItem(key); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch {} },
});
const saved = remember('sdb.sessionId');
const savedCode = remember('sdb.classCode');
let classCode = savedCode.get() || '';

// The class code comes first; the name form appears once it is accepted.
function askForCode(message) {
  classCode = '';
  savedCode.set(null);
  $('codeError').textContent = message || '';
  $('codeForm').hidden = false;
  $('startForm').hidden = true;
  $('classCode').focus();
}
function showNameForm() {
  $('codeForm').hidden = true;
  $('startForm').hidden = false;
}

function show(view) {
  for (const v of ['start', 'chat', 'result']) $(v).hidden = v !== view;
  $('leave').hidden = view === 'start';
  $('who').textContent = session && view !== 'start'
    ? [session.firstName, session.groupName].filter(Boolean).join(' · ') : '';
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

  show('start');
  if (config.needsCode && !classCode) askForCode(); else showNameForm();
  const id = saved.get();
  if (id) {
    try {
      const data = await api(`/api/sessions/${id}`);
      $('resumeText').textContent =
        `${data.session.firstName}, you have a chat ${data.session.groupName ? `with ${data.session.groupName} ` : ''}on this computer.`;
      $('resume').hidden = false;
      $('resumeBtn').onclick = () => openChat(data);
      $('freshBtn').onclick = () => { saved.set(null); $('resume').hidden = true; };
    } catch { saved.set(null); }
  }
}

$('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('codeError').textContent = '';
  $('codeBtn').disabled = true;
  const typed = $('classCode').value.trim();
  try {
    await api('/api/join', { classCode: typed });
    classCode = typed;
    savedCode.set(typed);
    showNameForm();
    $('firstName').focus();
  } catch (err) { $('codeError').textContent = err.message; }
  $('codeBtn').disabled = false;
});

$('startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('startError').textContent = '';
  $('startBtn').disabled = true;
  $('startBtn').textContent = 'Finding your client…';
  try {
    openChat(await api('/api/sessions', {
      firstName: $('firstName').value, lastName: $('lastName').value,
      section: $('section').value, classCode,
    }));
  } catch (err) {
    // The teacher changed the code since this browser last used it.
    if (err.status === 403) askForCode(err.message); else $('startError').textContent = err.message;
  }
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
    Object.assign(session, data.session); // the group is filled in once the student has named it
    show('chat');
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

init().catch((err) => { show('start'); showNameForm(); $('startError').textContent = err.message; });
