module.exports = {
  "setupFilesAfterEnv": [
    "./jest.setup.js"
  ],
  "testMatch": [
    "**/__tests__/**/*.+(ts|tsx|js)",
    "**/?(*.)+(test).+(ts|tsx|js)"

  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
};
