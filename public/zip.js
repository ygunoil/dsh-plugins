function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes) {
  const start = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

function rank(name) {
  const parts = name.split("/").filter(Boolean);
  if (parts.at(-1) !== "package.json") return Infinity;
  if (parts.includes("node_modules")) return 100 + parts.length;
  return parts.length;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length > 2_000_000) throw new Error("package.json 太大");
  return out;
}

export async function readPackageJson(file) {
  const bytes = file instanceof Uint8Array
    ? file
    : new Uint8Array(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("这不是 zip");
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("zip 目录读不出来");
  const count = u16(bytes, eocd + 10);
  const offset = u32(bytes, eocd + 16);
  if (offset === 0xffffffff) throw new Error("这个 zip 用了 ZIP64，请换一个普通 zip");
  const entries = [];
  let cursor = offset;
  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new Error("zip 目录损坏");
    const method = u16(bytes, cursor + 10);
    const compressed = u32(bytes, cursor + 20);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    entries.push({ name, method, compressed, localOffset, rank: rank(name) });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  const chosen = entries.filter((entry) => entry.rank < 10).sort((a, b) => a.rank - b.rank)[0];
  if (!chosen) throw new Error("zip 里没有 package.json");
  if (chosen.compressed === 0xffffffff || chosen.localOffset === 0xffffffff) throw new Error("这个 zip 用了 ZIP64，请换一个普通 zip");
  if (chosen.method !== 0 && chosen.method !== 8) throw new Error("package.json 的压缩方式不支持");
  const nameLen = u16(bytes, chosen.localOffset + 26);
  const extraLen = u16(bytes, chosen.localOffset + 28);
  const dataOffset = chosen.localOffset + 30 + nameLen + extraLen;
  const slice = bytes.subarray(dataOffset, dataOffset + chosen.compressed);
  if (slice.length > 2_000_000) throw new Error("package.json 太大");
  const raw = chosen.method === 0 ? slice : await inflate(slice);
  let text = new TextDecoder().decode(raw);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error("package.json 不是合法 JSON");
  }
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new Error("package.json 缺少 name 或 version");
  const name = pkg.name.trim();
  const version = pkg.version.trim();
  if (!/^(@[A-Za-z0-9-._]+\/)?[A-Za-z0-9-._]+$/.test(name)) throw new Error("包名不是可用的 npm 名称");
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error("版本需要是 x.y.z");
  return {
    name,
    version,
    description: typeof pkg.description === "string" ? pkg.description.replace(/\s+/g, " ").trim().slice(0, 200) : "",
  };
}
