module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tst'],
  testMatch: ['**/*.tst.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
