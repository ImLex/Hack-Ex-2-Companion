/**
 * Metro is the tool that bundles all your code into something a phone (or a
 * browser) can run. This file only exists to make the *web* version work —
 * Android and iOS need none of it.
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// On the web, expo-sqlite runs a real SQLite engine compiled to WebAssembly.
// Metro does not treat .wasm as a bundleable asset unless told to.
config.resolver.assetExts.push('wasm');

// That WebAssembly build stores your data in the browser's private file system
// (OPFS), which browsers only permit on cross-origin-isolated pages. These two
// headers are what makes a page cross-origin isolated. Without them the web
// version loads but cannot save anything.
config.server = config.server ?? {};
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
