-- Phần tiếp của seed-1m.sql: nhóm bảng tiền và các bảng còn trống ở cỡ 1 triệu.
--
-- seed-1m.sql cố ý bỏ qua sổ cái vì sổ kép có bất biến SUM(amount) = 0, chèn dòng
-- ngẫu nhiên là làm lệch ngay. File này đi đúng luồng tiền thật nên vẫn cân:
--   topup              gateway_clearing -> available của người dùng
--   order_hold         gateway_clearing -> escrow_hold (đơn PayOS đã trả)
--   escrow_release     escrow_hold -> available người bán + revenue (đơn đã giao)
--   withdrawal_approve available người bán -> withdrawal_pending
--   withdrawal_complete withdrawal_pending -> bank_external
-- Đơn COD không có ký quỹ, đúng như hệ thống thật.
--
-- balance_after tính luỹ kế theo đúng thứ tự id, giao diện lịch sử ví đọc cột này.
--
-- KHÔNG seed wallets, wallet_transactions: bảng cũ, nguồn sự thật là ledger_*.
-- KHÔNG seed push_tokens: token giả làm job gọi Firebase thật mỗi khi có thông báo.
--
-- Tiền đề: đã chạy seed-1m.sql. Chạy hai lần sẽ bị chặn ở bước kiểm đầu tiên.
-- Có binlog thì mở phiên bằng SET SESSION sql_log_bin=0, không sinh vài GB log.
--
-- id cố định, tránh mọi id thật: tài khoản 100000+n, ký quỹ và rút tiền 100000+k,
-- giao dịch sổ cái theo dải 10/20/30/40/50 triệu.

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
SET SESSION unique_checks = 0;
SET SESSION foreign_key_checks = 0;
SET @t0 = NOW(6);

