// Storage. Uses Firestore when STORE=firestore (Cloud Run), otherwise a local
// JSON file so the app runs on a laptop with no setup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => crypto.randomBytes(12).toString('hex');

function fileStore() {
  const file = process.env.DATA_FILE || path.join(__dirname, '..', 'local-data.json');
  let db = { sessions: {}, messages: {} };
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const save = () => fs.writeFileSync(file, JSON.stringify(db));
  return {
    async createSession(data) {
      const id = newId();
      db.sessions[id] = { id, ...data };
      db.messages[id] = [];
      save();
      return db.sessions[id];
    },
    async getSession(id) { return db.sessions[id] || null; },
    async updateSession(id, patch) { Object.assign(db.sessions[id], patch); save(); },
    async listSessions() {
      return Object.values(db.sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async addMessage(id, msg) { db.messages[id].push(msg); save(); },
    async getMessages(id) { return db.messages[id] || []; },
    async getSettings() { return db.settings || {}; },
    async setSettings(patch) { db.settings = { ...db.settings, ...patch }; save(); },
  };
}

function firestoreStore() {
  const { Firestore } = require('@google-cloud/firestore');
  const fsdb = new Firestore({ databaseId: process.env.FIRESTORE_DATABASE || '(default)' });
  const sessions = fsdb.collection('sessions');
  const settings = fsdb.collection('config').doc('settings');
  return {
    async createSession(data) {
      const id = newId();
      await sessions.doc(id).set({ id, ...data });
      return { id, ...data };
    },
    async getSession(id) {
      const d = await sessions.doc(id).get();
      return d.exists ? d.data() : null;
    },
    async updateSession(id, patch) { await sessions.doc(id).update(patch); },
    async listSessions() {
      const q = await sessions.orderBy('updatedAt', 'desc').limit(1000).get();
      return q.docs.map((d) => d.data());
    },
    async addMessage(id, msg) { await sessions.doc(id).collection('messages').add(msg); },
    async getMessages(id) {
      const q = await sessions.doc(id).collection('messages').orderBy('at').get();
      return q.docs.map((d) => d.data());
    },
    async getSettings() { return (await settings.get()).data() || {}; },
    async setSettings(patch) { await settings.set(patch, { merge: true }); },
  };
}

module.exports = process.env.STORE === 'firestore' ? firestoreStore() : fileStore();
