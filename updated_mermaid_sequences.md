# Updated Sequence Diagrams with Activation Boxes

Copy the code below for each diagram and paste it into the Mermaid editor in Draw.io (Double click the diagram -> Paste -> Apply).

## 1. Login
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client (Web/App)
    participant API as API Server
    participant DB as MySQL

    U->>+C: Enter Email & Password
    C->>+API: POST /auth/login
    API->>+DB: Find user by email
    DB-->>-API: Return User record
    API->>API: Compare passwords (bcrypt)
    
    alt User does not exist or incorrect password
        API-->>C: 401 Unauthorized
        C-->>U: Display error
    else Login successful
        API->>+DB: Update last_login
        DB-->>-API: Success
        API->>API: Generate Access Token & Refresh Token
        API-->>-C: 200 OK + JWT Tokens
        C->>C: Save Token to LocalStorage/Cookie
        C-->>-U: Redirect to Home page
    end
```

## 2. Cart
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client (Web/App)
    participant API as API Server
    participant DB as MySQL

    U->>+C: Bấm "Thêm vào giỏ hàng"
    C->>+API: POST /cart/items {product_id, quantity} + JWT Token
    API->>+DB: Query product info (Stock)
    DB-->>-API: Return Product info
    
    API->>API: Check (requested quantity <= stock)
    
    alt Out of stock or insufficient quantity
        API-->>C: 400 Bad Request (Quantity error)
        C-->>U: Display error message
    else In stock
        API->>+DB: Upsert (Add/Update) cart_items table
        DB-->>-API: Success
        API-->>-C: 200 OK + New cart info
        C-->>-U: Update quantity on cart icon
    end
```

## 3. Chat
```mermaid
sequenceDiagram
    autonumber
    actor US as User (Sender)
    actor UR as User (Receiver)
    participant CS as Client (Sender)
    participant CR as Client (Receiver)
    participant GW as Socket.IO Gateway
    participant DB as MySQL
    participant RD as Redis (Pub/Sub)

    %% Initialize connection
    CS->>+GW: Connect & Authenticate (JWT)
    GW-->>-CS: Connected
    CR->>+GW: Connect & Authenticate (JWT)
    GW-->>-CR: Connected
    
    %% Send message
    US->>+CS: Enter message & Click Send
    CS->>+GW: emit("send_message", {room_id, content})
    
    %% Storage
    GW->>+DB: Save message to Database
    DB-->>-GW: Success (return message_id)
    
    %% Confirm to sender immediately
    GW-->>-CS: ack (Confirm saved)
    CS-->>-US: Update UI (Sent)
    
    %% Distribute messages via Redis (Pub/Sub)
    GW->>+RD: Publish(room_id, message_data)
    RD-->>-GW: Receive Message from channel (Subscribe)
    
    %% Push to receiver
    GW->>+CR: emit("new_message", message_data)
    CR-->>-UR: Display new message
```

## 4. Checkout
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant DB as MySQL

    U->>+C: Xác nhận thông tin & bấm "Đặt hàng"
    C->>+API: POST /orders {address_id, cart_items} + JWT Token
    
    API->>+DB: BEGIN TRANSACTION
    API->>DB: Lock product (SELECT ... FOR UPDATE)
    DB-->>-API: Return current inventory
    
    API->>API: Check (requested quantity <= stock)
    
    alt Insufficient inventory (Not enough quantity)
        API->>+DB: ROLLBACK
        DB-->>-API: Success
        API-->>C: 400 Bad Request (Insufficient stock)
        C-->>U: Show Error
    else Valid (Sufficient quantity)
        API->>+DB: Deduct inventory quantity (Stock)
        API->>DB: INSERT order and order_items
        API->>DB: Create escrow_hold for cash flow
        API->>DB: Clear Cart
        API->>DB: COMMIT
        DB-->>-API: Success
        API-->>-C: 201 Order Created
        C-->>-U: Switch to Payment/Success screen
    end
```

## 5. Google OAuth
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant GO as Google OAuth
    participant DB as DB

    U->>+C: Click "Login with Google"
    C->>+API: GET /auth/google
    API-->>-C: Return Google Redirect URL
    
    C->>+GO: Redirect user to Google
    U->>+GO: Login & Grant permissions
    
    GO->>+API: Callback GET /auth/google/callback?code=xxx
    API->>+GO: Send API to exchange code for Access Token
    GO-->>-API: Google Token + User Info (Email, Name)
    
    API->>+DB: Find or Create new User by Email
    DB-->>-API: Return User record
    
    API->>API: Generate internal JWT Access Token
    API-->>-GO: 302 Redirect to Client /login/success?token=xxx
    GO-->>-C: Follow Redirect
    
    C->>C: Save Token locally (LocalStorage/Cookie)
    C-->>-U: Login successful
```

