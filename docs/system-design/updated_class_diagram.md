# Biểu đồ Lớp (Class Diagram) - Đã bổ sung

Bản vẽ này bao gồm 20 class cũ và 5 class nâng cao mới: `ProductVariant`, `Voucher`, `ReturnRequest`, `ShippingCarrier`, `Cart`.
Bạn hãy copy phần code bên dưới và paste vào Draw.io (Insert -> Advanced -> Mermaid). 
Draw.io sẽ tự động sắp xếp thông minh: các class trung tâm (như Order, Product, User) sẽ nằm ở giữa, các class ít kết nối hơn sẽ nằm xung quanh.

```mermaid
classDiagram
  direction TB

  %% ================== IDENTITY ==================
  class User {
    +int id
    +string full_name
    +string email
    +string phone_number
    +UserRole role
    +bool is_locked
    +isSeller() bool
  }

  class Address {
    +int id
    +int user_id
    +string recipient_name
    +string phone_number
    +string full_address
    +bool is_default
  }

  class Shop {
    +int id
    +int owner_id
    +string name
    +string phone
    +string address
    +ShopStatus status
  }

  %% ================== CATALOG ==================
  class Category {
    +int id
    +int parent_id
    +string name
    +bool is_active
  }

  class Product {
    +int id
    +int shop_id
    +int category_id
    +string name
    +decimal price
    +int stock
    +ProductStatus status
    +isAvailable() bool
  }

  class ProductVariant {
    +int id
    +int product_id
    +string sku
    +string attribute_name
    +string attribute_value
    +decimal price
    +int stock
  }

  class Review {
    +int id
    +int user_id
    +int product_id
    +int order_id
    +int rating
    +string comment
  }

  class Follow {
    +int id
    +int follower_id
    +int following_shop_id
  }

  %% ================== CART & ORDERING ==================
  class Cart {
    +int id
    +int user_id
    +decimal total_amount
  }

  class CartItem {
    +int id
    +int cart_id
    +int product_variant_id
    +int quantity
  }

  class Voucher {
    +int id
    +int shop_id
    +string code
    +decimal discount_value
    +decimal min_order_value
    +int usage_limit
    +datetime end_date
  }

  class Order {
    +int id
    +int user_id
    +int shop_id
    +int voucher_id
    +string order_code
    +decimal final_amount
    +OrderStatus status
    +PaymentMethod payment_method
    +bool is_paid
  }

  class OrderItem {
    +int id
    +int order_id
    +int product_variant_id
    +decimal price
    +int quantity
  }

  class ShippingCarrier {
    +int id
    +string name
    +string api_url
    +bool is_active
  }

  class OrderShipment {
    +int id
    +int order_id
    +int carrier_id
    +string tracking_code
    +ShipmentStatus status
    +datetime delivered_at
  }

  class ReturnRequest {
    +int id
    +int order_id
    +string reason
    +ReturnStatus status
    +decimal refund_amount
  }

  %% ================== MONEY ==================
  class Payment {
    +int id
    +int order_id
    +decimal amount
    +PaymentStatus status
    +string transaction_code
  }

  class Escrow {
    +int id
    +int order_id
    +decimal amount
    +EscrowStatus status
    +datetime released_at
  }

  class Withdrawal {
    +int id
    +int user_id
    +decimal amount
    +string bank_account
    +WithdrawalStatus status
  }

  class LedgerAccount {
    +bigint id
    +LedgerOwnerType owner_type
    +bigint balance
  }

  class LedgerTransaction {
    +bigint id
    +LedgerTxType type
    +string idempotency_key
  }

  class LedgerEntry {
    +bigint id
    +bigint transaction_id
    +bigint account_id
    +bigint amount
    +bigint balance_after
  }

  %% ================== MESSAGING ==================
  class Conversation {
    +int id
    +int buyer_id
    +int shop_id
  }

  class Message {
    +int id
    +int conversation_id
    +int sender_id
    +string content
  }

  class Notification {
    +int id
    +int user_id
    +string title
    +text content
    +bool is_read
  }

  %% ================== RELATIONSHIPS (Định tuyến thông minh) ==================
  
  %% Trung tâm: User, Shop, Product, Order
  User "1" -- "*" Address : has
  User "1" -- "0..1" Shop : opens
  User "1" -- "1" Cart : owns
  User "1" -- "*" Order : places
  User "1" -- "*" Review : writes
  User "1" -- "*" Follow : follows
  User "1" -- "*" Notification : receives
  User "1" -- "*" Withdrawal : requests
  User "1" -- "*" Conversation : chats

  Shop "1" -- "*" Product : sells
  Shop "1" -- "*" Order : fulfills
  Shop "1" -- "*" Voucher : issues
  Shop "1" -- "*" Conversation : replies

  Category "1" -- "*" Product : groups
  Product "1" -- "*" ProductVariant : has variants
  Product "1" -- "*" Review : gets

  %% Giỏ hàng & Đơn hàng
  Cart "1" *-- "*" CartItem : contains
  ProductVariant "1" -- "*" CartItem : added to

  Order "1" *-- "*" OrderItem : contains
  ProductVariant "1" -- "*" OrderItem : appears in
  Voucher "0..1" -- "*" Order : applied to

  %% Vận chuyển & Trả hàng
  ShippingCarrier "1" -- "*" OrderShipment : handles
  Order "1" -- "0..1" OrderShipment : shipped via
  Order "1" -- "0..1" ReturnRequest : returned via

  %% Thanh toán & Kế toán
  Order "1" -- "0..1" Payment : paid by
  Order "1" -- "0..1" Escrow : holds money
  
  LedgerAccount "1" -- "*" LedgerEntry : records
  LedgerTransaction "1" *-- "2..*" LedgerEntry : balances

  %% Nhắn tin
  Conversation "1" *-- "*" Message : contains
```
