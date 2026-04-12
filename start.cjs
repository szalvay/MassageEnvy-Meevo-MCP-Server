// Node wrapper that spawns tsx without needing npx
// Avoids the "C:\Program Files" space-in-path issue on Windows
const { execFileSync } = require("child_process");
const path = require("path");

const tsxBin = path.join(__dirname, "node_modules", ".bin", "tsx.cmd");
const entry = path.join(__dirname, "src", "index.ts");

try {
  execFileSync(tsxBin, [entry], { stdio: "inherit" });
} catch (e) {
  process.exit(e.status || 1);
}
