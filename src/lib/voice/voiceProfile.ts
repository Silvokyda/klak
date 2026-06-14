import type { AppSettings } from "../../types";

export interface VoiceProfile {
  version: 1;
  phrase: string;
  samples: number;
  mean: VoiceFeatures;
  tolerance: VoiceFeatures;
  createdAt: string;
}

interface VoiceFeatures {
  pitchHz: number;
  rms: number;
  zcr: number;
}

export async function createVoiceProfile(samples: Blob[], phrase: string): Promise<string> {
  if (samples.length < 3) {
    throw new Error("Capture at least three owner samples before enabling voice lock.");
  }

  const features = await Promise.all(samples.map(extractVoiceFeatures));
  const mean = averageFeatures(features);
  const deviation = averageDeviation(features, mean);
  const profile: VoiceProfile = {
    version: 1,
    phrase,
    samples: samples.length,
    mean,
    tolerance: {
      pitchHz: Math.max(45, deviation.pitchHz * 2.8),
      rms: Math.max(0.035, deviation.rms * 3.2),
      zcr: Math.max(0.035, deviation.zcr * 3.2)
    },
    createdAt: new Date().toISOString()
  };

  return JSON.stringify(profile);
}

export async function verifyOwnerVoice(audio: Blob, settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.voiceProfileEnabled) return { ok: true, message: "Voice profile is disabled." };
  if (!settings.voiceProfileCalibration) {
    return { ok: false, message: "Voice profile is enabled but no owner profile is enrolled." };
  }

  const profile = parseProfile(settings.voiceProfileCalibration);
  const features = await extractVoiceFeatures(audio);
  const pitchDistance = normalizedDistance(features.pitchHz, profile.mean.pitchHz, profile.tolerance.pitchHz);
  const rmsDistance = normalizedDistance(features.rms, profile.mean.rms, profile.tolerance.rms);
  const zcrDistance = normalizedDistance(features.zcr, profile.mean.zcr, profile.tolerance.zcr);
  const score = pitchDistance * 0.56 + rmsDistance * 0.18 + zcrDistance * 0.26;

  if (score <= 1.15) {
    return { ok: true, message: "Owner voice matched." };
  }

  return {
    ok: false,
    message: "Voice lock did not match the enrolled owner. Klak ignored this voice command."
  };
}

export function voiceProfileSummary(settings: AppSettings): string {
  if (!settings.voiceProfileCalibration) return "No owner voice profile captured.";
  try {
    const profile = parseProfile(settings.voiceProfileCalibration);
    return `Owner profile enrolled with ${profile.samples} samples.`;
  } catch {
    return "Owner voice profile data is unreadable.";
  }
}

async function extractVoiceFeatures(audio: Blob): Promise<VoiceFeatures> {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Audio analysis is not available in this WebView.");

  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await audio.arrayBuffer());
    const data = downmix(buffer);
    const trimmed = trimSilence(data);
    if (trimmed.length < buffer.sampleRate * 0.45) {
      throw new Error("The voice sample is too short or too quiet.");
    }

    return {
      pitchHz: estimatePitch(trimmed, buffer.sampleRate),
      rms: rootMeanSquare(trimmed),
      zcr: zeroCrossingRate(trimmed)
    };
  } finally {
    await context.close();
  }
}

function downmix(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      output[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return output;
}

function trimSilence(data: Float32Array): Float32Array {
  const threshold = Math.max(0.012, rootMeanSquare(data) * 0.34);
  let start = 0;
  let end = data.length - 1;
  while (start < data.length && Math.abs(data[start]) < threshold) start += 1;
  while (end > start && Math.abs(data[end]) < threshold) end -= 1;
  return data.slice(start, end + 1);
}

function rootMeanSquare(data: Float32Array): number {
  const sum = data.reduce((total, value) => total + value * value, 0);
  return Math.sqrt(sum / Math.max(1, data.length));
}

function zeroCrossingRate(data: Float32Array): number {
  let crossings = 0;
  for (let index = 1; index < data.length; index += 1) {
    if ((data[index - 1] < 0 && data[index] >= 0) || (data[index - 1] >= 0 && data[index] < 0)) {
      crossings += 1;
    }
  }
  return crossings / Math.max(1, data.length);
}

function estimatePitch(data: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 300);
  const maxLag = Math.floor(sampleRate / 75);
  let bestLag = minLag;
  let bestCorrelation = -Infinity;
  const stride = Math.max(1, Math.floor(data.length / 18000));

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let count = 0;
    for (let index = 0; index + lag < data.length; index += stride) {
      correlation += data[index] * data[index + lag];
      count += 1;
    }
    const normalized = correlation / Math.max(1, count);
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }

  return sampleRate / bestLag;
}

function averageFeatures(features: VoiceFeatures[]): VoiceFeatures {
  return {
    pitchHz: average(features.map((item) => item.pitchHz)),
    rms: average(features.map((item) => item.rms)),
    zcr: average(features.map((item) => item.zcr))
  };
}

function averageDeviation(features: VoiceFeatures[], mean: VoiceFeatures): VoiceFeatures {
  return {
    pitchHz: average(features.map((item) => Math.abs(item.pitchHz - mean.pitchHz))),
    rms: average(features.map((item) => Math.abs(item.rms - mean.rms))),
    zcr: average(features.map((item) => Math.abs(item.zcr - mean.zcr)))
  };
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function normalizedDistance(value: number, mean: number, tolerance: number): number {
  return Math.abs(value - mean) / Math.max(tolerance, 0.0001);
}

function parseProfile(value: string): VoiceProfile {
  const profile = JSON.parse(value) as VoiceProfile;
  if (profile.version !== 1 || !profile.mean || !profile.tolerance) {
    throw new Error("Unsupported voice profile format.");
  }
  return profile;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
