import { analyze } from "./dtmf.js";
import { synthesize } from "./synth.js";

function showCase(title: string, samples: number[]): void {
  const r = analyze(samples);
  console.log(`=== ${title} ===`);
  console.log(`status=${r.status} key=${r.key ?? "-"} rms=${r.rms.toFixed(4)}`);
  console.log(
    `row winner=${r.rowWinner?.freq}Hz (norm ${r.rowWinner?.normalizedPower.toExponential(3)}), ` +
      `col winner=${r.colWinner?.freq}Hz (norm ${r.colWinner?.normalizedPower.toExponential(3)})`,
  );
  console.log(
    `checks: rowDom=${r.checks.rowDominance?.toFixed(2)} colDom=${r.checks.colDominance?.toFixed(2)} ` +
      `balance=${r.checks.balanceRatio?.toFixed(3)} share=${r.checks.energyShare?.toFixed(3)}`,
  );
  if (r.rejectReasons.length) {
    console.log(`rejects: ${r.rejectReasons.map((x) => `${x.code}(${x.message})`).join("; ")}`);
  }
  console.log("");
}

const key5 = synthesize({ key: "5" }).samples;
showCase("key 5 (770+1336 Hz)", key5);

const single = synthesize({ freqs: [770], amplitudes: [0.3] }).samples;
showCase("single tone 770 Hz", single);

const silence = new Array(640).fill(0);
showCase("silence", silence);

const imbalanced = synthesize({ key: "5", rowAmplitude: 0.5, colAmplitude: 0.02 }).samples;
showCase("severe amplitude imbalance (row 0.5 / col 0.02)", imbalanced);
