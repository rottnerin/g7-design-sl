// Gemini calls. Credentials come from the environment (see README):
//   GOOGLE_API_KEY                         -> Gemini Developer API key
//   GOOGLE_GENAI_USE_ENTERPRISE=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
//                                          -> Google Cloud (Vertex AI), no key needed on Cloud Run
// MOCK_AI=1 returns canned replies so the site can be tried with no credentials.
const { systemPrompt, onePagerPrompt, ONE_PAGER_SCHEMA, ACCESS_FM } = require('./prompt');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MOCK = process.env.MOCK_AI === '1';

let client;
function ai() {
  if (!client) {
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({});
  }
  return client;
}

function toContents(messages) {
  // Gemini needs the conversation to start with a user turn.
  const contents = [{ role: 'user', parts: [{ text: '(The student has just opened the chat. Greet them.)' }] }];
  for (const m of messages) {
    const parts = [];
    if (m.image) {
      const [, mimeType, data] = m.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/) || [];
      if (data) parts.push({ inlineData: { mimeType, data } });
    }
    if (m.text) parts.push({ text: m.text });
    contents.push({ role: m.role === 'student' ? 'user' : 'model', parts });
  }
  return contents;
}

async function reply(group, student, messages) {
  if (MOCK) {
    const n = messages.filter((m) => m.role === 'student').length;
    return n === 0
      ? `Hello ${student.firstName}! I'm Linh from ${group.name}. (Test mode: no AI connected.) Which skills have you learned so far?`
      : `(Test mode reply ${n}) Thanks, tell me more about that.`;
  }
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: toContents(messages),
    config: { systemInstruction: systemPrompt(group, student), temperature: 0.7 },
  });
  const text = (res.text || '').trim();
  if (!text) throw new Error('Empty reply from model');
  return text;
}

async function onePager(group, student, messages) {
  if (MOCK) {
    return {
      projectTitle: 'Test project', summary: 'Test mode summary.', clientName: 'Linh',
      clientNeed: group.need || group.mission, skills: ['Woodworking', 'Laser cutting'],
      ...Object.fromEntries(ACCESS_FM.map((a) => [a[0], 'Not decided yet'])),
      questionsForClient: ['Test question?'],
    };
  }
  const transcript = messages
    .map((m) => `${m.role === 'student' ? 'STUDENT' : 'CLIENT'}: ${m.text || ''}${m.image ? ' [uploaded a drawing]' : ''}`)
    .join('\n');
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: `${onePagerPrompt(group, student)}\n\nCONVERSATION:\n${transcript}` }] }],
    config: { responseMimeType: 'application/json', responseJsonSchema: ONE_PAGER_SCHEMA, temperature: 0.2 },
  });
  return JSON.parse(res.text);
}

module.exports = { reply, onePager };
