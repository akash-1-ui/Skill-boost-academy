/**
 * SkillBoost Access & Subscription System - Database Schema
 * 
 * This schema includes tables for plans, customers, academies, and usage tracking
 */

CREATE TABLE IF NOT EXISTS plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    max_instructors INT NOT NULL,
    max_students INT NOT NULL,
    price INT NOT NULL,
    description TEXT,
    features JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
);

CREATE TABLE IF NOT EXISTS customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS academies (
    id VARCHAR(36) PRIMARY KEY,
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    academy_name VARCHAR(255) NOT NULL,
    access_code VARCHAR(20) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'active',
    instructor_count INT DEFAULT 0,
    student_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_access_code (access_code),
    INDEX idx_plan_id (plan_id),
    INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS instructors (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id VARCHAR(36) NOT NULL,
    user_id INT,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_academy_id (academy_id),
    UNIQUE KEY unique_academy_email (academy_id, email)
);

CREATE TABLE IF NOT EXISTS students (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id VARCHAR(36) NOT NULL,
    user_id INT,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_academy_id (academy_id),
    UNIQUE KEY unique_academy_email (academy_id, email)
);

CREATE TABLE IF NOT EXISTS attempt_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id VARCHAR(36) NOT NULL,
    type ENUM('student', 'instructor') NOT NULL,
    status ENUM('success', 'failed') DEFAULT 'success',
    reason VARCHAR(255),
    email VARCHAR(255),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    INDEX idx_academy_id (academy_id),
    INDEX idx_type (type),
    INDEX idx_timestamp (timestamp)
);

CREATE TABLE IF NOT EXISTS academy_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id VARCHAR(36) NOT NULL,
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    plan_name VARCHAR(100) NOT NULL,
    amount INT NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    status VARCHAR(50) DEFAULT 'completed',
    payment_reference VARCHAR(120) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_academy_created (academy_id, created_at),
    INDEX idx_customer_created (customer_id, created_at)
);

CREATE TABLE IF NOT EXISTS academy_payment_orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id VARCHAR(36) NOT NULL,
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    amount INT NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    razorpay_order_id VARCHAR(120) NOT NULL UNIQUE,
    receipt VARCHAR(120) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'created',
    razorpay_payment_id VARCHAR(120),
    razorpay_signature VARCHAR(255),
    payment_status VARCHAR(50),
    is_consumed TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_payment_order_academy (academy_id, status),
    INDEX idx_payment_order_customer (customer_id, created_at)
);

-- Insert default plans
INSERT IGNORE INTO plans (id, name, max_instructors, max_students, price, description, features) VALUES 
(1, 'Basic', 1, 10, 0, 'Free plan for getting started', 
    JSON_ARRAY('1 Instructor', '10 Students', 'Basic Access')),
(2, 'Pro', 10, 200, 499, 'Perfect for small academies', 
    JSON_ARRAY('10 Instructors', '200 Students', 'Priority Support')),
(3, 'Advanced', 25, 1000, 999, 'For growing academies', 
    JSON_ARRAY('25 Instructors', '1000 Students', 'Advanced Capacity', 'Priority Support'));
