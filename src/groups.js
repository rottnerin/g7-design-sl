// Who a student can be designing for.
//   data/handbook.json  one entry per service learning group, text taken from the school handbook
//   data/groups.json    the design teacher's own client list: what each client needs, and idea hints
// A handbook group is linked to a client on file when the client's name appears on the group's page.
const clients = require('../data/groups.json');
const handbook = require('../data/handbook.json');

const plain = (s) => s.toLowerCase().replace(/[’`]/g, "'");
function namesFor(client) {
  const base = client.name.replace(/\(.*?\)/g, '').trim();
  const acronym = (client.name.match(/\(([A-Z0-9]{3,})\)/) || [])[1];
  const words = base.split(/\s+/);
  return [base, words.length > 2 && /^\w+$/.test(words[1]) ? words.slice(0, 2).join(' ') : null, acronym, ...(client.aka || [])].filter(Boolean);
}
function mentions(text, name) {
  const escaped = plain(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(plain(text));
}

const groups = [
  ...handbook.map((g) => ({
    id: g.id, name: g.name, handbook: g.text, fromHandbook: true,
    clients: clients.filter((c) => namesFor(c).some((n) => mentions(`${g.name}\n${g.text}`, n))),
  })),
  // A student can also name a client directly ("I am designing for the language teachers").
  ...clients.map((c) => ({ id: c.id, name: c.name, handbook: '', fromHandbook: false, clients: [c] })),
];

module.exports = { groups, find: (id) => groups.find((g) => g.id === id) || null };
