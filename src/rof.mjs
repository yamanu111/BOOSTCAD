// QuickLZ 1.5 level-1 decoder, based on the algorithm by Lasse Mikkel Reinhold.
// This project is distributed under GPL-3.0-or-later; see LICENSE.
export const u32 = (b, p) => (b[p] | b[p + 1] << 8 | b[p + 2] << 16 | b[p + 3] << 24) >>> 0;
export const u16 = (b, p) => b[p] | b[p + 1] << 8;
export const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export function quicklz(b, p = 0, cap = 1048576) {
  if (p < 0 || p + 3 > b.length) throw new Error('Truncated QuickLZ header');
  const flag = b[p], wide = (flag & 2) !== 0;
  const header = wide ? 9 : 3;
  if (p + header > b.length) throw new Error('Truncated QuickLZ header');
  const packed = wide ? u32(b, p + 1) : b[p + 1];
  const size = wide ? u32(b, p + 5) : b[p + 2];
  if (size > cap || packed < header || p + packed > b.length || !(flag & 64)) throw new Error(`QuickLZ header ${p}`);
  if (!(flag & 1)) {
    if (packed - header !== size) throw new Error('QuickLZ literal size');
    return b.slice(p + header, p + packed);
  }
  if ((flag >> 2 & 3) !== 1 || (flag >> 4 & 3) !== 0) throw new Error('Unsupported QuickLZ level/stream');
  const output = new Uint8Array(size), table = new Int32Array(4096).fill(-1);
  let input = p + header, written = 0, control = 1, hashed = -1;
  function update(until) {
    while (hashed < until) {
      hashed++;
      const value = output[hashed] | output[hashed + 1] << 8 | output[hashed + 2] << 16;
      table[(value ^ value >>> 12) & 4095] = hashed;
    }
  }
  while (written < size) {
    if (control === 1) {
      if (input + 4 > p + packed) throw new Error('Truncated QuickLZ control');
      control = u32(b, input); input += 4;
      if (!control) throw new Error('Invalid QuickLZ control');
    }
    if ((control & 1) && written < size - 10) {
      if (input + 2 > p + packed) throw new Error('Truncated QuickLZ reference');
      const token = u16(b, input), from = table[token >>> 4];
      if (!(token & 15) && input + 3 > p + packed) throw new Error('Truncated QuickLZ length');
      const length = (token & 15) ? (token & 15) + 2 : b[input + 2];
      input += (token & 15) ? 2 : 3;
      if (from < 0 || from >= written || length < 3 || written + length > size - 4) throw new Error(`Invalid QuickLZ reference ${written}/${size}`);
      const start = written;
      for (let i = 0; i < length; i++) output[written++] = output[from + i];
      update(start); hashed = written - 1;
    } else {
      if (input >= p + packed) throw new Error('Truncated QuickLZ literal');
      output[written++] = b[input++];
      if (written < size - 10) update(written - 3);
    }
    control >>>= 1;
  }
  if (input !== p + packed) throw new Error('QuickLZ packed length mismatch');
  return output;
}
const OUTER = '79a8a99645b44af3983833c33a061b06';
export function expandHeap(b) {
  if (new TextDecoder().decode(b.subarray(0, 8)) !== 'ROF FDB ') throw new Error('Not a PLN ROF file');
  if (b.length < 48 || b.length % 16) throw new Error('Truncated PLN allocation framing');
  let physical = 32, logical = 32, blocks = [], groups = [], segments = [b.slice(0, 32)];
  while (physical < b.length) {
    if (b[physical] === 66 && b[physical + 1] === 76) {
      const size = u32(b, physical + 2) * 16;
      if (size < 16 || size > b.length - physical) throw new Error(`Invalid BL ${physical}`);
      const bytes = b.slice(physical, physical + size);
      blocks.push({ offset: logical, size, physical }); segments.push(bytes);
      physical += size; logical += size;
    } else if (hex(b.subarray(physical, physical + 16)) === OUTER) {
      const start = physical, decoded = u32(b, start + 16), count = u32(b, start + 24);
      if (u32(b, start + 20) || u32(b, start + 28) || !count || count > 4096 || decoded > 128 * 1024 * 1024) throw new Error('Invalid outer group');
      physical += 32; let expanded = 0;
      for (let i = 0; i < count; i++) {
        if (physical + 7 > b.length) throw new Error('Truncated outer chunk header');
        const packed = u32(b, physical); physical += 4;
        // Small groups can use QuickLZ's three-byte header, including literal
        // chunks. Their packed length is one byte rather than a UInt32.
        const chunkPacked = b[physical] & 2 ? u32(b, physical + 1) : b[physical + 1];
        if (packed !== chunkPacked) throw new Error('Outer compressed length mismatch');
        const out = quicklz(b, physical); segments.push(out); physical += packed; expanded += out.length;
      }
      if (decoded !== expanded) throw new Error('Outer decoded length mismatch');
      // The trailer is UInt16 padding count followed by that many zero bytes.
      // Even an already aligned chunk still has this trailer (14 + 2 bytes).
      if (physical + 2 > b.length) throw new Error('Truncated outer alignment trailer');
      const padding = u16(b, physical), next = physical + 2 + padding;
      if (padding > 15 || next > b.length || next % 16 || !b.subarray(physical + 2, next).every(x => x === 0)) throw new Error('Invalid outer alignment trailer');
      physical = next;
      groups.push({ physical: start, logical, decoded, count }); logical += expanded;
    } else throw new Error(`Unknown heap framing at ${physical} (${hex(b.subarray(physical, physical + 32))})`);
    if (logical > 256 * 1024 * 1024) throw new Error('PLN expands beyond 256 MiB');
  }
  const output = new Uint8Array(logical); let offset = 0;
  for (const s of segments) { output.set(s, offset); offset += s.length; }
  return { bytes: output, groups, blocks };
}
export function allocations(b) {
  const out = []; let p = 32;
  while (p < b.length) {
    if (b[p] !== 66 || b[p + 1] !== 76) throw new Error(`Logical BL marker ${p}`);
    const size = u32(b, p + 2) * 16;
    if (size < 16 || size > b.length - p) throw new Error(`Logical BL extent ${p}`);
    out.push({ offset: p, size, kind: u16(b, p + 6), code: b[p + 9], encoding: b[p + 10], guid: hex(b.subarray(p + 11, p + 27)) });
    p += size;
  }
  return out;
}
export function zeroMask(b, size) {
  const out = new Uint8Array(size); let p = 0;
  for (let i = 0; i < size;) {
    if (p >= b.length) throw new Error('Truncated zero mask');
    const mask = b[p++];
    for (let bit = 0; bit < 8 && i < size; bit++, i++) {
      if (mask & 1 << bit) { if (p >= b.length) throw new Error('Truncated zero-mask data'); out[i] = b[p++]; }
    }
  }
  return { bytes: out, consumed: p };
}
export function payload(b, record) {
  const { offset: p, size, code, encoding } = record;
  const width = code >> 4 === 10 ? ((code & 15) >= 7 ? 4 : 2) : code >> 4 === 11 ? 4 : 0;
  if (!width) return null;
  let q = p + 27;
  const packed = width === 2 ? u16(b, q) : u32(b, q); q += width;
  if (packed > size || q + packed > p + size) throw new Error('Payload extent');
  if (encoding === 0x80) return b.slice(q, q + packed);
  if (encoding === 0x84) {
    if (q + 4 + packed > p + size) throw new Error('Literal payload extent');
    return b.slice(q + 4, q + 4 + packed);
  }
  const expanded = u32(b, q); q += 4;
  if (expanded > 64 * 1024 * 1024 || q + 4 + packed > p + size) throw new Error('Payload expanded extent');
  if (encoding === 0x85) {
    const result = zeroMask(b.subarray(q + 4, q + 4 + packed), expanded);
    if (result.consumed !== packed) throw new Error(`Zero mask consumed ${result.consumed}/${packed}`);
    return result.bytes;
  }
  if (encoding === 0x86) {
    q += 4;
    const end = q + packed; const parts = []; let total = 0;
    while (q < end) {
      const length = b[q] & 2 ? u32(b, q + 1) : b[q + 1];
      if (!length || q + length > end) throw new Error('Inner chunk extent');
      const decoded = quicklz(b, q, 262144); q += length; total += decoded.length; parts.push(decoded);
    }
    if (total !== expanded || q !== end) throw new Error('Inner decoded length');
    const output = new Uint8Array(total); let dest = 0;
    for (const part of parts) { output.set(part, dest); dest += part.length; }
    return output;
  }
  return null;
}
