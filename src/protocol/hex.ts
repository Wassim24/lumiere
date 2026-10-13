export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function utf8Hex(text: string): string {
  const bin = unescape(encodeURIComponent(text));
  let s = '';
  for (let i = 0; i < bin.length; i++) s += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return s;
}

export function hexUtf8(hex: string): string {
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  try {
    return decodeURIComponent(escape(bin));
  } catch {
    return bin;
  }
}
