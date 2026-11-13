const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./src/store');
const ai = require('./src/ai');
const { ACCESS_FM } = require('./src/prompt');
const groups = require('./data/groups.json');

const SECTIONS = (process.env.SECTIONS || '7.01,7.02,7.03,7.04,7.05,7.06').split(',');
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MAX_STUDENT_MESSAGES = 150;
const MAX_HISTORY = 80; // messages sent to the model per turn
const MAX_IMAGES_IN_HISTORY = 3;

const app = express();
app.use(express.json({ limit: '3mb' }));

const now = () => new Date().toISOString();
const clean = (s, max) => String(s || '').trim().slice(0, max);
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- teacher login (HTTP basic auth) ----------
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function requireAdmin(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) return res.status(503).send('Teacher login is not configured.');
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && token) {
    const decoded = Buffer.from(token, 'base64').toString();
    const i = decoded.indexOf(':');
    if (i > 0 && safeEqual(decoded.slice(0, i), ADMIN_USER) && safeEqual(decoded.slice(i + 1), ADMIN_PASSWORD)) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Teacher view"').status(401).send('Teacher login required.');
}
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.use('/api/admin', requireAdmin);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- student API ----------
app.get('/api/config', (req, res) => {
  res.json({
    sections: SECTIONS,
    accessFm: ACCESS_FM.map(([key, label]) => ({ key, label })),
    groups: groups.map(({ id, name, mission }) => ({ id, name, mission })), // hints stay on the server
  });
});

// Only the most recent drawings are re-sent to the model, to keep requests small.
function forModel(messages) {
  const recent = messages.slice(-MAX_HISTORY);
  let images = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].image && ++images > MAX_IMAGES_IN_HISTORY) {
      recent[i] = { ...recent[i], image: null, text: `${recent[i].text || ''} [an earlier drawing was uploaded here]` };
    }
  }
  return recent;
}

async function load(req, res) {
  const session = await store.getSession(req.params.id);
  if (!session) { res.status(404).json({ error: 'Chat not found.' }); return null; }
  const group = groups.find((g) => g.id === session.groupId);
  return { session, group, student: session };
}

app.post('/api/sessions', wrap(async (req, res) => {
  const firstName = clean(req.body.firstName, 40);
  const lastName = clean(req.body.lastName, 40);
  const section = clean(req.body.section, 10);
  const group = groups.find((g) => g.id === req.body.groupId);
  if (!firstName || !lastName || !SECTIONS.includes(section) || !group) {
    return res.status(400).json({ error: 'Please fill in your name, section and group.' });
  }
  const student = { firstName, lastName, section };
  const greeting = await ai.reply(group, student, []);
  const t = now();
  const session = await store.createSession({
    ...student, groupId: group.id, groupName: group.name,
    createdAt: t, updatedAt: t, messageCount: 1, onePager: null, onePagerAt: null,
  });
  const msg = { role: 'client', text: greeting, image: null, at: t };
  await store.addMessage(session.id, msg);
  res.json({ session, messages: [msg] });
}));

app.get('/api/sessions/:id', wrap(async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  res.json({ session: ctx.session, messages: await store.getMessages(ctx.session.id) });
}));

app.post('/api/sessions/:id/messages', wrap(async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const text = clean(req.body.text, 2000);
  const image = typeof req.body.image === 'string'
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(req.body.image)
    && req.body.image.length < 700000 ? req.body.image : null;
  if (!text && !image) return res.status(400).json({ error: 'Type a message first.' });

  const history = await store.getMessages(ctx.session.id);
  if (history.filter((m) => m.role === 'student').length >= MAX_STUDENT_MESSAGES) {
    return res.status(429).json({ error: 'This chat has reached its limit. Please ask your teacher.' });
  }
  const studentMsg = { role: 'student', text, image, at: now() };
  const replyText = await ai.reply(ctx.group, ctx.student, forModel([...history, studentMsg]));
  const clientMsg = { role: 'client', text: replyText, image: null, at: now() };
  await store.addMessage(ctx.session.id, studentMsg);
  await store.addMessage(ctx.session.id, clientMsg);
  await store.updateSession(ctx.session.id, { updatedAt: clientMsg.at, messageCount: history.length + 2 });
  res.json({ messages: [studentMsg, clientMsg] });
}));

app.post('/api/sessions/:id/onepager', wrap(async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const history = await store.getMessages(ctx.session.id);
  if (history.filter((m) => m.role === 'student').length < 3) {
    return res.status(400).json({ error: 'Keep chatting with your client a bit more first.' });
  }
  const onePager = await ai.onePager(ctx.group, ctx.student, history);
  const drawings = history.filter((m) => m.image);
  onePager.drawing = drawings.length ? drawings[drawings.length - 1].image : null;
  const t = now();
  await store.updateSession(ctx.session.id, { onePager, onePagerAt: t, updatedAt: t });
  res.json({ onePager, onePagerAt: t });
}));

// ---------- teacher API ----------
app.get('/api/admin/sessions', wrap(async (req, res) => {
  const sessions = await store.listSessions();
  res.json({
    sessions: sessions.map(({ onePager, ...s }) => ({ ...s, hasOnePager: !!onePager })),
  });
}));

app.get('/api/admin/sessions/:id', wrap(async (req, res) => {
  const session = await store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json({ session, messages: await store.getMessages(session.id) });
}));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
