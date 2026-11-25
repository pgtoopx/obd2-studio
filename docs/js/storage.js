/**
 * OBD2 Studio — Persistent Browser Storage (IndexedDB with localStorage fallback).
 * Stores telemetry recording sessions safely offline in the browser.
 */

(function (global) {
  const DB_NAME = "obd2_studio_db";
  const DB_VERSION = 1;
  const STORE_NAME = "recordings";
  const LS_KEY = "obd2_recordings_fallback";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function lsReadAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function lsWriteAll(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  async function saveRecording(rec) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(rec);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const list = lsReadAll().filter((r) => r.id !== rec.id);
      list.push(rec);
      lsWriteAll(list);
      return true;
    }
  }

  async function listRecordings() {
    try {
      const db = await openDB();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      return items.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    } catch (_) {
      return lsReadAll().sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    }
  }

  async function getRecording(id) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      return lsReadAll().find((r) => r.id === id) || null;
    }
  }

  async function deleteRecording(id) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      lsWriteAll(lsReadAll().filter((r) => r.id !== id));
      return true;
    }
  }

  async function clearAllRecordings() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      localStorage.removeItem(LS_KEY);
      return true;
    }
  }

  global.OBDStorage = {
    saveRecording,
    listRecordings,
    getRecording,
    deleteRecording,
    clearAllRecordings,
  };
})(window);
