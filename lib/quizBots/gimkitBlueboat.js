function writeUtf8(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 128) view.setUint8(offset++, code);
    else if (code < 2048) {
      view.setUint8(offset++, 192 | (code >> 6));
      view.setUint8(offset++, 128 | (code & 63));
    } else if (code < 55296 || code >= 57344) {
      view.setUint8(offset++, 224 | (code >> 12));
      view.setUint8(offset++, 128 | ((code >> 6) & 63));
      view.setUint8(offset++, 128 | (code & 63));
    } else {
      i++;
      code = 65536 + (((code & 1023) << 10) | (text.charCodeAt(i) & 1023));
      view.setUint8(offset++, 240 | (code >> 18));
      view.setUint8(offset++, 128 | ((code >> 12) & 63));
      view.setUint8(offset++, 128 | ((code >> 6) & 63));
      view.setUint8(offset++, 128 | (code & 63));
    }
  }
}

function encodePacket(payload) {
  const bytes = [];
  const refs = [];

  function pack(val) {
    const type = typeof val;
    if (type === 'string') {
      let len = 0;
      for (let i = 0; i < val.length; i++) {
        const code = val.charCodeAt(i);
        if (code < 128) len += 1;
        else if (code < 2048) len += 2;
        else if (code < 55296 || code >= 57344) len += 3;
        else {
          i++;
          len += 4;
        }
      }
      if (len < 32) bytes.push(160 | len);
      else if (len < 256) bytes.push(217, len);
      else if (len < 65536) bytes.push(218, len >> 8, len);
      else bytes.push(219, len >> 24, len >> 16, len >> 8, len);
      refs.push({ text: val, len });
      return bytes.length + len;
    }
    if (type === 'number') {
      if (Number.isInteger(val) && val >= 0 && val < 128) {
        bytes.push(val);
        return 1;
      }
      bytes.push(203);
      refs.push({ num: val });
      return bytes.length + 8;
    }
    if (type === 'boolean') {
      bytes.push(val ? 195 : 194);
      return 1;
    }
    if (val === null) {
      bytes.push(192);
      return 1;
    }
    if (Array.isArray(val)) {
      const len = val.length;
      if (len < 16) bytes.push(144 | len);
      else if (len < 65536) bytes.push(220, len >> 8, len);
      else bytes.push(221, len >> 24, len >> 16, len >> 8, len);
      let size = bytes.length;
      for (const item of val) size += pack(item);
      return size;
    }
    if (type === 'object') {
      const keys = Object.keys(val).filter((k) => typeof val[k] !== 'function');
      const len = keys.length;
      if (len < 16) bytes.push(128 | len);
      else if (len < 65536) bytes.push(222, len >> 8, len);
      else bytes.push(223, len >> 24, len >> 16, len >> 8, len);
      let size = bytes.length;
      for (const key of keys) {
        size += pack(key);
        size += pack(val[key]);
      }
      return size;
    }
    throw new Error('Could not encode');
  }

  const total = pack(payload);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  let offset = 0;
  let refIndex = 0;

  function write(val) {
    const type = typeof val;
    if (type === 'string') {
      const ref = refs[refIndex++];
      const len = ref.len;
      if (len < 32) view.setUint8(offset++, 160 | len);
      else if (len < 256) {
        view.setUint8(offset++, 217);
        view.setUint8(offset++, len);
      } else if (len < 65536) {
        view.setUint8(offset++, 218);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      } else {
        view.setUint8(offset++, 219);
        view.setUint8(offset++, len >> 24);
        view.setUint8(offset++, len >> 16);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      }
      writeUtf8(view, offset, val);
      offset += len;
      return;
    }
    if (type === 'number') {
      if (Number.isInteger(val) && val >= 0 && val < 128) {
        view.setUint8(offset++, val);
        return;
      }
      refs[refIndex++];
      view.setUint8(offset++, 203);
      view.setFloat64(offset, val);
      offset += 8;
      return;
    }
    if (type === 'boolean') {
      view.setUint8(offset++, val ? 195 : 194);
      return;
    }
    if (val === null) {
      view.setUint8(offset++, 192);
      return;
    }
    if (Array.isArray(val)) {
      const len = val.length;
      if (len < 16) view.setUint8(offset++, 144 | len);
      else if (len < 65536) {
        view.setUint8(offset++, 220);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      } else {
        view.setUint8(offset++, 221);
        view.setUint8(offset++, len >> 24);
        view.setUint8(offset++, len >> 16);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      }
      for (const item of val) write(item);
      return;
    }
    if (type === 'object') {
      const keys = Object.keys(val).filter((k) => typeof val[k] !== 'function');
      const len = keys.length;
      if (len < 16) view.setUint8(offset++, 128 | len);
      else if (len < 65536) {
        view.setUint8(offset++, 222);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      } else {
        view.setUint8(offset++, 223);
        view.setUint8(offset++, len >> 24);
        view.setUint8(offset++, len >> 16);
        view.setUint8(offset++, len >> 8);
        view.setUint8(offset++, len);
      }
      for (const key of keys) {
        write(key);
        write(val[key]);
      }
    }
  }

  write(payload);
  const out = new Uint8Array(buffer);
  const framed = new Uint8Array(out.length + 1);
  framed[0] = 4;
  framed.set(out, 1);
  return framed.buffer;
}

export function encodeBlueboatJoin(roomId, intentId) {
  return encodePacket({
    type: 2,
    data: ['blueboat_JOIN_ROOM', { roomId, options: { intent: intentId } }],
    options: { compress: true },
    nsp: '/',
  });
}

export function encodeBlueboatAnswer(roomId, questionId, answerId) {
  return encodePacket({
    type: 2,
    data: [
      'blueboat_SEND_MESSAGE',
      {
        room: roomId,
        key: 'QUESTION_ANSWERED',
        data: { questionId, answer: answerId },
      },
    ],
    options: { compress: true },
    nsp: '/',
  });
}