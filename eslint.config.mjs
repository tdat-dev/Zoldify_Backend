// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// 6 nhóm nghiệp vụ + 4 nhóm hạ tầng. Chiều phụ thuộc chỉ đi xuống dưới:
//   ops → ordering → {catalog, money} → identity → common → core
const ALL = [
  'root',
  'core',
  'common',
  'migrations',
  'identity',
  'catalog',
  'money',
  'messaging',
  'ordering',
  'ops',
];

/** @param {string} from @param {string[]} to */
const policy = (from, to) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: { anyOf: to } } } },
});

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'scripts/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  // Ranh giới giữa các nhóm nghiệp vụ.
  //
  // Mục đích: làm cho lỗi kiểu "escrows tự đọc bảng users rồi cộng tiền"
  // không viết ra được nữa. Máy chặn, không dựa vào việc nhớ.
  {
    files: ['src/**/*.ts'],
    // Bỏ qua file test.
    //
    // Luật này tồn tại để chặn COUPLING trong mã chạy thật. Một spec tích hợp
    // phải nạp entity của nhiều nhóm để dựng lược đồ database mà chạy — ví dụ
    // escrows.service.spec.ts cần Order, Product, Category, Setting chỉ để
    // TypeORM tạo bảng. Đó không phải là phụ thuộc nghiệp vụ và nó không đi
    // vào sản phẩm.
    //
    // Nói rõ để không ai lách: cách này KHÔNG dùng để giấu vi phạm thật. Vi
    // phạm trong mã sản phẩm vẫn bị đếm đủ, và mốc chỉ được phép giảm.
    ignores: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts'],
    plugins: { boundaries },
    settings: {
      // Bắt buộc phải có. Không có resolver này thì plugin không map được
      // alias '@ordering/...' về file thật, nó coi như package ngoài và
      // luật im lặng không kiểm gì — tưởng sạch nhưng thực ra là tắt.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'root', pattern: 'src/*.ts' },
        { type: 'core', pattern: 'src/core/**/*' },
        { type: 'common', pattern: 'src/common/**/*' },
        { type: 'migrations', pattern: 'src/migrations/**/*' },
        { type: 'identity', pattern: 'src/identity/**/*' },
        { type: 'catalog', pattern: 'src/catalog/**/*' },
        { type: 'money', pattern: 'src/money/**/*' },
        { type: 'messaging', pattern: 'src/messaging/**/*' },
        { type: 'ordering', pattern: 'src/ordering/**/*' },
        { type: 'ops', pattern: 'src/ops/**/*' },
      ],
    },
    rules: {
      // Để 'warn' chứ chưa phải 'error' vì code hiện còn 28 vi phạm, phần
      // lớn là money → ordering (escrow, payments, payos đang tự đọc bảng
      // orders). Chúng sẽ biến mất khi làm ledger ở tuần 3.
      //
      // Không cho phép con số đó tăng: `npm run boundaries:check` chặn
      // trong CI. Khi về 0 thì đổi sang 'error' và xoá script đó đi.
      'boundaries/dependencies': [
        'warn',
        {
          default: 'disallow',
          policies: [
            // app.module.ts là nơi lắp ráp nên được gọi tất cả
            policy('root', ALL),
            policy('migrations', ALL),
            policy('core', ['core', 'common']),
            policy('common', ['common', 'core']),
            policy('identity', ['identity', 'common', 'core']),
            policy('catalog', ['catalog', 'identity', 'common', 'core']),
            // money KHÔNG được với sang ordering hay catalog. Muốn biết
            // đơn hàng thì để ordering gọi xuống money, không phải ngược lại.
            policy('money', ['money', 'identity', 'common', 'core']),
            policy('messaging', ['messaging', 'identity', 'common', 'core']),
            policy('ordering', [
              'ordering',
              'catalog',
              'money',
              'identity',
              'common',
              'core',
            ]),
            policy('ops', ALL),
          ],
        },
      ],
    },
  },
);
