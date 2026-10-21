const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/**
 * Encode raw mono PCM as a WAV buffer — the one format whisper.cpp accepts
 * without ffmpeg, which this project deliberately does not depend on.
 *
 * It will not resample, so `sampleRate` must be the rate the samples were
 * actually captured at; declaring a rate the audio doesn't match stretches
 * the whole clip and quietly degrades recognition rather than erroring.
 */
export function encodeWav(pcm: Int16Array, sampleRate = 16000): Buffer {
  const dataBytes = pcm.length * BYTES_PER_SAMPLE;
  const wav = Buffer.alloc(HEADER_BYTES + dataBytes);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');

  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16); // fmt chunk length
  wav.writeUInt16LE(1, 20); // 1 = uncompressed PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28); // byte rate
  wav.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample

  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < pcm.length; i++) {
    wav.writeInt16LE(pcm[i], HEADER_BYTES + i * BYTES_PER_SAMPLE);
  }

  return wav;
}
