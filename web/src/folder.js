// Speicherordner auf dem Rechner (File System Access API, Edge/Chrome): Transkripte (.md) und Aufnahmen
// werden zusätzlich als normale Dateien in einen vom Nutzer gewählten Ordner geschrieben.
// Der Browser gibt nur den Ordnernamen preis, nicht den vollständigen Pfad.

export const folderSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

export class Folder {
  /** @param {{get:(key:string)=>Promise<any>, set:(key:string, value:any)=>Promise<void>}} settings */
  constructor(settings) {
    this.settings = settings;
    this.handle = null;
    this.state = folderSupported ? "none" : "unsupported"; // none | prompt | granted | unsupported
  }

  get name() {
    return this.handle?.name || "";
  }

  async load() {
    if (!folderSupported) return this.state;
    this.handle = (await this.settings.get("folder")) || null;
    this.state = this.handle ? await this.#permission(false) : "none";
    return this.state;
  }

  /** Ordner auswählen (braucht einen Klick des Nutzers). */
  async pick() {
    const handle = await window.showDirectoryPicker({ id: "transcripter", mode: "readwrite", startIn: "documents" });
    this.handle = handle;
    await this.settings.set("folder", handle);
    this.state = await this.#permission(true);
    return this.state;
  }

  /** Zugriff nach Browser-Neustart erneut erlauben (braucht einen Klick des Nutzers). */
  async grant() {
    if (!this.handle) return this.state;
    this.state = await this.#permission(true);
    return this.state;
  }

  get ready() {
    return this.state === "granted" && !!this.handle;
  }

  async #permission(ask) {
    const opts = { mode: "readwrite" };
    let p = await this.handle.queryPermission(opts);
    if (p !== "granted" && ask) p = await this.handle.requestPermission(opts);
    return p === "granted" ? "granted" : "prompt";
  }

  async #dir(parts, create) {
    let dir = this.handle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  /** Schreibt eine Datei, z. B. write("Audio/2026-…_mic.webm", blob). Überschreibt vorhandene. */
  async write(path, data) {
    if (!this.ready) return false;
    const parts = path.split("/");
    const name = parts.pop();
    const dir = await this.#dir(parts, true);
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
    return true;
  }

  async exists(path) {
    if (!this.ready) return false;
    const parts = path.split("/");
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, false);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path) {
    if (!this.ready) return;
    const parts = path.split("/");
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, false);
      await dir.removeEntry(name);
    } catch {
      /* schon weg */
    }
  }
}