DROP TABLE IF EXISTS _so;
CREATE TABLE _so (n INT NOT NULL PRIMARY KEY) ENGINE = InnoDB;
INSERT INTO _so (n)
SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000
  FROM (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
       (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b,
       (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c,
       (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) d,
       (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) e,
       (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) f;

DROP TABLE IF EXISTS _esc;
CREATE TABLE _esc (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  buyer_id INT NOT NULL,
  seller_id INT NOT NULL,
  amt BIGINT NOT NULL,
  da_giai_ngan TINYINT NOT NULL,
  ct DATETIME(6) NOT NULL
) ENGINE = InnoDB;

-- Số dư đang chạy của người bán, nối tiếp giữa các lô.
DROP TABLE IF EXISTS _sb;
CREATE TABLE _sb (seller_id INT NOT NULL PRIMARY KEY, bal BIGINT NOT NULL) ENGINE = InnoDB;

DROP PROCEDURE IF EXISTS _seed_1m_tien;
DELIMITER //
CREATE PROCEDURE _seed_1m_tien()
BEGIN
  DECLARE LO INT DEFAULT 100000;
  DECLARE T BIGINT DEFAULT 5000000;
  DECLARE W BIGINT DEFAULT 200000;
  DECLARE a INT DEFAULT 0;
  DECLARE tong INT DEFAULT 0;
  DECLARE gw BIGINT; DECLARE es BIGINT; DECLARE rv BIGINT; DECLARE bk BIGINT;
  DECLARE gwb BIGINT; DECLARE esb BIGINT; DECLARE rvb BIGINT; DECLARE bkb BIGINT DEFAULT 0;
  DECLARE so_gw INT DEFAULT 0; DECLARE so_es INT DEFAULT 0;
  DECLARE so_rv INT DEFAULT 0; DECLARE so_bk INT DEFAULT 0;

  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'seed1m:topup:0') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'seed-1m-tien da chay roi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = 1099999) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'chua chay seed-1m.sql';
  END IF;

  -- Tài khoản nền của sàn: lấy số dư thật làm mốc, không ghi đè.
  SELECT id, balance INTO gw, gwb FROM ledger_accounts
   WHERE owner_type = 'external' AND purpose = 'gateway_clearing' LIMIT 1;
  SELECT id, balance INTO es, esb FROM ledger_accounts
   WHERE owner_type = 'platform' AND purpose = 'escrow_hold' LIMIT 1;
  SELECT id, balance INTO rv, rvb FROM ledger_accounts
   WHERE owner_type = 'platform' AND purpose = 'revenue' LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE owner_type = 'external' AND purpose = 'bank_external') THEN
    INSERT INTO ledger_accounts (owner_type, owner_id, purpose, balance, version)
    VALUES ('external', NULL, 'bank_external', 0, 1);
  END IF;
  SELECT id, balance INTO bk, bkb FROM ledger_accounts
   WHERE owner_type = 'external' AND purpose = 'bank_external' LIMIT 1;

  -- ─── Tài khoản available + lần nạp đầu của mỗi người dùng ──────────────────
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO ledger_accounts (id, owner_type, owner_id, purpose, balance, version, created_at, updated_at)
    SELECT 100000 + n, 'user', 100000 + n, 'available', T, 2, u.created_at, u.created_at
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO;

    INSERT INTO ledger_transactions (id, type, idempotency_key, reference_type, reference_id, created_at)
    SELECT 30000000 + n, 'topup', CONCAT('seed1m:topup:', n), 'seed', n, u.created_at
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT -T, gwb - (n - a + 1) * T, u.created_at, 30000000 + n, gw
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO
     ORDER BY n;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT T, T, u.created_at, 30000000 + n, 100000 + n
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO
     ORDER BY n;

    INSERT INTO payments (amount, payment_method, transaction_code, status, type, paid_at,
                          payos_order_code, user_id, created_at, updated_at)
    SELECT T, 'payos', CONCAT('SEED1MT', n), 'success', 'wallet_topup', u.created_at,
           CONCAT('91', n), 100000 + n, u.created_at, u.created_at
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO;

    SET gwb = gwb - LO * T;
    SET so_gw = so_gw + LO;
    COMMIT;
    SET a = a + LO;
  END WHILE;

  INSERT INTO _sb (seller_id, bal)
  SELECT 100000 + n, T FROM _so WHERE n < 5000;

  -- ─── Ký quỹ: một dòng mỗi (đơn PayOS đã trả, người bán) ───────────────────
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO _esc (order_id, buyer_id, seller_id, amt, da_giai_ngan, ct)
    SELECT o.id, o.user_id, p.seller_id, CAST(SUM(oi.subtotal) AS SIGNED),
           o.status = 'delivered', o.created_at
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
     WHERE o.id >= 100000 + a AND o.id < 100000 + a + LO
       AND o.payment_method = 'payos' AND o.is_paid = 1
       AND o.status IN ('confirmed', 'processing', 'shipping', 'delivered')
     GROUP BY o.id, o.user_id, p.seller_id, o.status, o.created_at
     ORDER BY o.id, p.seller_id;
    COMMIT;
    SET a = a + LO;
  END WHILE;

  INSERT IGNORE INTO _sb (seller_id, bal) SELECT DISTINCT seller_id, 0 FROM _esc;

  SELECT COALESCE(MAX(id), 0) INTO tong FROM _esc;
  SET a = 0;
  WHILE a < tong DO
    INSERT INTO escrows (id, amount, status, released_at, created_at, updated_at, order_id,
                         buyer_id, seller_id, shipping_amount)
    SELECT 100000 + id, amt, IF(da_giai_ngan, 'released', 'holding'),
           IF(da_giai_ngan, ct + INTERVAL 5 DAY, NULL), ct, ct, order_id, buyer_id, seller_id, 0
      FROM _esc WHERE id > a AND id <= a + LO;

    INSERT INTO ledger_transactions (id, type, idempotency_key, reference_type, reference_id, created_at)
    SELECT 10000000 + id, 'order_hold', CONCAT('seed1m:hold:', id), 'order', order_id, ct
      FROM _esc WHERE id > a AND id <= a + LO;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT -amt, gwb - SUM(amt) OVER (ORDER BY id), ct, 10000000 + id, gw
      FROM _esc WHERE id > a AND id <= a + LO ORDER BY id;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT amt, esb + SUM(amt) OVER (ORDER BY id), ct, 10000000 + id, es
      FROM _esc WHERE id > a AND id <= a + LO ORDER BY id;

    SET gwb = gwb - (SELECT SUM(amt) FROM _esc WHERE id > a AND id <= a + LO);
    SET esb = esb + (SELECT SUM(amt) FROM _esc WHERE id > a AND id <= a + LO);
    SET so_gw = so_gw + (SELECT COUNT(*) FROM _esc WHERE id > a AND id <= a + LO);
    SET so_es = so_es + (SELECT COUNT(*) FROM _esc WHERE id > a AND id <= a + LO);

    INSERT INTO ledger_transactions (id, type, idempotency_key, reference_type, reference_id, created_at)
    SELECT 20000000 + id, 'escrow_release', CONCAT('seed1m:release:', id), 'order', order_id,
           ct + INTERVAL 5 DAY
      FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT -amt, esb - SUM(amt) OVER (ORDER BY id), ct + INTERVAL 5 DAY, 20000000 + id, es
      FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1 ORDER BY id;

    -- Phí sàn 5%, phần còn lại về người bán.
    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT FLOOR(amt * 0.05), rvb + SUM(FLOOR(amt * 0.05)) OVER (ORDER BY id),
           ct + INTERVAL 5 DAY, 20000000 + id, rv
      FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1 AND FLOOR(amt * 0.05) > 0
     ORDER BY id;

    INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
    SELECT e.amt - FLOOR(e.amt * 0.05),
           s.bal + SUM(e.amt - FLOOR(e.amt * 0.05)) OVER (PARTITION BY e.seller_id ORDER BY e.id),
           e.ct + INTERVAL 5 DAY, 20000000 + e.id, e.seller_id
      FROM _esc e JOIN _sb s ON s.seller_id = e.seller_id
     WHERE e.id > a AND e.id <= a + LO AND e.da_giai_ngan = 1
     ORDER BY e.id;

    SET esb = esb - COALESCE((SELECT SUM(amt) FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1), 0);
    SET rvb = rvb + COALESCE((SELECT SUM(FLOOR(amt * 0.05)) FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1), 0);
    SET so_es = so_es + (SELECT COUNT(*) FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1);
    SET so_rv = so_rv + (SELECT COUNT(*) FROM _esc WHERE id > a AND id <= a + LO AND da_giai_ngan = 1 AND FLOOR(amt * 0.05) > 0);

    UPDATE _sb s
      JOIN (SELECT seller_id, SUM(amt - FLOOR(amt * 0.05)) c FROM _esc
             WHERE id > a AND id <= a + LO AND da_giai_ngan = 1 GROUP BY seller_id) x
        ON x.seller_id = s.seller_id
       SET s.bal = s.bal + x.c;
    COMMIT;
    SET a = a + LO;
  END WHILE;

  -- ─── Thanh toán đơn: thành công cho đơn đã trả, thất bại cho đơn PayOS huỷ ──
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO payments (amount, payment_method, transaction_code, status, type, paid_at,
                          payos_order_code, order_id, user_id, created_at, updated_at)
    SELECT final_amount, 'payos', CONCAT('SEED1MO', id), IF(is_paid = 1, 'success', 'failed'),
           'order_payment', IF(is_paid = 1, created_at, NULL), CONCAT('92', id), id, user_id,
           created_at, created_at
      FROM orders
     WHERE id >= 100000 + a AND id < 100000 + a + LO AND payment_method = 'payos';
    COMMIT;
    SET a = a + LO;
  END WHILE;

  -- ─── Rút tiền: 5.000 người bán, mỗi người 20 lần ──────────────────────────
  INSERT INTO ledger_accounts (id, owner_type, owner_id, purpose, balance, version, created_at, updated_at)
  SELECT 1100000 + n, 'user', 100000 + n, 'withdrawal_pending', 0, 1, NOW(6), NOW(6)
    FROM _so WHERE n < 5000;

  DROP TEMPORARY TABLE IF EXISTS _rut;
  CREATE TEMPORARY TABLE _rut (
    id INT NOT NULL PRIMARY KEY, seller_n INT NOT NULL, k INT NOT NULL, xong TINYINT NOT NULL, ct DATETIME(6) NOT NULL
  );
  INSERT INTO _rut (id, seller_n, k, xong, ct)
  SELECT n, n DIV 20, n % 20, NOT (n % 20 = 19 AND (n DIV 20) % 10 = 0),
         NOW(6) - INTERVAL (100000 - n) MINUTE
    FROM _so WHERE n < 100000;

  INSERT INTO withdrawals (id, amount, bank_name, bank_account, bank_holder, status, processed_at,
                           created_at, updated_at, user_id)
  SELECT 100000 + r.id, W, ELT(1 + r.seller_n % 4, 'Vietcombank', 'Techcombank', 'MB Bank', 'ACB'),
         CONCAT('9704', LPAD(r.seller_n, 8, '0')), u.full_name,
         IF(r.xong, 'completed', 'pending'), IF(r.xong, r.ct + INTERVAL 1 DAY, NULL),
         r.ct, r.ct, 100000 + r.seller_n
    FROM _rut r JOIN users u ON u.id = 100000 + r.seller_n;

  INSERT INTO ledger_transactions (id, type, idempotency_key, reference_type, reference_id, created_at)
  SELECT 40000000 + id, 'withdrawal_approve', CONCAT('seed1m:rut:', id), 'withdrawal', 100000 + id, ct
    FROM _rut;

  INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
  SELECT -W, s.bal - W * (r.k + 1), r.ct, 40000000 + r.id, 100000 + r.seller_n
    FROM _rut r JOIN _sb s ON s.seller_id = 100000 + r.seller_n ORDER BY r.id;

  INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
  SELECT W, W * (r.k + 1), r.ct, 40000000 + r.id, 1100000 + r.seller_n FROM _rut r ORDER BY r.id;

  INSERT INTO ledger_transactions (id, type, idempotency_key, reference_type, reference_id, created_at)
  SELECT 50000000 + id, 'withdrawal_complete', CONCAT('seed1m:rut-xong:', id), 'withdrawal', 100000 + id,
         ct + INTERVAL 1 DAY
    FROM _rut WHERE xong = 1;

  INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
  -- Hai mươi lệnh duyệt vào trước, lệnh hoàn tất trừ dần theo thứ tự id.
  SELECT -W, W * 20 - W * (r.k + 1), r.ct + INTERVAL 1 DAY, 50000000 + r.id, 1100000 + r.seller_n
    FROM _rut r WHERE r.xong = 1 ORDER BY r.id;

  INSERT INTO ledger_entries (amount, balance_after, created_at, transaction_id, account_id)
  SELECT W, bkb + W * ROW_NUMBER() OVER (ORDER BY r.id), r.ct + INTERVAL 1 DAY, 50000000 + r.id, bk
    FROM _rut r WHERE r.xong = 1 ORDER BY r.id;

  SET so_bk = (SELECT COUNT(*) FROM _rut WHERE xong = 1);
  SET bkb = bkb + W * so_bk;

  UPDATE _sb s
    JOIN (SELECT 100000 + seller_n sid, COUNT(*) c FROM _rut GROUP BY seller_n) x ON x.sid = s.seller_id
     SET s.bal = s.bal - W * x.c;
  UPDATE ledger_accounts a2
    JOIN (SELECT 1100000 + seller_n aid, SUM(1 - xong) c FROM _rut GROUP BY seller_n) x ON x.aid = a2.id
     SET a2.balance = W * x.c, a2.version = 3;
  DROP TEMPORARY TABLE _rut;
  COMMIT;

  -- ─── Chốt số dư tài khoản ─────────────────────────────────────────────────
  UPDATE ledger_accounts a2 JOIN _sb s ON a2.id = s.seller_id
     SET a2.balance = s.bal, a2.version = a2.version + 25;
  UPDATE ledger_accounts SET balance = gwb, version = version + so_gw WHERE id = gw;
  UPDATE ledger_accounts SET balance = esb, version = version + so_es WHERE id = es;
  UPDATE ledger_accounts SET balance = rvb, version = version + so_rv WHERE id = rv;
  UPDATE ledger_accounts SET balance = bkb, version = version + so_bk WHERE id = bk;
  COMMIT;

  -- ─── Địa chỉ, phiên đăng nhập, nhật ký admin, file ────────────────────────
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO addresses (recipient_name, phone_number, label, province, district, ward, street,
                           is_default, user_id, created_at, updated_at)
    SELECT u.full_name, CONCAT('09', LPAD(n, 8, '0')), 'Nhà riêng',
           ELT(1 + n % 5, 'TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng'),
           CONCAT('Quận ', 1 + n % 12), CONCAT('Phường ', 1 + n % 20),
           CONCAT(1 + n % 500, ' Đường số ', 1 + n % 60), 1, 100000 + n, u.created_at, u.created_at
      FROM _so JOIN users u ON u.id = 100000 + n
     WHERE n >= a AND n < a + LO;

    -- Phần lớn đã hết hạn hoặc đã thu hồi, như bảng thật sau một thời gian chạy.
    INSERT INTO user_sessions (id, user_id, refresh_hash, revoked_at, expires_at, created_at)
    SELECT UUID(), 100000 + n, SHA2(CONCAT('seed1m:', n), 256),
           IF(n % 3 = 0, NOW() - INTERVAL 1 DAY, NULL),
           IF(n % 3 = 1, NOW() - INTERVAL 2 DAY, NOW() + INTERVAL 7 DAY),
           NOW() - INTERVAL 3 DAY
      FROM _so WHERE n >= a AND n < a + LO;

    INSERT INTO admin_action_logs (admin_id, method, path, action, target_type, target_id,
                                   status_code, ip, created_at)
    SELECT (SELECT MIN(id) FROM users WHERE role = 'admin'), 'PATCH',
           CONCAT('/api/v1/admin/users/', 100000 + n), 'users.update', 'user', 100000 + n,
           200, '127.0.0.1', NOW(6) - INTERVAL n SECOND
      FROM _so WHERE n >= a AND n < a + LO;

    INSERT INTO files (file_name, url, mime_type, size, folder, created_at, uploaded_by)
    SELECT CONCAT('seed-', n, '.webp'), CONCAT('/uploads/seed/', n, '.webp'), 'image/webp',
           20000 + n % 100000, 'products', NOW(6) - INTERVAL n SECOND, 100000 + n % 5000
      FROM _so WHERE n >= a AND n < a + LO;
    COMMIT;
    SET a = a + LO;
  END WHILE;
END //
DELIMITER ;

CALL _seed_1m_tien();

DROP PROCEDURE _seed_1m_tien;
DROP TABLE _esc;
DROP TABLE _sb;
DROP TABLE _so;

SET SESSION foreign_key_checks = 1;
SET SESSION unique_checks = 1;

-- Bất biến phải đúng ngay sau khi chạy.
SELECT 'tong sum phai bang 0' AS kiem, COALESCE(SUM(amount), 0) AS gia_tri FROM ledger_entries
UNION ALL
SELECT 'tai khoan lech voi but toan', COUNT(*) FROM (
  SELECT a.id FROM ledger_accounts a
    LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) e
      ON e.account_id = a.id
   WHERE a.balance <> COALESCE(e.s, 0)
) x
UNION ALL
SELECT 'but toan cuoi lech so du', COUNT(*) FROM (
  SELECT a.id FROM ledger_accounts a
    JOIN (SELECT account_id, MAX(id) m FROM ledger_entries GROUP BY account_id) l ON l.account_id = a.id
    JOIN ledger_entries e ON e.id = l.m
   WHERE e.balance_after <> a.balance
) y;
SELECT TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;
