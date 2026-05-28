const path = require('path');

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.{ts,tsx}'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Keep React and react-test-renderer on the mobile workspace's React 19 pair.
    '^react$': path.resolve(__dirname, 'node_modules/react/index.js'),
    '^react/(.*)$': path.resolve(__dirname, 'node_modules/react/$1'),
  },
  // In npm workspaces, jest-expo is hoisted to root but react-native is in workspace.
  // modulePaths lets jest-expo's preset find react-native from the workspace node_modules.
  modulePaths: [path.resolve(__dirname, 'node_modules')],
  setupFiles: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>'],
};
