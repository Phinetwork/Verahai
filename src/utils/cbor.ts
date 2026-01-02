const textDecoder = new TextDecoder();

type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

type Reader = {
  data: Uint8Array;
  offset: number;
};

function readUint(reader: Reader, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = (value << 8) | reader.data[reader.offset + i];
  }
  reader.offset += length;
  return value;
}

function readLength(reader: Reader, info: number): number {
  if (info < 24) return info;
  if (info === 24) return readUint(reader, 1);
  if (info === 25) return readUint(reader, 2);
  if (info === 26) return readUint(reader, 4);
  if (info === 27) {
    const high = readUint(reader, 4);
    const low = readUint(reader, 4);
    return high * 2 ** 32 + low;
  }
  throw new Error("Unsupported CBOR length encoding.");
}

function readValue(reader: Reader): CborValue {
  if (reader.offset >= reader.data.length) {
    throw new Error("Unexpected end of CBOR data.");
  }
  const initial = reader.data[reader.offset++];
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0: {
      return readLength(reader, info);
    }
    case 1: {
      return -1 - readLength(reader, info);
    }
    case 2: {
      const len = readLength(reader, info);
      const start = reader.offset;
      reader.offset += len;
      return reader.data.slice(start, start + len);
    }
    case 3: {
      const len = readLength(reader, info);
      const start = reader.offset;
      reader.offset += len;
      return textDecoder.decode(reader.data.slice(start, start + len));
    }
    case 4: {
      const len = readLength(reader, info);
      const arr: CborValue[] = [];
      for (let i = 0; i < len; i += 1) arr.push(readValue(reader));
      return arr;
    }
    case 5: {
      const len = readLength(reader, info);
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < len; i += 1) {
        const key = readValue(reader);
        const value = readValue(reader);
        map.set(key, value);
      }
      return map;
    }
    case 7: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new Error("Unsupported CBOR simple value.");
    }
    default:
      throw new Error("Unsupported CBOR major type.");
  }
}

export function decodeCbor(data: Uint8Array): CborValue {
  const reader: Reader = { data, offset: 0 };
  const value = readValue(reader);
  return value;
}

