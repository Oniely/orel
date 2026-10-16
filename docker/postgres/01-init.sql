CREATE DATABASE test;
GRANT ALL PRIVILEGES ON DATABASE test TO postgres;

\connect orel_dev;

-- Drop existing tables if re-initializing
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url TEXT,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_is_active ON users (is_active);

-- 2. Categories (with self-referencing foreign key for hierarchy)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_parent_id ON categories (parent_id);

-- 3. Products
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    tags JSONB DEFAULT '[]'::jsonb,
    specs JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_category_id ON products (category_id);
CREATE INDEX idx_products_price ON products (price);
CREATE INDEX idx_products_category_price ON products (category_id, price);

-- 4. Orders
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    shipping_address JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_user_status ON orders (user_id, status);

-- 5. Order Items
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount DECIMAL(10, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_product_id ON order_items (product_id);
CREATE UNIQUE INDEX idx_order_items_order_product ON order_items (order_id, product_id);

-- 6. Activity Logs
CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    payload JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_logs_user_id ON activity_logs (user_id);
CREATE INDEX idx_activity_logs_action ON activity_logs (action);

-- ==============================================================================
-- Seed Data
-- ==============================================================================

-- Users
INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active, preferences) VALUES
('alice_admin', 'alice@orel.dev', 'hash_alice_123', 'Alice', 'Vance', 'admin', TRUE, '{"theme": "dark", "notifications": true, "compactMode": false}'),
('bob_manager', 'bob@orel.dev', 'hash_bob_456', 'Bob', 'Smith', 'manager', TRUE, '{"theme": "light", "notifications": true, "compactMode": true}'),
('charlie_dev', 'charlie@orel.dev', 'hash_charlie_789', 'Charlie', 'Brown', 'member', TRUE, '{"theme": "system", "notifications": false}'),
('diana_qa', 'diana@orel.dev', 'hash_diana_101', 'Diana', 'Prince', 'member', TRUE, '{"theme": "dark", "notifications": true}'),
('evan_wright', 'evan@orel.dev', 'hash_evan_202', 'Evan', 'Wright', 'member', TRUE, '{"theme": "dark"}'),
('fiona_g', 'fiona@orel.dev', 'hash_fiona_303', 'Fiona', 'Gallagher', 'member', FALSE, '{"theme": "light"}'),
('george_c', 'george@orel.dev', 'hash_george_404', 'George', 'Clark', 'member', TRUE, '{"theme": "dark"}'),
('hannah_a', 'hannah@orel.dev', 'hash_hannah_505', 'Hannah', 'Abbott', 'member', TRUE, '{"theme": "light"}'),
('ian_malcolm', 'ian@orel.dev', 'hash_ian_606', 'Ian', 'Malcolm', 'guest', TRUE, '{"theme": "system"}'),
('julia_r', 'julia@orel.dev', 'hash_julia_707', 'Julia', 'Roberts', 'member', TRUE, '{"theme": "dark"}');

-- Categories
INSERT INTO categories (name, slug, description, parent_id) VALUES
('Electronics', 'electronics', 'Electronic devices and gadgets', NULL),
('Computers & Laptops', 'computers', 'Laptops, desktops, and accessories', 1),
('Audio & Video', 'audio-video', 'Headphones, speakers, and monitors', 1),
('Smartphones & Tablets', 'smartphones', 'Mobile phones and tablets', 1),
('Accessories', 'accessories', 'Cables, chargers, and cases', 1),
('Smart Home', 'smart-home', 'Home automation and IoT devices', NULL);

-- Products
INSERT INTO products (category_id, sku, name, description, price, stock_quantity, is_published, tags, specs) VALUES
(2, 'PROD-LAPTOP-01', 'QuantumBook Pro 16', 'High-performance laptop with 16-inch Retina display', 2499.00, 45, TRUE, '["laptop", "m3", "pro"]'::jsonb, '{"cpu": "12-core", "ram": "32GB", "storage": "1TB SSD"}'::jsonb),
(2, 'PROD-LAPTOP-02', 'AeroBook Air 13', 'Ultra-thin lightweight laptop with all-day battery life', 1199.00, 80, TRUE, '["laptop", "portable", "lightweight"]'::jsonb, '{"cpu": "8-core", "ram": "16GB", "storage": "512GB SSD"}'::jsonb),
(4, 'PROD-PHONE-01', 'NovaPhone 15 Pro', 'Flagship smartphone with titanium frame and 5x zoom', 1099.00, 120, TRUE, '["smartphone", "5g", "flagship"]'::jsonb, '{"screen": "6.7 inch OLED", "storage": "256GB", "camera": "48MP"}'::jsonb),
(4, 'PROD-PHONE-02', 'NovaPhone SE', 'Affordable smartphone with fast performance', 499.00, 200, TRUE, '["smartphone", "budget"]'::jsonb, '{"screen": "6.1 inch", "storage": "128GB"}'::jsonb),
(3, 'PROD-AUDIO-01', 'SoundWave ANC 700', 'Wireless noise cancelling over-ear headphones', 349.50, 65, TRUE, '["audio", "anc", "wireless"]'::jsonb, '{"battery": "30h", "connectivity": "Bluetooth 5.3", "weight": "250g"}'::jsonb),
(3, 'PROD-AUDIO-02', 'SoundPulse Mini Speaker', 'Waterproof compact Bluetooth speaker with rich bass', 89.99, 150, TRUE, '["audio", "portable", "waterproof"]'::jsonb, '{"battery": "12h", "rating": "IPX7"}'::jsonb),
(5, 'PROD-ACC-01', 'USB-C Magnetic Cable 2m', 'Braided fast-charging USB-C cable', 24.99, 500, TRUE, '["accessories", "cable", "fast-charge"]'::jsonb, '{"length": "2m", "wattage": "100W"}'::jsonb),
(5, 'PROD-ACC-02', 'ErgoStand Monitor Arm', 'Gas spring dual monitor desk mount', 129.00, 35, TRUE, '["accessories", "ergonomic", "desk"]'::jsonb, '{"maxWeight": "9kg per arm", "vesa": "75x75, 100x100"}'::jsonb),
(6, 'PROD-HOME-01', 'Lumina Smart Bulb RGB', 'Wi-Fi enabled color-changing smart bulb', 19.99, 320, TRUE, '["smart-home", "lighting", "rgb"]'::jsonb, '{"lumens": "800", "protocol": "Matter/Thread"}'::jsonb),
(6, 'PROD-HOME-02', 'OmniPlug Smart Outlet', 'Energy monitoring smart plug compatible with HomeKit', 29.99, 180, TRUE, '["smart-home", "power", "energy"]'::jsonb, '{"maxAmps": "15A", "monitoring": true}'::jsonb);

