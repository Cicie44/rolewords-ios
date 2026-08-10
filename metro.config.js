// Windows-only fix: Metro's file watcher crashes with ENOENT when a tool
// (e.g. Codex) briefly creates and removes files under
// .git/refs/codex/turn-diffs/captures/... while Metro is watching the repo
// root. Metro's default blockList doesn't exclude .git at all, so this adds
// one more pattern on top of it rather than replacing it.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  ...config.resolver.blockList,
  /(?:^|[\\/])\.git(?:[\\/]|$)/,
];

module.exports = config;
