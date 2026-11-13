const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./src/store');
const ai = require('./src/ai');
const { ACCESS_FM } = require('./src/prompt');
const { groups, find: findGroup } = require('./src/groups');

const SECTIONS = (process.env.SECTIONS || '7.01,7.02,7.03,7.04,7.05,7.06').split(',');
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CLASS_CODE = (process.env.CLASS_CODE || '').trim().toLowerCase();
const DEFAULTS = {
  model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  temperature: Number(process.env.GEMINI_TEMPERATURE || 1),
};
const MAX_STUDENT_MESSAGES = 150;
const MAX_HISTORY = 80; // messages sent to the model per turn
const MAX_IMAGES_IN_HISTORY = 3;

const app = express();
app.set('trust proxy', 1); // Cloud Run: use the caller's address, not the proxy's
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

// Teachers change these in the teacher view; they apply to the next message.
const settings = async () => ({ ...DEFAULTS, ...(await store.getSettings()) });

// ---------- class code ----------
// Wrong guesses are counted per network address. A whole class shares one
// address at school, so the limit is generous.
const MAX_BAD_CODES = 30;
const badCodes = new Map();
function checkCode(req, res) {
  if (!CLASS_CODE) return true;
  const t = Date.now();
  let rec = badCodes.get(req.ip);
  if (rec && t > rec.reset) { badCodes.delete(req.ip); rec = null; }
  if (rec && rec.n >= MAX_BAD_CODES) {
    res.status(429).json({ error: 'Too many wrong codes. Wait ten minutes, then check the code with your teacher.' });
    return false;
  }
  const given = String(req.body.classCode || '').trim().toLowerCase();
  if (given && safeEqual(given, CLASS_CODE)) return true;
  badCodes.set(req.ip, { n: (rec ? rec.n : 0) + 1, reset: rec ? rec.reset : t + 10 * 60 * 1000 });
  res.status(403).json({ error: 'That class code is not right. Check with your teacher.' });
  return false;
}

// ---------- student API ----------
app.post('/api/join', (req, res) => { if (checkCode(req, res)) res.json({ ok: true }); });

app.get('/api/config', (req, res) => {
  res.json({
    needsCode: !!CLASS_CODE,
    sections: SECTIONS,
    accessFm: ACCESS_FM.map(([key, label, question]) => ({ key, label, question })),
    groups: groups.map(({ id, name }) => ({ id, name })), // handbook text and hints stay on the server
  });
});

// Only the most recent drawings are re-sent to the model, to keep requests small.
function forModel(messages) {
  // "guide" messages are the site's own instructions, not part of the client conversation.
  const recent = messages.filter((m) => m.role !== 'guide').slice(-MAX_HISTORY);
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
  const group = findGroup(session.groupId);
  return { session, group, student: session };
}

const HANDBOOK_NAMES = groups.filter((g) => g.fromHandbook).map((g) => g.name).join(', ');

// A chat starts with no group. The student introduces themselves, and the
// group (and so the client) is worked out from what they write.
app.post('/api/sessions', wrap(async (req, res) => {
  if (!checkCode(req, res)) return;
  const firstName = clean(req.body.firstName, 40);
  const lastName = clean(req.body.lastName, 40);
  const section = clean(req.body.section, 10);
  if (!firstName || !lastName || !SECTIONS.includes(section)) {
    return res.status(400).json({ error: 'Please fill in your name and section.' });
  }
  const t = now();
  const session = await store.createSession({
    firstName, lastName, section, groupId: null, groupName: null,
    createdAt: t, updatedAt: t, messageCount: 1, onePager: null, onePagerAt: null,
  });
  const msg = {
    role: 'guide', image: null, at: t,
    text: `Hi ${firstName}! You are about to meet a client from your service learning group. Start the way you would in real life: say hello, tell them your name, and say which service learning group you are in.`,
  };
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
  const cfg = await settings();

  if (!ctx.group) {
    // Everything typed so far counts, in case the group took two tries.
    const said = [...history, studentMsg].filter((m) => m.role === 'student').map((m) => m.text).join('\n');
    const group = findGroup(await ai.identify(said, groups, cfg));
    if (!group) {
      const guideMsg = {
        role: 'guide', image: null, at: now(),
        text: `I could not tell which service learning group you are in. Type its name. The groups are: ${HANDBOOK_NAMES}.`,
      };
      await store.addMessage(ctx.session.id, studentMsg);
      await store.addMessage(ctx.session.id, guideMsg);
      await store.updateSession(ctx.session.id, { updatedAt: guideMsg.at, messageCount: history.length + 2 });
      return res.json({ messages: [studentMsg, guideMsg], session: ctx.session });
    }
    ctx.group = group;
    Object.assign(ctx.session, { groupId: group.id, groupName: group.name });
    await store.updateSession(ctx.session.id, { groupId: group.id, groupName: group.name });
  }
  const replyText = await ai.reply(ctx.group, ctx.student, forModel([...history, studentMsg]), cfg);
  const clientMsg = { role: 'client', text: replyText, image: null, at: now(), temperature: cfg.temperature, model: cfg.model };
  await store.addMessage(ctx.session.id, studentMsg);
  await store.addMessage(ctx.session.id, clientMsg);
  await store.updateSession(ctx.session.id, { updatedAt: clientMsg.at, messageCount: history.length + 2 });
  res.json({ messages: [studentMsg, clientMsg], session: ctx.session });
}));

app.post('/api/sessions/:id/onepager', wrap(async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const history = (await store.getMessages(ctx.session.id)).filter((m) => m.role !== 'guide');
  if (!ctx.group || history.filter((m) => m.role === 'student').length < 3) {
    return res.status(400).json({ error: 'Keep chatting with your client a bit more first.' });
  }
  const onePager = await ai.onePager(ctx.group, ctx.student, history, await settings());
  const drawings = history.filter((m) => m.image);
  onePager.drawing = drawings.length ? drawings[drawings.length - 1].image : null;
  const t = now();
  await store.updateSession(ctx.session.id, { onePager, onePagerAt: t, updatedAt: t });
  res.json({ onePager, onePagerAt: t });
}));

// ---------- teacher API ----------
app.get('/api/admin/settings', wrap(async (req, res) => res.json(await settings())));
app.post('/api/admin/settings', wrap(async (req, res) => {
  const temperature = Number(req.body.temperature);
  const model = clean(req.body.model, 60);
  if (!(temperature >= 0 && temperature <= 2) || !/^[\w.-]+$/.test(model)) {
    return res.status(400).json({ error: 'Temperature must be between 0 and 2, and the model name cannot be empty.' });
  }
  await store.setSettings({ temperature, model });
  res.json(await settings());
}));

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
app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
  if (!CLASS_CODE) console.log('No CLASS_CODE set: anyone with the address can start a chat.');
});
