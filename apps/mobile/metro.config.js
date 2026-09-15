const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker imports wa-sqlite.wasm directly; Metro doesn't
// treat .wasm as a resolvable asset by default, which fails the web/SSR
// bundle Expo builds alongside native targets (used by @expo/router-server).
config.resolver.assetExts.push("wasm");

module.exports = config;
