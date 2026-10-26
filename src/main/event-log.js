// Registro in memoria degli ultimi eventi (sensori, citofono, allarme, connessione)
// mostrato nella dashboard. Non viene salvato su disco.
class EventLog {
  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.counter = 0;
    this.onAdd = null;
  }

  setOnAdd(callback) {
    this.onAdd = callback;
  }

  // type: "sensor" | "intercom" | "gate" | "alarm" | "connection"
  add(type, title, detail = "") {
    const entry = {
      id: ++this.counter,
      type,
      title,
      detail,
      time: new Date().toISOString(),
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    if (this.onAdd) this.onAdd(entry);
    return entry;
  }

  list() {
    return [...this.entries];
  }
}

module.exports = EventLog;
