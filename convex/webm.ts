export function webmDuration(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => { throw new Error("Use a WebM recording containing one Opus audio track without lacing."); };
  function vint(offset: number, id = false) {
    if (offset >= bytes.length || bytes[offset] === 0) return fail();
    let length = 1;
    let mask = 128;
    while (!(bytes[offset] & mask)) { length++; mask >>= 1; }
    if (length > (id ? 4 : 8) || offset + length > bytes.length) return fail();
    let value = id ? bytes[offset] : bytes[offset] & (mask - 1);
    let unknown = !id && value === mask - 1;
    for (let n = 1; n < length; n++) {
      value = value * 256 + bytes[offset + n];
      unknown = unknown && bytes[offset + n] === 255;
    }
    return { length, value, unknown };
  }
  function uint(start: number, end: number) {
    if (end - start > 6) return fail();
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + bytes[i];
    return value;
  }
  function opusDuration(start: number, end: number) {
    if (start >= end) return fail();
    const toc = bytes[start];
    const config = toc >> 3;
    const frameMs = config >= 16 ? 2.5 * 2 ** (config % 4) : config >= 12 ? 10 * 2 ** (config % 2) : [10, 20, 40, 60][config % 4];
    const code = toc & 3;
    if (code === 3 && start + 1 >= end) return fail();
    const frames = code === 0 ? 1 : code === 3 ? bytes[start + 1] & 63 : 2;
    const duration = frameMs * frames;
    if (frames < 1 || duration > 120) return fail();
    return duration;
  }
  let scale = 1_000_000;
  let metadataTicks = 0;
  let docType = "";
  let trackType = 0;
  let codec = "";
  let track = 0;
  let trackCount = 0;
  let clusterTicks = 0;
  const blocks: Array<{ track: number; timestamp: number; duration: number }> = [];
  function elements(start: number, end: number, depth: number, stopAtCluster = false): number {
    if (depth > 8) return fail();
    for (let offset = start; offset < end;) {
      const id = vint(offset, true);
      if (stopAtCluster && id.value === 0x1f43b675) return offset;
      const size = vint(offset + id.length);
      const data = offset + id.length + size.length;
      const next = size.unknown ? end : data + size.value;
      if (!Number.isSafeInteger(next) || next > end || next < data) return fail();
      if (size.unknown && id.value !== 0x18538067 && id.value !== 0x1f43b675) return fail();
      if ([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0].includes(id.value)) {
        if (id.value === 0xae) trackCount++;
        if (id.value === 0x1f43b675) clusterTicks = 0;
        const consumed = elements(data, next, depth + 1, size.unknown && id.value === 0x1f43b675);
        if (consumed !== next) { offset = consumed; continue; }
      } else if (id.value === 0x4282) docType = new TextDecoder().decode(bytes.subarray(data, next));
      else if (id.value === 0x2ad7b1) scale = uint(data, next);
      else if (id.value === 0x4489) {
        if (next - data !== 4 && next - data !== 8) return fail();
        metadataTicks = next - data === 4 ? view.getFloat32(data) : view.getFloat64(data);
      } else if (id.value === 0x83) trackType = uint(data, next);
      else if (id.value === 0xd7) track = uint(data, next);
      else if (id.value === 0x86) codec = new TextDecoder().decode(bytes.subarray(data, next));
      else if (id.value === 0xe7) clusterTicks = uint(data, next);
      else if (id.value === 0xa3 || id.value === 0xa1) {
        const blockTrack = vint(data);
        const timestamp = data + blockTrack.length;
        if (timestamp + 3 >= next || (bytes[timestamp + 2] & 6)) return fail();
        blocks.push({
          track: blockTrack.value, timestamp: clusterTicks + view.getInt16(timestamp),
          duration: opusDuration(timestamp + 3, next),
        });
      }
      offset = next;
    }
    return end;
  }
  elements(0, bytes.length, 0);
  if (docType !== "webm" || trackCount !== 1 || trackType !== 2 || codec !== "A_OPUS" || !track || !blocks.length || scale <= 0 || !Number.isFinite(metadataTicks)) return fail();
  let endMs = 0;
  let samplesMs = 0;
  for (const block of blocks) {
    if (block.track !== track || block.timestamp < -1000) return fail();
    endMs = Math.max(endMs, block.timestamp * scale / 1_000_000 + block.duration);
    samplesMs += block.duration;
  }
  return Math.max(endMs, samplesMs, metadataTicks * scale / 1_000_000) / 1000;
}
