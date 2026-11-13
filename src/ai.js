// Gemini calls. Credentials come from the environment (see README):
//   GOOGLE_API_KEY                         -> Gemini Developer API key
//   GOOGLE_GENAI_USE_ENTERPRISE=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
//                                          -> Google Cloud (Vertex AI), no key needed on Cloud Run
// MOCK_AI=1 returns canned replies so the site can be tried with no credentials.
const { systemPrompt, onePagerPrompt, ONE_PAGER_SCHEMA, ACCESS_FM } = require('./prompt');

const MOCK = process.env.MOCK_AI === '1';

let client;
function ai() {
  if (!client) {
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({});
  }
  return client;
}

// Low "thinking" makes replies about three times faster. Models that do not
// have the setting reject it, so the call is tried again without it.
async function generate(model, contents, config) {
  try {
    return await ai().models.generateContent({ model, contents, config: { ...config, thinkingConfig: { thinkingLevel: 'low' } } });
  } catch (err) {
    if (!/thinking/i.test(String(err.message))) throw err;
    return ai().models.generateContent({ model, contents, config });
  }
}

function toContents(messages) {
  const contents = [];
  for (const m of messages) {
    const parts = [];
    if (m.image) {
      const [, mimeType, data] = m.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/) || [];
      if (data) parts.push({ inlineData: { mimeType, data } });
    }
    if (m.text) parts.push({ text: m.text });
    const role = m.role === 'student' ? 'user' : 'model';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts); // two messages in a row from one side
    else contents.push({ role, parts });
  }
  // Gemini needs the conversation to start with a user turn.
  if (!contents.length || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(The student has just opened the chat. Greet them.)' }] });
  }
  return contents;
}

// Works out which group the student means from their introduction. Returns a group id or null.
async function identify(text, groups, { model }) {
  if (MOCK) {
    const t = text.toLowerCase();
    const hit = groups.find((g) => t.includes(g.name.toLowerCase().split(/[(:]/)[0].trim()));
    return hit ? hit.id : null;
  }
  const list = groups.map((g) => {
    const partners = g.fromHandbook && g.clients.length ? ` (works with: ${g.clients.map((c) => c.name).join(', ')})` : '';
    return `${g.id} | ${g.fromHandbook ? 'service learning group' : 'client organisation'} | ${g.name}${partners}`;
  }).join('\n');
  const res = await generate(model, [{ role: 'user', parts: [{ text:
`A Grade 7 student is introducing themselves and saying which school service learning group they are in. Pick the entry they mean.

Rules:
- They may misspell it, shorten it, or describe it ("the bear group", "pet rescue").
- Prefer a service learning group. Pick a client organisation only when they name that organisation and no service learning group clearly fits.
- If they have not said a group, or two entries fit equally well, answer "unknown". Do not guess.

ENTRIES (id | kind | name)
${list}

WHAT THE STUDENT WROTE
${text}` }] }], {
    temperature: 0,
    responseMimeType: 'application/json',
    responseJsonSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  });
  const { id } = JSON.parse(res.text);
  return groups.some((g) => g.id === id) ? id : null;
}

async function reply(group, student, messages, { model, temperature }) {
  if (MOCK) {
    const n = messages.filter((m) => m.role === 'student').length;
    return n <= 1
      ? `Hello ${student.firstName}! I'm Linh, and I work with ${group.name}. (Test mode: no AI connected.) What would you like to ask me?`
      : `(Test mode reply ${n}) Thanks, tell me more about that.`;
  }
  const res = await generate(model, toContents(messages), { systemInstruction: systemPrompt(group, student), temperature });
  const text = (res.text || '').trim();
  if (!text) throw new Error('Empty reply from model');
  return text;
}

async function onePager(group, student, messages, { model }) {
  if (MOCK) {
    return {
      projectTitle: 'Test project', summary: 'Test mode summary.', clientName: 'Linh',
      clientNeed: `Something useful for ${group.name}.`, skills: ['Woodworking', 'Laser cutting'],
      ...Object.fromEntries(ACCESS_FM.map((a) => [a[0], 'Not decided yet'])),
      questionsForClient: ['Test question?'],
    };
  }
  const transcript = messages
    .map((m) => `${m.role === 'student' ? 'STUDENT' : 'CLIENT'}: ${m.text || ''}${m.image ? ' [uploaded a drawing]' : ''}`)
    .join('\n');
  const res = await generate(model,
    [{ role: 'user', parts: [{ text: `${onePagerPrompt(group, student)}\n\nCONVERSATION:\n${transcript}` }] }],
    { responseMimeType: 'application/json', responseJsonSchema: ONE_PAGER_SCHEMA, temperature: 0.2 });
  return JSON.parse(res.text);
}

module.exports = { identify, reply, onePager };
