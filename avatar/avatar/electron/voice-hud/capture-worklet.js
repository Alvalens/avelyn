/**
 * Runs on the audio thread.
 *
 * A real file rather than a Blob URL so it stays inside the page's
 * `script-src 'self'` policy — and so a mistake in here reports a line number
 * instead of failing silently as a string.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.pending.push(channel.slice(0));

      // Buffered to ~85 ms before posting: sending every 128-sample block
      // would be ~375 messages a second for no benefit.
      const frames = this.pending.reduce((total, block) => total + block.length, 0);
      if (frames >= 4096) {
        const merged = new Float32Array(frames);
        let at = 0;
        for (const block of this.pending) {
          merged.set(block, at);
          at += block.length;
        }
        this.port.postMessage(merged, [merged.buffer]);
        this.pending = [];
      }
    }

    // Output is left silent. This node is connected to the destination only
    // so the graph keeps pulling it; copying input through would echo the
    // microphone out of the speakers.
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
