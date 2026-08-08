const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');

/**
 * Cấu hình Jest, chuyển từ khối "jest" trong package.json ra file riêng.
 *
 * Lý do chuyển: Jest không đọc `paths` của tsconfig, nên mọi test chạm tới
 * entity đều chết với "Cannot find module '@identity/...'". Đọc thẳng từ
 * tsconfig để lúc thêm context thứ 9 không ai phải nhớ sửa hai chỗ.
 */
module.exports = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/../',
  }),
};
