// ring.js
// ---------------------------------------------------------------------------
// Byte-capped ring buffer of log chunks, one instance per project.
// Keeps the most-recent chunks up to `maxBytes`; older chunks are evicted
// FIFO and counted in `droppedBytes`. See SPEC §4 (ringBytes) and §3.2.
// ---------------------------------------------------------------------------

export class RingBuffer {
  /**
   * @param {number} maxBytes  total byte cap across all retained chunks
   */
  constructor(maxBytes = 262144) {
    this.maxBytes = maxBytes;
    /** @type {string[]} retained log chunks (utf8 strings) */
    this.chunks = [];
    /** @type {number} current total byte size of retained chunks */
    this.bytes = 0;
    /** @type {number} bytes evicted over the lifetime of this ring */
    this.droppedBytes = 0;
  }

  /** Byte length of a utf8 string. */
  static _len(s) {
    return Buffer.byteLength(s, 'utf8');
  }

  /**
   * Append a chunk, evicting oldest chunks until within the byte cap.
   * @param {string} chunk
   */
  push(chunk) {
    if (!chunk) return;
    const size = RingBuffer._len(chunk);

    // If a single chunk exceeds the cap, keep only its tail.
    if (size > this.maxBytes) {
      const buf = Buffer.from(chunk, 'utf8');
      const tail = buf.subarray(buf.length - this.maxBytes).toString('utf8');
      this.droppedBytes += size - RingBuffer._len(tail);
      this.chunks = [tail];
      this.bytes = RingBuffer._len(tail);
      return;
    }

    this.chunks.push(chunk);
    this.bytes += size;

    // Evict from the front until we fit.
    while (this.bytes > this.maxBytes && this.chunks.length > 0) {
      const evicted = this.chunks.shift();
      const evictedSize = RingBuffer._len(evicted);
      this.bytes -= evictedSize;
      this.droppedBytes += evictedSize;
    }
  }

  /**
   * Snapshot the retained chunks (optionally only the last N).
   * @param {number} [tail]  if provided, return only the last `tail` chunks
   * @returns {string[]}
   */
  snapshot(tail) {
    if (tail && tail > 0 && tail < this.chunks.length) {
      return this.chunks.slice(this.chunks.length - tail);
    }
    return this.chunks.slice();
  }

  /** Last retained chunk's last non-empty line (for the card preview). */
  lastLine() {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const lines = this.chunks[i].split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length) return lines[lines.length - 1];
    }
    return null;
  }

  /** Clear all retained chunks (does not reset droppedBytes). */
  clear() {
    this.chunks = [];
    this.bytes = 0;
  }
}
