const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

require('./scripts/registerEnv');

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),
    timers: path.resolve(__dirname, 'polyfills/timers'),
  },
};

module.exports = config;
