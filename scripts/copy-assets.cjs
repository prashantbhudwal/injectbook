const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "templates");
const target = path.join(root, "dist", "templates");
const packageJsonSource = path.join(root, "package.json");
const packageJsonTarget = path.join(root, "dist", "package.json");

fs.mkdirSync(target, { recursive: true });
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }
  fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
}

fs.copyFileSync(packageJsonSource, packageJsonTarget);
