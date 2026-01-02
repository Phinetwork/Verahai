export type KaiMood = 'calm' | 'focused' | 'surge' | 'reveal';

export interface PulseState {
  time: string;
  kaiMood: KaiMood;
  beat: number;
}
