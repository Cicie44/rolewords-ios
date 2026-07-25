import * as Speech from 'expo-speech';
import type { Voice } from 'expo-speech';

// Preferred voice languages in priority order, falling back down the list.
const PREFERRED_LANGUAGES = ['en-NZ', 'en-AU', 'en-GB', 'en-US'];

// Slightly slower than the device default (1.0) so words stay clear for learners.
const LEARNING_SPEECH_RATE = 0.85;

let preferredVoicePromise: Promise<Voice | null> | null = null;

// Guards against overlapping calls: only the request holding the current
// highest id is allowed to stop/start playback once its async work resolves.
let latestRequestId = 0;

function pickPreferredVoice(voices: Voice[]): Voice | null {
  for (const language of PREFERRED_LANGUAGES) {
    const matches = voices.filter(
      (voice) => voice.language?.toLowerCase() === language.toLowerCase(),
    );
    if (matches.length === 0) {
      continue;
    }
    const enhanced = matches.find((voice) => voice.quality === Speech.VoiceQuality.Enhanced);
    return enhanced ?? matches[0];
  }
  return null;
}

async function resolvePreferredVoice(): Promise<Voice | null> {
  if (!preferredVoicePromise) {
    preferredVoicePromise = Speech.getAvailableVoicesAsync()
      .then(pickPreferredVoice)
      .catch(() => null);
  }
  return preferredVoicePromise;
}

/**
 * Speaks an English word or phrase aloud, preferring en-NZ/AU/GB/US system
 * voices in that order. Stops any in-progress speech first so calls never
 * queue up, and never throws — playback failures are logged and swallowed.
 *
 * If this is called again before the previous call's voice lookup resolves,
 * only the most recent call is allowed to actually stop/start playback, so
 * rapid repeated taps end up playing just the last word requested.
 */
export async function playPronunciation(text: string): Promise<void> {
  if (!text) {
    return;
  }

  const requestId = ++latestRequestId;

  try {
    const voice = await resolvePreferredVoice();

    if (requestId !== latestRequestId) {
      // A newer request started while we were resolving the voice; drop this one.
      return;
    }

    await Speech.stop();

    if (requestId !== latestRequestId) {
      // A newer request started while we were stopping playback; drop this one.
      return;
    }

    Speech.speak(text, {
      rate: LEARNING_SPEECH_RATE,
      voice: voice?.identifier,
      language: voice ? undefined : 'en-US',
      onError: (error) => {
        console.warn('[pronunciationService] playback error:', error);
      },
    });
  } catch (error) {
    console.warn('[pronunciationService] failed to speak text:', text, error);
  }
}
