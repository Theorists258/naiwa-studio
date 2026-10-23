import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP32 with UTF-8 filenames. Keeps packaging independent of PowerShell policies.
export function createZip(directory, output) {
  const entries = [];
  const walk = (current, relative) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Cannot package a symbolic link: ${name}`);
      if (entry.isDirectory()) walk(absolute, name);
      else entries.push({ absolute, name });
    }
  };
  walk(directory, path.basename(directory));
  if (entries.length > 65535) throw new Error("Archive exceeds the ZIP32 entry limit.");
  const now = new Date();
  const year = Math.max(1980, Math.min(2107, now.getFullYear()));
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const filename = Buffer.from(entry.name, "utf8");
    const raw = readFileSync(entry.absolute);
    const compressed = deflateRawSync(raw, { level: 9 });
    if (filename.length > 65535 || raw.length > 0xffffffff || offset + compressed.length > 0xffffffff) {
      throw new Error("Archive exceeds ZIP32 limits.");
    }
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version required
    common.writeUInt16LE(0x800, 2); // UTF-8
    common.writeUInt16LE(8, 4); // DEFLATE
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(raw), 10);
    common.writeUInt32LE(compressed.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(filename.length, 22);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    common.copy(local, 4);
    locals.push(local, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // created on DOS/Windows
    common.copy(record, 6);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize > 0xffffffff) throw new Error("Archive exceeds ZIP32 limits.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(output, Buffer.concat([...locals, ...central, end]));
}
