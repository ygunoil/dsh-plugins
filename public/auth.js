const ACCOUNTS = "dsh.accounts.v1";
const SESSION = "dsh.session.v1";
const ITER = 210000;

function memoryStore() {
  const mem = new Map();
  return {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  };
}

function hasLocalStorage() {
  try {
    if (!globalThis.localStorage) return false;
    const key = "__dsh_probe__";
    globalThis.localStorage.setItem(key, "1");
    globalThis.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const store = hasLocalStorage() ? localStorage : memoryStore();

function b64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromB64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function same(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function loadAccounts() {
  try {
    const parsed = JSON.parse(store.getItem(ACCOUNTS) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  store.setItem(ACCOUNTS, JSON.stringify(accounts));
}

function readSession() {
  try {
    const session = JSON.parse(store.getItem(SESSION) || "null");
    if (!session?.userId || !session.exp || session.exp < Date.now()) {
      store.removeItem(SESSION);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function setSession(userId) {
  store.setItem(SESSION, JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

export function currentUser() {
  const session = readSession();
  if (!session) return null;
  const user = loadAccounts().find((item) => item.id === session.userId);
  return user ? publicUser(user) : null;
}

export async function register({ name, email, password, confirm }) {
  const display = String(name || "").trim();
  const mail = String(email || "").trim().toLowerCase();
  if (display.length < 2 || display.length > 24) throw new Error("显示名需要 2 到 24 个字");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error("邮箱格式不对");
  if (String(password || "").length < 8 || String(password || "").length > 72) throw new Error("密码需要 8 到 72 位");
  if (password !== confirm) throw new Error("两次密码不一致");
  const accounts = loadAccounts();
  if (accounts.some((item) => item.email === mail)) throw new Error("这个邮箱已经注册过");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  const user = {
    id: crypto.randomUUID(),
    name: display,
    email: mail,
    salt: b64(salt),
    hash: b64(hash),
    iter: ITER,
    createdAt: new Date().toISOString(),
  };
  accounts.push(user);
  saveAccounts(accounts);
  setSession(user.id);
  return publicUser(user);
}

export async function login(email, password) {
  const mail = String(email || "").trim().toLowerCase();
  const user = loadAccounts().find((item) => item.email === mail);
  if (!user) throw new Error("邮箱或密码不对");
  const actual = b64(await pbkdf2(String(password || ""), fromB64(user.salt), user.iter || ITER));
  if (!same(actual, user.hash)) throw new Error("邮箱或密码不对");
  setSession(user.id);
  return publicUser(user);
}

export function logout() {
  store.removeItem(SESSION);
}

export function wipeLocal() {
  store.removeItem(ACCOUNTS);
  store.removeItem(SESSION);
  if (globalThis.indexedDB) indexedDB.deleteDatabase("dsh-plugins");
}

export function resetStoreForTests() {
  store.removeItem(ACCOUNTS);
  store.removeItem(SESSION);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dsh-plugins", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("uploads")) {
        const uploads = db.createObjectStore("uploads", { keyPath: "id" });
        uploads.createIndex("ownerId", "ownerId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("写入失败"));
    tx.onabort = () => reject(tx.error || new Error("写入被中断"));
  });
}

export async function listUploads(ownerId) {
  const db = await openDb();
  try {
    const tx = db.transaction("uploads", "readonly");
    const request = tx.objectStore("uploads").index("ownerId").getAll(ownerId);
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    await txDone(tx);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } finally {
    db.close();
  }
}

export async function saveUpload(ownerId, meta, file) {
  const db = await openDb();
  try {
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").put({
      id: `local~${ownerId}~${meta.name.replaceAll("~", "-")}~${meta.version}`,
      ownerId,
      name: meta.name,
      version: meta.version,
      description: meta.description || "",
      filename: file.name || `${meta.name}-${meta.version}.zip`,
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file,
    });
    await txDone(tx);
  } catch (error) {
    if (String(error?.name || error).includes("Quota")) throw new Error("浏览器空间不够，存不下这个 zip");
    throw error;
  } finally {
    db.close();
  }
}

export async function getUpload(id, ownerId) {
  const rows = await listUploads(ownerId);
  return rows.find((row) => row.id === id) || null;
}

export async function removeUpload(id, ownerId) {
  const existing = await getUpload(id, ownerId);
  if (!existing) throw new Error("找不到这个包");
  const db = await openDb();
  try {
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