-- Orders
INSERT INTO orders (user_id, order_number, status, total_amount, shipping_address, notes) VALUES
(1, 'ORD-2026-001', 'completed', 2848.50, '{"street": "101 Market St", "city": "San Francisco", "state": "CA", "zip": "94105", "country": "USA"}'::jsonb, 'Leave at reception desk'),
(2, 'ORD-2026-002', 'completed', 1199.00, '{"street": "456 Broadway", "city": "New York", "state": "NY", "zip": "10013", "country": "USA"}'::jsonb, NULL),
(3, 'ORD-2026-003', 'processing', 1448.50, '{"street": "789 Pine Ave", "city": "Seattle", "state": "WA", "zip": "98101", "country": "USA"}'::jsonb, 'Please deliver after 5pm'),
(4, 'ORD-2026-004', 'shipped', 523.99, '{"street": "321 Elm St", "city": "Austin", "state": "TX", "zip": "73301", "country": "USA"}'::jsonb, NULL),
(5, 'ORD-2026-005', 'pending', 379.48, '{"street": "654 Maple Dr", "city": "Denver", "state": "CO", "zip": "80201", "country": "USA"}'::jsonb, 'Gift wrap requested'),
(1, 'ORD-2026-006', 'completed', 149.98, '{"street": "101 Market St", "city": "San Francisco", "state": "CA", "zip": "94105", "country": "USA"}'::jsonb, NULL),
(7, 'ORD-2026-007', 'cancelled', 1099.00, '{"street": "852 Cedar Rd", "city": "Chicago", "state": "IL", "zip": "60601", "country": "USA"}'::jsonb, 'Customer cancelled before dispatch'),
(8, 'ORD-2026-008', 'processing', 2628.00, '{"street": "963 Walnut St", "city": "Boston", "state": "MA", "zip": "02108", "country": "USA"}'::jsonb, NULL);

-- Order Items
INSERT INTO order_items (order_id, product_id, quantity, unit_price, discount) VALUES
(1, 1, 1, 2499.00, 0.00),
(1, 5, 1, 349.50, 0.00),
(2, 2, 1, 1199.00, 0.00),
(3, 3, 1, 1099.00, 0.00),
(3, 5, 1, 349.50, 0.00),
(4, 4, 1, 499.00, 0.00),
(4, 7, 1, 24.99, 0.00),
(5, 5, 1, 349.50, 0.00),
(5, 9, 1, 19.99, 0.00),
(5, 10, 1, 29.99, 20.00),
(6, 8, 1, 129.00, 0.00),
(6, 9, 1, 19.99, 0.00),
(7, 3, 1, 1099.00, 0.00),
(8, 1, 1, 2499.00, 0.00),
(8, 8, 1, 129.00, 0.00);

-- Activity Logs
INSERT INTO activity_logs (user_id, action, entity_type, entity_id, payload, ip_address) VALUES
(1, 'user.login', 'user', 1, '{"method": "password", "success": true}'::jsonb, '192.168.1.10'),
(1, 'order.create', 'order', 1, '{"total": 2848.50, "items_count": 2}'::jsonb, '192.168.1.10'),
(2, 'order.create', 'order', 2, '{"total": 1199.00, "items_count": 1}'::jsonb, '192.168.1.15'),
(3, 'product.view', 'product', 3, '{"referrer": "category_page"}'::jsonb, '192.168.1.22'),
(3, 'order.create', 'order', 3, '{"total": 1448.50, "items_count": 2}'::jsonb, '192.168.1.22'),
(4, 'order.create', 'order', 4, '{"total": 523.99, "items_count": 2}'::jsonb, '192.168.1.34'),
(5, 'user.update_profile', 'user', 5, '{"changed": ["preferences"]}'::jsonb, '192.168.1.41'),
(7, 'order.cancel', 'order', 7, '{"reason": "changed_mind"}'::jsonb, '192.168.1.58'),
(8, 'order.create', 'order', 8, '{"total": 2628.00, "items_count": 2}'::jsonb, '192.168.1.62'),
(1, 'product.create', 'product', 10, '{"sku": "PROD-HOME-02", "price": 29.99}'::jsonb, '192.168.1.10');
