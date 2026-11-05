-- Bước ba của đợt 1 triệu: cho sản phẩm sinh ra mang tên và ảnh của hàng thật.
--
-- seed-1m.sql ghi một ảnh chung cho cả triệu món, tên kiểu "Áo thun cao cấp #12345"
-- và mô tả "Hàng sinh cho bài đo". Đo được tốc độ nhưng web hiện toàn một ảnh, tên
-- không khớp ảnh lẫn danh mục, và tìm kiếm đo trên từ vựng giả.
--
-- Mỗi món chép TRỌN BỘ từ một sản phẩm thật cùng danh mục (id < 100000) nên tên,
-- ảnh, mô tả, thương hiệu, thông số luôn đi cùng nhau. Tên trùng là bình thường trên
-- chợ đồ cũ: nhiều người cùng bán một mẫu. Slug giữ nguyên để không đụng UNIQUE.
-- Giá lệch 85 đến 115% giá gốc, làm tròn nghìn đồng.
--
-- order_items chép lại tên và ảnh, không thì trang đơn vẫn hiện tên cũ. Không đổi
-- giá trong đơn: đó là giá lúc mua, ký quỹ và sổ cái đã tính theo số đó.
--
-- Chạy lại an toàn: chép từ cùng nguồn ra cùng kết quả.
-- Có binlog thì mở phiên bằng SET SESSION sql_log_bin=0.
--
-- Tham số: SET @tu, @den là khoảng id sản phẩm. Mặc định cả triệu. Chạy thử một
-- khoảng nhỏ trước: mysql --init-command="SET @den_thu=101000".

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
SET SESSION max_execution_time = 0;
SET SESSION unique_checks = 0;
SET SESSION foreign_key_checks = 0;
SET @t0 = NOW(6);
SET @den = COALESCE(@den_thu, 1100000);

DROP TABLE IF EXISTS _nguon;
CREATE TABLE _nguon (cat INT NOT NULL, k INT NOT NULL, pid INT NOT NULL, PRIMARY KEY (cat, k)) ENGINE = InnoDB;
INSERT INTO _nguon (cat, k, pid)
SELECT category_id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY id) - 1, id
  FROM products
 WHERE id < 100000 AND deleted_at IS NULL AND status = 'active'
   AND image IS NOT NULL AND image <> '' AND category_id IS NOT NULL;

DROP TABLE IF EXISTS _dem;
CREATE TABLE _dem (cat INT NOT NULL PRIMARY KEY, c INT NOT NULL) ENGINE = InnoDB;
INSERT INTO _dem (cat, c) SELECT cat, COUNT(*) FROM _nguon GROUP BY cat;

-- Danh mục không có hàng thật thì chuyển món sang danh mục có hàng, không để trống ảnh.
DROP TABLE IF EXISTS _cat;
CREATE TABLE _cat (k INT NOT NULL PRIMARY KEY, cat INT NOT NULL) ENGINE = InnoDB;
INSERT INTO _cat (k, cat) SELECT ROW_NUMBER() OVER (ORDER BY cat) - 1, cat FROM _dem;
SET @so_cat = (SELECT COUNT(*) FROM _cat);

DROP PROCEDURE IF EXISTS _chep_that;
DELIMITER //
CREATE PROCEDURE _chep_that()
BEGIN
  DECLARE LO INT DEFAULT 20000;
  DECLARE a INT DEFAULT 100000;

  WHILE a < @den DO
    UPDATE products p
      JOIN _cat kc ON kc.k = p.id % @so_cat
       SET p.category_id = kc.cat
     WHERE p.id >= a AND p.id < LEAST(a + LO, @den)
       AND NOT EXISTS (SELECT 1 FROM _dem d WHERE d.cat = p.category_id);

    UPDATE products p
      JOIN _dem d ON d.cat = p.category_id
      JOIN _nguon g ON g.cat = p.category_id AND g.k = (p.id * 7919) % d.c
      JOIN products r ON r.id = g.pid
       SET p.name = r.name,
           p.description = r.description,
           p.image = r.image,
           p.images = r.images,
           p.brand = r.brand,
           p.spec = r.spec,
           p.price = GREATEST(10000, ROUND(r.price * (0.85 + (p.id % 31) / 100), -3))
     WHERE p.id >= a AND p.id < LEAST(a + LO, @den);
    COMMIT;

    UPDATE order_items oi
      JOIN products p ON p.id = oi.product_id
       SET oi.product_name = p.name, oi.product_image = p.image
     WHERE oi.product_id >= a AND oi.product_id < LEAST(a + LO, @den);
    COMMIT;

    SET a = a + LO;
  END WHILE;
END //
DELIMITER ;

CALL _chep_that();

DROP PROCEDURE _chep_that;
DROP TABLE _cat;
DROP TABLE _dem;
DROP TABLE _nguon;

SET SESSION foreign_key_checks = 1;
SET SESSION unique_checks = 1;

SELECT TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;
