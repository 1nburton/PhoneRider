const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.sourceExts = Array.from(new Set([
  'ios.js',
  'native.js',
  'ios.jsx',
  'native.jsx',
  'ios.ts',
  'native.ts',
  'ios.tsx',
  'native.tsx',
  ...config.resolver.sourceExts,
]));
config.resolver.extraNodeModules = {
  '@react-native-async-storage/async-storage': path.join(projectRoot, 'src/shims/asyncStorage.js'),
};

module.exports = config;