## 6. Password Reset
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant RD as Redis
    participant SMTP as SMTP / Mailer
    participant DB as DB

    %% Phase 1: Request Reset
    U->>+C: Enter your email and click "Forgot password"
    C->>+API: POST /auth/forgot-password {email}
    API->>+DB: Check if Email exists?
    DB-->>-API: Return result
    
    API->>+RD: Generate and Save Reset Token (TTL 15 mins)
    RD-->>-API: Success
    API->>+SMTP: Send Email with password reset link
    
    %% Add response for Client
    API-->>-C: 200 OK (Please check your email)
    C-->>-U: Show Success Message
    SMTP-->>-U: User receives Email
    
    %% Phase 2: Perform Reset
    U->>+C: Click link trong Email
    C->>+API: POST /auth/reset-password {token, new_pass}
    API->>+RD: Check if Token is valid & not expired?
    RD-->>-API: Token check result
    
    %% Add alt block for logic handling
    alt Invalid or expired Token
        API-->>C: 400 Bad Request (Invalid Token)
        C-->>U: Show error, request to resend email
    else Token valid
        API->>API: Hash new password (bcrypt)
        API->>+DB: Update User (new password)
        DB-->>-API: Success
        API->>+RD: Delete Token (prevent reuse)
        RD-->>-API: Success
        API-->>-C: 200 OK (Password changed successfully)
        C-->>-U: Request login again
    end
```

## 7. Payment
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant PO as PayOS
    participant DB as MySQL

    %% Phase 1: Create link and pay
    C->>+API: POST /payments/create (Create payment link)
    API->>+PO: Create Payment Link API (Send amount, order id)
    PO-->>-API: Return checkout_url
    API-->>-C: Return checkout_url
    
    C->>+PO: Display PayOS payment gateway (QR Code)
    U->>+PO: Scan QR Code & Transfer money
    PO-->>-U: Wait for processing
    
    %% Phase 2: Webhook & Fulfill
    PO->>+API: Webhook POST /payos/webhook (Paid)
    
    API->>+DB: BEGIN TRANSACTION
    API->>DB: Query transaction (Check Idempotency)
    DB-->>-API: Return transaction status
    
    API->>API: Check duplicate Webhook?
    
    alt Already processed (Webhook resent / Duplicate)
        API->>+DB: ROLLBACK (Skip, no update)
        DB-->>-API: Success
        API-->>PO: 200 OK (Acknowledged, stop sending)
    else Not processed (First time)
        API->>+DB: Update Order status -> PAID
        API->>DB: Log cash flow (Ledger)
        API->>DB: COMMIT
        DB-->>-API: Success
        API-->>-PO: 200 OK
    end
    
    PO-->>-C: Redirect to App (Success screen)
    C-->>U: Show payment success
```

## 8. Product Create
```mermaid
sequenceDiagram
    autonumber
    actor S as Seller
    participant C as Client
    participant API as API Server
    participant S3 as R2/Disk (Storage)
    participant DB as MySQL

    S->>+C: Enter info & Select product image
    C->>+API: POST /products (multipart/form-data) + JWT Token
    
    API->>API: Validate image format & Data
    
    alt Validation failed (Invalid data, image too large...)
        API-->>C: 400 Bad Request
        C-->>S: Display error message
    else Validation valid
        %% Save image to Cloud Storage
        API->>+S3: Upload files (Save images)
        S3-->>-API: Return image URLs list
        
        %% Save data to DB (wrapped in Transaction)
        API->>+DB: BEGIN TRANSACTION
        API->>DB: INSERT into products (basic info)
        API->>DB: INSERT into product_images (contains image URLs)
        DB-->>API: Success
        API->>DB: COMMIT
        DB-->>-API: Success
        
        %% Response to Client
        API-->>-C: 201 Created (Created successfully)
        C-->>-S: Notify Product listed successfully
    end
```

## 9. Product Search
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant DB as MySQL

    U->>+C: Enter the keyword "Shoes" & click Search.
    C->>+API: GET /products?q=giay&page=1
    API->>+DB: SELECT ... WHERE name LIKE '%giay%'
    DB-->>-API: Product list & Total pages
    API-->>-C: 200 OK (With JSON Data)
    C-->>-U: Render search results on screen
