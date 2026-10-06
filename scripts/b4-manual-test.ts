import { DataSource } from 'typeorm';
import { LedgerAccount } from '../src/money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '../src/money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '../src/money/ledger/entities/ledger-transaction.entity';
import { LedgerService } from '../src/money/ledger/ledger.service';
import { LedgerOwnerType, LedgerPurpose } from '../src/money/ledger/ledger.types';
import * as jwt from 'jsonwebtoken';

const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    ...TEST_DB,
    entities: [LedgerAccount, LedgerEntry, LedgerTransaction],
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();

  // Clean and create admin user
  await dataSource.query('DELETE FROM users');
  await dataSource.query(
    `INSERT INTO users (id, full_name, email, password, role) VALUES (1, 'Admin', 'admin@test.com', 'x', 'admin')`,
  );

  const ledger = new LedgerService(dataSource);

  // Create a platform/revenue account to corrupt
  const revenue = await ledger.getOrCreateAccount(
    LedgerOwnerType.PLATFORM,
    null,
    LedgerPurpose.REVENUE,
  );
  console.log('Revenue account id:', revenue.id);

  // Test 1: Initial state should be balanced
  console.log('\n=== Test 1: Initial state ===');
  const kq1 = await dataSource.query(
    `SELECT COALESCE(SUM(amount), 0) AS tong FROM ledger_entries`,
  );
  console.log('Tong but toan:', kq1[0]?.tong);
  console.log('Expected: 0');

  // Test 2: Corrupt the balance
  console.log('\n=== Test 2: Corrupt balance (+1000) ===');
  await dataSource.query(
    `UPDATE ledger_accounts SET balance = balance + 1000 WHERE id = ?`,
    [revenue.id],
  );
  console.log('Updated balance for account', revenue.id);

  // Check reconciliation would detect it
  const lechRows = await dataSource.query(
    `SELECT a.id, a.owner_type, a.owner_id, a.purpose, a.balance,
            COALESCE(SUM(e.amount), 0) AS tong_but_toan
     FROM ledger_accounts a
     LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.id, a.owner_type, a.owner_id, a.purpose, a.balance
     HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
  );
  console.log('So tai khoan lech:', lechRows.length);
  if (lechRows.length > 0) {
    const r = lechRows[0];
    console.log('Lech tai khoan:', {
      id: r.id,
      owner_type: r.owner_type,
      purpose: r.purpose,
      balance: r.balance,
      tong_but_toan: r.tong_but_toan,
      lech: String(r.balance - r.tong_but_toan),
    });
  }

  // Test 3: Restore balance
  console.log('\n=== Test 3: Restore balance (-1000) ===');
  await dataSource.query(
    `UPDATE ledger_accounts SET balance = balance - 1000 WHERE id = ?`,
    [revenue.id],
  );
  console.log('Restored balance for account', revenue.id);

  const lechRows2 = await dataSource.query(
    `SELECT a.id, a.owner_type, a.owner_id, a.purpose, a.balance,
            COALESCE(SUM(e.amount), 0) AS tong_but_toan
     FROM ledger_accounts a
     LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.id, a.owner_type, a.owner_id, a.purpose, a.balance
     HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
  );
  console.log('So tai khoan lech sau restore:', lechRows2.length);
  console.log('Expected: 0');

  await dataSource.destroy();
  console.log('\n=== CA DOI CHUNG HOAN TAT ===');
}

main().catch(console.error);