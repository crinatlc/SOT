
// data.js

// Your core stimuli, converted to objects
export const STIMS = [
  ["-1","clopotului","copac","toba","306","Before"],
  ["-2","tobei","semafor","roata","57","After"],
  ["-3","clopotului","copac","butoiul","326","After"],
  ["-4","coșului de gunoi","tobă","clopotul","49","After"],
  ["1","roții","butoi","semaforul","143","None"],
  ["2","tobei","copac","roata","249","None"],
  ["3","semaforului","tobă","coșul de gunoi","93","None"],
  ["4","tobei","clopot","roata","165","None"],
  ["5","semaforului","copac","butoiul","318","None"],
  ["6","semaforului","clopot","roata","250","None"],
  ["7","butoiului","coș de gunoi","clopotul","333","None"],
  ["8","coșului de gunoi","clopot","semaforul","268","None"],
  ["9","roații","semafor","copacul","266","None"],
  ["10","butoiului","tobă","roata","41","None"],
  ["11","copacului","clopot","coșul de gunoi","25","None"],
  ["12","tobei","coș de gunoi","butoiul","151","None"],
].map(([index, text1, text2, text3, expectedAngle, controlLineDraw]) => ({
  index,
  text1,
  text2,
  text3,
  expectedAngle: Number(expectedAngle),       // degrees; 0° at top; clockwise positive
  controlLineDraw,                            // "Before" | "After" | "None"
}));

// ---- Images ----

// Description page image (bottom of the page)
export const DESCRIPTION_IMAGE = './assets/description.png'; // <-- set your actual path

// Test page image (Left-Top cell)
// Option A: single shared image for all tests
export const TEST_IMAGE = './assets/test.png'; // <-- set your actual path

// Option B (optional): per-stimulus image mapping (uncomment and customize)
// export const STIM_IMAGE_MAP = {
//   "-1": "./assets/clopot-tree-tobă.jpg",
//   "-2": "./assets/tobă-semafor-roată.jpg",
//   // ...
// };