```

## 10. Product Search (with Redis)
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant RD as Redis (Cache)
    participant DB as MySQL

    U->>+C: Enter the keyword "Shoes" & click Search.
    C->>+API: GET /products?q=giay&page=1
    
    %% Caching technique for speedup
    API->>+RD: Check Cache (GET search:giay:page:1)
    
    alt Has Cache (Cache Hit)
        RD-->>-API: Return direct result from Cache
        API-->>C: 200 OK (JSON Data - Super fast)
    else No Cache (Cache Miss)
        %% Query DB with LIMIT/OFFSET
        API->>+DB: Query: SELECT ... LIKE '%giay%' LIMIT 20 OFFSET 0
        DB-->>-API: Return Product list & Total pages
        
        %% Remember to save to Cache for next time
        API->>+RD: Save to Cache (SETEX with TTL 5 mins)
        RD-->>-API: OK
        
        API-->>-C: 200 OK (With JSON Data)
    end
    
    C-->>-U: Render search results on screen
```

## 11. Profile Update
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant S3 as R2/Disk (Storage)
    participant DB as MySQL

    U->>+C: Change Avatar & Phone number
    C->>+API: PATCH /users/me (Send Token + Data/File)
    
    API->>API: Authenticate JWT (Validate permissions)
    
    %% Handle image upload if any
    alt Has new Avatar image update
        API->>+S3: Upload Avatar image file
        S3-->>-API: Return new image URL
    end
    
    %% Check business logic
    API->>+DB: Check if Phone number already exists?
    DB-->>-API: Return result (Yes/No)
    
    alt Duplicate phone number (Already in use)
        API-->>C: 409 Conflict (Phone number already exists)
        C-->>U: Display error message
    else Valid data
        API->>+DB: UPDATE users SET avatar_url, phone
        DB-->>-API: Success
        API-->>-C: 200 OK (Return new User profile)
        C-->>-U: Update personal interface
    end
```

## 12. Registration
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant DB as MySQL

    U->>+C: Enter Email, Password & Click Register
    C->>+API: POST /auth/register
    
    API->>+DB: Check Email (Check duplicate)
    DB-->>-API: Return result (Yes/No)
    
    alt Email already exists
        %% Use 409 Conflict for duplicate data error
        API-->>C: 409 Conflict (Email already used)
        C-->>U: Display duplicate Email error
    else Email does not exist (Valid)
        API->>API: Hash Password (bcrypt)
        API->>+DB: INSERT INTO users (email, hashed_password)
        DB-->>-API: Success
        
        %% Note: If your system requires email verification, 
        %% you can call SMTP to send email at this step.
        
        API-->>-C: 201 Created (Account created successfully)
        C-->>-U: Notify success, request login
    end
```

## 13. Shop
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant RD as Redis (Cache)
    participant DB as MySQL

    U->>+C: Click on Seller Name (Shop)
    %% Add pagination parameters
    C->>+API: GET /shops/{seller_id}?page=1
    
    %% Caching technique to reduce DB load
    API->>+RD: Check Cache (GET shop:{seller_id}:page:1)
    
    alt Has Cache (Cache Hit)
        RD-->>-API: Return Shop & Products info
        API-->>C: 200 OK (JSON Data - Super fast)
    else No Cache (Cache Miss)
        %% Get info from DB
        API->>+DB: Get Seller Profile info
        DB-->>-API: Return Profile
        
        API->>+DB: Get Products list (with LIMIT/OFFSET)
        DB-->>-API: Return Products list
        
        %% Save to Cache for subsequent loads
        API->>+RD: Save result to Cache (SETEX with TTL 5 mins)
        RD-->>-API: OK
        
        API-->>-C: 200 OK (With JSON Data)
    end
    
    C-->>-U: Display Shop page (Info + Products on sale)
```

## 14. Email Verification
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant API as API Server
    participant RD as Redis
    participant SMTP as SMTP / Mailer
    participant DB as DB

    %% Phase 1: Send OTP
    C->>+API: POST /auth/send-verification (Request code)
    API->>+RD: Generate OTP (Save to Redis with TTL 5 mins)
    RD-->>-API: Success
    API->>+SMTP: Send Email with OTP
    SMTP-->>-API: Success
    
    %% Return to Client to open OTP input UI
    API-->>-C: 200 OK (Email sent)
    SMTP-->>-U: User receives Email with OTP
    
    %% Phase 2: Verify OTP
    U->>+C: Enter OTP into App
    C->>+API: POST /auth/verify-email {otp}
    
    API->>+RD: Get OTP from Redis to check
    RD-->>-API: Return result (Valid / Empty)
    
    alt OTP incorrect or expired
        API-->>C: 400 Bad Request (Invalid verification code)
        C-->>U: Display error message
    else OTP correct
        API->>+DB: UPDATE users SET is_verified = TRUE
        DB-->>-API: Success
        API->>+RD: Delete OTP (Prevent reuse)
        RD-->>-API: Success
        API-->>-C: 200 OK (Verification successful)
        C-->>-U: Notify Verification success & Change status
    end
```
