import assert from "node:assert/strict";
import { test } from "node:test";

import { Folder } from "../src/folder.js";

// Minimaler Nachbau von FileSystemDirectoryHandle (nur was Folder benutzt)
class FakeDir {
  constructor(name) {
    this.name = name;
    this.entries = new Map();
  }
  async queryPermission() {
    return "granted";
  }
  async requestPermission() {
    return "granted";
  }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw new DOMException("nicht gefunden", "NotFoundError");
      this.entries.set(name, new FakeDir(name));
    }
    return this.entries.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw new DOMException("nicht gefunden", "NotFoundError");
      this.entries.set(name, { kind: "file", data: null });
    }
    const entry = this.entries.get(name);
    return {
      createWritable: async () => ({
        write: async (d) => (entry.data = d),
        close: async () => {},
      }),
    };
  }
  async removeEntry(name) {
    this.entries.delete(name);
  }
}

test("Folder schreibt, findet und löscht Dateien (auch in Unterordnern)", async () => {
  const folder = new Folder({ get: async () => null, set: async () => {} });
  folder.handle = new FakeDir("Transkripte");
  folder.state = "granted";

  assert.equal(await folder.write("Audio/2026-09-30_mic.webm", "AUDIO"), true);
  assert.equal(await folder.write("2026-09-30.md", "# Test"), true);
  assert.equal(folder.handle.entries.get("Audio").entries.get("2026-09-30_mic.webm").data, "AUDIO");
  assert.equal(await folder.exists("2026-09-30.md"), true);
  assert.equal(await folder.exists("Audio/fehlt.webm"), false);
  assert.equal(await folder.exists("Fehlt/x.md"), false);
  await folder.remove("2026-09-30.md");
  assert.equal(await folder.exists("2026-09-30.md"), false);
});

test("Folder schreibt nichts ohne Erlaubnis", async () => {
  const folder = new Folder({ get: async () => null, set: async () => {} });
  folder.handle = new FakeDir("X");
  folder.state = "prompt";
  assert.equal(await folder.write("a.md", "x"), false);
  assert.equal(folder.handle.entries.size, 0);
});
