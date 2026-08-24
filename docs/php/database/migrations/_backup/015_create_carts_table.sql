-- Tạo bảng giỏ hàng (lưu vĩnh viễn trong Database)
-- Đảm bảo các bảng users và products đã được tạo trước

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS carts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Mỗi user chỉ có 1 dòng cho mỗi sản phẩm
    UNIQUE KEY unique_user_product (user_id, product_id),
    
    -- Khóa ngoại
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;