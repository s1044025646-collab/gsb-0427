export const SAMPLE_RATE = 8000;
export const ROW_FREQS = [697, 770, 852, 941] as const;
export const COL_FREQS = [1209, 1336, 1477, 1633] as const;
export const ALL_FREQS = [...ROW_FREQS, ...COL_FREQS] as const;

export const KEYPAD: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477], "A": [697, 1633],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477], "B": [770, 1633],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477], "C": [852, 1633],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477], "D": [941, 1633],
};

export const MIN_SAMPLES = 400;
export const MAX_SAMPLES = 8000;
export const MIN_RMS = 0.01;
export const DOMINANCE_RATIO = 4;
export const BALANCE_MIN = 0.25;
export const BALANCE_MAX = 4;
export const ENERGY_SHARE_MIN = 0.6;
export const NEGATIVE_POWER_TOLERANCE = 1e-9;

export const ALGORITHM_VERSION = "goertzel-dtmf/1.0.0";
