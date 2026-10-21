import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from './wav.ts';

// whisper.cpp only accepts 16 kHz mono 16-bit PCM — it will not resample for
// us (that path needs ffmpeg, which this project deliberately doesn't depend
// on). So the header is not boilerplate to get roughly right: if the rate it
// declares is wrong, every timestamp and every phoneme is wrong too.

test('writes a 16 kHz mono 16-bit PCM header', () => {
  const wav = encodeWav(new Int16Array([0, 1, -1]));

  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.subarray(12, 16).toString('ascii'), 'fmt ');
  assert.equal(wav.readUInt32LE(16), 16, 'fmt chunk size');
  assert.equal(wav.readUInt16LE(20), 1, 'format: PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'channels: mono');
  assert.equal(wav.readUInt32LE(24), 16000, 'sample rate');
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample');
});

test('byte rate and block align match the format', () => {
  const wav = encodeWav(new Int16Array([0]));

  assert.equal(wav.readUInt32LE(28), 16000 * 1 * 2, 'byte rate');
  assert.equal(wav.readUInt16LE(32), 1 * 2, 'block align');
});

test('declares the exact length of the data chunk', () => {
  const samples = new Int16Array([1, 2, 3, 4, 5]);
  const wav = encodeWav(samples);

  assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
  assert.equal(wav.readUInt32LE(40), samples.length * 2, 'data chunk size');
  assert.equal(wav.length, 44 + samples.length * 2, 'total length');
  // The two RIFF size fields are what a strict reader trusts over the actual
  // file length, so a wrong value here reads as a truncated file.
  assert.equal(wav.readUInt32LE(4), wav.length - 8, 'RIFF size');
});

test('writes samples as little-endian signed 16-bit', () => {
  const wav = encodeWav(new Int16Array([0, 1000, -1000, 32767, -32768]));
  const data = wav.subarray(44);

  assert.equal(data.readInt16LE(0), 0);
  assert.equal(data.readInt16LE(2), 1000);
  assert.equal(data.readInt16LE(4), -1000);
  assert.equal(data.readInt16LE(6), 32767);
  assert.equal(data.readInt16LE(8), -32768);
});

test('an empty buffer is still a valid, header-only wav', () => {
  const wav = encodeWav(new Int16Array([]));

  assert.equal(wav.length, 44);
  assert.equal(wav.readUInt32LE(40), 0);
  assert.equal(wav.readUInt32LE(4), 36);
});
