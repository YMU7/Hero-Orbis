// Writes data/scenes/puzzle.json from the default octagon layout in
// app/puzzle/roomLayout.ts (the file the /puzzle runtime and the Scene
// Editor load). Objects already in the file keep any extra fields (puzzle /
// painting components); the previous file is copied to data/scenes/backups.
//
//   node scripts/write-puzzle-layout.cjs
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) =>
  module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);

const root = path.join(__dirname, "..");
const { ROOM_LAYOUT } = require(path.join(root, "app/puzzle/roomLayout.ts"));
const file = path.join(root, "data/scenes/puzzle.json");
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { objects: [] };
if (fs.existsSync(file)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(file, path.join(root, `data/scenes/backups/puzzle-${stamp}.json`));
}
const extras = new Map(old.objects.map((o) => [o.id, Object.fromEntries(Object.entries(o).filter(([k]) => !["id", "name", "asset", "position", "rotation", "scale"].includes(k)))]));
const objects = ROOM_LAYOUT.map((o) => ({
  id: o.id,
  name: o.name,
  asset: `builtin:${o.kind}`,
  position: o.position,
  rotation: [0, o.rotY, 0],
  scale: o.scale ?? [1, 1, 1],
  ...(extras.get(o.id) ?? {}),
}));
fs.writeFileSync(file, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), objects }, null, 2) + "\n");
console.log(`wrote ${objects.length} objects to ${path.relative(root, file)}`);
