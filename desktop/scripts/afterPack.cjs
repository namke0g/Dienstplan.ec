// electron-builder never copies folders named node_modules into extraResources, so put the web server's packages there ourselves.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "..", "build", "app", "node_modules");
  const to = path.join(context.appOutDir, "resources", "web", "node_modules");
  fs.cpSync(from, to, { recursive: true });
};
