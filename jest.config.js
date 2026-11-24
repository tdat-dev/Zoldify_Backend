const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');

/**
 * Cấu hình Jest, chuyển từ khối "jest" trong package.json ra file riêng.
 *
 * Lý do chuyển: Jest không đọc `paths` của tsconfig, nên mọi test chạm tới
 * entity đều chết với "Cannot find module '@identity/...". Đọc thẳng từ
 * tsconfig để lúc thêm context thứ 9 không ai phải nhớ sửa hai chỗ.
 */
module.exports = {
  // Enable ESM support for Jest
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  // Use ts-jest transformer with ESM flag
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { useESM: true }],
  },
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\\.spec\\\.ts$',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',

  // Chạy tuần tự, không song song.
  // Các spec về tiền chạy trên MySQL thật và dùng CHUNG một database
  // zoldify_test; mỗi spec xoá sạch bảng của mình ở beforeEach. Để jest chạy
  // song song thì chúng xoá dữ liệu của nhau giữa chừng và tranh khoá dòng —
  // triệu chứng là "Deadlock found when trying to get lock", đỏ ngẫu nhiên
  // mỗi lần một khác. Từng file chạy riêng đều xanh.
  // Đánh đổi: suite chậm hơn. Với vài file thì không đáng kể, và test tiền
  // đỏ chập chờn thì tệ hơn nhiều.
  maxWorkers: 1,

  // globalSetup disabled for CI
  moduleNameMapper: {
    'ioredis': '<rootDir>/../__mocks__/ioredis.ts',
    ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/../' }),
  },
};