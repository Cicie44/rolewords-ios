import * as Speech from 'expo-speech';
import type { Voice } from 'expo-speech';

// Preferred voice languages in priority order, falling back down the list.
const PREFERRED_LANGUAGES = ['en-NZ', 'en-AU', 'en-GB', 'en-US'];

// Slightly slower than the device default (1.0) so words stay clear for learners.
const LEARNING_SPEECH_RATE = 0.85;

let preferredVoicePromise: Promise<Voice | null> | null = null;

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
 */
export async function playPronunciation(text: string): Promise<void> {
  if (!text) {
    return;
  }

  try {
    await Speech.stop();
  } catch {
    // Nothing was playing; safe to ignore.
  }

  try {
    const voice = await resolvePreferredVoice();

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
