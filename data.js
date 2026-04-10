// data.js

// Your core stimuli, converted to objects
export const STIMS = [
  ["-1", "clopotului", "copac", "toba", "clopot", "copac", "306", "Before"],
  ["-2", "tobei", "semafor", "roata", "tobă", "semafor", "57", "After"],
  ["-3", "clopotului", "copac", "butoiul", "clopot", "copac", "326", "After"],
  ["-4", "coșului de gunoi", "tobă", "clopotul", "coș de gunoi", "tobă", "49", "After"],
  ["1", "roții", "butoi", "semaforul", "roată", "butoi", "143", "None"],
  ["2", "tobei", "copac", "roata", "tobă", "copac", "249", "None"],
  ["3", "semaforului", "tobă", "coșul de gunoi", "semafor", "tobă", "93", "None"],
  ["4", "tobei", "clopot", "roata", "tobă", "clopot", "165", "None"],
  ["5", "semaforului", "copac", "butoiul", "semafor", "copac", "318", "None"],
  ["6", "semaforului", "clopot", "roata", "semafor", "clopot", "250", "None"],
  ["7", "butoiului", "coșului de gunoi", "clopotul", "butoi", "coș de gunoi", "333", "None"],
  ["8", "coșului de gunoi", "clopot", "semaforul", "coș de gunoi", "clopot", "268", "None"],
  ["9", "roții", "semafor", "copacul", "roată", "semafor", "266", "None"],
  ["10", "butoiului", "tobă", "roata", "butoi", "tobă", "41", "None"],
  ["11", "copacului", "clopot", "coșul de gunoi", "copac", "clopot", "25", "None"],
  ["12", "tobei", "coșului de gunoi", "butoiul", "tobă", "coș de gunoi", "151", "None"],
].map(([index, text1, text2, text3, text4, text5, expectedAngle, controlLineDraw]) => ({
  index,
  text1,
  text2,
  text3,
  text4,
  text5,
  expectedAngle: Number(expectedAngle),
  controlLineDraw,
}));

// ---- Images ----

// Description page image (bottom of the page)
export const DESCRIPTION_IMAGE = './assets/description.png';

// Test page image (Left-Top cell)
// Option A: single shared image for all tests
export const TEST_IMAGE = './assets/test.png';

// Option B (optional): per-stimulus image mapping (uncomment and customize)
// export const STIM_IMAGE_MAP = {
//   "-1": "./assets/clopot-tree-toba.jpg",
//   "-2": "./assets/toba-semafor-roata.jpg",
//   // ...
// };
