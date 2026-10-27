import { crc32, inflateRawSync } from 'node:zlib';

const MAX_ENTRY = 1024 * 1024;

export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    if (file.name.includes('..') || file.name.startsWith('/') || file.name.includes('\\')) {
      throw new Error('压缩路径不合法');
    }
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, name, data]));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw Object.assign(new Error('不是有效的 zip 文件'), { status: 400 });
}

export function listZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw Object.assign(new Error('不是有效的 zip 文件'), { status: 400 });
  }
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralStart = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) {
    throw Object.assign(new Error('不支持 Zip64，请上传 32MB 以内的普通 zip'), { status: 400 });
  }
  if (centralStart + centralSize > buf.length) {
    throw Object.assign(new Error('zip 目录损坏'), { status: 400 });
  }
  const entries = [];
  let cursor = centralStart;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw Object.assign(new Error('zip 目录损坏'), { status: 400 });
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      throw Object.assign(new Error('zip 内含非法路径'), { status: 400 });
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
  }
  return entries;
}

export function readZipEntry(buf, entry) {
  if (entry.uncompressedSize > MAX_ENTRY || entry.compressedSize > MAX_ENTRY) {
    throw Object.assign(new Error(`zip 内文件过大：${entry.name}`), { status: 400 });
  }
  if (entry.localOffset + 30 > buf.length || buf.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw Object.assign(new Error('zip 本地文件头损坏'), { status: 400 });
  }
  const nameLength = buf.readUInt16LE(entry.localOffset + 26);
  const extraLength = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buf.length) {
    throw Object.assign(new Error('zip 数据截断'), { status: 400 });
  }
  const compressed = buf.subarray(start, end);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) {
    const data = inflateRawSync(compressed);
    if (data.length > MAX_ENTRY) {
      throw Object.assign(new Error(`zip 内文件过大：${entry.name}`), { status: 400 });
    }
    return data;
  }
  throw Object.assign(new Error(`不支持的压缩方式：${entry.name}`), { status: 400 });
}

export function inspectPluginZip(buf) {
  const entries = listZipEntries(buf);
  const packages = entries.filter((entry) => (
    /(^|\/)package\.json$/i.test(entry.name) && !entry.name.split('/').includes('node_modules')
  ));
  if (packages.length === 0) {
    throw Object.assign(new Error('zip 根目录或插件目录里需要有 package.json'), { status: 400 });
  }
  packages.sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  const manifestEntry = packages[0];
  const base = manifestEntry.name.includes('/')
    ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1)
    : '';
  let manifest;
  try {
    manifest = JSON.parse(readZipEntry(buf, manifestEntry).toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('package.json 不是合法 JSON'), { status: 400 });
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw Object.assign(new Error('package.json 必须是对象'), { status: 400 });
  }
  const readmeEntry = entries.find((entry) => (
    entry.name.startsWith(base) &&
    !entry.name.slice(base.length).includes('/') &&
    /^readme(\.[a-z0-9]+)?$/i.test(entry.name.slice(base.length))
  ));
  const readme = readmeEntry ? readZipEntry(buf, readmeEntry).toString('utf8').slice(0, 100000) : '';
  return { manifest, readme, root: base };
}
