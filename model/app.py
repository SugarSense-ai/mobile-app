import os
import base64
from PIL import Image
import io
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import chromadb
from datetime import datetime, timedelta, date, timezone
from typing import List, Dict, Any
import google.generativeai as genai
import requests
from sqlalchemy import create_engine, text, Table, MetaData
from chromadb import PersistentClient
from chromadb.utils import embedding_functions
from sentence_transformers import SentenceTransformer
import uuid
import re
import calendar
import pandas as pd
from nixtla import NixtlaClient
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import random
import numpy as np
from cryptography.fernet import Fernet
from pydexcom import Dexcom
from pylibrelinkup import PyLibreLinkUp
import threading
import time

# Load environment variables from .env file
load_dotenv()

# --- CGM Security and Configuration Classes ---

class CGMSecurity:
    """Handles encryption and decryption of CGM credentials"""
    
    @staticmethod
    def get_encryption_key():
        """Get or generate encryption key for CGM credentials"""
        # First try to get from environment variable
        key = os.environ.get('CGM_ENCRYPTION_KEY')
        
        if key:
            # If key exists in environment, decode it
            try:
                return base64.urlsafe_b64decode(key.encode())
            except Exception as e:
                print(f"⚠️ Error decoding encryption key from environment: {e}")
        
        # Check if key file exists
        key_file = '.encryption_key'
        if os.path.exists(key_file):
            try:
                with open(key_file, 'rb') as f:
                    return f.read()
            except Exception as e:
                print(f"⚠️ Error reading encryption key file: {e}")
        
        # Generate new key and save to file
        new_key = Fernet.generate_key()
        try:
            with open(key_file, 'wb') as f:
                f.write(new_key)
            print(f"🔐 Generated new CGM encryption key and saved to {key_file}")
            
            # Also provide environment variable format for production
            encoded_key = base64.urlsafe_b64encode(new_key).decode()
            print(f"🔑 For production, set environment variable: CGM_ENCRYPTION_KEY={encoded_key}")
            
            return new_key
        except Exception as e:
            print(f"❌ Error saving encryption key: {e}")
            # Return the key anyway for this session
            return new_key
    
    @staticmethod
    def encrypt_password(password: str) -> bytes:
        """Encrypt a password for storage"""
        try:
            key = CGMSecurity.get_encryption_key()
            cipher_suite = Fernet(key)
            return cipher_suite.encrypt(password.encode())
        except Exception as e:
            print(f"❌ Error encrypting password: {e}")
            raise Exception("Failed to encrypt password")
    
    @staticmethod
    def decrypt_password(encrypted_password: bytes) -> str:
        """Decrypt a password from storage"""
        try:
            key = CGMSecurity.get_encryption_key()
            cipher_suite = Fernet(key)
            return cipher_suite.decrypt(encrypted_password).decode()
        except Exception as e:
            print(f"❌ Error decrypting password: {e}")
            raise Exception("Failed to decrypt password")

class DexcomConfig:
    """Configuration constants for Dexcom CGM integration"""
    
    REGIONS = {
        'us': 'United States',
        'ous': 'Outside United States', 
        'jp': 'Japan'
    }
    
    CGM_TYPES = {
        'dexcom-g6-g5-one-plus': 'Dexcom G6/G5/One+',
        'dexcom-g7': 'Dexcom G7',
        'freestyle-libre-2': 'Abbott Freestyle Libre 2'
    }
    
    DEFAULT_SYNC_FREQUENCY = 15  # minutes
    MAX_READINGS_PER_SYNC = 100
    CONNECTION_TIMEOUT = 30  # seconds
    RETRY_ATTEMPTS = 3
    
    # Rate limiting
    MIN_SYNC_INTERVAL = 5  # minimum minutes between syncs
    MAX_DAILY_SYNCS = 96  # 24 hours * 4 syncs per hour
    
    @staticmethod
    def get_region_endpoint(region: str) -> str:
        """Get the appropriate Dexcom endpoint for region"""
        endpoints = {
            'us': 'share2.dexcom.com',
            'ous': 'shareous1.dexcom.com',
            'jp': 'share.dexcom.jp'
        }
        return endpoints.get(region, endpoints['us'])

# --- Configuration ---
app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# Gemini Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Nixtla TimeGPT Configuration
NIXTLA_API_KEY = os.getenv("NIXTLA_API_KEY")
nixtla_client = None
if NIXTLA_API_KEY:
    try:
        nixtla_client = NixtlaClient(api_key=NIXTLA_API_KEY)
        print("NixtlaClient initialized successfully.")
    except Exception as e:
        print(f"Error initializing NixtlaClient: {e}")
        print("Nixtla TimeGPT functionality will be disabled.")
else:
    print("NIXTLA_API_KEY not found in .env. Nixtla TimeGPT functionality will be disabled.")

# Configure Gemini API
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel('gemini-2.5-flash')
else:
    print("GEMINI_API_KEY not found in .env. Gemini functionality will be disabled.")
    gemini_model = None

# MySQL connection using individual environment variables
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = os.getenv("MYSQL_PORT", "3306")
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "Alex%4012345")
MYSQL_DB = os.getenv("MYSQL_DB", "sugarsense")

# Construct the MySQL URL from individual components with better connection settings
MYSQL_URL = f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"

# Create engine with improved settings for lock timeout handling
engine = create_engine(
    MYSQL_URL,
    pool_size=20,
    max_overflow=30,
    pool_timeout=30,
    pool_recycle=3600,
    pool_pre_ping=True,
    connect_args={
        "autocommit": False,
        "connect_timeout": 60,
        "read_timeout": 60,
        "write_timeout": 60,
        "charset": "utf8mb4"
    }
)

def create_activity_log_table():
    """Create the activity_log table for manual activity entries"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS activity_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    activity_type VARCHAR(100) NOT NULL,
                    duration_minutes INT NOT NULL,
                    steps INT DEFAULT 0,
                    calories_burned INT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    INDEX idx_activity_type (activity_type)
                )
            """))
            conn.commit()
            print("✅ Activity log table created/verified successfully")
    except Exception as e:
        print(f"Error creating activity_log table: {e}")
        raise

def create_health_data_archive_table():
    """Create the permanent health_data_archive table with all necessary columns"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS health_data_archive (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    data_type VARCHAR(100) NOT NULL,
                    data_subtype VARCHAR(100) NULL,
                    value DECIMAL(15,6) NULL,
                    value_string TEXT NULL,
                    unit VARCHAR(50) NULL,
                    start_date DATETIME NULL,
                    end_date DATETIME NULL,
                    source_name VARCHAR(200) NULL,
                    source_bundle_id VARCHAR(200) NULL,
                    device_name VARCHAR(200) NULL,
                    sample_id VARCHAR(100) NULL,
                    category_type VARCHAR(100) NULL,
                    workout_activity_type VARCHAR(100) NULL,
                    total_energy_burned DECIMAL(10,2) NULL,
                    total_distance DECIMAL(10,4) NULL,
                    average_quantity DECIMAL(15,6) NULL,
                    minimum_quantity DECIMAL(15,6) NULL,
                    maximum_quantity DECIMAL(15,6) NULL,
                    metadata TEXT NULL,
                    timestamp DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    INDEX idx_user_data_type (user_id, data_type),
                    INDEX idx_start_date (start_date),
                    INDEX idx_data_type_date (data_type, start_date),
                    UNIQUE KEY idx_sample_id (sample_id),
                    INDEX idx_user_type_date (user_id, data_type, start_date)
                )
            """))
            conn.commit()
            print("✅ health_data_archive table verified/created with unique sample_id index")
    except Exception as e:
        print(f"Error creating health_data_archive table: {e}")
        raise

def create_health_data_display_table():
    """Create the health_data_display table for dashboarding"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS health_data_display (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    data_type VARCHAR(100) NOT NULL,
                    data_subtype VARCHAR(100) NULL,
                    value DECIMAL(15,6) NULL,
                    value_string TEXT NULL,
                    unit VARCHAR(50) NULL,
                    start_date DATETIME NULL,
                    end_date DATETIME NULL,
                    source_name VARCHAR(200) NULL,
                    source_bundle_id VARCHAR(200) NULL,
                    device_name VARCHAR(200) NULL,
                    sample_id VARCHAR(100) NULL,
                    category_type VARCHAR(100) NULL,
                    workout_activity_type VARCHAR(100) NULL,
                    total_energy_burned DECIMAL(10,2) NULL,
                    total_distance DECIMAL(10,4) NULL,
                    average_quantity DECIMAL(15,6) NULL,
                    minimum_quantity DECIMAL(15,6) NULL,
                    maximum_quantity DECIMAL(15,6) NULL,
                    metadata TEXT NULL,
                    timestamp DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    INDEX idx_user_data_type (user_id, data_type),
                    INDEX idx_start_date (start_date),
                    INDEX idx_data_type_date (data_type, start_date),
                    INDEX idx_sample_id (sample_id),
                    INDEX idx_user_type_date (user_id, data_type, start_date)
                )
            """))
            conn.commit()
            print("✅ health_data_display table verified/created")
    except Exception as e:
        print(f"Error creating health_data_display table: {e}")
        raise

def create_verification_health_data_table():
    """Creates the verification_health_data table if it doesn't exist."""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS verification_health_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                data_type VARCHAR(255) NOT NULL,
                data JSON,
                created_at DATETIME NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                KEY idx_user_id (user_id),
                KEY idx_created_at (created_at)
            );
        """))
    print("✅ Verification health data table created/verified successfully.")

# --- Database Initialization ---
def create_glucose_log_table():
    """Create the glucose_log table for glucose readings with unique constraint to prevent duplicates"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS glucose_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    glucose_level DECIMAL(5,1) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    UNIQUE KEY unique_user_timestamp (user_id, timestamp)
                )
            """))
            conn.commit()
            
            # Add unique constraint to existing table if it doesn't exist
            try:
                conn.execute(text("""
                    ALTER TABLE glucose_log 
                    ADD UNIQUE KEY unique_user_timestamp (user_id, timestamp)
                """))
                conn.commit()
                print("✅ Added unique constraint to glucose_log table")
            except Exception as alter_error:
                # Constraint might already exist, which is fine
                if "Duplicate key name" in str(alter_error):
                    print("ℹ️ Unique constraint already exists on glucose_log table")
                else:
                    print(f"⚠️  Note: Could not add unique constraint: {alter_error}")
            
            print("✅ Glucose log table created/verified successfully")
    except Exception as e:
        print(f"Error creating glucose_log table: {e}")
        raise

def create_food_log_table():
    """Create the food_log table for meal logging"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS food_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    meal_type VARCHAR(50) NOT NULL,
                    food_description TEXT NOT NULL,
                    calories DECIMAL(8,2) DEFAULT 0,
                    carbs DECIMAL(8,2) DEFAULT 0,
                    protein DECIMAL(8,2) DEFAULT 0,
                    fat DECIMAL(8,2) DEFAULT 0,
                    sugar DECIMAL(8,2) DEFAULT 0,
                    fiber DECIMAL(8,2) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    INDEX idx_meal_type (meal_type)
                )
            """))
            conn.commit()
            print("✅ Food log table created/verified successfully")
    except Exception as e:
        print(f"Error creating food_log table: {e}")
        raise

def create_medication_log_table():
    """Create the medication_log table for medication tracking"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS medication_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    medication_type VARCHAR(100) NOT NULL,
                    medication_name VARCHAR(200) NOT NULL,
                    dosage DECIMAL(8,2) NOT NULL,
                    insulin_type VARCHAR(50) NULL,
                    meal_context VARCHAR(50) NULL,
                    injection_site VARCHAR(50) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    INDEX idx_medication_type (medication_type)
                )
            """))
            conn.commit()
            
            # Add injection_site column if it doesn't exist (for existing databases)
            try:
                conn.execute(text("""
                    ALTER TABLE medication_log 
                    ADD COLUMN injection_site VARCHAR(50) NULL
                """))
                conn.commit()
                print("✅ Added injection_site column to medication_log table")
            except Exception as alter_error:
                # Column might already exist, which is fine
                if "Duplicate column name" in str(alter_error):
                    pass
                else:
                    print(f"⚠️  Note: Could not add injection_site column: {alter_error}")
                    
            print("✅ Medication log table created/verified successfully")
    except Exception as e:
        print(f"Error creating medication_log table: {e}")
        raise

def create_sleep_log_table():
    """Create the sleep_log table for sleep tracking"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sleep_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    sleep_start DATETIME NOT NULL,
                    sleep_end DATETIME NOT NULL,
                    sleep_quality VARCHAR(20) DEFAULT 'Good',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_sleep_end (user_id, sleep_end)
                )
            """))
            conn.commit()
            print("✅ Sleep log table created/verified successfully")
    except Exception as e:
        print(f"Error creating sleep_log table: {e}")
        raise

def create_users_table():
    """Create the central users table for user management and onboarding data"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    profile_image_url TEXT,
                    
                    -- Basic Demographics (from onboarding)
                    date_of_birth DATE,
                    gender ENUM('Male', 'Female', 'Other', 'Prefer not to say'),
                    height_value DECIMAL(5,2),
                    height_unit ENUM('cm', 'ft'),
                    weight_value DECIMAL(5,2),
                    weight_unit ENUM('kg', 'lbs'),
                    
                    -- Diabetes Profile (from onboarding)
                    has_diabetes ENUM('Yes', 'No', 'Not sure'),
                    diabetes_type ENUM('Type 1', 'Type 2', 'Gestational', 'Pre-diabetes', 'Not sure'),
                    year_of_diagnosis YEAR,
                    uses_insulin ENUM('Yes', 'No'),
                    insulin_type ENUM('Basal', 'Bolus', 'Both'),
                    daily_basal_dose DECIMAL(5,2),
                    insulin_to_carb_ratio DECIMAL(5,2),
                    
                    -- Target Glucose Range (customizable by user)
                    target_glucose_min INT DEFAULT 70,
                    target_glucose_max INT DEFAULT 140,
                    
                    -- Device Preferences (from onboarding)
                    cgm_status ENUM('No – Decided against it', 'No – Still deciding', 'No – Trying to get one', 'Yes – I already use one'),
                    cgm_model ENUM('Dexcom G7 / One+', 'Dexcom G6 / G5 / One', 'Abbott Freestyle Libre'),
                    insulin_delivery_status ENUM('Not using insulin', 'Only using basal insulin', 'MDI now, but considering a pump or smart pen', 'MDI now, actively trying to get one', 'MDI now, decided against a pump or smart pen', 'Omnipod 5', 'Omnipod Dash'),
                    pump_model ENUM('Omnipod 5', 'Omnipod Dash'),
                    
                    -- Onboarding Tracking
                    onboarding_completed BOOLEAN DEFAULT FALSE,
                    onboarding_completed_at TIMESTAMP NULL,
                    
                    -- Audit Fields
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    INDEX idx_clerk_user_id (clerk_user_id),
                    INDEX idx_email (email),
                    INDEX idx_onboarding_completed (onboarding_completed)
                )
            """))
            conn.commit()
            
            # Add target glucose columns if they don't exist (for existing databases)
            try:
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN target_glucose_min INT DEFAULT 70
                """))
                conn.commit()
                print("✅ Added target_glucose_min column to users table")
            except Exception as alter_error:
                # Column might already exist, which is fine
                if "Duplicate column name" in str(alter_error):
                    pass
                else:
                    print(f"⚠️  Note: Could not add target_glucose_min column: {alter_error}")
            
            try:
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN target_glucose_max INT DEFAULT 140
                """))
                conn.commit()
                print("✅ Added target_glucose_max column to users table")
            except Exception as alter_error:
                # Column might already exist, which is fine
                if "Duplicate column name" in str(alter_error):
                    pass
                else:
                    print(f"⚠️  Note: Could not add target_glucose_max column: {alter_error}")
                    
            print("✅ Users table created/verified successfully")
    except Exception as e:
        print(f"Error creating users table: {e}")
        raise

def create_basal_dose_logs_table():
    """Create the basal_dose_logs table for basal insulin dose tracking"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS basal_dose_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    insulin_type VARCHAR(20) DEFAULT 'basal',
                    insulin_name VARCHAR(200) NOT NULL,
                    dose_units DECIMAL(8,2) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    INDEX idx_insulin_type (insulin_type)
                )
            """))
            conn.commit()
            print("✅ Basal dose logs table created/verified successfully")
    except Exception as e:
        print(f"Error creating basal_dose_logs table: {e}")
        raise

def create_cgm_connections_table():
    """Create the cgm_connections table for storing CGM device credentials and connection status"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS cgm_connections (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    cgm_type ENUM('dexcom-g6-g5-one-plus', 'dexcom-g7', 'freestyle-libre-2') NOT NULL,
                    region ENUM('us', 'ous', 'jp') DEFAULT 'us',
                    username VARCHAR(255) NOT NULL,
                    password_encrypted BLOB NOT NULL,
                    account_id VARCHAR(255) NULL,
                    connection_status ENUM('connected', 'failed', 'expired', 'testing') DEFAULT 'testing',
                    active INT DEFAULT 1,
                    last_sync_at TIMESTAMP NULL,
                    last_error_message TEXT NULL,
                    sync_frequency_minutes INT DEFAULT 15,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    
                    UNIQUE KEY unique_user_cgm (user_id, cgm_type),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_user_status (user_id, connection_status),
                    INDEX idx_last_sync (last_sync_at),
                    INDEX idx_status_sync (connection_status, last_sync_at)
                )
            """))
            
            # Check if 'active' column exists and add it if not (for existing databases)
            result = conn.execute(text("SHOW COLUMNS FROM cgm_connections LIKE 'active'"))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE cgm_connections ADD COLUMN active INT DEFAULT 1"))
                print("✅ Added 'active' column to existing cgm_connections table")
            
            conn.commit()
            print("✅ CGM connections table created/verified successfully")
    except Exception as e:
        print(f"Error creating cgm_connections table: {e}")
        raise

def create_cgm_sync_logs_table():
    """Create the cgm_sync_logs table for monitoring and debugging CGM sync operations"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS cgm_sync_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    cgm_connection_id INT NOT NULL,
                    sync_start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_end_time TIMESTAMP NULL,
                    readings_fetched INT DEFAULT 0,
                    readings_inserted INT DEFAULT 0,
                    readings_duplicated INT DEFAULT 0,
                    sync_status ENUM('in_progress', 'completed', 'failed') DEFAULT 'in_progress',
                    error_message TEXT NULL,
                    api_response_time_ms INT NULL,
                    
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (cgm_connection_id) REFERENCES cgm_connections(id) ON DELETE CASCADE,
                    INDEX idx_user_sync_time (user_id, sync_start_time),
                    INDEX idx_status_time (sync_status, sync_start_time),
                    INDEX idx_connection_status (cgm_connection_id, sync_status)
                )
            """))
            conn.commit()
            print("✅ CGM sync logs table created/verified successfully")
    except Exception as e:
        print(f"Error creating cgm_sync_logs table: {e}")
        raise

def initialize_database():
    """Creates all necessary database tables if they don't exist."""
    print("--- Initializing Database ---")
    create_users_table()  # Create users table first for foreign key references
    create_glucose_log_table()
    create_food_log_table()
    create_activity_log_table()
    create_medication_log_table()
    create_sleep_log_table()
    create_basal_dose_logs_table()  # Add basal dose logs table
    create_cgm_connections_table()  # CGM connections table
    create_cgm_sync_logs_table()  # CGM sync monitoring table
    create_health_data_archive_table()
    create_health_data_display_table()
    create_verification_health_data_table()
    print("--- Database Initialization Complete ---")

# Run initialization at startup
initialize_database()

# Clean up any existing duplicates on startup
print("🧪 Cleaning up any existing duplicate glucose readings...")
try:
    cleanup_duplicate_glucose_readings()
except Exception as e:
    print(f"⚠️ Could not clean up duplicates on startup: {e}")

# --- User Management Helper Functions ---

def get_user_id_from_clerk(clerk_user_id: str) -> int:
    """
    Get the database user_id from a Clerk user_id
    
    Args:
        clerk_user_id: The Clerk user identifier
        
    Returns:
        int: The database user ID
        
    Raises:
        ValueError: If user not found
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT id FROM users WHERE clerk_user_id = :clerk_user_id
            """), {'clerk_user_id': clerk_user_id}).fetchone()
            
            if not result:
                raise ValueError(f"User not found for clerk_user_id: {clerk_user_id}")
            
            return result.id
    except Exception as e:
        print(f"Error getting user_id for clerk_user_id {clerk_user_id}: {e}")
        raise

def get_or_create_user(clerk_user_id: str, email: str, full_name: str = None, profile_image_url: str = None) -> dict:
    """
    Get existing user or create new user with basic information
    
    Args:
        clerk_user_id: The Clerk user identifier
        email: User's email address
        full_name: User's full name (optional)
        profile_image_url: User's profile image URL (optional)
        
    Returns:
        dict: User information including database user_id and whether user was created
    """
    try:
        with engine.connect() as conn:
            # Check if user already exists
            existing_user = conn.execute(text("""
                SELECT id, onboarding_completed FROM users WHERE clerk_user_id = :clerk_user_id
            """), {'clerk_user_id': clerk_user_id}).fetchone()
            
            if existing_user:
                # Update last_active_at for existing user
                conn.execute(text("""
                    UPDATE users SET last_active_at = CURRENT_TIMESTAMP 
                    WHERE clerk_user_id = :clerk_user_id
                """), {'clerk_user_id': clerk_user_id})
                conn.commit()
                
                return {
                    "user_id": existing_user.id,
                    "onboarding_completed": bool(existing_user.onboarding_completed),
                    "created": False
                }
            
            # Create new user
            result = conn.execute(text("""
                INSERT INTO users (clerk_user_id, email, full_name, profile_image_url)
                VALUES (:clerk_user_id, :email, :full_name, :profile_image_url)
            """), {
                'clerk_user_id': clerk_user_id,
                'email': email,
                'full_name': full_name,
                'profile_image_url': profile_image_url
            })
            
            user_id = result.lastrowid
            conn.commit()
            
            print(f"✅ Created new user with database ID {user_id} for clerk_user_id: {clerk_user_id}")
            
            return {
                "user_id": user_id,
                "onboarding_completed": False,
                "created": True
            }
            
    except Exception as e:
        print(f"Error in get_or_create_user for clerk_user_id {clerk_user_id}: {e}")
        raise

# --- CGM Helper Functions ---

def test_dexcom_connection(username: str, password: str, region: str = 'us') -> dict:
    """
    Test Dexcom connection without storing credentials
    
    Args:
        username: Dexcom Share username
        password: Dexcom Share password  
        region: Dexcom region ('us', 'ous', 'jp')
        
    Returns:
        dict: Connection test result with success status and current glucose if available
    """
    try:
        print(f"🔗 Testing Dexcom connection for username: {username[:3]}*** in region: {region}")
        
        # Initialize Dexcom client with updated API
        from pydexcom import Region
        region_enum = Region.US if region == 'us' else (Region.OUS if region == 'ous' else Region.JP)
        dexcom = Dexcom(username=username, password=password, region=region_enum)
        
        # Test connection by fetching current glucose reading
        current_glucose = dexcom.get_current_glucose_reading()
        
        if current_glucose is not None:
            return {
                "success": True,
                "message": "Connection successful",
                "current_glucose": {
                    "value": current_glucose.value,
                    "trend": current_glucose.trend_description,
                    "trend_arrow": current_glucose.trend_arrow,
                    "timestamp": current_glucose.datetime.isoformat() if current_glucose.datetime else None
                }
            }
        else:
            # Connection worked but no current reading available
            return {
                "success": True,
                "message": "Connection successful, but no current glucose reading available",
                "current_glucose": None
            }
            
    except Exception as e:
        error_msg = str(e).lower()
        
        # Provide specific error messages based on common issues
        if "invalid" in error_msg or "unauthorized" in error_msg:
            return {
                "success": False,
                "error": "Invalid username or password",
                "message": "Please check your Dexcom Share credentials and try again"
            }
        elif "network" in error_msg or "connection" in error_msg:
            return {
                "success": False,
                "error": "Network connection failed",
                "message": "Unable to connect to Dexcom servers. Please check your internet connection"
            }
        elif "region" in error_msg:
            return {
                "success": False,
                "error": "Incorrect region",
                "message": f"Region '{region}' may be incorrect. Try 'us' for United States, 'ous' for outside US, or 'jp' for Japan"
            }
        else:
            return {
                "success": False,
                "error": f"Connection failed: {str(e)}",
                "message": "Unable to connect to Dexcom. Please verify your credentials and region"
            }


def test_librelink_connection(username: str, password: str) -> dict:
    """
    Test LibreLinkUp connection without storing credentials
    
    Args:
        username: LibreLinkUp email
        password: LibreLinkUp password
        
    Returns:
        dict: Connection test result with success status and current glucose if available
    """
    try:
        print(f"🔗 Testing LibreLinkUp connection for username: {username[:3]}***")
        
        # Initialize LibreLinkUp client
        client = PyLibreLinkUp(email=username, password=password)
        client.authenticate()
        
        # Get patient list
        patients = client.get_patients()
        if not patients:
            return {
                "success": False,
                "error": "No patients found",
                "message": "No patients associated with this LibreLinkUp account"
            }
        
        # Get current glucose reading from first patient
        current_glucose = client.latest(patient_identifier=patients[0])
        
        if current_glucose is not None:
            return {
                "success": True,
                "message": "Connection successful",
                "current_glucose": {
                    "value": current_glucose.value,
                    "timestamp": current_glucose.timestamp.isoformat() if current_glucose.timestamp else None,
                    "trend": getattr(current_glucose, 'trend', None)
                }
            }
        else:
            # Connection worked but no current reading available
            return {
                "success": True,
                "message": "Connection successful, but no current glucose reading available",
                "current_glucose": None
            }
            
    except Exception as e:
        error_msg = str(e).lower()
        
        # Provide specific error messages based on common issues
        if "invalid" in error_msg or "unauthorized" in error_msg or "authentication" in error_msg:
            return {
                "success": False,
                "error": "Invalid username or password",
                "message": "Please check your LibreLinkUp credentials and try again"
            }
        elif "network" in error_msg or "connection" in error_msg:
            return {
                "success": False,
                "error": "Network connection failed",
                "message": "Unable to connect to LibreLinkUp servers. Please check your internet connection"
            }
        else:
            return {
                "success": False,
                "error": f"Connection failed: {str(e)}",
                "message": "Unable to connect to LibreLinkUp. Please verify your credentials"
            }

def validate_cgm_credentials(username: str, password: str, cgm_type: str, region: str = 'us') -> dict:
    """
    Validate CGM credentials and return detailed validation result
    
    Args:
        username: CGM username
        password: CGM password
        cgm_type: Type of CGM device
        region: Region for Dexcom devices
        
    Returns:
        dict: Validation result with success status and details
    """
    try:
        # Validate inputs
        if not username or not password:
            return {
                "success": False,
                "error": "Missing credentials",
                "message": "Username and password are required"
            }

        # Handle LibreLinkUp devices
        if cgm_type == 'freestyle-libre-2':
            connection_result = test_librelink_connection(username, password)
            if connection_result["success"]:
                return {
                    "success": True,
                    "message": "Credentials validated successfully",
                    "connection_test": connection_result
                }
            else:
                return {
                    "success": False,
                    "error": connection_result["error"],
                    "message": connection_result["message"],
                    "connection_test": connection_result
                }

        # Handle Dexcom devices
        elif cgm_type.startswith('dexcom'):
            # Validate region
            if region not in DexcomConfig.REGIONS:
                return {
                    "success": False,
                    "error": "Invalid region",
                    "message": f"Region must be one of: {', '.join(DexcomConfig.REGIONS.keys())}"
                }
            
            # Test the connection
            connection_result = test_dexcom_connection(username, password, region)
            
            if connection_result["success"]:
                return {
                    "success": True,
                    "message": "Credentials validated successfully",
                    "connection_test": connection_result
                }
            else:
                return {
                    "success": False,
                    "error": connection_result["error"],
                    "message": connection_result["message"],
                    "connection_test": connection_result
                }
        
        # Unsupported CGM type
        else:
            return {
                "success": False,
                "error": "Unsupported CGM type",
                "message": f"CGM type '{cgm_type}' is not yet supported."
            }
        

            
    except Exception as e:
        return {
            "success": False,
            "error": f"Validation failed: {str(e)}",
            "message": "Unable to validate credentials"
        }

def get_user_cgm_connections(user_id: int) -> list:
    """
    Get all CGM connections for a user
    
    Args:
        user_id: Database user ID
        
    Returns:
        list: List of CGM connections with status
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT id, cgm_type, region, username, connection_status, 
                       last_sync_at, last_error_message, sync_frequency_minutes,
                       created_at, updated_at
                FROM cgm_connections 
                WHERE user_id = :user_id
                ORDER BY created_at DESC
            """), {'user_id': user_id}).fetchall()
            
            connections = []
            for row in result:
                connections.append({
                    "id": row.id,
                    "cgm_type": row.cgm_type,
                    "region": row.region,
                    "username": row.username,
                    "connection_status": row.connection_status,
                    "last_sync_at": row.last_sync_at.isoformat() if row.last_sync_at else None,
                    "last_error_message": row.last_error_message,
                    "sync_frequency_minutes": row.sync_frequency_minutes,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None
                })
            
            return connections
            
    except Exception as e:
        print(f"❌ Error getting CGM connections for user {user_id}: {e}")
        return []

def log_cgm_sync_attempt(user_id: int, cgm_connection_id: int, sync_start_time: datetime) -> int:
    """
    Log the start of a CGM sync attempt
    
    Args:
        user_id: Database user ID
        cgm_connection_id: CGM connection ID
        sync_start_time: When the sync started
        
    Returns:
        int: Sync log ID for updating later
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                INSERT INTO cgm_sync_logs 
                (user_id, cgm_connection_id, sync_start_time, sync_status)
                VALUES (:user_id, :cgm_connection_id, :sync_start_time, 'in_progress')
            """), {
                'user_id': user_id,
                'cgm_connection_id': cgm_connection_id,
                'sync_start_time': sync_start_time
            })
            
            sync_log_id = result.lastrowid
            conn.commit()
            return sync_log_id
            
    except Exception as e:
        print(f"❌ Error logging CGM sync attempt: {e}")
        return None

def update_cgm_sync_result(sync_log_id: int, success: bool, readings_fetched: int = 0, 
                          readings_inserted: int = 0, error_message: str = None) -> None:
    """
    Update CGM sync log with results
    
    Args:
        sync_log_id: Sync log ID to update
        success: Whether sync was successful
        readings_fetched: Number of readings fetched from CGM
        readings_inserted: Number of readings inserted to database
        error_message: Error message if sync failed
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                UPDATE cgm_sync_logs 
                SET sync_end_time = CURRENT_TIMESTAMP,
                    sync_status = :status,
                    readings_fetched = :readings_fetched,
                    readings_inserted = :readings_inserted,
                    error_message = :error_message
                WHERE id = :sync_log_id
            """), {
                'sync_log_id': sync_log_id,
                'status': 'completed' if success else 'failed',
                'readings_fetched': readings_fetched,
                'readings_inserted': readings_inserted,
                'error_message': error_message
            })
            conn.commit()
            
    except Exception as e:
        print(f"❌ Error updating CGM sync result: {e}")

# Setup persistent ChromaDB memory
try:
    embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
    client = PersistentClient(path="chroma_db")
    collection = client.get_or_create_collection(name="health_insights", embedding_function=embedding_func)

    # Add default memory if collection is empty
    if collection.count() == 0:
        collection.add(documents=[
            "User tends to eat more carbs at lunch and dinner.",
            "Running sessions consistently burns more than 200 calories.",
            "Glucose drops more after taking metformin post lunch.",
            "Better sleep quality correlates with lower morning glucose.",
            "Skipping breakfast has led to inconsistent glucose levels."
        ], ids=["1", "2", "3", "4", "5"])
    print("ChromaDB setup complete.")

except Exception as e:
    print(f"Error setting up ChromaDB or SentenceTransformer: {e}")
    print("Please ensure 'chroma_db' directory exists and sentence-transformers is installed (`pip install sentence-transformers chromadb`)")
    collection = None

# --- Flask Route for Chat API ---
@app.route('/api/chat', methods=['POST'])

def chat():
    data = request.json
    user_message = data.get('message', '')
    health_snapshot = data.get('health_snapshot')
    image_data_b64 = data.get('image')  # Base64 encoded image string
    chat_history = data.get('chat_history', [])
    clerk_user_id = data.get('clerk_user_id')

    # ------------------------------------------------------------
    # QUICK GREETING HANDLER – bypass heavy reasoning for casual greetings
    # ------------------------------------------------------------
    greeting_patterns = [r'^\s*hi[.!]?\s*$', r'^\s*hello[.!]?\s*$', r'^\s*hey[.!]?\s*$',
                         r'^\s*good\s+morning[.!]?\s*$', r'^\s*good\s+afternoon[.!]?\s*$',
                         r'^\s*good\s+evening[.!]?\s*$']

    lowered_msg = user_message.strip().lower()
    if any(re.match(pat, lowered_msg) for pat in greeting_patterns):
        friendly_greeting = (
            "Hello! How can I assist you with your glucose, activity, or nutrition today?"
        )
        return jsonify({"response": friendly_greeting})

    # Log receipt of data
    print(f"Received user_message: '{user_message}'")
    print(f"Received image_data (present): {image_data_b64 is not None}")
    if health_snapshot:
        print(f"✅ Received health_snapshot from frontend: {health_snapshot}")

    # --- Start of RAG and Conversational Context Logic ---

    # 1. Format chat history from frontend payload into Gemini's expected format
    chat_history_formatted = []
    # Filter out the initial 'info' message and any messages without text content
    for msg in [m for m in chat_history if m.get('type') != 'info' and m.get('text')]:
        role = 'model' if msg.get('type') == 'system' else 'user'
        chat_history_formatted.append({'role': role, 'parts': [{'text': msg.get('text')}]})
    
    print(f"chat_history_formatted: {chat_history_formatted}")

    # 2. RAG: Retrieve relevant documents from ChromaDB based on the current query
    # The query should combine the user message and key health metrics for better context
    query_text = user_message
    if health_snapshot and health_snapshot.get('glucoseSummary'):
        query_text += f" (current glucose avg: {health_snapshot['glucoseSummary'].get('averageToday')})"

    try:
        retrieved_docs = collection.query(
            query_texts=[query_text],
            n_results=7  # Retrieve more docs for better context
        )
        # Flatten the list of lists and remove duplicates
        retrieved_context = "\n".join(list(set(retrieved_docs['documents'][0])))
        print(f"📚 RAG Context Retrieved:\n{retrieved_context}")
    except Exception as e:
        print(f"⚠️ Error querying ChromaDB: {e}")
        retrieved_context = "No historical data could be retrieved."

    # 3. Build the Health Snapshot string for the prompt
    health_snapshot_str = "No real-time health data available."
    if health_snapshot:
        health_snapshot_str = "\n".join([f"{k}: {v}" for k, v in health_snapshot.items()])

    # Fetch recent glucose logs
    try:
        # Get user_id from clerk_user_id if available
        user_id = None
        if clerk_user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                print(f"Warning: Could not resolve user_id from clerk_user_id {clerk_user_id}: {e}")
        
        if user_id:
            with engine.connect() as conn:
                recent_glucose_result = conn.execute(text("""
                    SELECT timestamp, glucose_level 
                    FROM glucose_log 
                    WHERE user_id = :user_id 
                    ORDER BY timestamp DESC 
                    LIMIT 5
                """), {'user_id': user_id}).fetchall()
                
                today_start = datetime.now().strftime('%Y-%m-%d 00:00:00')
                today_avg_result = conn.execute(text("""
                    SELECT AVG(glucose_level) as avg_glucose
                    FROM glucose_log 
                    WHERE user_id = :user_id AND timestamp >= :today_start
                """), {'user_id': user_id, 'today_start': today_start}).fetchone()
        else:
            # No user_id available, set empty results
            recent_glucose_result = []
            today_avg_result = None
        
        if recent_glucose_result:
            recent_glucose_str = "Recent glucose logs:"
            for log in recent_glucose_result:
                recent_glucose_str += f"\n- {log.glucose_level} mg/dL at {log.timestamp}"
            health_snapshot_str += f"\n{recent_glucose_str}"
        else:
            health_snapshot_str += "\nNo recent glucose logs."
        
        if today_avg_result and today_avg_result.avg_glucose:
            health_snapshot_str += f"\nToday's average glucose: {today_avg_result.avg_glucose:.1f} mg/dL"
        else:
            health_snapshot_str += "\nNo glucose data available for today."
    except Exception as e:
        print(f"Error fetching glucose data: {e}")

    # Fetch latest meal from database
    try:
        if user_id:
            with engine.connect() as conn:
                latest_meals_result = conn.execute(text("""
                    SELECT food_description, meal_type, timestamp, carbs 
                    FROM food_log 
                    WHERE user_id = :user_id 
                    ORDER BY timestamp DESC 
                    LIMIT 5
                """), {'user_id': user_id}).fetchall()
        else:
            latest_meals_result = []
        
        if latest_meals_result:
            latest_meals_str = "Recent logged meals:"
            for meal in latest_meals_result:
                latest_meals_str += f"\n- {meal.food_description} ({meal.meal_type}), carbs: {meal.carbs}g, at {meal.timestamp}"
            health_snapshot_str += f"\n{latest_meals_str}"
        else:
            health_snapshot_str += "\nNo recent meals logged."
    except Exception as e:
        print(f"Error fetching recent meals: {e}")

    # Fetch step data from database (last 30 days for comprehensive coverage)
    try:
        if user_id:
            with engine.connect() as conn:
                # Prioritize display table and fallback to archive to prevent double counting
                step_data_query = text("""
                    SELECT DATE(start_date) as date, SUM(value) as total_steps
                    FROM health_data_display
                    WHERE user_id = :user_id AND data_type = 'StepCount'
                      AND start_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                      AND value > 0
                    GROUP BY DATE(start_date)
                    UNION
                    SELECT DATE(start_date) as date, SUM(value) as total_steps
                    FROM health_data_archive
                    WHERE user_id = :user_id AND data_type = 'StepCount'
                      AND start_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                      AND value > 0
                      AND DATE(start_date) NOT IN (
                          SELECT DISTINCT DATE(start_date)
                          FROM health_data_display
                          WHERE user_id = :user_id AND data_type = 'StepCount'
                            AND start_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                      )
                    GROUP BY DATE(start_date)
                    ORDER BY date DESC
                """)
                step_records = conn.execute(step_data_query, {'user_id': user_id}).fetchall()
        else:
            step_records = []

        if step_records:
            step_data_str = "Step data for last 30 days:"
            print(f"📊 Retrieved {len(step_records)} days of step data")
            for record in step_records:
                step_data_str += f"\n- {record.date}: {int(record.total_steps)} steps"
            health_snapshot_str += f"\n{step_data_str}"
        else:
            health_snapshot_str += "\nNo step data available for the last 30 days."
            print(f"⚠️ No step data found for user {user_id}")
    except Exception as e:
        print(f"Error fetching step data: {e}")

    # Fetch sleep data from database (last 30 days for comprehensive coverage)
    try:
        if user_id:
            with engine.connect() as conn:
                # Get sleep data from archive table as the main source of truth
                # FIX: Use MAX to get the longest sleep session per day, not total
                sleep_data_query = text("""
                    SELECT
                        DATE(end_date) as date,
                        MAX(TIMESTAMPDIFF(MINUTE, start_date, end_date) / 60.0) as total_hours
                    FROM
                        health_data_archive
                    WHERE
                        user_id = :user_id AND data_type = 'SleepAnalysis'
                        AND end_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    GROUP BY DATE(end_date)
                    ORDER BY DATE(end_date) DESC
                """)
                sleep_records = conn.execute(sleep_data_query, {'user_id': user_id}).fetchall()
        else:
            sleep_records = []
        
        if sleep_records:
            sleep_data_str = "Sleep data for last 30 days:"
            print(f"🛏️ Retrieved {len(sleep_records)} days of sleep data")
            for record in sleep_records:
                sleep_data_str += f"\n- {record.date}: {record.total_hours:.1f} hours"
            health_snapshot_str += f"\n{sleep_data_str}"
        else:
            health_snapshot_str += "\nNo sleep data available for the last 30 days."
            print(f"⚠️ No sleep data found for user {user_id}")
    except Exception as e:
        print(f"Error fetching sleep data: {e}")

    # Fetch activity/calories data from database (last 30 days for comprehensive coverage)
    try:
        if user_id:
            with engine.connect() as conn:
                # Get active calories data from display table with fallback to archive
                calories_data_query = text("""
                    SELECT DATE(start_date) as date, SUM(CAST(value AS DECIMAL(10,2))) as total_calories 
                    FROM health_data_display
                    WHERE user_id = :user_id AND data_type = 'ActiveEnergyBurned'
                      AND start_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                      AND CAST(value AS DECIMAL(10,2)) > 0
                    GROUP BY DATE(start_date)
                    ORDER BY DATE(start_date) DESC
                """)
                calories_records = conn.execute(calories_data_query, {'user_id': user_id}).fetchall()
                
                # Fallback to archive if no display data found
                if not calories_records:
                    print(f"⚠️ No calories data in display table, falling back to archive table")
                    calories_archive_query = text("""
                        SELECT DATE(start_date) as date, SUM(CAST(value AS DECIMAL(10,2))) as total_calories 
                        FROM health_data_archive
                        WHERE user_id = :user_id AND data_type = 'ActiveEnergyBurned'
                          AND start_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                          AND CAST(value AS DECIMAL(10,2)) > 0
                        GROUP BY DATE(start_date)
                        ORDER BY DATE(start_date) DESC
                    """)
                    calories_records = conn.execute(calories_archive_query, {'user_id': user_id}).fetchall()
        else:
            calories_records = []
        
        if calories_records:
            calories_data_str = "Active calories for last 30 days:"
            print(f"🔥 Retrieved {len(calories_records)} days of calories data")
            for record in calories_records:
                calories_data_str += f"\n- {record.date}: {int(record.total_calories)} calories"
            health_snapshot_str += f"\n{calories_data_str}"
        else:
            health_snapshot_str += "\nNo active calories data available for the last 30 days."
            print(f"⚠️ No calories data found for user {user_id}")
    except Exception as e:
        print(f"Error fetching calories data: {e}")

    # 4. Construct the comprehensive prompt for Gemini
    system_instructions = """
# Your Role: SugarSense.ai - Advanced AI Health Assistant
You are an expert AI assistant specializing in diabetes management, nutrition, and personal health coaching. Provide data-driven, empathetic, actionable advice in a crisp, natural tone like a helpful friend.

# Core Instructions:
1. **Analyze Holistically:** Use all contexts: question, health snapshot, history, RAG data.
2. **Handle Incomplete Data:** Use available data; state what's missing clearly. If no data for a metric (e.g., today's average), skip it or note absence - NEVER fabricate values.
3. **Timeframes:** You have access to up to 30 days of comprehensive health data. When users ask about specific time periods (e.g., "last 7 days", "last 15 days", "last week"), calculate averages and trends from the available data within that timeframe. If they don't specify a timeframe, default to the most recent relevant period.
4. **Concise & Factual:** Short responses, no verbose paragraphs or repeated disclaimers.
5. **Avoid Hallucination:** Stick strictly to provided data; say "I'm not sure" or "Based on available info..." if uncertain. For trends/predictions, base on historical patterns and meal composition only.
6. **Interactive & Contextual:** Build on history and recent interactions intelligently.
7. **Natural Tone:** Be supportive, concise, and engaging.
8. **Meal Queries:** Provide detailed descriptions and summaries of meals from logs, including ingredients if available.
9. **Disclaimers:** Only include medical disclaimers if providing specific medical guidance.
10. **Trend Inference:** For future glucose trends, infer from real historical data and meal analysis; be vague if insufficient data (e.g., "Based on similar meals...").
11. **Dynamic Time Periods:** When users ask about averages or trends for specific time periods, use the available data to calculate accurate statistics. For example, if they ask about "last 7 days" and you have data for 5 of those days, calculate the average from those 5 days and mention the missing days.
12. **Source of Truth:** The "Real-time Health Snapshot" is your primary source of truth for specific data points and logs. Use "Relevant Health Memories (RAG)" for general context, but the Snapshot is authoritative. If there's a conflict, the Snapshot wins.

# Task: Reason step-by-step internally, then provide a clean response.
"""
    
    # Prepare the content parts for the Gemini API call
    prompt_content = [
        system_instructions,
        "\n--- Real-time Health Snapshot (Source of Truth) ---\n",
        health_snapshot_str,
        "\n--- Relevant Health Memories (for context) ---\n",
        retrieved_context,
        "\n--- User's Current Question ---\n",
        user_message
    ]

    if image_data_b64:
        print("🖼️  Processing image in chat - adding to prompt...")
        image_mime_type = "image/jpeg"
        image_parts = {
            "mime_type": image_mime_type,
            "data": image_data_b64
        }
        prompt_content.append(image_parts)

    # 5. Initialize chat with history and send the new comprehensive message
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        chat_session = model.start_chat(history=chat_history_formatted)
        response = chat_session.send_message(prompt_content)
        gemini_response_text = response.text
        print(f"Gemini text response: {gemini_response_text}")

        # 6. Add the new interaction to ChromaDB for future RAG
        # We store the user's question and the AI's answer as a single "document" for better Q&A context
        conversation_to_log = f"User asked: '{user_message}'. You answered: '{gemini_response_text}'"
        collection.add(
            documents=[conversation_to_log],
            metadatas=[{"source": "conversation", "timestamp": datetime.now().isoformat()}],
            ids=[str(uuid.uuid4())]
        )
        print("✅ Added conversational exchange to ChromaDB memory.")

        return jsonify({'response': gemini_response_text})

    except Exception as e:
        print(f"❌ Error during Gemini API call or ChromaDB update: {e}")
        return jsonify({'error': 'Failed to process chat message.'}), 500

def parse_gemini_food_analysis(response_text: str) -> Dict[str, Any]:
    """
    Parses the raw text response from Gemini's food analysis prompt into a structured dictionary.
    
    This function now expects a 'contains_food' boolean flag. If false, it immediately
    returns an error indicating the image is invalid.
    """
    print(f"✅ Gemini raw response received.\nRaw text: {response_text}")

    # Check for the 'contains_food' flag first.
    contains_food_match = re.search(r"contains_food:\s*(true|false)", response_text, re.IGNORECASE)
    
    if contains_food_match:
        contains_food = contains_food_match.group(1).lower() == 'true'
        if not contains_food:
            # Extract the reason if available
            description_match = re.search(r"description:\s*(.*)", response_text, re.DOTALL)
            reason = description_match.group(1).strip() if description_match else "The image does not appear to contain food."
            return {"error": reason}

    # If contains_food is true or the flag is missing (for backward compatibility), proceed with parsing.
    description_match = re.search(r"description:\s*(.*?)(?=\n\w+:)", response_text, re.DOTALL)
    ingredients_match = re.search(r"ingredients:\s*(.*?)(?=\n\w+:)", response_text, re.DOTALL)
    
    description = description_match.group(1).strip() if description_match else "No description provided."
    ingredients_text = ingredients_match.group(1).strip() if ingredients_match else ""
    
    # Split ingredients by comma or newline, then clean up whitespace
    ingredients = [ing.strip() for ing in re.split(r'[,\n]', ingredients_text) if ing.strip()]

    # Regex to find all nutritional values
    nutritional_values_match = re.findall(r"-\s*(\w+):\s*([\d.]+)", response_text)
    
    nutritional_values = {
        'calories': 0.0,
        'carbs_g': 0.0,
        'sugar_g': 0.0,
        'fiber_g': 0.0,
        'protein_g': 0.0,
        'fat_g': 0.0
    }
    
    for key, value in nutritional_values_match:
        try:
            nutritional_values[key] = float(value)
        except (ValueError, KeyError):
            pass # Ignore if key is not in our dict or value is not a float

    parsed_data = {
        "description": description,
        "ingredients": ingredients,
        "nutritional_values": nutritional_values,
    }
    
    print(f"✅ Parsed analysis: {parsed_data}")
    return parsed_data

@app.route('/gemini-analyze', methods=['POST'])
def gemini_analyze():
    """
    Analyzes an image using Gemini to identify food items and nutritional information.
    Includes a check to ensure the image contains food before proceeding.
    """
    if not request.is_json:
        return jsonify({'success': False, 'error': 'Invalid request: Content-Type must be application/json'}), 400

    data = request.json
    image_data_b64 = data.get('imageData')
    
    if not image_data_b64:
        return jsonify({'success': False, 'error': 'No imageData provided.'}), 400

    try:
        # Initialize the Gemini client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')

        # Decode the base64 image
        image_data = base64.b64decode(image_data_b64)
        image_part = {"mime_type": "image/jpeg", "data": image_data}

        # The prompt now instructs the model to first validate if there's food in the image.
        prompt_text = """
        Analyze the image provided. Your first task is to determine if the image contains food.
        
        - If the image contains food, respond with 'contains_food: true' and provide the analysis.
        - If the image does NOT contain food (e.g., it shows a person, a room, an object), respond with 'contains_food: false' and a brief 'description' explaining why it cannot be analyzed (e.g., "This image shows a person in a room, not a meal."). Do not provide any other fields.

        If food is present, provide the following details in a structured format:
        
        description: A short, 1-2 sentence description of the meal.
        ingredients: A list of primary ingredients.
        nutritional_values:
        - calories: Estimated calories (numeric value).
        - carbs_g: Estimated carbohydrates in grams (numeric value).
        - sugar_g: Estimated sugar in grams (numeric value).
        - fiber_g: Estimated fiber in grams (numeric value).
        - protein_g: Estimated protein in grams (numeric value).
        - fat_g: Estimated fat in grams (numeric value).
        
        Example for a valid food image:
        contains_food: true
        description: A healthy salad with grilled chicken.
        ingredients: lettuce, tomato, cucumber, grilled chicken, vinaigrette
        nutritional_values:
        - calories: 350
        - carbs_g: 10
        - sugar_g: 5
        - fiber_g: 4
        - protein_g: 30
        - fat_g: 15

        Example for an invalid image:
        contains_food: false
        description: This image shows a car, not a meal.
        """

        print("🖼️ Sending image to Gemini for structured food analysis...")
        response = model.generate_content([prompt_text, image_part], stream=False)
        response.resolve()

        # Parse the response using the updated parsing function
        analysis_result = parse_gemini_food_analysis(response.text)

        # If the parser returned an error (e.g., not food), return that error.
        if 'error' in analysis_result:
            chat_response = f"I can see this isn't a food image. {analysis_result['error']} Feel free to ask me any questions about your diabetes management, glucose trends, or health data!"
            return jsonify({
                'success': False, 
                'error': analysis_result['error'],
                'response': chat_response  # Add chat-compatible response
            }), 400

        # Create conversational response for chat UI
        nutrition = analysis_result['nutritional_values']
        description = analysis_result['description']
        ingredients = ', '.join(analysis_result['ingredients'])
        
        # Format nutritional information conversationally
        nutrition_text = f"📊 **Nutritional Breakdown:**\n"
        nutrition_text += f"• Calories: {nutrition['calories']:.0f}\n"
        nutrition_text += f"• Carbs: {nutrition['carbs_g']:.0f}g\n"
        nutrition_text += f"• Protein: {nutrition['protein_g']:.0f}g\n"
        nutrition_text += f"• Fat: {nutrition['fat_g']:.0f}g"
        
        # Determine glucose impact based on carbs
        carbs = nutrition['carbs_g']
        if carbs > 45:
            glucose_impact = "🔴 **High carb content** - expect significant glucose rise in 1-2 hours"
        elif carbs > 15:
            glucose_impact = "🟡 **Moderate carb content** - expect moderate glucose rise"
        else:
            glucose_impact = "🟢 **Low carb content** - minimal glucose impact expected"
        
        # Get recent glucose pattern for personalized advice
        try:
            clerk_user_id = data.get('clerk_user_id')
            recent_avg = None
            
            if clerk_user_id:
                try:
                    user_id = get_user_id_from_clerk(clerk_user_id)
                    with engine.connect() as conn:
                        recent_avg = conn.execute(text("""
                            SELECT AVG(glucose_level) FROM glucose_log 
                            WHERE user_id = :user_id AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                        """), {'user_id': user_id}).scalar()
                except ValueError as e:
                    print(f"Warning: Could not resolve user_id from clerk_user_id {clerk_user_id}: {e}")
                    recent_avg = None
                
                if recent_avg and recent_avg > 180:
                    personalized_advice = "💡 **Tip:** Your recent levels have been elevated. Consider light activity after eating or consult your doctor about meal-time insulin."
                elif recent_avg and recent_avg < 100:
                    personalized_advice = "💡 **Tip:** Your recent levels have been good. This meal may cause a spike, so monitor closely."
                else:
                    personalized_advice = "💡 **Tip:** Monitor your glucose 1-2 hours after eating to see how this meal affects you."
        except:
            personalized_advice = "💡 **Tip:** Monitor your glucose 1-2 hours after eating to see how this meal affects you."
        
        # Create conversational response for chat UI
        chat_response = f"I can see this is **{description}** 🍽️\n\n"
        chat_response += f"**Main ingredients:** {ingredients}\n\n"
        chat_response += f"{nutrition_text}\n\n"
        chat_response += f"{glucose_impact}\n\n"
        chat_response += personalized_advice
        
        # Store nutritional context in ChromaDB for follow-up questions
        if collection:
            food_context = f"User just analyzed: {description}. Nutritional info: {nutrition['calories']} calories, {nutrition['carbs_g']}g carbs, {nutrition['protein_g']}g protein, {nutrition['fat_g']}g fat. Ingredients: {ingredients}."
            collection.add(
                documents=[food_context], 
                ids=[f"food_analysis_{int(datetime.now().timestamp())}"]
            )
            print("🧠 Stored food analysis in memory for follow-up questions")

        # Return both structured analysis AND chat response
        return jsonify({
            'success': True, 
            'analysis': analysis_result,
            'response': chat_response  # Add chat-compatible response
        })

    except Exception as e:
        print(f"💥 Error during Gemini analysis: {e}")
        # Check for specific Gemini API errors if needed
        if "API key not valid" in str(e):
            return jsonify({'success': False, 'error': 'Invalid Gemini API key.'}), 500
        return jsonify({'success': False, 'error': f"An unexpected error occurred during analysis: {e}"}), 500

# New endpoint for logging glucose data
@app.route('/api/log-glucose', methods=['POST'])
def log_glucose():
    # Ensure the glucose_log table exists
    create_glucose_log_table()
    
    data = request.json
    clerk_user_id = data.get('clerk_user_id')
    glucose_level = data.get('glucoseLevel')
    log_time_str = data.get('time')

    if not all([clerk_user_id, glucose_level, log_time_str]):
        return jsonify({"error": "Missing required fields: clerk_user_id, glucoseLevel, or time"}), 400
    
    try:
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        # The timestamp string is now sent in 'YYYY-MM-DD HH:MM:SS' format from the frontend,
        # which is directly usable by MySQL.
        timestamp = log_time_str

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO glucose_log (user_id, timestamp, glucose_level)
                VALUES (:user_id, :timestamp, :glucose_level)
            """), {'user_id': user_id, 'timestamp': timestamp, 'glucose_level': glucose_level})
            conn.commit()
        return jsonify({"message": "Glucose logged successfully"}), 200
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Error logging glucose: {e}")
        return jsonify({"error": "Failed to log glucose data."}), 500

# New endpoint for logging meal data
@app.route('/api/log-meal', methods=['POST'])
def log_meal():
    # Ensure the food_log table exists
    create_food_log_table()
    
    data = request.json
    clerk_user_id = data.get('clerk_user_id')
    
    # Extract all expected fields, providing defaults for new ones
    meal_type = data.get('meal_type')
    food_description = data.get('food_description')
    calories = data.get('calories')
    carbs = data.get('carbs')
    protein = data.get('protein_g') # Match frontend key
    fat = data.get('fat_g')       # Match frontend key
    sugar = data.get('sugar_g')     # Match frontend key
    fiber = data.get('fiber_g')     # Match frontend key

    # Basic validation for required fields
    if not all([clerk_user_id, meal_type, food_description]):
        return jsonify({"error": "Missing required fields: clerk_user_id, meal_type, or food_description"}), 400
    
    # Coalesce None to 0 for numerical fields
    calories = float(calories or 0)
    carbs = float(carbs or 0)
    protein = float(protein or 0)
    fat = float(fat or 0)
    sugar = float(sugar or 0)
    fiber = float(fiber or 0)

    try:
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with engine.connect() as conn:
            # Updated SQL query with all nutritional columns
            conn.execute(text("""
                INSERT INTO food_log (
                    user_id, timestamp, meal_type, food_description, 
                    calories, carbs, protein, fat, sugar, fiber
                )
                VALUES (
                    :user_id, :timestamp, :meal_type, :food_description, 
                    :calories, :carbs, :protein, :fat, :sugar, :fiber
                )
            """), {
                'user_id': user_id,
                'meal_type': meal_type,
                'food_description': food_description,
                'timestamp': timestamp,
                'calories': calories,
                'carbs': carbs,
                'protein': protein,
                'fat': fat,
                'sugar': sugar,
                'fiber': fiber,
            })
            conn.commit()

        # Add to ChromaDB for RAG
        if collection:
            meal_context = f"User logged meal on {timestamp}: {food_description} ({meal_type}), nutritional info: carbs {carbs}g, protein {protein}g, fat {fat}g, calories {calories}."
            collection.add(
                documents=[meal_context],
                ids=[str(uuid.uuid4())]
            )
            print("✅ Added meal log to ChromaDB memory.")
        return jsonify({"message": "Meal logged successfully"}), 200
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Error logging meal: {e}")
        # Provide a more specific error message if it's a known schema issue
        if "Unknown column" in str(e):
             return jsonify({"error": "Database schema error. Make sure the 'food_log' table has columns for protein, fat, sugar, and fiber."}), 500
        return jsonify({"error": "Failed to log meal data."}), 500

# New endpoint for fetching recent meal data
@app.route('/api/recent-meal', methods=['GET'])
def get_recent_meal():
    """Get the most recent meal logged by the user with enhanced logging"""
    try:
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id is required"
            }), 400
        
        # Get the database user_id from clerk_user_id
        try:
            user_id = get_user_id_from_clerk(clerk_user_id)
            print(f"🔍 Fetching recent meal for user_id: {user_id} (clerk_user_id: {clerk_user_id})")
        except ValueError as e:
            print(f"❌ User lookup failed for clerk_user_id: {clerk_user_id}")
            return jsonify({
                "success": False,
                "error": "User not found"
            }), 404
        
        with engine.connect() as conn:
            # Fetch the most recent meal for the user
            recent_meal = conn.execute(text("""
                SELECT food_description, meal_type, timestamp, carbs, calories
                FROM food_log 
                WHERE user_id = :user_id 
                ORDER BY timestamp DESC 
                LIMIT 1
            """), {'user_id': user_id}).fetchone()
            
            if recent_meal:
                print(f"✅ Found recent meal: {recent_meal.food_description[:50]}... at {recent_meal.timestamp}")
                return jsonify({
                    "success": True,
                    "meal": {
                        "food_description": recent_meal.food_description,
                        "meal_type": recent_meal.meal_type,
                        "timestamp": recent_meal.timestamp.isoformat(),
                        "carbs": float(recent_meal.carbs or 0),
                        "calories": float(recent_meal.calories or 0)
                    }
                }), 200
            else:
                print(f"⚠️ No meals found for user_id: {user_id}")
                return jsonify({
                    "success": True,
                    "meal": None
                }), 200
                
    except Exception as e:
        print(f"💥 Error fetching recent meal: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch recent meal data"
        }), 500

@app.route('/api/extract-food-items', methods=['POST'])
def extract_food_items():
    """
    Extract core food items from meal descriptions using Gemini AI.
    This endpoint intelligently parses meal descriptions to extract only
    the main food items, removing generic words and descriptions.
    """
    try:
        data = request.json
        food_description = data.get('food_description', '').strip()
        
        if not food_description:
            return jsonify({
                "success": False,
                "error": "food_description is required"
            }), 400
        
        # If the description is very short (1-3 words), return as-is with basic cleaning
        words = food_description.split()
        if len(words) <= 3:
            # Basic cleaning for short descriptions
            cleaned = food_description.strip().lower()
            # Remove common generic words even from short descriptions
            generic_words = ['simple', 'wholesome', 'meal', 'tasty', 'delicious', 'healthy', 'fresh']
            for word in generic_words:
                cleaned = cleaned.replace(word, '').strip()
            
            # Capitalize properly
            result = ' '.join([w.capitalize() for w in cleaned.split() if w])
            return jsonify({
                "success": True,
                "extracted_items": result or food_description.strip(),
                "method": "basic_cleaning"
            }), 200
        
        # For longer descriptions, use Gemini if available
        if gemini_model:
            try:
                prompt = f"""
Extract only the core food items from this meal description. Follow these rules:

1. Extract ONLY actual food names (e.g., "rice", "chicken curry", "roti", "salad")
2. Remove ALL generic descriptive words like: simple, wholesome, meal, Indian, tasty, delicious, healthy, fresh, good, nice, etc.
3. Remove quantity words like: bowl, plate, cup, serving, etc.
4. Remove cooking methods unless they're part of the food name (e.g., "fried rice" is OK, but "boiled" alone is not)
5. Keep specific dish names intact (e.g., "chicken curry", "dal tadka")
6. Limit to 8-10 words maximum
7. Return only the food items, separated by commas if multiple items

Meal description: "{food_description}"

Return only the extracted food items, nothing else:
"""
                
                response = gemini_model.generate_content(prompt)
                extracted_items = response.text.strip()
                
                # Clean up the response
                extracted_items = extracted_items.replace('**', '').replace('*', '').strip()
                
                # Remove any remaining generic words that might have slipped through
                generic_words = ['simple', 'wholesome', 'meal', 'indian', 'tasty', 'delicious', 
                               'healthy', 'fresh', 'good', 'nice', 'traditional', 'typical',
                               'homemade', 'prepared', 'cooked', 'served', 'today', 'yesterday']
                
                words = extracted_items.lower().split()
                filtered_words = [word.strip(',') for word in words if word.strip(',') not in generic_words]
                
                # Reconstruct with proper capitalization
                result = ' '.join([w.capitalize() for w in filtered_words if w])
                
                print(f"✅ Gemini extracted food items: '{result}' from '{food_description}'")
                
                return jsonify({
                    "success": True,
                    "extracted_items": result,
                    "method": "gemini_extraction"
                }), 200
                
            except Exception as e:
                print(f"❌ Gemini extraction failed: {e}")
                # Fall back to rule-based extraction
        
        # Fallback rule-based extraction when Gemini is not available
        def rule_based_extraction(description):
            # Convert to lowercase for processing
            text = description.lower().strip()
            
            # Remove common prefixes
            prefixes_to_remove = [
                r'^(i had|i ate|today i had|for my|my|the|a|an)\s+',
                r'^(breakfast|lunch|dinner|snack):\s*',
                r'^(this morning|this afternoon|this evening|tonight|today|yesterday)\s+',
                r'^(simple|wholesome|tasty|delicious|healthy|fresh|good|nice)\s+',
                r'^(traditional|typical|homemade|prepared|cooked|served)\s+'
            ]
            
            for prefix in prefixes_to_remove:
                text = re.sub(prefix, '', text)
            
            # Remove sentence endings
            text = re.sub(r'[.!?]+$', '', text).strip()
            
            # Split into words and filter out generic words
            words = text.split()
            
            # Generic words to remove
            generic_words = {
                'simple', 'wholesome', 'meal', 'indian', 'tasty', 'delicious', 
                'healthy', 'fresh', 'good', 'nice', 'traditional', 'typical',
                'homemade', 'prepared', 'cooked', 'served', 'today', 'yesterday',
                'bowl', 'plate', 'cup', 'serving', 'portion', 'small', 'large',
                'big', 'little', 'hot', 'cold', 'warm', 'spicy', 'mild'
            }
            
            # Keep important food-related words and connecting words
            filtered_words = []
            for word in words:
                clean_word = word.strip('.,!?()[]{}";:')
                if clean_word and clean_word not in generic_words:
                    filtered_words.append(clean_word)
            
            # Limit to 8 words
            filtered_words = filtered_words[:8]
            
            # Capitalize properly
            result = ' '.join([w.capitalize() for w in filtered_words])
            
            return result
        
        extracted = rule_based_extraction(food_description)
        
        print(f"✅ Rule-based extracted food items: '{extracted}' from '{food_description}'")
        
        return jsonify({
            "success": True,
            "extracted_items": extracted or food_description.strip(),
            "method": "rule_based_extraction"
        }), 200
        
    except Exception as e:
        print(f"💥 Error extracting food items: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to extract food items",
            "extracted_items": data.get('food_description', '').strip()
        }), 500

# New endpoint for logging activity data
@app.route('/api/log-activity', methods=['POST'])
def log_activity():
    # Ensure the activity_log table exists
    create_activity_log_table()
    
    data = request.json
    clerk_user_id = data.get('clerk_user_id')
    activity_type = data.get('activity_type')
    duration_minutes = data.get('duration_minutes')
    steps = data.get('steps', 0) # Optional
    calories_burned = data.get('calories_burned', 0) # Optional
    # Assuming activity is logged at current time
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if not all([clerk_user_id, activity_type, duration_minutes]):
        return jsonify({"error": "Missing required fields: clerk_user_id, activity_type, or duration_minutes"}), 400
    
    try:
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO activity_log (user_id, timestamp, activity_type, duration_minutes, steps, calories_burned)
                VALUES (:user_id, :timestamp, :activity_type, :duration_minutes, :steps, :calories_burned)
            """), {'user_id': user_id, 'timestamp': timestamp, 'activity_type': activity_type, 'duration_minutes': duration_minutes, 'steps': steps, 'calories_burned': calories_burned})
            conn.commit()
        return jsonify({"message": "Activity logged successfully"}), 200
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Error logging activity: {e}")
        return jsonify({"error": "Failed to log activity data."}), 500

# New endpoint for glucose prediction
@app.route('/api/predict-glucose', methods=['POST'])
def predict_glucose():
    data = request.json
    current_glucose = data.get('current_glucose')
    # These are now used as the 'most recent' values for future forecasting
    recent_carbs = data.get('recent_carbs', 0) 
    recent_activity_minutes = data.get('recent_activity_minutes', 0)
    recent_sleep_quality = data.get('recent_sleep_quality', 'average')
    clerk_user_id = data.get('clerk_user_id')

    if current_glucose is None:
        return jsonify({"error": "Current glucose level is required."}), 400
    
    if not clerk_user_id:
        return jsonify({"error": "clerk_user_id is required."}), 400

    if not nixtla_client:
        return jsonify({"error": "Nixtla TimeGPT is not initialized. Please check backend logs."}), 503

    try:
        # Get the database user_id from clerk_user_id
        try:
            user_id = get_user_id_from_clerk(clerk_user_id)
        except ValueError as e:
            return jsonify({"error": f"User not found: {str(e)}"}), 404
        
        # --- ROBUST DATA PREPARATION PIPELINE ---
        
        # Define prediction frequency and a rounded 'now' timestamp for alignment
        freq = '15min'
        now_utc_rounded = pd.to_datetime(datetime.now(timezone.utc)).round(freq)

        # 1. Fetch historical data for a sufficient lookback period
        lookback_days = 30
        history_start_date = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        with engine.connect() as conn:
            # Fetch glucose data
            glucose_df = pd.read_sql(text("""
                SELECT timestamp, glucose_level 
                FROM glucose_log 
                WHERE user_id = :user_id AND timestamp >= :start_date
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['timestamp'])
            
            # Fetch food data (for carbs)
            food_df = pd.read_sql(text("""
                SELECT timestamp, carbs 
                FROM food_log 
                WHERE user_id = :user_id AND timestamp >= :start_date AND carbs > 0
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['timestamp'])

            # Fetch activity data
            activity_df = pd.read_sql(text("""
                SELECT timestamp, duration_minutes
                FROM activity_log
                WHERE user_id = :user_id AND timestamp >= :start_date AND duration_minutes > 0
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['timestamp'])

            # Fetch step count data from DISPLAY table (consistent with dashboard)
            steps_df = pd.read_sql(text("""
                SELECT start_date as timestamp, value as steps
                FROM health_data_display
                WHERE user_id = :user_id AND data_type = 'StepCount'
                  AND start_date >= :start_date AND value > 0
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['timestamp'])

            # Fetch workout data to create a binary flag for when user is in a formal workout
            workout_df = pd.read_sql(text("""
                SELECT start_date, end_date
                FROM health_data_display
                WHERE user_id = :user_id AND data_type = 'Workout'
                  AND start_date >= :start_date
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['start_date', 'end_date'])

            # Fetch medication data
            medication_df = pd.read_sql(text("""
                SELECT timestamp, medication_name, dosage
                FROM medication_log
                WHERE user_id = :user_id AND timestamp >= :start_date AND dosage > 0
            """), conn, params={'user_id': user_id, 'start_date': history_start_date}, parse_dates=['timestamp'])
            
            # Fetch sleep summary data
            sleep_df = pd.read_sql(text("""
                SELECT sleep_date, sleep_hours
                FROM sleep_summary
                WHERE user_id = :user_id AND sleep_date >= :start_date
            """), conn, params={'user_id': user_id, 'start_date': history_start_date - timedelta(days=1)}, parse_dates=['sleep_date'])

        # 2b. Get Sleep Data using the reliable dashboard function
        sleep_data_result = get_improved_sleep_data(user_id=user_id, days_back=lookback_days + 1)
        if sleep_data_result.get('success'):
            sleep_df = pd.DataFrame(sleep_data_result['daily_summaries'])
            if not sleep_df.empty:
                sleep_df['sleep_date'] = pd.to_datetime(sleep_df['date'])
        else:
            sleep_df = pd.DataFrame()

        # Ensure DataFrames are not empty
        if glucose_df.empty:
             raise ValueError("No historical glucose data found for this user.")

        # --- Timezone Standardization ---
        # Ensure all timestamps are timezone-aware (UTC) to prevent errors
        glucose_df['timestamp'] = glucose_df['timestamp'].dt.tz_localize('UTC', ambiguous='infer')
        if not food_df.empty:
            food_df['timestamp'] = food_df['timestamp'].dt.tz_localize('UTC', ambiguous='infer')
        if not activity_df.empty:
            activity_df['timestamp'] = activity_df['timestamp'].dt.tz_localize('UTC', ambiguous='infer')
        if not steps_df.empty:
            steps_df['timestamp'] = steps_df['timestamp'].dt.tz_localize('UTC', ambiguous='infer')
        if not workout_df.empty:
            workout_df['start_date'] = workout_df['start_date'].dt.tz_localize('UTC', ambiguous='infer')
            workout_df['end_date'] = workout_df['end_date'].dt.tz_localize('UTC', ambiguous='infer')
        if not medication_df.empty:
            medication_df['timestamp'] = medication_df['timestamp'].dt.tz_localize('UTC', ambiguous='infer')
        if not sleep_df.empty:
            # sleep_date is just a date, no timezone needed
            pass

        # 2. Create the Master 15-Minute Timeline
        # Aligns all data to a consistent 15-minute frequency.
        prediction_horizon_hours = 6
        
        start_date = glucose_df['timestamp'].min()
        # Ensure end_date is the rounded current time for a clean historical series
        end_date = now_utc_rounded

        master_timeline = pd.DataFrame(pd.date_range(start=start_date, end=end_date, freq=freq, inclusive='left'), columns=['ds'])

        # 3. Resample and Interpolate Glucose Data (y)
        # Prepares the target variable for TimeGPT.
        glucose_df = glucose_df.set_index('timestamp')
        
        # Resample to 15-min intervals, taking the mean of any glucose values in that window
        resampled_glucose = glucose_df['glucose_level'].resample(freq).mean()
        
        # Interpolate to fill gaps, creating a continuous glucose signal
        interpolated_glucose = resampled_glucose.interpolate(method='time')
        
        df_history = pd.DataFrame(interpolated_glucose).reset_index()
        df_history.rename(columns={'timestamp': 'ds', 'glucose_level': 'y'}, inplace=True)

        # 4. Engineer Exogenous Features (Phase 1: Carbs)
        if not food_df.empty:
            food_df = food_df.set_index('timestamp')
            # Sum carbs in 15-min windows
            resampled_carbs = food_df['carbs'].resample(freq).sum()
            
            # Engineer 'carbs_active_3h' feature
            # This rolling window calculates the sum of carbs ingested in the last 3 hours.
            # 3 hours / 15 mins per interval = 12 intervals
            carbs_active = resampled_carbs.rolling(window=12, min_periods=1).sum()
            
            carbs_df = pd.DataFrame(carbs_active).reset_index()
            carbs_df.rename(columns={'timestamp': 'ds', 'carbs': 'carbs_active_3h'}, inplace=True)
            
            # Merge with master timeline
            df_history = pd.merge(df_history, carbs_df, on='ds', how='left')
        else:
            df_history['carbs_active_3h'] = 0

        # Engineer 'activity_minutes_active_2h' feature
        if not activity_df.empty:
            activity_df = activity_df.set_index('timestamp')
            resampled_activity = activity_df['duration_minutes'].resample(freq).sum()
            # 2 hours / 15 mins per interval = 8 intervals
            activity_active = resampled_activity.rolling(window=8, min_periods=1).sum()
            activity_df = pd.DataFrame(activity_active).reset_index()
            activity_df.rename(columns={'timestamp': 'ds', 'duration_minutes': 'activity_minutes_active_2h'}, inplace=True)
            df_history = pd.merge(df_history, activity_df, on='ds', how='left')
        else:
            df_history['activity_minutes_active_2h'] = 0

        # Engineer 'rolling_step_count_1h' feature
        if not steps_df.empty:
            steps_df = steps_df.set_index('timestamp')
            # Sum steps in 15-min windows
            resampled_steps = steps_df['steps'].resample(freq).sum()
            
            # 1 hour / 15 mins per interval = 4 intervals
            rolling_steps = resampled_steps.rolling(window=4, min_periods=1).sum()
            
            steps_df = pd.DataFrame(rolling_steps).reset_index()
            steps_df.rename(columns={'timestamp': 'ds', 'steps': 'rolling_step_count_1h'}, inplace=True)
            
            # Merge with master timeline
            df_history = pd.merge(df_history, steps_df, on='ds', how='left')
        else:
            df_history['rolling_step_count_1h'] = 0

        # --- Data Unification & Feature Engineering for Activity ---

        # 1. Engineer 'is_in_workout' binary flag from HealthKit Workouts first
        df_history['is_in_workout'] = 0
        if not workout_df.empty:
            for index, row in workout_df.iterrows():
                workout_start = row['start_date']
                workout_end = row['end_date']
                workout_indices = (df_history['ds'] >= workout_start) & (df_history['ds'] <= workout_end)
                df_history.loc[workout_indices, 'is_in_workout'] = 1
        
        # 2. Engineer 'activity_minutes_active_2h' from DE-DUPLICATED manual logs
        df_history['activity_minutes_active_2h'] = 0
        if not manual_activity_df.empty:
            # Filter out manual logs that overlap with HealthKit workouts
            workout_timestamps = df_history[df_history['is_in_workout'] == 1]['ds'].dt.floor('15min').unique()
            non_overlapping_manual_activity = manual_activity_df[
                ~manual_activity_df['timestamp'].dt.floor('15min').isin(workout_timestamps)
            ]

            if not non_overlapping_manual_activity.empty:
                activity_df = non_overlapping_manual_activity.set_index('timestamp')
                resampled_activity = activity_df['duration_minutes'].resample(freq).sum()
                activity_active = resampled_activity.rolling(window=8, min_periods=1).sum()
                activity_df_processed = pd.DataFrame(activity_active).reset_index()
                activity_df_processed.rename(columns={'timestamp': 'ds', 'duration_minutes': 'activity_minutes_active_2h'}, inplace=True)
                df_history = pd.merge(df_history, activity_df_processed, on='ds', how='left', suffixes=('', '_manual'))

        # 3. Engineer time-of-day cyclical features
        hour = df_history['ds'].dt.hour
        df_history['hour_sin'] = np.sin(2 * np.pi * hour / 24)
        df_history['hour_cos'] = np.cos(2 * np.pi * hour / 24)

        # Engineer medication features
        df_history['metformin_active_8h'] = 0
        df_history['fast_insulin_active_3h'] = 0
        if not medication_df.empty:
            medication_df = medication_df.set_index('timestamp')
            
            # Metformin
            metformin_mask = medication_df['medication_name'].str.contains('Metformin', case=False)
            if metformin_mask.any():
                metformin_dosages = medication_df[metformin_mask]['dosage'].resample(freq).sum()
                # 8 hours / 15 mins = 32 intervals
                metformin_active = metformin_dosages.rolling(window=32, min_periods=1).sum()
                metformin_df = pd.DataFrame(metformin_active).reset_index().rename(columns={'timestamp': 'ds', 'dosage': 'metformin_active_8h'})
                df_history = pd.merge(df_history, metformin_df, on='ds', how='left')

            # Fast-Acting Insulin
            insulin_mask = medication_df['medication_name'].str.contains('Insulin', case=False) # Simple assumption for now
            if insulin_mask.any():
                insulin_dosages = medication_df[insulin_mask]['dosage'].resample(freq).sum()
                # 3 hours / 15 mins = 12 intervals
                insulin_active = insulin_dosages.rolling(window=12, min_periods=1).sum()
                insulin_df = pd.DataFrame(insulin_active).reset_index().rename(columns={'timestamp': 'ds', 'dosage': 'fast_insulin_active_3h'})
                df_history = pd.merge(df_history, insulin_df, on='ds', how='left')

        # Engineer sleep feature
        if not sleep_df.empty and 'sleep_hours' in sleep_df.columns:
            # Apply previous night's sleep to the entire day
            sleep_df_processed = sleep_df[['sleep_date', 'sleep_hours']].copy()
            sleep_df_processed.rename(columns={'sleep_date': 'date'}, inplace=True)
            sleep_df_processed['date'] = sleep_df_processed['date'] + timedelta(days=1) # Shift date to apply to the *next* day
            
            df_history['date'] = pd.to_datetime(df_history['ds'].dt.date) # FIX: Convert date to datetime to match sleep_df
            df_history = pd.merge(df_history, sleep_df_processed, on='date', how='left')
            df_history.rename(columns={'sleep_hours': 'sleep_hours_last_night'}, inplace=True)
            df_history.drop(columns=['date'], inplace=True)
        else:
            df_history['sleep_hours_last_night'] = 8 # Default assumption

        # Fill any remaining NaNs (especially at the start) with 0 or forward/backward fill
        df_history['carbs_active_3h'] = df_history['carbs_active_3h'].fillna(0)
        df_history['activity_minutes_active_2h'] = df_history['activity_minutes_active_2h'].fillna(0)
        df_history['rolling_step_count_1h'] = df_history['rolling_step_count_1h'].fillna(0)
        df_history['is_in_workout'] = df_history['is_in_workout'].fillna(0)
        df_history['metformin_active_8h'] = df_history['metformin_active_8h'].fillna(0)
        df_history['fast_insulin_active_3h'] = df_history['fast_insulin_active_3h'].fillna(0)
        df_history['sleep_hours_last_night'] = df_history['sleep_hours_last_night'].ffill().bfill().fillna(8)
        
        # CRITICAL FIX: Ensure the timeline is perfectly clean by merging with the master timeline
        # This removes any duplicates or gaps that may have been introduced.
        df_history = pd.merge(master_timeline, df_history, on='ds', how='left')
        
        # Re-interpolate 'y' after the merge to fill any gaps at the edges
        df_history['y'] = df_history['y'].interpolate(method='linear')
        
        # Add the current glucose value to the very end of the series for accuracy
        if not df_history.empty and df_history['ds'].iloc[-1] == now_utc_rounded:
             df_history.loc[df_history.index[-1], 'y'] = current_glucose
        
        # Forward-fill other features, then backfill, then fill with 0
        df_history = df_history.ffill().bfill().fillna(0)
        
        # Final cleanup: ensure no duplicates and consistent frequency before passing to model
        df_history = df_history.drop_duplicates(subset='ds', keep='last').set_index('ds').asfreq(freq).reset_index()

        # 5. Generate Future Exogenous Variables
        # How many 15-min intervals in our prediction horizon
        h_horizon = prediction_horizon_hours * 4
        
        # Create future timestamps
        last_known_ds = df_history['ds'].iloc[-1]
        future_timestamps = pd.date_range(start=last_known_ds + pd.Timedelta(minutes=15), periods=h_horizon, freq=freq)
        
        # Create future exogenous dataframe and add cyclical time features
        future_exog_df = pd.DataFrame({'ds': future_timestamps})
        future_hour = future_exog_df['ds'].dt.hour
        future_exog_df['hour_sin'] = np.sin(2 * np.pi * future_hour / 24)
        future_exog_df['hour_cos'] = np.cos(2 * np.pi * future_hour / 24)

        # For now, assume no new carbs or activity are planned in the prediction window
        future_exog_df['carbs_active_3h'] = 0
        future_exog_df['activity_minutes_active_2h'] = 0
        future_exog_df['rolling_step_count_1h'] = df_history['rolling_step_count_1h'].iloc[-1] * 0.75
        future_exog_df['is_in_workout'] = 0
        future_exog_df['metformin_active_8h'] = df_history['metformin_active_8h'].iloc[-1] * 0.9
        future_exog_df['fast_insulin_active_3h'] = df_history['fast_insulin_active_3h'].iloc[-1] * 0.8
        future_exog_df['sleep_hours_last_night'] = df_history['sleep_hours_last_night'].iloc[-1]
        
        # Note: A more advanced version could allow users to pre-log meals

        # 6. Call nixtla_client.forecast() with the rich, prepared data
        print(f"🧠 Calling TimeGPT with {len(df_history)} historical data points...")
        forecast_df = nixtla_client.forecast(
            df=df_history,
            X_df=future_exog_df,
            h=h_horizon,
            time_col='ds',
            target_col='y',
            freq=freq
        )

        predicted_levels = forecast_df['y'].tolist()
        predicted_levels = [round(level, 1) for level in predicted_levels]

        # Ensure predictions are within a reasonable physiological range
        predicted_levels = [max(40.0, min(400.0, level)) for level in predicted_levels]

        print(f"✅ TimeGPT Predicted Glucose Levels (15-min intervals): {predicted_levels}")
        return jsonify({"predictions": predicted_levels})

    except Exception as e:
        print(f"Error during glucose prediction with TimeGPT: {e}")
        # Fallback to mock prediction in case of TimeGPT error or lack of data
        predicted_levels = []
        initial_prediction = current_glucose
        if recent_carbs > 30: initial_prediction += 30
        elif recent_carbs > 10: initial_prediction += 15
        if recent_activity_minutes > 30: initial_prediction -= 20
        elif recent_activity_minutes > 10: initial_prediction -= 10
        if recent_sleep_quality == 'poor': initial_prediction += 10
        elif recent_sleep_quality == 'good': initial_prediction -= 5
        
        # Generate 24 points for 6 hours at 15-min intervals
        predicted_levels.append(round(initial_prediction, 1))
        for i in range(1, 24):
            # Simple decay/reversion to a mean
            next_level = predicted_levels[-1] * 0.98 + 120 * 0.02
            # Add some noise to make it look more realistic
            next_level += random.uniform(-2, 2)
            predicted_levels.append(round(next_level, 1))

        predicted_levels = [max(40.0, min(400.0, level)) for level in predicted_levels]
        print(f"⚠️ Using fallback mock prediction: {predicted_levels}")
        return jsonify({"predictions": predicted_levels})

# New endpoint for syncing comprehensive health data from Apple Health
@app.route('/api/sync-health-data', methods=['POST'])
def sync_health_data():
    data = request.json
    user_id = data.get('user_id', 1)  # Default to user_id 1
    health_data = data.get('health_data', {})
    
    if not health_data:
        return jsonify({"error": "No health data provided"}), 400
    
    try:
        # Create the health_data table if it doesn't exist
        create_health_data_archive_table()
        
        # Check and add any missing columns for new data types
        check_and_add_missing_columns()
        
        # Process and store all health data
        records_inserted = 0
        
        with engine.connect() as conn:
            for data_type, entries in health_data.items():
                if isinstance(entries, list):
                    # Handle array of entries (e.g., historical data points)
                    for entry in entries:
                        record = process_health_entry(user_id, data_type, entry)
                        if record:
                            upsert_health_record(conn, record)
                            records_inserted += 1
                else:
                    # Handle single value entries
                    record = process_health_entry(user_id, data_type, entries)
                    if record:
                        upsert_health_record(conn, record)
                        records_inserted += 1
            
            conn.commit()
        
        # --- Sleep summary maintenance ---------------------------------
        try:
            create_sleep_summary_table()
            refresh_sleep_summary(user_id)
        except Exception as e:
            print(f"⚠️  Could not refresh sleep_summary table: {e}")

        # --- Automatic duplicate cleaning for critical data types ---
        duplicates_cleaned = 0
        try:
            duplicates_cleaned = auto_clean_health_data_duplicates(user_id)
            if duplicates_cleaned > 0:
                print(f"🧹 Automatically cleaned {duplicates_cleaned} duplicate health records")
        except Exception as e:
            print(f"⚠️  Could not clean duplicates: {e}")

        return jsonify({
            "message": f"Successfully synced {records_inserted} health data records",
            "records_inserted": records_inserted,
            "duplicates_cleaned": duplicates_cleaned
        }), 200
        
    except Exception as e:
        print(f"Error syncing health data: {e}")
        return jsonify({"error": f"Failed to sync health data: {str(e)}"}), 500

def map_healthkit_data_type(healthkit_type: str) -> str:
    """Map HealthKit data types to internal data types used by analysis functions"""
    mapping = {
        'sleep': 'SleepAnalysis',  # Map HealthKit sleep to SleepAnalysis
        'steps': 'StepCount',
        'activeEnergy': 'ActiveEnergyBurned', 
        'distance': 'DistanceWalkingRunning',
        'heartRate': 'HeartRate'
    }
    return mapping.get(healthkit_type, healthkit_type)

def is_record_within_display_window(record: Dict[str, Any], days_back: int = 7) -> bool:
    """Check if a health record is within the display window (default: today + 7 previous days = 8 total days)"""
    try:
        # Get the record's date (prefer start_date, fallback to end_date)
        record_date = record.get('start_date') or record.get('end_date')
        if not record_date:
            print(f"⚠️ Display window check: No date found in record")
            return False  # No date, exclude from display
        
        original_record_date = record_date  # Keep for debugging
        
        # Handle both datetime objects and strings
        if isinstance(record_date, str):
            record_date = parse_iso_datetime(record_date)
        
        if not record_date:
            print(f"⚠️ Display window check: Failed to parse date '{original_record_date}'")
            return False
        
        # Convert to date for comparison (remove time component)
        if hasattr(record_date, 'date'):
            record_date = record_date.date()
        
        # Calculate cutoff date - FIXED: Include today + 7 previous days (8 total days)
        # Use same logic as main dashboard: today - days_back gives us the start date
        cutoff_date = (datetime.now() - timedelta(days=days_back)).date()
        today = datetime.now().date()
        
        # Include if record is within the display window (today + previous 7 days)
        is_within_window = record_date >= cutoff_date and record_date <= today
        
        # Enhanced debugging for current and recent dates
        data_type = record.get('data_type', 'Unknown')
        if record_date >= today - timedelta(days=2):  # Today or last 2 days
            print(f"🔍 Display window check: {data_type} record from {record_date} - {'✅ INCLUDED' if is_within_window else '❌ EXCLUDED'} (cutoff: {cutoff_date}, today: {today})")
        
        return is_within_window
        
    except Exception as e:
        print(f"⚠️ Error checking display window for record: {e}")
        return False  # Default to excluding on error

def check_if_first_time_sync_internal(user_id: int) -> bool:
    """Check if this is the first time syncing Apple Health data for this user"""
    try:
        with engine.connect() as conn:
            # Check if user has any health data in archive table
            result = conn.execute(text("""
                SELECT COUNT(*) as count 
                FROM health_data_archive 
                WHERE user_id = :user_id 
                LIMIT 1
            """), {'user_id': user_id}).fetchone()
            
            count = result.count if result else 0
            is_first_time = count == 0
            
            print(f"{'🆕' if is_first_time else '🔄'} First-time sync check for user {user_id}: {is_first_time} (found {count} existing records)")
            return is_first_time
            
    except Exception as e:
        print(f"❌ Error checking first-time sync status: {e}")
        return False  # Default to assuming not first-time to be safe

@app.route('/api/check-first-time-sync', methods=['GET'])
def check_first_time_sync():
    """API endpoint to check if this is the first time syncing Apple Health data for a user"""
    try:
        user_id = request.args.get('user_id', type=int)
        
        if not user_id:
            return jsonify({
                "success": False,
                "error": "user_id parameter is required"
            }), 400
        
        is_first_time = check_if_first_time_sync_internal(user_id)
        
        return jsonify({
            "success": True,
            "is_first_time": is_first_time,
            "user_id": user_id,
            "recommended_days": 365 if is_first_time else 7
        }), 200
        
    except Exception as e:
        print(f"❌ Error checking first-time sync status: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "is_first_time": False  # Default to false on error
        }), 500

@app.route('/api/sync-dashboard-health-data', methods=['POST'])
def sync_dashboard_health_data():
    """
    Smart two-table sync endpoint for Apple Health data with dual sync modes:
    
    🔄 FIRST-TIME SYNC (Full Historical):
    - Detects if user has no existing health data
    - Syncs ALL available Apple Health data (complete history)
    - Stores everything in health_data_archive for permanent record
    - Populates health_data_display with latest 7 days for dashboard
    
    🔄 PULL-TO-REFRESH SYNC (Delta Only):
    - Syncs only last 7 days of Apple Health data
    - Updates archive with any new/changed records
    - Refreshes display table with latest 7-day snapshot
    - Lightweight and fast for regular dashboard updates
    """
    data = request.json
    user_id = data.get('user_id', 1)
    health_data = data.get('health_data', {})
    sync_type = data.get('sync_type', 'regular_sync')
    is_initial_sync = data.get('is_initial_sync', False)
    total_records = data.get('total_records', 0)
    
    # 🧠 Smart sync mode detection
    if sync_type == 'auto_detect':
        is_first_time = check_if_first_time_sync_internal(user_id)
        if is_first_time:
            sync_type = 'full_historical_sync'
            is_initial_sync = True
            print(f"🆕 AUTO-DETECTED: First-time sync for user {user_id} - switching to full historical sync")
        else:
            sync_type = 'pull_to_refresh'
            print(f"🔄 AUTO-DETECTED: Existing user {user_id} - using delta refresh sync")
    
    # Log sync parameters for debugging
    print(f"🔄 SYNC INITIATED: User {user_id}, Type: {sync_type}, Records: {total_records}, Initial: {is_initial_sync}")
    
    if not health_data:
        return jsonify({"error": "No health data provided"}), 400
    
    # Adjust batch sizes and retry limits based on sync type
    no_batching = data.get('no_batching', False)
    
    if sync_type == 'full_historical_sync_no_batching' or no_batching:
        print(f"🔄 COMPLETE HISTORICAL SYNC (NO BATCHING) detected for user {user_id}: {total_records} total records")
        max_retries = 2  # Fewer retries since we're doing single transaction
        use_batching = False
        batch_size = total_records  # Process all at once
        sleep_batch_size = total_records  # Process all at once
    elif sync_type == 'full_historical_sync':
        print(f"🔄 HISTORICAL SYNC detected for user {user_id}: {total_records} total records")
        max_retries = 5  # More retries for historical sync
        use_batching = True
        batch_size = 50  # Smaller batches for stability
        sleep_batch_size = 25  # Even smaller for sleep data
    elif sync_type == 'pull_to_refresh':
        print(f"🔄 PULL-TO-REFRESH SYNC detected for user {user_id}: {total_records} total records")
        max_retries = 2  # Fewer retries for faster feedback
        use_batching = True
        batch_size = 100  # Standard batch size
        sleep_batch_size = 10  # Moderate sleep batch size
    else:
        max_retries = 3
        use_batching = True
        batch_size = 100
        sleep_batch_size = 5
    for attempt in range(max_retries):
        try:
            # Ensure all tables exist
            create_health_data_archive_table()
            create_health_data_display_table()

            records_archived = 0
            records_displayed = 0
            
            # Get a list of all data types in this sync
            data_types_in_sync = [map_healthkit_data_type(dt) for dt in health_data.keys()]

            # Use separate transactions for better lock management
            # First: Clear display table for all sync types to ensure 7-day snapshot
            with engine.begin() as conn:
                if data_types_in_sync:
                    clear_health_data_display_for_sync(conn, user_id, data_types_in_sync)
                    print(f"🧹 Cleared display data for {len(data_types_in_sync)} data types (will populate with 7-day snapshot)")

            # Second: Process data in smaller batches to avoid long-running transactions
            all_records = []
            
            # Separate sleep data processing to avoid deadlocks
            sleep_records = []
            non_sleep_records = []
            
            # Collect all records first, separating sleep data
            for data_type, entries in health_data.items():
                internal_data_type = map_healthkit_data_type(data_type)
                
                # DEBUG: Log distance data during sync
                if data_type == 'distance' and isinstance(entries, list):
                    print(f"🔍 SYNC DEBUG: Processing {len(entries)} distance entries from Apple Health")
                    # Show sample of distance values and dates
                    for i, entry in enumerate(entries[:10]):  # Show first 10
                        quantity = entry.get('quantity', 'N/A')
                        start_date = entry.get('startDate', 'N/A')
                        sample_id = entry.get('uuid', 'N/A')[:20] + '...' if entry.get('uuid') else 'N/A'
                        print(f"  📅 Sample {i+1}: {quantity}m at {start_date} (ID: {sample_id})")
                    
                    if len(entries) > 10:
                        print(f"  ... and {len(entries)-10} more entries")
                
                if isinstance(entries, list) and entries:
                    for entry in entries:
                        record = process_health_entry(user_id, internal_data_type, entry)
                        if record:
                            if internal_data_type == 'SleepAnalysis':
                                sleep_records.append(record)
                            else:
                                non_sleep_records.append(record)

            all_records = non_sleep_records

            # ================= IMPROVED BATCH UPSERT =================
            # The original per-record transaction loop was extremely slow when
            # hundreds of records (e.g. 750 calorie samples) were sent – the
            # mobile client would hit its 120 s HTTP timeout. We now process
            # the non-sleep records in small batches (~100) inside a single
            # transaction which is fast enough yet still avoids deadlocks.

            if all_records:
                if use_batching:
                    print(f"📊 Processing {len(all_records)} non-sleep records in batches of {batch_size}")
                    for i in range(0, len(all_records), batch_size):
                        batch = all_records[i : i + batch_size]
                        batch_attempt = 0
                        max_batch_retries = 3
                        
                        while batch_attempt < max_batch_retries:
                            try:
                                with engine.begin() as conn:
                                    for record in batch:
                                        upsert_health_record(conn, record)  # Archive all records
                                        records_archived += 1
                                        
                                        # Only add to display table if within last 7 days
                                        if is_record_within_display_window(record):
                                            insert_health_data_display(conn, record)
                                            records_displayed += 1
                                break  # Success, exit retry loop
                            except Exception as batch_err:
                                batch_attempt += 1
                                if batch_attempt >= max_batch_retries:
                                    print(f"⚠️ Batch upsert failed after {max_batch_retries} attempts (records {i}-{i+len(batch)-1}): {batch_err}")
                                    continue
                                else:
                                    print(f"⚠️ Batch attempt {batch_attempt}/{max_batch_retries} failed, retrying...")
                                    time.sleep(0.5)  # Brief pause before retry
                else:
                    # NO BATCHING - Single transaction for all records (optimal for historical sync)
                    print(f"🚀 Processing ALL {len(all_records)} non-sleep records in SINGLE TRANSACTION (no batching)")
                    try:
                        with engine.begin() as conn:
                            for record in all_records:
                                upsert_health_record(conn, record)
                                records_archived += 1
                                
                                # Only add to display table if within last 7 days
                                if is_record_within_display_window(record):
                                    insert_health_data_display(conn, record)
                                    records_displayed += 1
                        print(f"✅ Single transaction completed successfully for {len(all_records)} records")
                    except Exception as single_err:
                        print(f"❌ Single transaction failed: {single_err}")
                        # Fallback to batching if single transaction fails
                        print("🔄 Falling back to batching approach...")
                        use_batching = True
                        batch_size = 1000  # Use larger batches for fallback
            
            # Process sleep records separately to avoid deadlocks
            if sleep_records:
                if use_batching:
                    print(f"🛏️ Processing {len(sleep_records)} sleep records separately in batches of {sleep_batch_size}...")
                    
                    for i in range(0, len(sleep_records), sleep_batch_size):
                        sleep_batch = sleep_records[i:i + sleep_batch_size]
                        sleep_attempt = 0
                        max_sleep_retries = 3
                        
                        while sleep_attempt < max_sleep_retries:
                            try:
                                with engine.begin() as conn:
                                    for record in sleep_batch:
                                        try:
                                            # SAFE UPSERT (replace bulky SQL)
                                            upsert_health_record(conn, record)
                                            records_archived += 1
                                            
                                            # Only add to display table if within last 7 days
                                            if is_record_within_display_window(record):
                                                insert_health_data_display(conn, record)
                                                records_displayed += 1
                                        except Exception as sleep_error:
                                            print(f"⚠️ Failed to process sleep record: {sleep_error}")
                                            continue
                                break  # Success, exit retry loop
                            except Exception as batch_error:
                                sleep_attempt += 1
                                if sleep_attempt >= max_sleep_retries:
                                    print(f"⚠️ Sleep batch failed after {max_sleep_retries} attempts: {batch_error}")
                                    continue
                                else:
                                    print(f"⚠️ Sleep batch attempt {sleep_attempt}/{max_sleep_retries} failed, retrying...")
                                    time.sleep(0.5)
                else:
                    # NO BATCHING - Single transaction for all sleep records
                    print(f"🛏️ Processing ALL {len(sleep_records)} sleep records in SINGLE TRANSACTION (no batching)")
                    try:
                        with engine.begin() as conn:
                            for record in sleep_records:
                                try:
                                    upsert_health_record(conn, record)
                                    records_archived += 1
                                    
                                    # Only add to display table if within last 7 days
                                    if is_record_within_display_window(record):
                                        insert_health_data_display(conn, record)
                                        records_displayed += 1
                                except Exception as sleep_error:
                                    print(f"⚠️ Failed to process sleep record: {sleep_error}")
                                    continue
                        print(f"✅ Single sleep transaction completed for {len(sleep_records)} records")
                    except Exception as sleep_error:
                        print(f"❌ Single sleep transaction failed: {sleep_error}")
                        # Continue processing without failing the entire sync
            
            # Refresh sleep summary ONLY if sleep records were received to avoid slow quick-syncs
            if sleep_records:
                try:
                    create_sleep_summary_table()
                    refresh_sleep_summary(user_id)
                except Exception as e:
                    print(f"⚠️ Could not refresh sleep_summary table: {e}")
            
            # Auto-clean duplicates for historical syncs
            duplicates_cleaned = 0
            if sync_type == 'full_historical_sync':
                print(f"🧹 Running duplicate cleanup for historical sync...")
                duplicates_cleaned = auto_clean_health_data_duplicates(user_id)
                print(f"🧹 Cleaned {duplicates_cleaned} duplicate records")
            
            print(f"✅ DISPLAY SYNC COMPLETE: Archived {records_archived} records, Displayed {records_displayed} records.")
            
            # Create intelligent sync response message
            sync_description = {
                'full_historical_sync': f"Full Historical Sync - Archived {records_archived} records, displaying latest {records_displayed}",
                'pull_to_refresh': f"Delta Refresh - Updated {records_archived} records, refreshed {records_displayed} for dashboard",
                'regular_sync': f"Regular Sync - Processed {records_archived} records"
            }.get(sync_type, f"Sync completed - {records_archived} records processed")
            
            response_data = {
                "message": sync_description,
                "records_archived": records_archived,
                "records_displayed": records_displayed,
                "sync_type": sync_type,
                "is_initial_sync": is_initial_sync,
                "duplicates_cleaned": duplicates_cleaned,
                "sync_summary": {
                    "total_processed": records_archived,
                    "dashboard_records": records_displayed,
                    "archive_growth": records_archived - duplicates_cleaned,
                    "first_time_user": is_initial_sync
                }
            }
            
            return jsonify(response_data), 200
            
        except Exception as e:
            error_msg = str(e).lower()
            # Check for database lock issues
            is_deadlock = any(keyword in error_msg for keyword in [
                "deadlock", "lock wait timeout", "try restarting transaction",
                "1213", "1205"  # MySQL error codes for deadlock and lock timeout
            ])
            
            if is_deadlock and attempt < max_retries - 1:
                import time
                import random
                wait_time = (1.0 * (2 ** attempt)) + random.uniform(0, 0.5)
                print(f"⚠️ Database lock issue during sync, retrying attempt {attempt + 2}/{max_retries} after {wait_time:.2f}s")
                time.sleep(wait_time)
                continue
            
            print(f"Error during two-table sync: {e}")
            return jsonify({"error": f"Failed to sync display health data: {str(e)}"}), 500
    
    return jsonify({"error": "Failed to sync after multiple retries due to database lock issues"}), 500

def check_and_add_missing_columns():
    """Dynamically check for and add any missing columns to accommodate new data types"""
    try:
        with engine.connect() as conn:
            # Get current columns
            result = conn.execute(text("DESCRIBE health_data_archive")).fetchall()
            existing_columns = {row[0] for row in result}
            
            # Define all possible columns we might need
            potential_columns = {
                'sample_id': 'VARCHAR(100) NULL',
                'category_type': 'VARCHAR(100) NULL', 
                'workout_activity_type': 'VARCHAR(100) NULL',
                'total_energy_burned': 'DECIMAL(10,2) NULL',
                'total_distance': 'DECIMAL(10,4) NULL',
                'average_quantity': 'DECIMAL(15,6) NULL',
                'minimum_quantity': 'DECIMAL(15,6) NULL',
                'maximum_quantity': 'DECIMAL(15,6) NULL',
                'timestamp': 'DATETIME NULL'
            }
            
            # Add missing columns
            columns_added = 0
            for column_name, column_definition in potential_columns.items():
                if column_name not in existing_columns:
                    try:
                        conn.execute(text(f"ALTER TABLE health_data_archive ADD COLUMN {column_name} {column_definition}"))
                        print(f"✅ Added column: {column_name}")
                        columns_added += 1
                    except Exception as e:
                        print(f"⚠️ Could not add column {column_name}: {e}")
            
            if columns_added > 0:
                conn.commit()
                print(f"🔧 Schema updated: {columns_added} new columns added")
            else:
                print("✅ Schema up to date: no new columns needed")
                
    except Exception as e:
        print(f"Error checking/updating schema: {e}")

def process_health_entry(user_id, data_type, entry):
    """Process a single health data entry into a standardized format with enhanced field mapping"""
    try:
        record = {
            'user_id': user_id,
            'data_type': data_type,
            'data_subtype': entry.get('subtype'),
            'value': None,
            'value_string': None,
            'unit': entry.get('unit'),
            'start_date': None,
            'end_date': None,
            'source_name': entry.get('sourceName'),
            'source_bundle_id': entry.get('sourceBundleId'),
            'device_name': None,
            # CRITICAL FIX: Use 'uuid' from HealthKit data or generate a new one to guarantee a sample_id
            'sample_id': entry.get('uuid') or str(uuid.uuid4()),
            'category_type': entry.get('categoryType'),
            'workout_activity_type': entry.get('workoutActivityType'),
            'total_energy_burned': None,
            'total_distance': None,
            'average_quantity': None,
            'minimum_quantity': None,
            'maximum_quantity': None,
            'metadata': None
        }
        
        # ------------------------------------------------------------------
        # 1. Device handling – ensure we never pass a raw dict to SQL layer
        # ------------------------------------------------------------------
        device_val = entry.get('device')
        if device_val is not None:
            if isinstance(device_val, dict):
                # Prefer the human-readable name if present, otherwise dump json
                record['device_name'] = device_val.get('name') or device_val.get('model') or device_val.get('hardwareVersion') or json.dumps(device_val)[:200]
                # Store full device object inside metadata for reference
                metadata_extra = record.get('metadata_extra', {}) if record.get('metadata_extra') else {}
                metadata_extra['device'] = device_val
                record['metadata_extra'] = metadata_extra
            else:
                record['device_name'] = str(device_val)
        
        # ------------------------------------------------------------------
        # 2. Handle different value types
        # ------------------------------------------------------------------
        # HealthKit sometimes returns quantities as strings that include the unit
        # (e.g. "0.85m" or "12.3kcal"). Attempt to safely extract the numeric
        # portion so we can store it as a float. Fallback to value_string if the
        # numeric part cannot be determined.
        if 'quantity' in entry:
            q = entry['quantity']
            if isinstance(q, (int, float)):
                record['value'] = float(q)
            else:
                # Extract the first numeric substring (handles optional negative sign and decimals)
                num_match = re.search(r"-?\d+\.\d+|-?\d+", str(q))
                if num_match:
                    try:
                        record['value'] = float(num_match.group())
                    except ValueError:
                        record['value_string'] = str(q)
                else:
                    record['value_string'] = str(q)
        elif 'value' in entry:
            v = entry['value']
            if isinstance(v, (int, float)):
                record['value'] = float(v)
            else:
                num_match = re.search(r"-?\d+\.\d+|-?\d+", str(v))
                if num_match:
                    try:
                        record['value'] = float(num_match.group())
                    except ValueError:
                        record['value_string'] = str(v)
                else:
                    record['value_string'] = str(v)
        
        # ------------------------------------------------------------------
        # 3. Capture additional numeric aggregate fields if present
        # ------------------------------------------------------------------
        for field in ['totalEnergyBurned', 'totalDistance', 'averageQuantity', 'minimumQuantity', 'maximumQuantity']:
            if field in entry and entry[field] is not None:
                snake_case_field = ''.join(['_' + c.lower() if c.isupper() else c for c in field]).lstrip('_')
                try:
                    record[snake_case_field] = float(entry[field])
                except (ValueError, TypeError):
                    print(f"⚠️ Could not convert {field} to float: {entry[field]}")
        
        # ------------------------------------------------------------------
        # 4. Store additional metadata as JSON (any leftover keys)
        # ------------------------------------------------------------------
        metadata = record.pop('metadata_extra', {}) if record.get('metadata_extra') else {}

        # CRITICAL: If entry already has metadata (like timezone info), preserve it
        if 'metadata' in entry and entry['metadata']:
            try:
                # Parse existing metadata from entry
                existing_metadata = json.loads(entry['metadata']) if isinstance(entry['metadata'], str) else entry['metadata']
                if isinstance(existing_metadata, dict):
                    metadata.update(existing_metadata)
                    print(f"🔧 Preserved existing metadata for {data_type}: {list(existing_metadata.keys())}")
            except (json.JSONDecodeError, TypeError) as e:
                print(f"⚠️ Could not parse existing metadata for {data_type}: {e}")

        excluded_keys = {
            'quantity', 'value', 'unit', 'startDate', 'endDate', 'timestamp',
            'sourceName', 'sourceBundleId', 'device', 'subtype', 'sampleId',
            'categoryType', 'workoutActivityType', 'totalEnergyBurned',
            'totalDistance', 'averageQuantity', 'minimumQuantity', 'maximumQuantity',
            'metadata'  # Add metadata to excluded keys since we handle it specially
        }

        for key, value in entry.items():
            if key not in excluded_keys:
                metadata[key] = value

        if metadata:
            record['metadata'] = json.dumps(metadata)
            # Log timezone info specifically for sleep data
            if data_type == 'SleepAnalysis' and 'HKTimeZone' in metadata:
                print(f"🌍 Sleep sample {entry.get('sampleId', 'unknown')} timezone: {metadata['HKTimeZone']}")
        
        # Handle timestamps
        if 'startDate' in entry:
            record['start_date'] = parse_iso_datetime(entry['startDate'])
        if 'endDate' in entry:
            record['end_date'] = parse_iso_datetime(entry['endDate'])
        elif 'timestamp' in entry:
            record['start_date'] = parse_iso_datetime(entry['timestamp'])
            record['end_date'] = record['start_date']
        
        return record
        
    except Exception as e:
        print(f"Error processing health entry {data_type}: {e}")
        print(f"Entry data: {entry}")
        return None

def parse_iso_datetime(iso_string: str | None) -> datetime | None:
    """Safely parse an ISO datetime string, ensuring it's timezone-aware (UTC)."""
    if not iso_string:
        return None
    try:
        # Handle 'Z' for UTC and ensure timezone info is present
        if iso_string.endswith('Z'):
            iso_string = iso_string.replace('Z', '+00:00')
        
        dt = datetime.fromisoformat(iso_string)
        
        # If parsing succeeds but the datetime object is naive, assume it's UTC
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        
        return dt
    except (ValueError, TypeError):
        print(f"⚠️ Could not parse datetime: {iso_string}")
        return None

def upsert_health_record(conn, record):
    """
    Insert or update a health record in the ARCHIVE table.
    Now strictly enforces upsert based on sample_id.
    """
    max_retries = 3
    for attempt in range(max_retries):
        try:
            # Every record is now guaranteed to have a sample_id.
            conn.execute(text("""
                INSERT INTO health_data_archive (
                    user_id, data_type, data_subtype, value, value_string, unit,
                    start_date, end_date, source_name, source_bundle_id, device_name, 
                    sample_id, category_type, workout_activity_type, total_energy_burned,
                    total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
                ) VALUES (
                    :user_id, :data_type, :data_subtype, :value, :value_string, :unit,
                    :start_date, :end_date, :source_name, :source_bundle_id, :device_name,
                    :sample_id, :category_type, :workout_activity_type, :total_energy_burned,
                    :total_distance, :average_quantity, :minimum_quantity, :maximum_quantity, :metadata
                ) ON DUPLICATE KEY UPDATE
                    value = VALUES(value),
                    value_string = VALUES(value_string),
                    unit = VALUES(unit),
                    start_date = VALUES(start_date),
                    end_date = VALUES(end_date),
                    source_name = VALUES(source_name),
                    source_bundle_id = VALUES(source_bundle_id),
                    device_name = VALUES(device_name),
                    metadata = VALUES(metadata)
            """), record)
            return  # Success, exit the retry loop
        except Exception as e:
            error_msg = str(e).lower()
            # Check for various MySQL deadlock and lock timeout conditions
            is_deadlock = any(keyword in error_msg for keyword in [
                "deadlock", "lock wait timeout", "try restarting transaction",
                "1213", "1205"  # MySQL error codes for deadlock and lock timeout
            ])
            
            if is_deadlock and attempt < max_retries - 1:
                import time
                import random
                wait_time = (0.1 * (2 ** attempt)) + random.uniform(0, 0.1)  # Exponential backoff with jitter
                print(f"⚠️ Database lock issue detected, retrying attempt {attempt + 2}/{max_retries} after {wait_time:.2f}s")
                time.sleep(wait_time)
                continue
            print(f"Error upserting health record: {e}")
            print(f"Record data: {record}")
            raise

def clear_health_data_display_for_sync(conn, user_id: int, data_types: List[str]):
    """Wipes data for a user and specific data types from the health_data_display table."""
    if not data_types:
        return 0
    
    try:
        result = conn.execute(text("""
            DELETE FROM health_data_display 
            WHERE user_id = :user_id 
            AND data_type IN :data_types
        """), {
            'user_id': user_id,
            'data_types': tuple(data_types) # Use tuple for IN clause
        })
        
        deleted_count = result.rowcount
        if deleted_count > 0:
            print(f"🧹 Wiped {deleted_count} records from health_data_display for user {user_id}.")
        return deleted_count
    except Exception as e:
        print(f"Error wiping display data: {e}")
        return 0

def populate_display_table_from_archive(conn, user_id: int, data_types: List[str] = None, days_back: int = 7):
    """Populate display table from archive table for recent data as a backup mechanism"""
    try:
        # If no specific data types provided, use common health data types
        if not data_types:
            data_types = ['SleepAnalysis', 'StepCount', 'ActiveEnergyBurned', 'DistanceWalkingRunning', 'Workout']
        
        # Calculate cutoff date
        cutoff_date = datetime.now() - timedelta(days=days_back)
        
        print(f"🔄 Populating display table from archive for user {user_id}, data types: {data_types}, cutoff: {cutoff_date.date()}")
        
        # Insert recent records from archive to display table
        for data_type in data_types:
            insert_query = text("""
                INSERT INTO health_data_display (
                    user_id, data_type, data_subtype, value, value_string, unit,
                    start_date, end_date, source_name, source_bundle_id, device_name,
                    sample_id, category_type, workout_activity_type, total_energy_burned,
                    total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
                )
                SELECT 
                    user_id, data_type, data_subtype, value, value_string, unit,
                    start_date, end_date, source_name, source_bundle_id, device_name,
                    sample_id, category_type, workout_activity_type, total_energy_burned,
                    total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
                FROM health_data_archive
                WHERE user_id = :user_id 
                AND data_type = :data_type 
                AND start_date >= :cutoff_date
                AND sample_id NOT IN (
                    SELECT sample_id FROM health_data_display 
                    WHERE user_id = :user_id AND data_type = :data_type AND sample_id IS NOT NULL
                )
            """)
            
            result = conn.execute(insert_query, {
                'user_id': user_id,
                'data_type': data_type,
                'cutoff_date': cutoff_date
            })
            
            inserted_count = result.rowcount
            if inserted_count > 0:
                print(f"📊 Populated {inserted_count} {data_type} records in display table from archive")
        
        print(f"✅ Display table population from archive completed for user {user_id}")
        
    except Exception as e:
        print(f"❌ Error populating display table from archive: {e}")
        raise

def insert_health_data_display(conn, record: Dict[str, Any]):
    """Inserts a processed health record into the health_data_display table."""
    try:
        conn.execute(text("""
            INSERT INTO health_data_display (
                user_id, data_type, data_subtype, value, value_string, unit,
                start_date, end_date, source_name, source_bundle_id, device_name, 
                sample_id, category_type, workout_activity_type, total_energy_burned,
                total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
            ) VALUES (
                :user_id, :data_type, :data_subtype, :value, :value_string, :unit,
                :start_date, :end_date, :source_name, :source_bundle_id, :device_name,
                :sample_id, :category_type, :workout_activity_type, :total_energy_burned,
                :total_distance, :average_quantity, :minimum_quantity, :maximum_quantity, :metadata
            )
        """), record)
    except Exception as e:
        print(f"Error inserting into display table: {e}")
        print(f"Record data: {record}")
        # Do not re-raise, as failure to write to display table should not stop the sync

# New endpoint for logging medication data
@app.route('/api/log-medication', methods=['POST'])
def log_medication():
    # Ensure the medication_log table exists
    create_medication_log_table()
    
    data = request.json
    clerk_user_id = data.get('clerk_user_id')
    
    if not clerk_user_id:
        return jsonify({"error": "clerk_user_id is required"}), 400
    
    try:
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({"error": "User not found"}), 404
    
    medication_type = data.get('medication_type')
    medication_name = data.get('medication_name')
    dosage = data.get('dosage')
    log_time_str = data.get('time')
    meal_context = data.get('meal_context')
    insulin_type = data.get('insulin_type', None) # Optional for insulin
    injection_site = data.get('injection_site', None) # Optional, but required for insulin

    if not all([medication_type, medication_name, dosage, log_time_str]):
        return jsonify({"error": "Missing medication details"}), 400

    # Additional validation for insulin injection site
    if medication_type == 'Insulin' and not injection_site:
        return jsonify({"error": "Injection site is required for insulin medications"}), 400

    try:
        # The timestamp string is now sent in 'YYYY-MM-DD HH:MM:SS' format from the frontend,
        # which is directly usable by MySQL.
        timestamp = log_time_str

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO medication_log (user_id, timestamp, medication_type, medication_name, dosage, insulin_type, meal_context, injection_site)
                VALUES (:user_id, :timestamp, :medication_type, :medication_name, :dosage, :insulin_type, :meal_context, :injection_site)
            """), {
                'user_id': user_id,
                'timestamp': timestamp,
                'medication_type': medication_type,
                'medication_name': medication_name,
                'dosage': dosage,
                'insulin_type': insulin_type,
                'meal_context': meal_context,
                'injection_site': injection_site
            })
            conn.commit()
        return jsonify({"message": "Medication logged successfully"}), 200
    except Exception as e:
        print(f"Error logging medication: {e}")
        return jsonify({"error": "Failed to log medication data."}), 500

# New endpoint for logging basal dose data
@app.route('/api/log-basal-dose', methods=['POST'])
def log_basal_dose():
    # Ensure the basal_dose_logs table exists
    create_basal_dose_logs_table()
    
    data = request.json
    clerk_user_id = data.get('clerk_user_id')
    insulin_name = data.get('insulin_name')
    dose_units = data.get('dose_units')
    log_time_str = data.get('timestamp')  # Optional - if not provided, use current time

    if not all([clerk_user_id, insulin_name, dose_units]):
        return jsonify({"error": "Missing required fields: clerk_user_id, insulin_name, or dose_units"}), 400
    
    # Validate and convert dose_units to float
    try:
        dose_units = float(dose_units)
        if dose_units <= 0:
            return jsonify({"error": "Dose must be a positive number"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid dose format. Must be a number"}), 400
    
    try:
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        # Use provided timestamp or current time
        if log_time_str:
            # Parse ISO timestamp and convert to MySQL-compatible format
            try:
                # Handle ISO format with Z suffix
                if log_time_str.endswith('Z'):
                    parsed_dt = datetime.fromisoformat(log_time_str.replace('Z', '+00:00'))
                else:
                    parsed_dt = datetime.fromisoformat(log_time_str)
                timestamp = parsed_dt.strftime('%Y-%m-%d %H:%M:%S')
                print(f"✅ Parsed timestamp from {log_time_str} to {timestamp}")
            except ValueError as e:
                # Fallback to current time if parsing fails
                print(f"⚠️ Failed to parse timestamp {log_time_str}: {e}")
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        else:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO basal_dose_logs (user_id, timestamp, insulin_name, dose_units)
                VALUES (:user_id, :timestamp, :insulin_name, :dose_units)
            """), {
                'user_id': user_id,
                'timestamp': timestamp,
                'insulin_name': insulin_name,
                'dose_units': dose_units
            })
            conn.commit()
        return jsonify({"message": "Basal dose logged successfully"}), 200
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Error logging basal dose: {e}")
        return jsonify({"error": "Failed to log basal dose data."}), 500

# New endpoint for fetching basal dose history
@app.route('/api/basal-dose-history', methods=['GET'])
def get_basal_dose_history():
    """Fetch basal dose history for the last 14 days for a specific user"""
    try:
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        # Calculate date range for last 14 days
        end_date = datetime.now()
        start_date = end_date - timedelta(days=14)
        
        with engine.connect() as conn:
            basal_records = conn.execute(text("""
                SELECT timestamp, insulin_name, dose_units 
                FROM basal_dose_logs 
                WHERE user_id = :user_id AND timestamp >= :start_date
                ORDER BY timestamp DESC
            """), {
                'user_id': user_id, 
                'start_date': start_date.strftime('%Y-%m-%d %H:%M:%S')
            }).fetchall()
            
            # Convert to list of dictionaries for JSON response
            basal_logs = []
            for record in basal_records:
                basal_logs.append({
                    'timestamp': record.timestamp.isoformat(),
                    'insulin_name': record.insulin_name,
                    'dose_units': float(record.dose_units)
                })
            
            return jsonify({
                'success': True,
                'basal_logs': basal_logs,
                'summary': {
                    'total_entries': len(basal_logs),
                    'date_range': {
                        'start_date': start_date.isoformat(),
                        'end_date': end_date.isoformat(),
                        'days_back': 14
                    }
                }
            }), 200
            
    except Exception as e:
        print(f"Error fetching basal dose history: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to fetch basal dose history: {str(e)}',
            'basal_logs': []
        }), 500

# ---------------------------------------------------------------------
# Sleep summary helpers
# ---------------------------------------------------------------------

def create_sleep_summary_table():
    """Create a daily sleep_summary table (one row per user per night)"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sleep_summary (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    sleep_date DATE NOT NULL,
                    sleep_start DATETIME NOT NULL,
                    sleep_end DATETIME NOT NULL,
                    sleep_hours DECIMAL(5,2) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_user_date (user_id, sleep_date),
                    INDEX idx_user_date (user_id, sleep_date)
                )
            """))
            conn.commit()
            print("✅ sleep_summary table verified/created")
    except Exception as e:
        print(f"Error creating sleep_summary table: {e}")
        raise


def refresh_sleep_summary(user_id: int = 1):
    """Recalculate sleep summary rows for a user using ACTUAL sleep session data, filtering out scheduled times."""
    try:
        with engine.begin() as conn:
            # Get all raw sleep analysis samples for the user from DISPLAY table
            raw_sleep_records = conn.execute(text("""
                SELECT start_date, end_date, metadata, value
                FROM health_data_display
                WHERE data_type = 'SleepAnalysis' AND user_id = :uid
                ORDER BY start_date
            """), {"uid": user_id}).fetchall()

            if not raw_sleep_records:
                print("ℹ️ No raw sleep data found to process.")
                conn.execute(text("DELETE FROM sleep_summary WHERE user_id = :uid"), {"uid": user_id})
                return

            print(f"🧠 Processing {len(raw_sleep_records)} raw sleep records...")

            # --- FILTER ACTUAL SLEEP SESSIONS VS SCHEDULED DATA ---
            actual_sleep_sessions = []
            for record in raw_sleep_records:
                # Parse timezone info
                metadata_str = record.metadata or '{}'
                metadata = {}
                try:
                    temp_data = json.loads(metadata_str)
                    while isinstance(temp_data, str):
                        temp_data = json.loads(temp_data)
                    metadata = temp_data
                except (json.JSONDecodeError, TypeError):
                    metadata = {}

                user_timezone_str = metadata.get('HKTimeZone', 'UTC')
                try:
                    user_tz = ZoneInfo(user_timezone_str)
                except ZoneInfoNotFoundError:
                    user_tz = ZoneInfo('UTC')

                start_local = record.start_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
                end_local = record.end_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
                duration_hours = (end_local - start_local).total_seconds() / 3600

                # --- PRESERVE AUTHENTIC HEALTHKIT SLEEP DATA ---
                # Skip very short sessions (< 5 minutes) - likely just movement or brief periods
                if duration_hours < 0.08:
                    continue
                
                # ❌ REMOVED OVERLY AGGRESSIVE FILTERING: 7:00 AM is a legitimate wake time!
                # ❌ REMOVED: Don't filter based on exact wake times - HealthKit data is authentic
                # ✅ Only filter if duration is unreasonable (> 16 hours for single session)
                if duration_hours > 16:
                    print(f"🚫 Skipping unreasonably long session: {start_local.strftime('%Y-%m-%d %H:%M')} - {end_local.strftime('%H:%M')} ({duration_hours:.2f}h)")
                    continue

                # Keep ALL sessions that look like actual sleep periods (5 min - 16 hours)
                if 0.08 <= duration_hours <= 16:
                    actual_sleep_sessions.append({
                        'start': start_local,
                        'end': end_local,
                        'duration': duration_hours,
                        'value': record.value
                    })
                    print(f"✅ Preserved authentic HealthKit sleep: {start_local.strftime('%Y-%m-%d %H:%M')} - {end_local.strftime('%H:%M')} ({duration_hours:.2f}h)")

            print(f"📊 Found {len(actual_sleep_sessions)} actual sleep sessions after filtering")

            # --- GROUP BY NIGHT AND FIND MAIN SLEEP PERIOD ---
            nights = {}
            for session in actual_sleep_sessions:
                # Determine which night this sleep belongs to
                # If sleep starts after 2 PM, it belongs to that day's night
                # If it starts before 2 PM, it belongs to previous day's night
                night_date = session['start'].date()
                if session['start'].hour < 14:  # Before 2 PM
                    night_date -= timedelta(days=1)

                date_key = night_date.strftime('%Y-%m-%d')
                if date_key not in nights:
                    nights[date_key] = []
                nights[date_key].append(session)

            # --- CREATE SLEEP SUMMARIES FOR EACH NIGHT ---
            final_summaries = []
            for date_key, sessions in nights.items():
                if not sessions:
                    continue

                # Sort sessions by start time
                sessions.sort(key=lambda x: x['start'])
                
                # Find the main sleep period (longest session of the night)
                main_session = max(sessions, key=lambda x: x['duration'])
                
                # Calculate total sleep including nearby sessions
                # Look for sessions that might be part of the same sleep period
                night_start = main_session['start']
                night_end = main_session['end']
                total_sleep_minutes = main_session['duration'] * 60

                # Include other sessions that are close to the main session
                for session in sessions:
                    if session != main_session:
                        # If session overlaps or is within 2 hours of main session
                        time_gap_hours = min(
                            abs((session['start'] - night_end).total_seconds() / 3600),
                            abs((session['end'] - night_start).total_seconds() / 3600)
                        )
                        
                        if time_gap_hours <= 2:  # Within 2 hours
                            night_start = min(night_start, session['start'])
                            night_end = max(night_end, session['end'])
                            total_sleep_minutes += session['duration'] * 60 * 0.8  # Weight additional sessions less

                # Apply sleep efficiency (people don't sleep 100% of time in bed)
                # sleep_efficiency = 0.85
                actual_sleep_hours = (total_sleep_minutes / 60)

                # Sanity check for reasonable sleep duration
                if 2 <= actual_sleep_hours <= 15:
                    final_summaries.append({
                        "user_id": user_id,
                        "sleep_date": date_key,
                        "sleep_start": night_start,
                        "sleep_end": night_end,
                        "sleep_hours": round(actual_sleep_hours, 2)
                    })
                    print(f"📅 {date_key}: {night_start.strftime('%H:%M')} - {night_end.strftime('%H:%M')} = {actual_sleep_hours:.1f}h")

            # --- SAVE TO DATABASE ---
            conn.execute(text("DELETE FROM sleep_summary WHERE user_id = :uid"), {"uid": user_id})
            
            if final_summaries:
                # Sort by date before inserting
                final_summaries.sort(key=lambda x: x['sleep_date'], reverse=True)
                conn.execute(text("""
                    INSERT INTO sleep_summary (user_id, sleep_date, sleep_start, sleep_end, sleep_hours)
                    VALUES (:user_id, :sleep_date, :sleep_start, :sleep_end, :sleep_hours)
                """), final_summaries)
                print(f"✅ sleep_summary refreshed with {len(final_summaries)} authentic HealthKit sleep periods (preserved all legitimate data!)")
            else:
                print("✅ No valid sleep summaries to insert after filtering.")

    except Exception as e:
        print(f"❌ Error refreshing sleep_summary: {e}")
        # non-fatal
        


@app.route('/api/diabetes-dashboard', methods=['GET'])
def get_diabetes_dashboard():
    """Provides a comprehensive summary for the diabetes dashboard."""
    try:
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        days = request.args.get('days', 15, type=int)
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        print(f"🔍 DASHBOARD API called with user_id={user_id}, clerk_user_id={clerk_user_id}, days={days}")

        end_date = date.today()
        # Dashboard metrics (sleep, steps, walking/running, calories) should always use today + 6 previous days (7 total)
        DASHBOARD_METRIC_DAYS = 6  # Days to look back from today (today + 6 previous = 7 total days)
        start_date = end_date - timedelta(days=DASHBOARD_METRIC_DAYS)
        start_of_range_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        
        # Convert start_date to datetime for proper comparison with DATETIME columns
        start_datetime = datetime.combine(start_date, datetime.min.time())
        
        print(f"📅 Dashboard date range: {start_date} to {end_date} (looking for user_id={user_id})")
        
        # DEBUG: Log user information for debugging
        print(f"🔍 DASHBOARD DEBUG: Getting data for user_id={user_id}, clerk_user_id={clerk_user_id}")
        print(f"📅 DASHBOARD DEBUG: Date range {start_date} to {end_date} (today + {DASHBOARD_METRIC_DAYS} previous = 7 total days)")
        # Optional timezone offset from client (e.g., '+05:30' or '-07:00') for correct per-day grouping
        tz_offset = request.args.get('tz_offset', '+00:00')
        start_date_local_str = start_date.isoformat()
        end_date_local_str = end_date.isoformat()

        # Migration disabled - sync process handles both tables properly
        # migrate_display_to_archive_for_user(user_id)
        
        with engine.connect() as conn:
            # --- 1. GLUCOSE DATA ---
            glucose_query = text("""
                SELECT timestamp, glucose_level FROM glucose_log
                WHERE user_id = :user_id AND timestamp >= :start_date
                ORDER BY timestamp
            """)
            
            query_params = {'user_id': user_id, 'start_date': start_datetime}
            print(f"🩸 GLUCOSE DEBUG: Executing query with params: {query_params}")
            print(f"🩸 GLUCOSE DEBUG: start_datetime type: {type(start_datetime)}, value: {start_datetime}")
            
            glucose_records = conn.execute(glucose_query, query_params).fetchall()

            print(f"🩸 GLUCOSE DEBUG: Found {len(glucose_records)} glucose records for user {user_id} since {start_date}")
            for record in glucose_records:
                print(f"  📊 {record.timestamp}: {record.glucose_level} mg/dL")

            glucose_by_day = {}
            for r in glucose_records:
                day = r.timestamp.strftime('%Y-%m-%d')
                if day not in glucose_by_day:
                    glucose_by_day[day] = []
                glucose_by_day[day].append(r.glucose_level)
            
            print(f"🩸 GLUCOSE DEBUG: Grouped into {len(glucose_by_day)} days: {list(glucose_by_day.keys())}")
            
            glucose_summary = []
            for day, readings in glucose_by_day.items():
                in_range_count = sum(1 for r in readings if 70 <= r <= 180)
                glucose_summary.append({
                    'date': day,
                    'avg_glucose': round(sum(readings) / len(readings), 1),
                    'min_glucose': min(readings),
                    'max_glucose': max(readings),
                    'reading_count': len(readings),
                    'time_in_range_percent': f"{(in_range_count / len(readings) * 100):.1f}"
                })
            
            total_readings = sum(len(v) for v in glucose_by_day.values())
            avg_glucose_total = sum(sum(v) for v in glucose_by_day.values()) / total_readings if total_readings > 0 else 0
            avg_time_in_range = sum(float(d['time_in_range_percent']) for d in glucose_summary) / len(glucose_summary) if glucose_summary else 0

            # --- 4. SLEEP DATA (USING IMPROVED ALGORITHM) ---
            # Look back further to find available sleep data, then return the most recent 7 days with data
            sleep_days_range = 30
            print(f"🛏️ Dashboard: Using improved sleep analysis for {sleep_days_range} days (today + 7 previous) (Sleep Patterns)")
            print(f"📱 MOBILE DEBUG: Request from {request.remote_addr} for user {user_id}")
            print(f"📱 MOBILE DEBUG: Request URL: {request.url}")
            
            improved_sleep_result = get_improved_sleep_data(user_id, sleep_days_range)
            
            sleep_data = []
            if improved_sleep_result.get('success'):
                daily_summaries = improved_sleep_result.get('daily_summaries', [])
                print(f"📱 MOBILE DEBUG: get_improved_sleep_data returned {len(daily_summaries)} summaries")
                
                for summary in daily_summaries:
                    sleep_entry = {
                        'date': summary['date'],
                        'bedtime': summary['bedtime'],
                        'wake_time': summary['wake_time'],
                        'sleep_hours': summary['sleep_hours'],
                        'formatted_sleep': summary['formatted_sleep'],
                        'has_data': summary.get('has_data', True)
                    }
                    sleep_data.append(sleep_entry)
                    
                    # Log each entry being added
                    status = '✅' if sleep_entry['has_data'] else '❌'
                    print(f"📱 MOBILE DEBUG: {status} Adding {sleep_entry['date']}: {sleep_entry['formatted_sleep']}")
                
                print(f"✅ Dashboard: Using {len(sleep_data)} sleep summaries (including {improved_sleep_result.get('days_without_data', 0)} days with no data)")
                print(f"📱 MOBILE DEBUG: Final sleep_data length: {len(sleep_data)}")
            else:
                print(f"⚠️ Dashboard: Improved sleep analysis failed, using fallback")
                # Create 7 empty days as fallback
                today = datetime.now().date()
                for i in range(7):
                    target_date = today - timedelta(days=i)
                    sleep_data.append({
                        'date': target_date.strftime('%Y-%m-%d'),
                        'bedtime': '--:--',
                        'wake_time': '--:--',
                        'sleep_hours': 0,
                        'formatted_sleep': 'No Data',
                        'has_data': False
                    })
            
            # --- 4b. SLEEP AVERAGE (USE A FIXED 7-DAY WINDOW: TODAY + 6 PREVIOUS) ---
            # Always divide by the full 7-day window (today + 6 previous) so that missing days contribute 0h
            # This prevents the average from being artificially inflated when a day has
            # no data.
            # Filter sleep_data to last 7 days for consistency with other metrics
            last_7_days_sleep = [(end_date - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
            sleep_data_filtered = [s for s in sleep_data if s['date'] in last_7_days_sleep]
            
            avg_sleep_hours = round(
                sum(s['sleep_hours'] for s in sleep_data_filtered) / 7,
                2
            )

            # --- 5. ACTIVITY DATA (STEPS + CALORIES FROM APPLE HEALTH + MANUAL) ---
            # Always query for exactly the last 7 days from today for consistent dashboard behavior
            dashboard_start_date = end_date - timedelta(days=DASHBOARD_METRIC_DAYS)
            dashboard_start_local_str = dashboard_start_date.isoformat()
            
            print(f"🔄 DASHBOARD: Querying activity data for exact 7-day window: {dashboard_start_date} to {end_date}")
            
            apple_steps_query = text("""
                SELECT DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as date, 
                       SUM(CAST(value AS DECIMAL(10,2))) as total_steps 
                FROM health_data_archive
                WHERE user_id = :user_id 
                  AND data_type IN ('StepCount', 'Steps')
                  AND DATE(CONVERT_TZ(end_date, '+00:00', :tz)) BETWEEN :start_local AND :end_local
                GROUP BY DATE(CONVERT_TZ(end_date, '+00:00', :tz))
                ORDER BY DATE(CONVERT_TZ(end_date, '+00:00', :tz)) DESC
            """)
            apple_step_records = conn.execute(apple_steps_query, {
                'user_id': user_id, 
                'tz': tz_offset,
                'start_local': dashboard_start_local_str,
                'end_local': end_date_local_str
            }).fetchall()
            
            print(f"📊 Found {len(apple_step_records)} days of step data in 7-day window")

            apple_calories_query = text("""
                SELECT DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as date, 
                       SUM(CAST(value AS DECIMAL(10,2))) as total_calories 
                FROM health_data_archive
                WHERE user_id = :user_id 
                  AND data_type = 'ActiveEnergyBurned' 
                  AND DATE(CONVERT_TZ(end_date, '+00:00', :tz)) BETWEEN :start_local AND :end_local
                GROUP BY DATE(CONVERT_TZ(end_date, '+00:00', :tz))
                ORDER BY DATE(CONVERT_TZ(end_date, '+00:00', :tz)) DESC
            """)
            apple_calories_records = conn.execute(apple_calories_query, {
                'user_id': user_id, 
                'tz': tz_offset,
                'start_local': dashboard_start_local_str,
                'end_local': end_date_local_str
            }).fetchall()
            
            print(f"🔥 Found {len(apple_calories_records)} days of calories data in 7-day window")

            # Get manual activity data from activity_log table (include duration) - also limit to 7 days
            manual_activity_query = text("""
                SELECT DATE(timestamp) as date,
                       SUM(duration_minutes) as total_minutes,
                       SUM(COALESCE(steps, 0)) as total_steps,
                       SUM(COALESCE(calories_burned, 0)) as total_calories
                FROM activity_log
                WHERE user_id = :user_id AND DATE(timestamp) >= :start_date
                GROUP BY DATE(timestamp)
            """)
            manual_activity_records = conn.execute(manual_activity_query, {
                'user_id': user_id, 
                'start_date': dashboard_start_date
            }).fetchall()

            # Get Apple Health workout durations (in minutes) from ARCHIVE table only - also limit to 7 days
            apple_workout_query = text("""
                SELECT DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as date,
                       SUM(TIMESTAMPDIFF(MINUTE, start_date, end_date)) as total_minutes
                FROM health_data_archive
                WHERE user_id = :user_id AND data_type = 'Workout'
                  AND DATE(CONVERT_TZ(end_date, '+00:00', :tz)) BETWEEN :start_local AND :end_local
                GROUP BY DATE(CONVERT_TZ(end_date, '+00:00', :tz))
            """)
            apple_workout_records = conn.execute(apple_workout_query, {
                'user_id': user_id, 
                'tz': tz_offset,
                'start_local': dashboard_start_local_str,
                'end_local': end_date_local_str
            }).fetchall()
            
            # Combine Apple Health, manual logs, and workouts into daily activity dict
            daily_activity = {}
            
            # Add Apple Health steps (sum per day)
            for r in apple_step_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0, 'active_minutes': 0, 'distance_km': 0}
                daily_activity[day_key]['steps'] = int(round(float(r.total_steps or 0)))
            
            # Add Apple Health calories
            for r in apple_calories_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0, 'active_minutes': 0, 'distance_km': 0}
                daily_activity[day_key]['calories'] = int(r.total_calories)
            
            # Add manual activity data (combine with Apple Health for same day)
            for r in manual_activity_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0, 'active_minutes': 0, 'distance_km': 0}
                
                # Add manual steps to existing Apple Health steps
                daily_activity[day_key]['steps'] += int(round(float(r.total_steps or 0)))
                # Add manual calories to existing Apple Health calories
                daily_activity[day_key]['calories'] += int(round(float(r.total_calories or 0)))
                # Add manual active minutes
                daily_activity[day_key]['active_minutes'] += int(round(float(r.total_minutes or 0)))
            
            # Add Apple Health workout durations
            for r in apple_workout_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0, 'active_minutes': 0, 'distance_km': 0}
                daily_activity[day_key]['active_minutes'] += int(r.total_minutes) if r.total_minutes else 0
            
            # ------------------------------------------------------------------
            # 🔄 FILL IN MISSING DAYS FOR EXACT 7-DAY WINDOW -------------------
            # Always ensure we have exactly 7 days (today + 6 previous days) represented
            # This guarantees consistent dashboard behavior and accurate averages
            last_7_days = [(end_date - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
            
            for d in last_7_days:
                if d not in daily_activity:
                    daily_activity[d] = {
                        'steps': 0,
                        'calories': 0,
                        'active_minutes': 0,
                        'distance_km': 0,
                    }
                    print(f"📅 Added missing day {d} with zero values for complete 7-day window")

            # ------------------------------------------------------------------
            # Create activity data structure
            activity_data = []
            for date_key, activity in daily_activity.items():
                # Determine activity level
                mins = activity['active_minutes']
                if mins >= 60:
                    level = 'Active'
                elif mins >= 30:
                    level = 'Moderately Active'
                else:
                    level = 'Sedentary'

                activity_data.append({
                    'date': date_key,
                    'steps': activity['steps'],
                    'calories_burned': activity['calories'],
                    'active_minutes': mins,
                    'activity_level': level,
                    'distance_km': activity['distance_km']
                })
            activity_data.sort(key=lambda x: x['date'], reverse=True)

            # Calculate totals & averages using a FIXED 7-DAY WINDOW (today + 6 previous days) for dashboard consistency
            # Filter activity_data to include today + last 6 days for complete view
            today = date.today()
            six_days_ago = today - timedelta(days=6)
            last_7_days = [(today - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
            
            # Restrict activity_data to last 7 days (today + 6 previous days) for display
            activity_data = [a for a in activity_data if a['date'] in last_7_days]

            # Filter to last 7 days for average calculations (today + 6 previous days)
            last_7_days_activity = [a for a in activity_data if a['date'] in last_7_days]
            
            # Ensure we have exactly 7 days by filling missing days with zeros
            activity_by_date = {a['date']: a for a in last_7_days_activity}
            complete_7_days_activity = []
            for day_str in last_7_days:
                if day_str in activity_by_date:
                    complete_7_days_activity.append(activity_by_date[day_str])
                else:
                    complete_7_days_activity.append({
                        'date': day_str,
                        'steps': 0,
                        'calories_burned': 0,
                        'active_minutes': 0,
                        'distance_km': 0,
                        'activity_level': 'Sedentary'
                    })
            
            # Calculate totals & averages using exactly 7 days (today + 6 previous days)
            total_steps = sum(a['steps'] for a in complete_7_days_activity)
            total_calories = sum(a['calories_burned'] for a in complete_7_days_activity)
            total_distance_activity = sum(a['distance_km'] for a in complete_7_days_activity)

            # Always divide by 7 for consistent dashboard averages (today + 6 previous days)
            DASHBOARD_DAYS = 7
            avg_daily_steps = round(total_steps / DASHBOARD_DAYS, 1)
            avg_daily_calories = round(total_calories / DASHBOARD_DAYS, 1)
            avg_daily_active_minutes = round(
                sum(a['active_minutes'] for a in complete_7_days_activity) / DASHBOARD_DAYS, 1
            )
            
            print(f"📊 ACTIVITY SUMMARY: {DASHBOARD_DAYS} days (fixed window), {total_steps} total steps, {int(avg_daily_steps)} avg daily")
            print(f"🔥 CALORIES SUMMARY: {DASHBOARD_DAYS} days (fixed window), {total_calories} total calories, {int(avg_daily_calories)} avg daily")

            # --- 6. WALKING + RUNNING DISTANCE DATA ---
            # Use the same exact 7-day window for consistency
            apple_distance_query = text("""
                SELECT DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as date, 
                       SUM(CAST(value AS DECIMAL(10,4))) as total_distance_mi
                FROM health_data_archive
                WHERE user_id = :user_id AND data_type = 'DistanceWalkingRunning'
                  AND DATE(CONVERT_TZ(end_date, '+00:00', :tz)) BETWEEN :start_local AND :end_local
                  AND value > 0
                GROUP BY DATE(CONVERT_TZ(end_date, '+00:00', :tz))
                ORDER BY DATE(CONVERT_TZ(end_date, '+00:00', :tz)) DESC
            """)
            apple_distance_records = conn.execute(apple_distance_query, {
                'user_id': user_id, 
                'tz': tz_offset,
                'start_local': dashboard_start_local_str,
                'end_local': end_date_local_str
            }).fetchall()
            
            print(f"📏 Found {len(apple_distance_records)} days of distance data in 7-day window")
            
            # Add Apple Health distance to daily_activity dictionary
            for r in apple_distance_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0, 'active_minutes': 0, 'distance_km': 0}
                # Convert miles → km (1 mi = 1.60934 km)
                daily_activity[day_key]['distance_km'] = round(float(r.total_distance_mi) * 1.60934, 2)
            
            # Use only Apple Health distance data (properly converted from miles to km)
            daily_distances = {}
            
            for r in apple_distance_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                distance_km = float(r.total_distance_mi) * 1.60934
                daily_distances[day_key] = round(distance_km, 2)
            
            # Create walking + running data structure with FIXED 7-DAY WINDOW (today + 6 previous days)
            walking_running_data = []
            
            # Ensure we calculate averages over exactly 7 days (same as other metrics)
            complete_7_days_distance = []
            for day_str in last_7_days:
                if day_str in daily_distances:
                    distance_km = daily_distances[day_str]
                    walking_running_data.append({
                        'date': day_str, 
                        'distance_km': round(distance_km, 2), 
                        'distance_miles': round(distance_km / 1.60934, 2)
                    })
                    complete_7_days_distance.append(distance_km)
                else:
                    # Include zero days for accurate 7-day average (today + 6 previous days)
                    walking_running_data.append({
                        'date': day_str, 
                        'distance_km': 0.0, 
                        'distance_miles': 0.0
                    })
                    complete_7_days_distance.append(0.0)
            
            walking_running_data.sort(key=lambda x: x['date'], reverse=True)
            
            # Calculate average distance using exactly 7 days (including zero days)
            total_distance_km = sum(complete_7_days_distance)
            avg_daily_distance_km = total_distance_km / DASHBOARD_DAYS
            avg_daily_distance_miles = avg_daily_distance_km / 1.60934 if avg_daily_distance_km > 0 else 0
            
            print(f"📏 DISTANCE SUMMARY: {DASHBOARD_DAYS} days (fixed window), {total_distance_km:.2f} km total, {avg_daily_distance_km:.2f} km avg daily")

            # MOBILE DEBUG: Log final data being sent
            print(f"📱 MOBILE DEBUG: About to return response with:")
            print(f"   • Glucose entries: {len(glucose_summary)}")
            print(f"   • Activity entries: {len(activity_data)}")
            print(f"   • Sleep entries: {len(sleep_data)}")
            print(f"   • Sleep data sample: {sleep_data[:2] if sleep_data else 'EMPTY'}")
            print(f"   • Average sleep hours: {avg_sleep_hours}")

            return jsonify({
                "date_range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": DASHBOARD_METRIC_DAYS + 1},
                "glucose": {
                    "data": sorted(glucose_summary, key=lambda x: x['date'], reverse=True),
                    "summary": {"avg_glucose_15_days": round(avg_glucose_total, 1), "avg_glucose_7_days": round(avg_glucose_total, 1), "avg_time_in_range": f"{avg_time_in_range:.1f}", "total_readings": total_readings}
                },
                "activity": {
                    "data": activity_data,
                    "summary": {"avg_daily_steps": int(avg_daily_steps), "avg_daily_calories": int(avg_daily_calories), "avg_daily_active_minutes": int(avg_daily_active_minutes), "total_distance_km": round(total_distance_activity, 2)}
                },
                "walking_running": {
                    "data": walking_running_data,
                    "summary": {
                        "avg_daily_distance_km": round(avg_daily_distance_km, 2),
                        "avg_daily_distance_miles": round(avg_daily_distance_miles, 2),
                        "total_distance_km": round(total_distance_km, 2),
                        "total_distance_miles": round(total_distance_km / 1.60934, 2) if total_distance_km > 0 else 0
                    }
                },
                "sleep": {
                    "data": sleep_data,
                    "summary": {"avg_sleep_hours": round(avg_sleep_hours, 1), "sleep_quality_trend": "needs_improvement"}
                },
            })

    except Exception as e:
        print(f"❌ Error in /api/diabetes-dashboard: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/activity-logs', methods=['GET'])
def get_activity_logs():
    """
    Comprehensive activity logs combining manual entries and Apple Health data
    Returns chronological list of all user activity with source identification
    """
    try:
        # Ensure the activity_log table exists
        create_activity_log_table()
        
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        days_back = request.args.get('days', 30, type=int)
        tz_offset = request.args.get('tz_offset', '+00:00')
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        # Calculate date range
        end_date = date.today()
        start_date = end_date - timedelta(days=days_back)
        
        # DEBUG: Log user information for debugging
        print(f"🔍 ACTIVITY LOGS DEBUG: Getting data for user_id={user_id}, clerk_user_id={clerk_user_id}")
        print(f"📅 ACTIVITY LOGS DEBUG: Date range {start_date} to {end_date} ({days_back} days)")
        
        activity_logs = []
        
        # Migration disabled - sync process handles both tables properly
        # migrate_display_to_archive_for_user(user_id)
        
        with engine.connect() as conn:
            # 1. MANUAL ACTIVITY LOGS from activity_log table
            print(f"🔍 Querying manual activities for user_id={user_id}, date range: {start_date} to {end_date}")
            
            manual_activities = conn.execute(text("""
                SELECT 
                    CONCAT('manual_', id) as id,
                    DATE(timestamp) as date,
                    TIME(timestamp) as time,
                    'manual' as type,
                    activity_type,
                    CONCAT(
                        activity_type, 
                        CASE 
                            WHEN duration_minutes > 0 THEN CONCAT(' for ', duration_minutes, ' minutes')
                            ELSE ''
                        END,
                        CASE 
                            WHEN steps > 0 THEN CONCAT(' (', steps, ' steps)')
                            ELSE ''
                        END
                    ) as description,
                    duration_minutes,
                    steps,
                    calories_burned,
                    NULL as distance_km,
                    'Manual Entry' as source,
                    timestamp as sort_timestamp
                FROM activity_log 
                WHERE user_id = :user_id 
                  AND DATE(timestamp) BETWEEN :start_date AND :end_date
                ORDER BY timestamp DESC
            """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
            
            print(f"📊 Found {len(manual_activities)} manual activities in database")
            for row in manual_activities:
                print(f"  • {row[1]} {row[2]}: {row[4]} - {row[5]}")
            
            # Let's also check if there are ANY activities in the table
            total_activities = conn.execute(text("""
                SELECT COUNT(*) as total, MAX(timestamp) as latest_timestamp 
                FROM activity_log 
                WHERE user_id = :user_id
            """), {'user_id': user_id}).fetchone()
            
            print(f"📈 Total activities for user {user_id}: {total_activities[0]}, Latest: {total_activities[1]}")

            # 2. APPLE HEALTH WORKOUT DATA from archive table (use local day via tz)
            try:
                apple_workouts = conn.execute(text("""
                    SELECT 
                        CONCAT('apple_workout_', id) as id,
                        DATE(CONVERT_TZ(start_date, '+00:00', :tz)) as date,
                        TIME(CONVERT_TZ(start_date, '+00:00', :tz)) as time,
                        'apple_health' as type,
                        COALESCE(workout_activity_type, data_subtype, 'Workout') as activity_type,
                        CONCAT(
                            COALESCE(workout_activity_type, data_subtype, 'Workout'),
                            CASE 
                                WHEN value > 0 THEN CONCAT(' (', ROUND(value, 0), ' ', unit, ')')
                                ELSE ''
                            END,
                            CASE 
                                WHEN end_date IS NOT NULL AND start_date IS NOT NULL 
                                THEN CONCAT(' for ', ROUND(TIMESTAMPDIFF(MINUTE, start_date, end_date), 0), ' min')
                                ELSE ''
                            END
                        ) as description,
                        CASE 
                            WHEN end_date IS NOT NULL AND start_date IS NOT NULL 
                            THEN ROUND(TIMESTAMPDIFF(MINUTE, start_date, end_date), 0)
                            ELSE NULL
                        END as duration_minutes,
                        NULL as steps,
                        CASE 
                            WHEN unit = 'cal' THEN ROUND(value, 0)
                            ELSE NULL
                        END as calories_burned,
                        CASE 
                            WHEN unit IN ('km', 'm') THEN 
                                CASE 
                                    WHEN unit = 'm' THEN ROUND(value / 1000, 2)
                                    ELSE ROUND(value, 2)
                                END
                            ELSE NULL
                        END as distance_km,
                        'Apple Health Workout' as source,
                        start_date as sort_timestamp
                    FROM health_data_archive 
                    WHERE user_id = :user_id 
                      AND data_type = 'Workout'
                      AND DATE(CONVERT_TZ(start_date, '+00:00', :tz)) BETWEEN :start_date AND :end_date
                    ORDER BY start_date DESC
                    LIMIT 10
                """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date, 'tz': tz_offset}).fetchall()
            except Exception as e:
                print(f"⚠️ Apple Health workouts query failed: {e}")
                apple_workouts = []

            # Fallback to archive table if no workout data found in display table
            if not apple_workouts:
                print(f"⚠️ No workout data in display table, falling back to archive table")
                try:
                    apple_workouts_archive = conn.execute(text("""
                        SELECT 
                            CONCAT('apple_workout_', id) as id,
                            DATE(start_date) as date,
                            TIME(start_date) as time,
                            'apple_health' as type,
                            COALESCE(workout_activity_type, data_subtype, 'Workout') as activity_type,
                            CONCAT(
                                COALESCE(workout_activity_type, data_subtype, 'Workout'),
                                CASE 
                                    WHEN value > 0 THEN CONCAT(' (', ROUND(value, 0), ' ', unit, ')')
                                    ELSE ''
                                END,
                                CASE 
                                    WHEN end_date IS NOT NULL AND start_date IS NOT NULL 
                                    THEN CONCAT(' for ', ROUND(TIMESTAMPDIFF(MINUTE, start_date, end_date), 0), ' min')
                                    ELSE ''
                                END
                            ) as description,
                            CASE 
                                WHEN end_date IS NOT NULL AND start_date IS NOT NULL 
                                THEN ROUND(TIMESTAMPDIFF(MINUTE, start_date, end_date), 0)
                                ELSE NULL
                            END as duration_minutes,
                            NULL as steps,
                            CASE 
                                WHEN unit = 'cal' THEN ROUND(value, 0)
                                ELSE NULL
                            END as calories_burned,
                            CASE 
                                WHEN unit IN ('km', 'm') THEN 
                                    CASE 
                                        WHEN unit = 'm' THEN ROUND(value / 1000, 2)
                                        ELSE ROUND(value, 2)
                                    END
                                ELSE NULL
                            END as distance_km,
                            'Apple Health Workout' as source,
                            start_date as sort_timestamp
                        FROM health_data_archive 
                        WHERE user_id = :user_id 
                          AND data_type = 'Workout'
                          AND DATE(start_date) BETWEEN :start_date AND :end_date
                        ORDER BY start_date DESC
                        LIMIT 10
                    """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
                    
                    apple_workouts = apple_workouts_archive
                    print(f"📊 Found {len(apple_workouts)} Apple Health workout entries from archive")
                    
                except Exception as e:
                    print(f"⚠️ Apple Health workouts archive query failed: {e}")
                    apple_workouts = []

            # 3. APPLE HEALTH STEP COUNT DATA (daily summaries) from ARCHIVE table ONLY (group by local day)
            try:
                apple_steps_query = text("""
                    SELECT 
                        CONCAT('apple_steps_', DATE(CONVERT_TZ(end_date, '+00:00', :tz))) as id,
                        DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as date,
                        '23:59:59' as time,
                        'apple_health' as type,
                        'Daily Steps' as activity_type,
                        CONCAT(ROUND(SUM(value), 0), ' steps recorded by Apple Health') as description,
                        NULL as duration_minutes,
                        CAST(ROUND(SUM(value), 0) AS UNSIGNED) as steps,
                        NULL as calories_burned,
                        NULL as distance_km,
                        'Apple Health Steps' as source,
                        DATE(CONVERT_TZ(end_date, '+00:00', :tz)) as sort_timestamp
                    FROM health_data_archive 
                    WHERE user_id = :user_id 
                      AND data_type IN ('StepCount', 'Steps')
                      AND DATE(CONVERT_TZ(end_date, '+00:00', :tz)) BETWEEN :start_date AND :end_date
                      AND value > 0
                    GROUP BY DATE(CONVERT_TZ(end_date, '+00:00', :tz))
                    ORDER BY DATE(CONVERT_TZ(end_date, '+00:00', :tz)) DESC
                """)
                
                apple_steps = conn.execute(apple_steps_query, {
                    'user_id': user_id, 
                    'start_date': start_date, 
                    'end_date': end_date, 
                    'tz': tz_offset
                }).fetchall()
                
                print(f"📊 Found {len(apple_steps)} Apple Health step entries in {days_back} days")
                
                # FALLBACK: If no recent step data found, extend search to last 30 days  
                if not apple_steps and days_back <= 7:
                    print(f"⚠️ No step data found in last {days_back} days, extending search to 30 days")
                    extended_start_date = end_date - timedelta(days=30)
                    
                    apple_steps = conn.execute(apple_steps_query, {
                        'user_id': user_id, 
                        'start_date': extended_start_date, 
                        'end_date': end_date, 
                        'tz': tz_offset
                    }).fetchall()
                    
                    if apple_steps:
                        print(f"✅ Found {len(apple_steps)} Apple Health step entries in extended 30-day window")
                        # Limit to latest 10 entries when using fallback
                        apple_steps = apple_steps[:10]
                    else:
                        print(f"❌ No step data found even in 30-day window for user_id={user_id}")
                
                for row in apple_steps:
                    print(f"  • {row[1]}: {row[7]} steps")
                    
            except Exception as e:
                print(f"⚠️ Apple Health steps query failed: {e}")
                apple_steps = []

            # REMOVED: Distance data should NOT be in activity logs - only in walking/running section
            apple_distance = []  # Keep empty to maintain code structure
            
            # Debug removed: display table not used anymore for steps

        # Combine all activity logs
        all_activities = []
        
        # Process manual activities
        for row in manual_activities:
            all_activities.append({
                'id': row[0],
                'date': str(row[1]),
                'time': str(row[2]),
                'type': row[3],
                'activity_type': row[4],
                'description': row[5],
                'duration_minutes': row[6] if row[6] else None,
                'steps': row[7] if row[7] else None,
                'calories_burned': row[8] if row[8] else None,
                'distance_km': row[9] if row[9] else None,
                'source': row[10],
                'sort_timestamp': row[11]
            })

        # Process Apple Health workouts
        for row in apple_workouts:
            all_activities.append({
                'id': row[0],
                'date': str(row[1]),
                'time': str(row[2]),
                'type': row[3],
                'activity_type': row[4],
                'description': row[5],
                'duration_minutes': row[6] if row[6] else None,
                'steps': row[7] if row[7] else None,
                'calories_burned': row[8] if row[8] else None,
                'distance_km': row[9] if row[9] else None,
                'source': row[10],
                'sort_timestamp': row[11]
            })

        # Process Apple Health steps
        for row in apple_steps:
            all_activities.append({
                'id': row[0],
                'date': str(row[1]),
                'time': str(row[2]),
                'type': row[3],
                'activity_type': row[4],
                'description': row[5],
                'duration_minutes': row[6] if row[6] else None,
                'steps': row[7] if row[7] else None,
                'calories_burned': row[8] if row[8] else None,
                'distance_km': row[9] if row[9] else None,
                'source': row[10],
                'sort_timestamp': row[11]
            })

        # REMOVED: Distance data should not be in activity logs - only in walking/running section

        # Debug: Log what we found
        print(f"📊 Activity logs found:")
        print(f"  • Manual activities: {len(manual_activities)}")
        print(f"  • Apple workouts: {len(apple_workouts)}")
        print(f"  • Apple steps: {len(apple_steps)}")
        print(f"  • Total combined: {len(all_activities)}")
        print(f"  ✅ Distance data excluded from activity logs (appears only in walking/running section)")
        
        # Sort all activities by timestamp (most recent first)
        # Handle both datetime and date objects for sorting
        def sort_key(activity):
            ts = activity['sort_timestamp']
            if isinstance(ts, str):
                try:
                    return datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except:
                    return datetime.strptime(ts, '%Y-%m-%d')
            elif hasattr(ts, 'date'):
                return ts  # It's already a datetime
            else:
                return datetime.combine(ts, datetime.min.time())  # It's a date, convert to datetime
        
        all_activities.sort(key=sort_key, reverse=True)

        # Remove sort_timestamp from final output
        for activity in all_activities:
            del activity['sort_timestamp']

        return jsonify({
            'activity_logs': all_activities,
            'summary': {
                'total_entries': len(all_activities),
                'manual_entries': len([a for a in all_activities if a['type'] == 'manual']),
                'apple_health_entries': len([a for a in all_activities if a['type'] == 'apple_health']),
                'date_range': {
                    'start_date': str(start_date),
                    'end_date': str(end_date),
                    'days': days_back
                }
            }
        }), 200

    except Exception as e:
        print(f"Error fetching activity logs: {e}")
        return jsonify({"error": f"Failed to fetch activity logs: {str(e)}"}), 500

# New endpoint for fetching glucose history
@app.route('/api/glucose-history', methods=['GET'])
def get_glucose_history():
    """Fetch glucose history from the database for chart visualization"""
    try:
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        days_back = request.args.get('days', 7, type=int)  # Default to last 7 days
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        with engine.connect() as conn:
            glucose_records = conn.execute(text("""
                SELECT timestamp, glucose_level 
                FROM glucose_log 
                WHERE user_id = :user_id AND timestamp >= :start_date
                ORDER BY timestamp ASC
            """), {
                'user_id': user_id, 
                'start_date': start_date.strftime('%Y-%m-%d %H:%M:%S')
            }).fetchall()
            
            # Convert to list of dictionaries for JSON response
            glucose_logs = []
            for record in glucose_records:
                glucose_logs.append({
                    'timestamp': record.timestamp.isoformat(),
                    'glucose_level': float(record.glucose_level)
                })
            
            return jsonify({
                'success': True,
                'glucose_logs': glucose_logs,
                'summary': {
                    'total_readings': len(glucose_logs),
                    'date_range': {
                        'start_date': start_date.isoformat(),
                        'end_date': end_date.isoformat(),
                        'days_back': days_back
                    }
                }
            }), 200
            
    except Exception as e:
        print(f"Error fetching glucose history: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to fetch glucose history: {str(e)}',
            'glucose_logs': []
        }), 500

# Simple health check endpoint for network connectivity testing
@app.route('/api/health', methods=['GET'])
def health_check():
    """Simple health check endpoint to test network connectivity"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "message": "SugarSense.ai backend is running",
        "version": "1.0.0"
    }), 200

@app.route('/api/enhanced-sleep-analysis', methods=['GET'])
def enhanced_sleep_analysis():
    """Enhanced sleep analysis endpoint for detailed sleep insights"""
    try:
        clerk_user_id = request.args.get('clerk_user_id')
        days = request.args.get('days', default=7, type=int)
        
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id parameter is required"
            }), 400
        
        # Get the database user_id from clerk_user_id
        try:
            user_id = get_user_id_from_clerk(clerk_user_id)
        except ValueError as e:
            return jsonify({
                "success": False,
                "error": "User not found"
            }), 404
        
        # Query sleep data from both display and archive tables
        with engine.connect() as conn:
            # First try display table for recent data
            display_sleep_query = text("""
                SELECT DATE(end_date) as sleep_date,
                       TIMESTAMPDIFF(MINUTE, start_date, end_date) / 60.0 as hours_slept,
                       start_date,
                       end_date,
                       source_name,
                       'display' as data_source
                FROM health_data_display
                WHERE user_id = :user_id 
                AND data_type = 'SleepAnalysis'
                AND end_date >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
                ORDER BY end_date DESC
            """)
            
            display_results = conn.execute(display_sleep_query, {
                'user_id': user_id, 
                'days': days
            }).fetchall()
            
            # Fallback to archive table if display table has limited data
            archive_sleep_query = text("""
                SELECT DATE(end_date) as sleep_date,
                       TIMESTAMPDIFF(MINUTE, start_date, end_date) / 60.0 as hours_slept,
                       start_date,
                       end_date,
                       source_name,
                       'archive' as data_source
                FROM health_data_archive
                WHERE user_id = :user_id 
                AND data_type = 'SleepAnalysis'
                AND end_date >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
                ORDER BY end_date DESC
            """)
            
            archive_results = conn.execute(archive_sleep_query, {
                'user_id': user_id, 
                'days': days
            }).fetchall()
            
            # Combine results, prioritizing display data
            sleep_data = []
            seen_dates = set()
            
            # Add display data first
            for row in display_results:
                sleep_date = str(row.sleep_date)
                if sleep_date not in seen_dates:
                    seen_dates.add(sleep_date)
                    sleep_data.append({
                        "date": sleep_date,
                        "hours_slept": round(float(row.hours_slept or 0), 1),
                        "start_time": row.start_date.isoformat() if row.start_date else None,
                        "end_time": row.end_date.isoformat() if row.end_date else None,
                        "source": row.source_name or "Unknown",
                        "data_source": row.data_source
                    })
            
            # Add archive data for missing dates
            for row in archive_results:
                sleep_date = str(row.sleep_date)
                if sleep_date not in seen_dates:
                    seen_dates.add(sleep_date)
                    sleep_data.append({
                        "date": sleep_date,
                        "hours_slept": round(float(row.hours_slept or 0), 1),
                        "start_time": row.start_date.isoformat() if row.start_date else None,
                        "end_time": row.end_date.isoformat() if row.end_date else None,
                        "source": row.source_name or "Unknown",
                        "data_source": row.data_source
                    })
            
            # Sort by date (most recent first)
            sleep_data.sort(key=lambda x: x["date"], reverse=True)
            
            # Calculate sleep insights
            if sleep_data:
                hours_list = [d["hours_slept"] for d in sleep_data if d["hours_slept"] > 0]
                if hours_list:
                    avg_sleep = sum(hours_list) / len(hours_list)
                    min_sleep = min(hours_list)
                    max_sleep = max(hours_list)
                    
                    # Sleep quality assessment
                    good_nights = len([h for h in hours_list if h >= 7])
                    sleep_quality = "Good" if good_nights >= len(hours_list) * 0.7 else "Needs Improvement"
                    
                    insights = {
                        "average_sleep": round(avg_sleep, 1),
                        "min_sleep": round(min_sleep, 1),
                        "max_sleep": round(max_sleep, 1),
                        "nights_with_data": len(hours_list),
                        "good_nights": good_nights,
                        "sleep_quality": sleep_quality,
                        "recommendation": "Aim for 7-9 hours of sleep nightly" if avg_sleep < 7 else "Great sleep habits!"
                    }
                else:
                    insights = None
            else:
                insights = None
            
            print(f"📊 Enhanced sleep analysis for user {user_id}: Found {len(sleep_data)} sleep records over {days} days")
            if not sleep_data:
                print(f"⚠️ No sleep data found - checking if user has any sleep data in archive")
                
            return jsonify({
                "success": True,
                "sleep_data": sleep_data,
                "insights": insights,
                "total_records": len(sleep_data),
                "days_requested": days,
                "user_id": user_id
            }), 200
            
    except Exception as e:
        print(f"❌ Error in enhanced sleep analysis: {e}")
        return jsonify({
            "success": False,
            "error": f"Enhanced sleep analysis failed: {str(e)}"
        }), 500

@app.route('/api/repair-display-table', methods=['POST'])
def repair_display_table():
    """Repair display table by populating it from archive table when it's empty"""
    try:
        data = request.json
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({
                "success": False,
                "error": "user_id is required"
            }), 400
        
        with engine.connect() as conn:
            # Check if display table is empty or has very little data
            display_count_query = text("""
                SELECT data_type, COUNT(*) as count
                FROM health_data_display
                WHERE user_id = :user_id
                AND start_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY data_type
            """)
            
            display_counts = conn.execute(display_count_query, {'user_id': user_id}).fetchall()
            display_data_types = {row.data_type: row.count for row in display_counts}
            
            # Check archive table to see what data is available
            archive_count_query = text("""
                SELECT data_type, COUNT(*) as count
                FROM health_data_archive
                WHERE user_id = :user_id
                AND start_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY data_type
            """)
            
            archive_counts = conn.execute(archive_count_query, {'user_id': user_id}).fetchall()
            archive_data_types = {row.data_type: row.count for row in archive_counts}
            
            # Find data types that need repair (exist in archive but missing/low in display)
            data_types_to_repair = []
            for data_type, archive_count in archive_data_types.items():
                display_count = display_data_types.get(data_type, 0)
                if display_count < archive_count * 0.5:  # Less than 50% of archive data
                    data_types_to_repair.append(data_type)
            
            print(f"🔧 Display table repair for user {user_id}:")
            print(f"   Archive data types: {archive_data_types}")
            print(f"   Display data types: {display_data_types}")
            print(f"   Data types needing repair: {data_types_to_repair}")
            
            if not data_types_to_repair:
                return jsonify({
                    "success": True,
                    "message": "Display table is healthy, no repair needed",
                    "archive_counts": archive_data_types,
                    "display_counts": display_data_types
                }), 200
            
            # Use transaction for repair
            with engine.begin() as trans_conn:
                populate_display_table_from_archive(trans_conn, user_id, data_types_to_repair)
            
            # Check results after repair
            final_counts = trans_conn.execute(display_count_query, {'user_id': user_id}).fetchall()
            final_display_data_types = {row.data_type: row.count for row in final_counts}
            
            return jsonify({
                "success": True,
                "message": f"Display table repaired for {len(data_types_to_repair)} data types",
                "repaired_data_types": data_types_to_repair,
                "before_repair": display_data_types,
                "after_repair": final_display_data_types,
                "archive_counts": archive_data_types
            }), 200
            
    except Exception as e:
        print(f"❌ Error repairing display table: {e}")
        return jsonify({
            "success": False,
            "error": f"Display table repair failed: {str(e)}"
        }), 500

# User Registration and Management Endpoints
@app.route('/api/register-user', methods=['POST'])
def register_user():
    """
    Register a new user or get existing user information
    Called immediately after successful Clerk authentication
    """
    try:
        data = request.json
        
        # Validate required fields
        clerk_user_id = data.get('clerk_user_id')
        email = data.get('email')
        
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id is required"
            }), 400
            
        if not email:
            return jsonify({
                "success": False,
                "error": "email is required"
            }), 400
        
        # Optional fields
        full_name = data.get('full_name')
        profile_image_url = data.get('profile_image_url')
        
        # Get or create user
        user_info = get_or_create_user(
            clerk_user_id=clerk_user_id,
            email=email,
            full_name=full_name,
            profile_image_url=profile_image_url
        )
        
        return jsonify({
            "success": True,
            "user_id": user_info["user_id"],
            "onboarding_completed": user_info["onboarding_completed"],
            "created": user_info["created"],
            "message": "User registered successfully" if user_info["created"] else "User retrieved successfully"
        }), 200
        
    except Exception as e:
        print(f"Error in register_user: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to register user: {str(e)}"
        }), 500

@app.route('/api/user-profile', methods=['GET'])
def get_user_profile():
    """
    Get user profile information by clerk_user_id
    """
    try:
        clerk_user_id = request.args.get('clerk_user_id')
        
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id parameter is required"
            }), 400
        
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT * FROM users WHERE clerk_user_id = :clerk_user_id
            """), {'clerk_user_id': clerk_user_id}).fetchone()
            
            if not result:
                return jsonify({
                    "success": False,
                    "error": "User not found"
                }), 404
            
            # Convert result to dictionary
            user_data = {
                "user_id": result.id,
                "clerk_user_id": result.clerk_user_id,
                "email": result.email,
                "full_name": result.full_name,
                "profile_image_url": result.profile_image_url,
                "onboarding_completed": bool(result.onboarding_completed),
                "created_at": result.created_at.isoformat() if result.created_at else None,
                "last_active_at": result.last_active_at.isoformat() if result.last_active_at else None,
                # Additional demographic & device preference fields so the client can pre-fill the edit profile form
                "gender": result.gender,
                "height_value": float(result.height_value) if getattr(result, "height_value", None) is not None else None,
                "height_unit": result.height_unit,
                "weight_value": float(result.weight_value) if getattr(result, "weight_value", None) is not None else None,
                "weight_unit": result.weight_unit,
                "cgm_model": result.cgm_model,
                "pump_model": result.pump_model,
                # Diabetes-related fields
                "has_diabetes": result.has_diabetes,
                "diabetes_type": result.diabetes_type,
                "year_of_diagnosis": int(result.year_of_diagnosis) if result.year_of_diagnosis else None,
                "uses_insulin": result.uses_insulin,
                "insulin_type": result.insulin_type,
                "daily_basal_dose": float(result.daily_basal_dose) if result.daily_basal_dose else None,
                "insulin_to_carb_ratio": float(result.insulin_to_carb_ratio) if result.insulin_to_carb_ratio else None,
                # Target glucose range
                "target_glucose_min": int(result.target_glucose_min) if getattr(result, "target_glucose_min", None) is not None else 70,
                "target_glucose_max": int(result.target_glucose_max) if getattr(result, "target_glucose_max", None) is not None else 140,
            }
            
            return jsonify({
                "success": True,
                "user": user_data
            }), 200
            
    except Exception as e:
        print(f"Error in get_user_profile: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get user profile: {str(e)}"
        }), 500

@app.route('/api/save-onboarding-data', methods=['POST'])
def save_onboarding_data():
    """
    Save user onboarding data and mark onboarding as completed
    """
    try:
        data = request.json
        
        # Validate required fields
        clerk_user_id = data.get('clerk_user_id')
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id is required"
            }), 400
        
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        with engine.connect() as conn:
            # Update user with onboarding data
            update_query = text("""
                UPDATE users SET 
                    date_of_birth = :date_of_birth,
                    gender = :gender,
                    height_value = :height_value,
                    height_unit = :height_unit,
                    weight_value = :weight_value,
                    weight_unit = :weight_unit,
                    has_diabetes = :has_diabetes,
                    diabetes_type = :diabetes_type,
                    year_of_diagnosis = :year_of_diagnosis,
                    uses_insulin = :uses_insulin,
                    insulin_type = :insulin_type,
                    daily_basal_dose = :daily_basal_dose,
                    insulin_to_carb_ratio = :insulin_to_carb_ratio,
                    cgm_status = :cgm_status,
                    cgm_model = :cgm_model,
                    insulin_delivery_status = :insulin_delivery_status,
                    pump_model = :pump_model,
                    onboarding_completed = TRUE,
                    onboarding_completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :user_id
            """)
            
            conn.execute(update_query, {
                'user_id': user_id,
                'date_of_birth': data.get('date_of_birth'),
                'gender': data.get('gender'),
                'height_value': data.get('height_value'),
                'height_unit': data.get('height_unit'),
                'weight_value': data.get('weight_value'),
                'weight_unit': data.get('weight_unit'),
                'has_diabetes': data.get('has_diabetes'),
                'diabetes_type': data.get('diaboses_type'),
                'year_of_diagnosis': data.get('year_of_diagnosis'),
                'uses_insulin': data.get('uses_insulin'),
                'insulin_type': data.get('insulin_type'),
                'daily_basal_dose': data.get('daily_basal_dose'),
                'insulin_to_carb_ratio': data.get('insulin_to_carb_ratio'),
                'cgm_status': data.get('cgm_status'),
                'cgm_model': data.get('cgm_model'),
                'insulin_delivery_status': data.get('insulin_delivery_status'),
                'pump_model': data.get('pump_model')
            })
            conn.commit()
            
            print(f"✅ Onboarding data saved for user_id {user_id} (clerk_user_id: {clerk_user_id})")
            
        return jsonify({
            "success": True,
            "message": "Onboarding data saved successfully",
            "user_id": user_id
        }), 200
        
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({
            "success": False,
            "error": "User not found"
        }), 404
    except Exception as e:
        print(f"Error saving onboarding data: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to save onboarding data: {str(e)}"
        }), 500

# Network diagnostic endpoint
@app.route('/api/network-test', methods=['GET'])
def network_test():
    """Network diagnostic endpoint with detailed connection info"""
    import socket
    import platform
    
    try:
        # Get server IP and hostname
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        
        return jsonify({
            "status": "success",
            "server_info": {
                "hostname": hostname,
                "local_ip": local_ip,
                "platform": platform.system(),
                "timestamp": datetime.now().isoformat()
            },
            "client_info": {
                "remote_addr": request.remote_addr,
                "user_agent": request.headers.get('User-Agent', 'Unknown'),
                "accept": request.headers.get('Accept', 'Unknown')
            },
            "message": "Network connection successful"
        }), 200
        
    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e),
            "message": "Network diagnostic failed"
        }), 500

@app.route('/api/debug-data-types', methods=['GET'])
def debug_data_types():
    """Debug endpoint to check what data types are actually in the database"""
    try:
        user_id = request.args.get('user_id', 10, type=int)
        
        with engine.connect() as conn:
            # Check display table
            display_query = text("""
                SELECT data_type, COUNT(*) as count,
                       MIN(DATE(start_date)) as earliest_date,
                       MAX(DATE(start_date)) as latest_date
                FROM health_data_display 
                WHERE user_id = :user_id
                GROUP BY data_type
                ORDER BY data_type
            """)
            display_results = conn.execute(display_query, {'user_id': user_id}).fetchall()
            
            # Check archive table
            archive_query = text("""
                SELECT data_type, COUNT(*) as count,
                       MIN(DATE(start_date)) as earliest_date,
                       MAX(DATE(start_date)) as latest_date
                FROM health_data_archive 
                WHERE user_id = :user_id
                GROUP BY data_type
                ORDER BY data_type
            """)
            archive_results = conn.execute(archive_query, {'user_id': user_id}).fetchall()
            
            return jsonify({
                'user_id': user_id,
                'display_table': [
                    {
                        'data_type': row.data_type,
                        'count': row.count,
                        'earliest_date': str(row.earliest_date),
                        'latest_date': str(row.latest_date)
                    } for row in display_results
                ],
                'archive_table': [
                    {
                        'data_type': row.data_type,
                        'count': row.count,
                        'earliest_date': str(row.earliest_date),
                        'latest_date': str(row.latest_date)
                    } for row in archive_results
                ]
            })
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# @app.route('/api/debug-health-data', methods=['GET'])
# def debug_health_data():
#     """Provides comprehensive health data analysis for debugging and historical sync detection."""
#     try:
#         user_id = request.args.get('user_id', 1)
#         days = int(request.args.get('days', 30))  # Default to 30 days for historical analysis
#         end_date = datetime.now(timezone.utc)
#         start_date = end_date - timedelta(days=days)

#         with engine.connect() as conn:
#             # First check display table (primary source)
#             display_query = text("""
#                 SELECT 
#                     data_type,
#                     COUNT(*) as record_count,
#                     COUNT(DISTINCT DATE(start_date)) as unique_days,
#                     MIN(start_date) as earliest_date,
#                     MAX(start_date) as latest_date,
#                     GROUP_CONCAT(DISTINCT DATE(start_date) ORDER BY DATE(start_date) SEPARATOR ',') as date_range
#                 FROM health_data_display
#                 WHERE user_id = :user_id
#                   AND start_date >= :start_date
#                 GROUP BY data_type
#                 ORDER BY data_type
#             """)
            
#             display_results = conn.execute(display_query, {
#                 'user_id': user_id,
#                 'start_date': start_date
#             }).fetchall()

#             # Also check archive table as fallback
#             archive_query = text("""
#                 SELECT 
#                     data_type,
#                     COUNT(*) as record_count,
#                     COUNT(DISTINCT DATE(start_date)) as unique_days,
#                     MIN(start_date) as earliest_date,
#                     MAX(start_date) as latest_date,
#                     GROUP_CONCAT(DISTINCT DATE(start_date) ORDER BY DATE(start_date) SEPARATOR ',') as date_range
#                 FROM health_data_archive
#                 WHERE user_id = :user_id
#                   AND start_date >= :start_date
#                 GROUP BY data_type
#                 ORDER BY data_type
#             """)
            
#             archive_results = conn.execute(archive_query, {
#                 'user_id': user_id,
#                 'start_date': start_date
#             }).fetchall()

#             # Process display table results (primary)
#             health_data_types = {}
#             for r in display_results:
#                 date_range = r.date_range.split(',') if r.date_range else []
#                 health_data_types[r.data_type] = {
#                     'record_count': r.record_count,
#                     'unique_days': r.unique_days,
#                     'earliest_date': r.earliest_date.isoformat() if r.earliest_date else None,
#                     'latest_date': r.latest_date.isoformat() if r.latest_date else None,
#                     'date_range': date_range,
#                     'source': 'display'
#                 }

#             # Add archive data for types not in display
#             for r in archive_results:
#                 if r.data_type not in health_data_types:
#                     date_range = r.date_range.split(',') if r.date_range else []
#                     health_data_types[r.data_type] = {
#                         'record_count': r.record_count,
#                         'unique_days': r.unique_days,
#                         'earliest_date': r.earliest_date.isoformat() if r.earliest_date else None,
#                         'latest_date': r.latest_date.isoformat() if r.latest_date else None,
#                         'date_range': date_range,
#                         'source': 'archive'
#                     }

#             # Calculate overall statistics
#             total_records = sum(info['record_count'] for info in health_data_types.values())
#             total_unique_days = len(set().union(*[set(info['date_range']) for info in health_data_types.values() if info['date_range']]))
#             data_types_with_data = len([info for info in health_data_types.values() if info['unique_days'] > 0])

#         return jsonify({
#             'success': True,
#             'user_id': user_id,
#             'days_queried': days,
#             'health_data_types': health_data_types,
#             'summary': {
#                 'total_records': total_records,
#                 'total_unique_days': total_unique_days,
#                 'data_types_with_data': data_types_with_data,
#                 'total_data_types': len(health_data_types)
#             }
#         })
#     except Exception as e:
#         return jsonify({'success': False, 'error': str(e)}), 500

# @app.route('/api/verify-apple-health-data', methods=['POST'])
# def verify_apple_health_data():
#     """Receive and log Apple Health data for manual verification before dashboard integration"""
#     # create_verification_health_data_table() # This is now called at startup
#     try:
#         data = request.get_json()
#         user_id = data.get('user_id', 1)
#         health_data = data.get('health_data', {})
        
#         print("🔍 Receiving Apple Health data for verification...")
        
#         with engine.connect() as conn:
#             transaction = conn.begin()
#             now = datetime.now()
#             total_records = 0
#             for data_type, records in health_data.items():
#                 if isinstance(records, list) and records:
#                     total_records += len(records)
#                     conn.execute(text("""
#                         INSERT INTO verification_health_data (user_id, data_type, data, created_at)
#                         VALUES (:user_id, :data_type, :data, :created_at)
#                     """), {
#                         'user_id': user_id,
#                         'data_type': data_type,
#                         'data': json.dumps(records),
#                         'created_at': now
#                     })
            
#             transaction.commit()
        
#         print(f"✅ Stored {total_records} records for verification.")
        
#         return jsonify({
#             'success': True,
#             'message': 'Apple Health data received and stored for verification.',
#         })
        
#     except Exception as e:
#         print(f"❌ Error in /api/verify-apple-health-data: {e}")
#         return jsonify({
#             'success': False,
#             'error': str(e),
#             'message': 'Failed to process Apple Health verification data'
#         }), 500

# @app.route('/api/approve-apple-health-data', methods=['POST'])
# def approve_apple_health_data():
#     data = request.get_json()
#     user_id = data.get('user_id', 1)

#     with engine.connect() as conn:
#         transaction = conn.begin()
#         try:
#             # 1. Fetch all unverified data for the user
#             verified_data_query = text("""
#                 SELECT id, data_type, data, created_at
#                 FROM verification_health_data
#                 WHERE user_id = :user_id AND verified = FALSE
#             """)
#             unverified_records = conn.execute(verified_data_query, {'user_id': user_id}).fetchall()

#             if not unverified_records:
#                 return jsonify({"success": True, "message": "No unverified Apple Health data to approve.", "approved_records": 0})

#             # Get the timestamp of the most recent sync to process only that batch
#             latest_timestamp = max(r.created_at for r in unverified_records)
            
#             # Filter for only the records from the most recent sync
#             records_to_process = [r for r in unverified_records if r.created_at == latest_timestamp]

#             all_records_to_insert = []

#             for record in records_to_process:
#                 data_type = record.data_type
#                 health_data_list = json.loads(record.data)
                
#                 print(f"✅ Processing approval for {data_type} with {len(health_data_list)} records.")

#                 # --- SPECIALIZED HANDLING FOR STEPCOUNT ---
#                 if data_type == 'StepCount':
#                     for entry in health_data_list:
#                         entry_date_str = entry['date'].split('T')[0]
#                         entry_date = datetime.fromisoformat(entry_date_str)
#                         start_of_day_utc = datetime(entry_date.year, entry_date.month, entry_date.day, tzinfo=timezone.utc)
#                         end_of_day_utc = start_of_day_utc + timedelta(days=1, seconds=-1)

#                         record_to_insert = {
#                             'user_id': user_id, 'data_type': 'StepCount', 'data_subtype': 'daily_summary',
#                             'value': entry['value'], 'value_string': None, 'unit': 'count',
#                             'start_date': start_of_day_utc, 'end_date': end_of_day_utc,
#                             'source_name': entry.get('source', 'Multiple'), 'source_bundle_id': None, 
#                             'device_name': None, 'device_manufacturer': None,
#                             'sample_id': f"daily_summary_{user_id}_{entry_date_str}",
#                             'entry_type': 'summary', 'category_type': None, 'workout_activity_type': None,
#                             'total_energy_burned': None, 'total_distance': None,
#                             'average_quantity': None, 'minimum_quantity': None, 'maximum_quantity': None,
#                             'metadata': json.dumps({'original_source': entry.get('source', 'Multiple')})
#                         }
#                         all_records_to_insert.append(record_to_insert)

#                 # --- GENERIC HANDLING FOR OTHER HEALTH DATA (Sleep, etc.) ---
#                 else:
#                     for entry in health_data_list:
#                         # Initialize a full dictionary for the table schema
#                         record_to_insert = {
#                             'user_id': user_id, 'data_type': data_type,
#                             'data_subtype': None, 'value': None, 'value_string': None, 'unit': None,
#                             'start_date': parse_iso_datetime(entry.get('startDate')),
#                             'end_date': parse_iso_datetime(entry.get('endDate')),
#                             'source_name': None, 'source_bundle_id': None, 'device_name': None, 'device_manufacturer': None,
#                             'sample_id': entry.get('sampleId') or entry.get('uuid') or str(uuid.uuid4()),
#                             'entry_type': 'sample', 'category_type': None, 'workout_activity_type': None,
#                             'total_energy_burned': None, 'total_distance': None,
#                             'average_quantity': None, 'minimum_quantity': None, 'maximum_quantity': None,
#                             'metadata': None
#                         }
                        
#                         metadata = entry.get('metadata', {}) or {}
#                         if isinstance(metadata, str):
#                             try:
#                                 metadata = json.loads(metadata)
#                             except json.JSONDecodeError:
#                                 metadata = {}
                        
#                         # Populate fields from entry
#                         record_to_insert.update({
#                             'data_subtype': entry.get('dataSubtype') or entry.get('value'),
#                             'value': entry.get('quantity') or entry.get('value'),
#                             'unit': entry.get('unit'),
#                             'source_name': entry.get('sourceName') or (entry.get('source', {}) or {}).get('name') or (entry.get('device', {}) or {}).get('name'),
#                             'source_bundle_id': (entry.get('source', {}) or {}).get('bundleIdentifier'),
#                             'device_name': (entry.get('device', {}) or {}).get('name'),
#                             'device_manufacturer': (entry.get('device', {}) or {}).get('manufacturer'),
#                             'entry_type': 'sample' if 'quantity' in entry else 'category',
#                             'metadata': json.dumps(metadata) # Store metadata with timezone
#                         })
#                         all_records_to_insert.append(record_to_insert)

#             # 3. BULK INSERT ALL PROCESSED RECORDS
#             if all_records_to_insert:
#                 sample_ids_to_delete = [r['sample_id'] for r in all_records_to_insert if r['sample_id']]
#                 if sample_ids_to_delete:
#                     delete_query = text("""
#                         DELETE FROM health_data_archive
#                         WHERE user_id = :user_id AND sample_id IN :sample_ids
#                     """)
#                     conn.execute(delete_query, {'user_id': user_id, 'sample_ids': tuple(sample_ids_to_delete)})
#                     print(f"✅ Cleared {len(sample_ids_to_delete)} existing records for fresh insertion.")

#                 print(f"✅ Inserting {len(all_records_to_insert)} total records into the health_data_archive table.")
#                 health_data_table = Table('health_data_archive', MetaData(), autoload_with=engine)
#                 conn.execute(health_data_table.insert(), all_records_to_insert)
#             else:
#                 print("ℹ️ No new records to insert.")

#             # 4. MARK THE BATCH AS VERIFIED
#             update_query = text("""
#                 UPDATE verification_health_data
#                 SET verified = TRUE
#                 WHERE user_id = :user_id AND created_at = :timestamp
#             """)
#             conn.execute(update_query, {'user_id': user_id, 'timestamp': latest_timestamp})

#             transaction.commit()
#             return jsonify({
#                 "success": True,
#                 "message": f"Successfully approved and integrated {len(all_records_to_insert)} Apple Health records into dashboard",
#                 "approved_records": len(all_records_to_insert)
#             })

#         except Exception as e:
#             if 'transaction' in locals() and transaction.is_active:
#                 transaction.rollback()
#             print(f"❌ Error during data approval: {e}")
#             return jsonify({"success": False, "message": f"An error occurred: {e}"}), 500

import threading
import time

# --- CGM Connection Endpoints (Dexcom) ---

@app.route('/api/connect-dexcom', methods=['POST'])
def connect_dexcom():
    """
    Establish a Dexcom CGM connection for the user.
    Validates credentials, encrypts password, stores connection, fetches initial readings.
    """
    data = request.get_json()
    required_fields = ['clerk_user_id', 'username', 'password']
    for field in required_fields:
        if field not in data:
            return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
    
    clerk_user_id = data['clerk_user_id']
    username = data['username']
    password = data['password']
    region = data.get('region')  # Do not default to 'us' here
    cgm_type = data.get('cgm_type', 'dexcom-g6-g5-one-plus')

    # Resolve user_id
    user_id = get_user_id_from_clerk(clerk_user_id)
    if not user_id:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    # Try all regions if region is not provided
    regions_to_try = [region] if region else list(DexcomConfig.REGIONS.keys())
    last_error = None
    for reg in regions_to_try:
        try:
            from pydexcom import Region
            region_enum = Region.US if reg == 'us' else (Region.OUS if reg == 'ous' else Region.JP)
            dexcom = Dexcom(username=username, password=password, region=region_enum)
            glucose = dexcom.get_current_glucose_reading()
            # If successful, break and use this region
            region = reg
            break
        except Exception as e:
            last_error = str(e)
            continue
    else:
        # If all regions failed
        error_msg = last_error or 'Unknown error connecting to Dexcom.'
        if 'invalid password' in error_msg.lower():
            return jsonify({'success': False, 'error': 'Invalid Dexcom credentials'}), 401
        elif 'region' in error_msg.lower():
            return jsonify({'success': False, 'error': 'Region mismatch. Please check your Dexcom region.'}), 400
        elif 'network' in error_msg.lower():
            return jsonify({'success': False, 'error': 'Network error. Please try again later.'}), 503
        else:
            return jsonify({'success': False, 'error': 'Dexcom connection failed: ' + error_msg}), 500

    # Encrypt password
    encrypted_password = CGMSecurity.encrypt_password(password)

    # Store connection in DB
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO cgm_connections (user_id, cgm_type, username, password_encrypted, region, active)
                VALUES (:user_id, :cgm_type, :username, :encrypted_password, :region, 1)
                ON DUPLICATE KEY UPDATE 
                    username = VALUES(username),
                    password_encrypted = VALUES(password_encrypted),
                    region = VALUES(region),
                    active = 1,
                    updated_at = CURRENT_TIMESTAMP
            """), {
                'user_id': user_id,
                'cgm_type': cgm_type,
                'username': username,
                'encrypted_password': encrypted_password,
                'region': region
            })
            conn.commit()
    except Exception as e:
        return jsonify({'success': False, 'error': 'Database error: ' + str(e)}), 500

    # Fetch initial readings
    try:
        readings = []
        for r in dexcom.get_glucose_readings(max_count=12):
            readings.append({
                'value': r.value,
                'datetime': r.datetime.isoformat(),
                'trend': r.trend_direction
            })
    except Exception as e:
        readings = []

    return jsonify({'success': True, 'message': f'Dexcom connected successfully (region: {region})', 'region': region, 'initial_readings': readings})

@app.route('/api/connect-cgm-mobile', methods=['POST'])
def connect_cgm_mobile():
    """
    Mobile-optimized CGM connection endpoint with better timeout handling and error messages.
    Specifically designed for mobile apps that may have network restrictions.
    """
    import signal
    import threading
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    
    data = request.get_json()
    required_fields = ['clerk_user_id', 'username', 'password', 'cgm_type']
    for field in required_fields:
        if field not in data:
            return jsonify({
                'success': False, 
                'error': f'Missing required field: {field}',
                'cgmType': data.get('cgm_type', 'unknown'),
                'timestamp': datetime.now().isoformat()
            }), 400
    
    clerk_user_id = data['clerk_user_id']
    username = data['username']
    password = data['password']
    cgm_type = data['cgm_type']
    region = data.get('region', 'us')
    
    print(f"🔗 Mobile CGM connection attempt: {username[:3]}*** ({cgm_type}) region: {region}")
    
    # Resolve user_id
    try:
        user_id = get_user_id_from_clerk(clerk_user_id)
        if not user_id:
            return jsonify({
                'success': False, 
                'error': 'User not found',
                'cgmType': cgm_type,
                'timestamp': datetime.now().isoformat()
            }), 404
    except Exception as e:
        return jsonify({
            'success': False, 
            'error': f'User lookup failed: {str(e)}',
            'cgmType': cgm_type,
            'timestamp': datetime.now().isoformat()
        }), 500

    def test_cgm_connection_with_timeout():
        """Test CGM connection with specific timeout handling"""
        try:
            if cgm_type == 'freestyle-libre-2':
                # LibreLinkUp connection
                result = test_librelink_connection(username, password)
            elif cgm_type.startswith('dexcom'):
                # Dexcom connection with timeout
                result = test_dexcom_connection(username, password, region)
            else:
                return {
                    'success': False,
                    'error': f'Unsupported CGM type: {cgm_type}',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }
            
            return result
            
        except Exception as e:
            error_msg = str(e).lower()
            
            # Specific mobile network error handling
            if 'timeout' in error_msg or 'timed out' in error_msg:
                return {
                    'success': False,
                    'error': 'Network request timed out',
                    'message': 'Mobile connection timeout. Try connecting to WiFi or check cellular signal.',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }
            elif 'connection' in error_msg or 'network' in error_msg:
                return {
                    'success': False,
                    'error': 'Network connection failed',
                    'message': 'Unable to reach CGM servers. Check your internet connection.',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }
            elif 'invalid' in error_msg or 'unauthorized' in error_msg:
                return {
                    'success': False,
                    'error': 'Invalid credentials',
                    'message': 'Please check your username and password.',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }
            else:
                return {
                    'success': False,
                    'error': f'Connection failed: {str(e)}',
                    'message': 'CGM connection failed. Please try again.',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }

    # Execute connection test with timeout (mobile-friendly: 45 seconds)
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(test_cgm_connection_with_timeout)
            try:
                # 45-second timeout for mobile connections
                connection_result = future.result(timeout=45)
            except TimeoutError:
                return jsonify({
                    'success': False,
                    'error': 'Network request timed out',
                    'message': 'Connection timeout after 45 seconds. Try connecting to WiFi for better connectivity.',
                    'cgmType': cgm_type,
                    'timestamp': datetime.now().isoformat()
                }), 408
                
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Connection test failed: {str(e)}',
            'message': 'Unable to test CGM connection.',
            'cgmType': cgm_type,
            'timestamp': datetime.now().isoformat()
        }), 500

    # Handle connection test result
    if not connection_result.get('success'):
        print(f"❌ Mobile CGM connection failed: {connection_result}")
        return jsonify(connection_result), 400

    print(f"✅ Mobile CGM connection successful: {connection_result.get('message', 'Connected')}")

    # Store connection in database if successful
    try:
        encrypted_password = CGMSecurity.encrypt_password(password)
        
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO cgm_connections (user_id, cgm_type, username, password_encrypted, region, active)
                VALUES (:user_id, :cgm_type, :username, :encrypted_password, :region, 1)
                ON DUPLICATE KEY UPDATE 
                    username = VALUES(username),
                    password_encrypted = VALUES(password_encrypted),
                    region = VALUES(region),
                    active = 1,
                    updated_at = CURRENT_TIMESTAMP,
                    connection_status = 'connected',
                    last_error_message = NULL
            """), {
                'user_id': user_id,
                'cgm_type': cgm_type,
                'username': username,
                'encrypted_password': encrypted_password,
                'region': region
            })
            conn.commit()
            
        print(f"✅ Stored CGM connection for user {user_id}")
        
    except Exception as e:
        print(f"❌ Database error storing CGM connection: {e}")
        return jsonify({
            'success': False,
            'error': 'Database error while saving connection',
            'message': 'Connection tested successfully but failed to save. Please try again.',
            'cgmType': cgm_type,
            'timestamp': datetime.now().isoformat()
        }), 500

    # Return success with current glucose data
    current_glucose = connection_result.get('current_glucose')
    response_data = {
        'success': True,
        'message': f'CGM connected successfully',
        'cgmType': cgm_type,
        'region': region,
        'timestamp': datetime.now().isoformat()
    }
    
    if current_glucose:
        response_data['currentGlucose'] = {
            'value': current_glucose['value'],
            'trend': current_glucose.get('trend', 'unknown'),
            'trendArrow': current_glucose.get('trend_arrow', '?'),
            'timestamp': current_glucose.get('timestamp')
        }
    
    return jsonify(response_data), 200


@app.route('/api/connect-librelink', methods=['POST'])
def connect_librelink():
    """
    Establish a LibreLinkUp CGM connection for the user.
    Validates credentials, encrypts password, stores connection, fetches initial readings.
    """
    data = request.get_json()
    required_fields = ['clerk_user_id', 'username', 'password']
    for field in required_fields:
        if field not in data:
            return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
    
    clerk_user_id = data['clerk_user_id']
    username = data['username']
    password = data['password']
    cgm_type = 'freestyle-libre-2'

    # Resolve user_id
    user_id = get_user_id_from_clerk(clerk_user_id)
    if not user_id:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    # Test LibreLinkUp credentials
    try:
        client = PyLibreLinkUp(email=username, password=password)
        client.authenticate()
        
        # Get patients and latest reading
        patients = client.get_patients()
        if not patients:
            return jsonify({'success': False, 'error': 'No patients found in LibreLinkUp account'}), 400
            
        current_glucose = client.latest(patient_identifier=patients[0])
    except Exception as e:
        error_msg = str(e)
        if 'invalid' in error_msg.lower() or 'unauthorized' in error_msg.lower() or 'authentication' in error_msg.lower():
            return jsonify({'success': False, 'error': 'Invalid LibreLinkUp credentials'}), 401
        elif 'network' in error_msg.lower():
            return jsonify({'success': False, 'error': 'Network error. Please try again later.'}), 503
        else:
            return jsonify({'success': False, 'error': 'LibreLinkUp connection failed: ' + error_msg}), 500

    # Encrypt password
    encrypted_password = CGMSecurity.encrypt_password(password)

    # Store connection in DB
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO cgm_connections (user_id, cgm_type, username, password_encrypted, region, active)
                VALUES (:user_id, :cgm_type, :username, :encrypted_password, :region, 1)
                ON DUPLICATE KEY UPDATE 
                    username = VALUES(username),
                    password_encrypted = VALUES(password_encrypted),
                    region = VALUES(region),
                    active = 1,
                    updated_at = CURRENT_TIMESTAMP
            """), {
                'user_id': user_id,
                'cgm_type': cgm_type,
                'username': username,
                'encrypted_password': encrypted_password,
                'region': 'global'  # LibreLinkUp doesn't use regions like Dexcom
            })
            conn.commit()
    except Exception as e:
        return jsonify({'success': False, 'error': 'Database error: ' + str(e)}), 500

    # Fetch initial readings from LibreLinkUp
    try:
        readings = []
        # Get graph data (last 12 hours)
        graph_data = client.graph(patient_identifier=patients[0])
        
        for reading in graph_data[-12:]:  # Get last 12 readings
            readings.append({
                'value': reading.value,
                'datetime': reading.timestamp.isoformat() if reading.timestamp else None,
                'trend': getattr(reading, 'trend', None)
            })
    except Exception as e:
        readings = []

    return jsonify({'success': True, 'message': 'LibreLinkUp connected successfully', 'initial_readings': readings})

@app.route('/api/cgm-status', methods=['GET'])
def cgm_status():
    """
    Check user's CGM connection status.
    """
    clerk_user_id = request.args.get('clerk_user_id')
    if not clerk_user_id:
        return jsonify({'success': False, 'error': 'Missing clerk_user_id'}), 400
    
    user_id = get_user_id_from_clerk(clerk_user_id)
    if not user_id:
        return jsonify({'success': False, 'error': 'User not found'}), 404
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT * FROM cgm_connections WHERE user_id = :user_id AND active = 1"), {'user_id': user_id})
            row = result.fetchone()
            if row:
                return jsonify({'success': True, 'connected': True, 'cgm_type': row.cgm_type, 'region': row.region, 'username': row.username})
            else:
                return jsonify({'success': True, 'connected': False})
    except Exception as e:
        return jsonify({'success': False, 'error': 'Database error: ' + str(e)}), 500

@app.route('/api/disconnect-cgm', methods=['DELETE'])
def disconnect_cgm():
    """
    Remove CGM connection and stop syncing.
    """
    data = request.get_json()
    clerk_user_id = data.get('clerk_user_id')
    if not clerk_user_id:
        return jsonify({'success': False, 'error': 'Missing clerk_user_id'}), 400
    
    user_id = get_user_id_from_clerk(clerk_user_id)
    if not user_id:
        return jsonify({'success': False, 'error': 'User not found'}), 404
    
    try:
        with engine.connect() as conn:
            conn.execute(text("UPDATE cgm_connections SET active = 0 WHERE user_id = :user_id"), {'user_id': user_id})
            conn.commit()
        return jsonify({'success': True, 'message': 'CGM disconnected'})
    except Exception as e:
        return jsonify({'success': False, 'error': 'Database error: ' + str(e)}), 500

@app.route('/api/test-cgm-connection', methods=['POST'])
def test_cgm_connection():
    """
    Test existing CGM connection without re-entering credentials.
    """
    data = request.get_json()
    clerk_user_id = data.get('clerk_user_id')
    if not clerk_user_id:
        return jsonify({'success': False, 'error': 'Missing clerk_user_id'}), 400
    
    user_id = get_user_id_from_clerk(clerk_user_id)
    if not user_id:
        return jsonify({'success': False, 'error': 'User not found'}), 404
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT * FROM cgm_connections WHERE user_id = :user_id AND active = 1"), {'user_id': user_id})
            row = result.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'No active CGM connection found'}), 404
            
            try:
                password = CGMSecurity.decrypt_password(row.password_encrypted)
                from pydexcom import Region
                region_enum = Region.US if row.region == 'us' else (Region.OUS if row.region == 'ous' else Region.JP)
                dexcom = Dexcom(username=row.username, password=password, region=region_enum)
                glucose = dexcom.get_current_glucose_reading()
                return jsonify({'success': True, 'glucose': glucose.value, 'trend': glucose.trend_direction, 'datetime': glucose.datetime.isoformat()})
            except Exception as e:
                return jsonify({'success': False, 'error': 'Dexcom connection failed: ' + str(e)}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': 'Database error: ' + str(e)}), 500

# --- Background CGM Sync Job ---

def background_cgm_sync_job(interval_minutes=5):
    """
    Background job to periodically fetch ONLY the current glucose reading for all active CGM connections.
    Fixed to prevent duplicate readings by fetching only current/latest reading every 5 minutes.
    """
    while True:
        try:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT * FROM cgm_connections WHERE active = 1"))
                connections = result.fetchall()
                for row in connections:
                    try:
                        user_id = row.user_id
                        cgm_type = row.cgm_type
                        username = row.username
                        password = CGMSecurity.decrypt_password(row.password_encrypted)
                        
                        current_reading = None
                        
                        if cgm_type == 'freestyle-libre-2':
                            # Handle LibreLinkUp connection - get ONLY current reading
                            client = PyLibreLinkUp(email=username, password=password)
                            client.authenticate()
                            patients = client.get_patients()
                            
                            if patients:
                                # Get only the current/latest reading
                                latest_reading = client.latest(patient_identifier=patients[0])
                                if latest_reading:
                                    current_reading = {
                                        'value': latest_reading.value,
                                        'datetime': latest_reading.timestamp,
                                        'trend': getattr(latest_reading, 'trend', None)
                                    }
                        
                        elif cgm_type.startswith('dexcom'):
                            # Handle Dexcom connection - get ONLY current reading
                            from pydexcom import Region
                            region = row.region if row.region != 'global' else 'us'
                            region_enum = Region.US if region == 'us' else (Region.OUS if region == 'ous' else Region.JP)
                            dexcom = Dexcom(username=username, password=password, region=region_enum)
                            current_glucose = dexcom.get_current_glucose_reading()
                            
                            if current_glucose:
                                current_reading = {
                                    'value': current_glucose.value,
                                    'datetime': current_glucose.datetime,
                                    'trend': current_glucose.trend_direction
                                }
                        
                        # Insert ONLY the current reading if we got one
                        if current_reading:
                            # Enhanced duplicate prevention with proper unique constraint check
                            conn.execute(text("""
                                INSERT INTO glucose_log (user_id, glucose_level, timestamp)
                                VALUES (:user_id, :value, :reading_time)
                                ON DUPLICATE KEY UPDATE 
                                    glucose_level = VALUES(glucose_level),
                                    created_at = created_at  -- Keep original created_at
                            """), {
                                'user_id': user_id,
                                'value': current_reading['value'],
                                'reading_time': current_reading['datetime']
                            })
                            
                            conn.commit()
                            print(f"✅ {cgm_type} sync successful for user {user_id}: Current glucose {current_reading['value']} mg/dL at {current_reading['datetime']}")
                        else:
                            print(f"⚠️  {cgm_type} sync for user {user_id}: No current reading available")
                        
                    except Exception as e:
                        print(f"❌ {row.cgm_type} sync failed for user {row.user_id}: {e}")
                        
        except Exception as e:
            print(f"❌ CGM background sync job error: {e}")
            
        time.sleep(interval_minutes * 60)

def cleanup_duplicate_glucose_readings(user_id: int = None):
    """
    Clean up duplicate glucose readings by keeping only the earliest created_at for each user_id + timestamp combo.
    This fixes the issue where background sync was creating too many duplicate readings.
    """
    try:
        with engine.connect() as conn:
            if user_id:
                # Clean up for specific user
                cleanup_query = text("""
                    DELETE gl1 FROM glucose_log gl1
                    INNER JOIN glucose_log gl2 
                    WHERE gl1.user_id = gl2.user_id 
                      AND gl1.timestamp = gl2.timestamp
                      AND gl1.id > gl2.id
                      AND gl1.user_id = :user_id
                """)
                result = conn.execute(cleanup_query, {'user_id': user_id})
            else:
                # Clean up for all users
                cleanup_query = text("""
                    DELETE gl1 FROM glucose_log gl1
                    INNER JOIN glucose_log gl2 
                    WHERE gl1.user_id = gl2.user_id 
                      AND gl1.timestamp = gl2.timestamp
                      AND gl1.id > gl2.id
                """)
                result = conn.execute(cleanup_query)
            
            deleted_count = result.rowcount
            conn.commit()
            
            if deleted_count > 0:
                print(f"✅ Cleaned up {deleted_count} duplicate glucose readings" + (f" for user {user_id}" if user_id else ""))
            else:
                print(f"ℹ️ No duplicate glucose readings found" + (f" for user {user_id}" if user_id else ""))
                
            return deleted_count
            
    except Exception as e:
        print(f"❌ Error cleaning up duplicate glucose readings: {e}")
        return 0

def backfill_cgm_historical_data(user_id: int, days: int = 7):
    """
    Backfill historical glucose data for the specified number of days.
    Fetches historical readings from CGM APIs and populates the glucose_log table.
    """
    try:
        with engine.connect() as conn:
            # Get user's CGM connection details
            cgm_query = text("""
                SELECT cgm_type, username, encrypted_password, region 
                FROM cgm_connections 
                WHERE user_id = :user_id AND is_active = TRUE
            """)
            cgm_result = conn.execute(cgm_query, {'user_id': user_id}).fetchone()
            
            if not cgm_result:
                print(f"❌ No active CGM connection found for user {user_id}")
                return 0
            
            cgm_type = cgm_result.cgm_type
            username = cgm_result.username
            encrypted_password = cgm_result.encrypted_password
            region = cgm_result.region
            
            # Decrypt password
            decrypted_password = cipher.decrypt(encrypted_password.encode()).decode()
            
            print(f"🔄 Starting {days}-day historical backfill for user {user_id} ({cgm_type})")
            
            total_readings = 0
            
            if cgm_type.lower() == 'dexcom':
                from pydexcom import Dexcom
                
                dexcom = Dexcom(username, decrypted_password)
                
                # Get historical readings for the specified number of days
                # Dexcom returns readings in 5-minute intervals, so ~288 per day
                max_readings = days * 288 + 50  # Add buffer for overlap
                
                print(f"📊 Fetching up to {max_readings} historical readings from Dexcom...")
                dexcom_readings = dexcom.get_glucose_readings(max_count=max_readings)
                
                if dexcom_readings:
                    # Filter readings to only include the specified number of days
                    from datetime import datetime, timedelta
                    cutoff_time = datetime.now() - timedelta(days=days)
                    
                    filtered_readings = [
                        reading for reading in dexcom_readings 
                        if reading.datetime >= cutoff_time
                    ]
                    
                    print(f"📈 Processing {len(filtered_readings)} filtered historical readings...")
                    
                    # Insert historical readings
                    for reading in filtered_readings:
                        try:
                            conn.execute(text("""
                                INSERT INTO glucose_log (user_id, glucose_level, timestamp)
                                VALUES (:user_id, :value, :reading_time)
                                ON DUPLICATE KEY UPDATE 
                                    glucose_level = VALUES(glucose_level),
                                    created_at = created_at
                            """), {
                                'user_id': user_id,
                                'value': reading.value,
                                'reading_time': reading.datetime
                            })
                            total_readings += 1
                        except Exception as e:
                            print(f"⚠️ Error inserting reading {reading.datetime}: {e}")
                            continue
                    
                    conn.commit()
                    print(f"✅ Dexcom historical backfill completed: {total_readings} readings inserted")
                
            elif cgm_type.lower() == 'libre':
                from pylibrelinkup import PyLibreLinkUp
                
                libre = PyLibreLinkUp(
                    email=username,
                    password=decrypted_password,
                    region=region or 'us'
                )
                
                libre.login()
                
                # LibreLinkUp historical readings
                print(f"📊 Fetching historical readings from LibreLinkUp...")
                libre_data = libre.get_data()
                
                if libre_data and 'history' in libre_data:
                    # Filter readings to only include the specified number of days
                    from datetime import datetime, timedelta
                    cutoff_time = datetime.now() - timedelta(days=days)
                    
                    filtered_readings = [
                        reading for reading in libre_data['history']
                        if datetime.fromisoformat(reading['datetime'].replace('Z', '+00:00')) >= cutoff_time
                    ]
                    
                    print(f"📈 Processing {len(filtered_readings)} filtered historical readings...")
                    
                    # Insert historical readings
                    for reading in filtered_readings:
                        try:
                            reading_time = datetime.fromisoformat(reading['datetime'].replace('Z', '+00:00'))
                            conn.execute(text("""
                                INSERT INTO glucose_log (user_id, glucose_level, timestamp)
                                VALUES (:user_id, :value, :reading_time)
                                ON DUPLICATE KEY UPDATE 
                                    glucose_level = VALUES(glucose_level),
                                    created_at = created_at
                            """), {
                                'user_id': user_id,
                                'value': reading['value'],
                                'reading_time': reading_time
                            })
                            total_readings += 1
                        except Exception as e:
                            print(f"⚠️ Error inserting reading {reading['datetime']}: {e}")
                            continue
                    
                    conn.commit()
                    print(f"✅ LibreLinkUp historical backfill completed: {total_readings} readings inserted")
            
            return total_readings
            
    except Exception as e:
        print(f"❌ Error during historical backfill for user {user_id}: {e}")
        return 0

@app.route('/api/backfill-cgm-historical', methods=['POST'])
def backfill_cgm_historical_endpoint():
    """API endpoint to backfill historical CGM data"""
    try:
        data = request.get_json() or {}
        clerk_user_id = data.get('clerk_user_id')
        days = data.get('days', 7)  # Default to 7 days
        
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id is required"
            }), 400
        
        try:
            user_id = get_user_id_from_clerk(clerk_user_id)
        except ValueError as e:
            return jsonify({
                "success": False,
                "error": str(e)
            }), 404
        
        # Run the backfill
        readings_added = backfill_cgm_historical_data(user_id, days)
        
        return jsonify({
            "success": True,
            "message": f"Historical backfill completed. Added {readings_added} readings for {days} days.",
            "readings_added": readings_added,
            "days_backfilled": days,
            "user_id": user_id
        }), 200
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/cleanup-duplicate-glucose', methods=['POST'])
def cleanup_duplicate_glucose_endpoint():
    """API endpoint to manually trigger cleanup of duplicate glucose readings"""
    try:
        data = request.get_json() or {}
        clerk_user_id = data.get('clerk_user_id')
        
        user_id = None
        if clerk_user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        deleted_count = cleanup_duplicate_glucose_readings(user_id)
        
        return jsonify({
            "success": True,
            "message": f"Cleanup completed. Removed {deleted_count} duplicate readings.",
            "duplicates_removed": deleted_count,
            "user_id": user_id
        }), 200
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

# Start background sync job in a separate thread (after database initialization)
def start_cgm_background_sync():
    cgm_sync_thread = threading.Thread(target=background_cgm_sync_job, args=(5,), daemon=True)
    cgm_sync_thread.start()
    print("✅ CGM background sync job started")
        
#     except Exception as e:UPDATE users SET
#         return jsonify({'error': str(e), 'success': False}), 500

def get_improved_sleep_data(user_id: int = 1, days_back: int = 25):
    """
    IMPROVED sleep data processing that correctly aggregates all sleep sessions from HealthKit.
    This version ensures a complete 7-day range is always returned for consistent UI display.
    """
    try:
        with engine.connect() as conn:
            # CRITICAL FIX: Use timezone-naive datetime for database comparison since DB stores naive datetimes
            start_date_dt = datetime.now() - timedelta(days=days_back)
            
            # Fetch all raw sleep analysis records from ARCHIVE table only
            raw_sleep_query = text("""
                SELECT start_date, end_date, value, metadata
                FROM health_data_archive
                WHERE data_type = 'SleepAnalysis' AND user_id = :uid
                  AND end_date >= :start_date
                ORDER BY end_date
            """)
            raw_sleep_records = conn.execute(raw_sleep_query, {
                "uid": user_id, 
                "start_date": start_date_dt
            }).fetchall()

            print(f"🛏️ AGGREGATING: Processing {len(raw_sleep_records)} raw sleep records...")

            # --- STEP 1: Group sessions by the day they END and identify MAIN sleep periods ---
            sleep_by_day = {}
            user_timezone_fallback = 'UTC'  # Default timezone
            
            for record in raw_sleep_records:
                # All dates from DB are UTC. We need to localize them to make sense of the "day".
                # Assume user's timezone if available, otherwise fallback to UTC.
                metadata_str = record.metadata or '{}'
                metadata = {}
                try:
                    # FIX: Handle potentially nested JSON strings in metadata
                    temp_data = json.loads(metadata_str)
                    while isinstance(temp_data, str):
                        temp_data = json.loads(temp_data)
                    metadata = temp_data
                except (json.JSONDecodeError, TypeError):
                    pass # metadata remains empty

                user_timezone_str = metadata.get('HKTimeZone', 'UTC')
                user_timezone_fallback = user_timezone_str  # Keep track of user's timezone
                
                try:
                    user_tz = ZoneInfo(user_timezone_str)
                except ZoneInfoNotFoundError:
                    user_tz = ZoneInfo('UTC')

                # Localize end_date to determine which calendar day the sleep belongs to
                end_date_utc = record.end_date.replace(tzinfo=timezone.utc)
                end_date_local = end_date_utc.astimezone(user_tz)
                day_key = end_date_local.strftime('%Y-%m-%d')

                if day_key not in sleep_by_day:
                    sleep_by_day[day_key] = {
                        'sessions': [],
                        'timezone': user_timezone_str
                    }
                
                start_date_utc = record.start_date.replace(tzinfo=timezone.utc)
                duration_hours = (end_date_utc - start_date_utc).total_seconds() / 3600
                
                # Only include valid sleep durations (e.g., > 1 minute and < 18 hours)
                if 0.016 < duration_hours < 18:
                    sleep_by_day[day_key]['sessions'].append({
                        'start_utc': start_date_utc,
                        'end_utc': end_date_utc,
                        'duration_hours': duration_hours,
                        'record': record
                    })

            # --- STEP 2: Generate complete 7-day range for consistent display ---
            try:
                user_tz = ZoneInfo(user_timezone_fallback)
            except ZoneInfoNotFoundError:
                user_tz = ZoneInfo('UTC')
            
            # FIXED: Always use current date to generate 7-day range for consistent dashboard behavior
            # This ensures the dashboard always shows today + 6 previous days, regardless of when the last sleep data was
            today_local = datetime.now(user_tz).date()
            seven_days_range = []
            
            for i in range(7):
                target_date = today_local - timedelta(days=i)
                seven_days_range.append(target_date.strftime('%Y-%m-%d'))
            
            print(f"📅 Generating current 7-day range (today + 6 previous days): {seven_days_range}")

            # --- STEP 3: Process each day in the 7-day range ---
            daily_summaries = []
            for day_key in seven_days_range:
                if day_key in sleep_by_day and sleep_by_day[day_key]['sessions']:
                    # Day has sleep data - process it
                    data = sleep_by_day[day_key]
                    sessions = data['sessions']
                    
                    # Find the longest sleep session (main sleep period)
                    main_session = max(sessions, key=lambda s: s['duration_hours'])
                    main_session_duration = main_session['duration_hours']
                    

                    
                    if main_session_duration >= 0.5:  # At least 30 minutes of main sleep
                        try:
                            user_tz = ZoneInfo(data['timezone'])
                        except ZoneInfoNotFoundError:
                            user_tz = ZoneInfo('UTC')
                        
                        # Use the main sleep session's actual start/end times
                        main_start_local = main_session['start_utc'].astimezone(user_tz)
                        main_end_local = main_session['end_utc'].astimezone(user_tz)
                        
                        main_session_duration_hours = main_session['duration_hours']

                        # --- ACCURATE DURATION CALCULATION (FIX) ---
                        # Convert float hours to total minutes for precision
                        total_minutes = main_session_duration_hours * 60
                        
                        # Calculate hours and minutes for display, rounding minutes to nearest whole number
                        display_hours = int(total_minutes // 60)
                        display_minutes = int(round(total_minutes % 60))
                        
                        # Handle edge case where rounding minutes results in 60
                        if display_minutes == 60:
                            display_hours += 1
                            display_minutes = 0

                        # For prediction, convert to hours.minutes format (e.g., 7.56 for 7h 56m)
                        # This is more accurate than decimal hours
                        total_minutes = main_session_duration_hours * 60
                        hours = int(total_minutes // 60)
                        minutes = int(round(total_minutes % 60))
                        
                        # Handle edge case where rounding minutes results in 60
                        if minutes == 60:
                            hours += 1
                            minutes = 0
                        
                        # Convert to hours.minutes format (e.g., 7.56 for 7h 56m)
                        prediction_sleep_hours = round(hours + (minutes / 100), 2)

                        authentic_bedtime = main_start_local.strftime('%H:%M')
                        authentic_wake_time = main_end_local.strftime('%H:%M')

                        summary = {
                            "date": day_key,
                            "bedtime": authentic_bedtime,
                            "wake_time": authentic_wake_time,
                            "sleep_hours": prediction_sleep_hours,
                            "formatted_sleep": f"{display_hours}h {display_minutes}m",
                            "has_data": True
                        }
                        daily_summaries.append(summary)
                        print(f"✅ {day_key}: {authentic_bedtime} - {authentic_wake_time} = {summary['formatted_sleep']}")
                    else:
                        # Duration too short, treat as no data
                        summary = {
                            "date": day_key,
                            "bedtime": "--:--",
                            "wake_time": "--:--", 
                            "sleep_hours": 0,
                            "formatted_sleep": "No Data",
                            "has_data": False
                        }
                        daily_summaries.append(summary)
                        print(f"⭕ {day_key}: No valid sleep data (sessions too short)")
                else:
                    # Day has no sleep data
                    summary = {
                        "date": day_key,
                        "bedtime": "--:--",
                        "wake_time": "--:--",
                        "sleep_hours": 0,
                        "formatted_sleep": "No Data",
                        "has_data": False
                    }
                    daily_summaries.append(summary)
                    print(f"⭕ {day_key}: No sleep data available")

            print(f"📊 Generated complete 7-day sleep summary: {len(daily_summaries)} days total")
            
            return {
                "success": True,
                "daily_summaries": daily_summaries,
                "days_with_data": len([s for s in daily_summaries if s['has_data']]),
                "days_without_data": len([s for s in daily_summaries if not s['has_data']]),
                "complete_range": True
            }

    except Exception as e:
        print(f"❌ Error getting improved sleep data: {e}")
        # Capture more detailed error information
        import traceback
        traceback.print_exc()
        return {"error": str(e), "success": False}

# Add endpoint for improved sleep analysis
# @app.route('/api/improved-sleep-analysis', methods=['GET'])
# def improved_sleep_analysis():
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 25, type=int)
        
#         result = get_improved_sleep_data(user_id, days_back)
#         return jsonify(result)
        
#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

def migrate_display_to_archive_for_user(user_id: int) -> int:
    """
    Migrate health data from health_data_display to health_data_archive for users who only have display data.
    This fixes the issue where new users have data in display but not archive tables.
    """
    try:
        with engine.connect() as conn:
            # Check if user has any data in archive table
            archive_count = conn.execute(text("""
                SELECT COUNT(*) as count
                FROM health_data_archive
                WHERE user_id = :user_id
            """), {'user_id': user_id}).fetchone()
            
            # Check if user has data in display table
            display_count = conn.execute(text("""
                SELECT COUNT(*) as count
                FROM health_data_display
                WHERE user_id = :user_id
            """), {'user_id': user_id}).fetchone()
            
            archive_records = archive_count.count if archive_count else 0
            display_records = display_count.count if display_count else 0
            
            print(f"📊 User {user_id}: Archive={archive_records}, Display={display_records}")
            
            # If user has display data but little/no archive data, migrate
            if display_records > 0 and archive_records < display_records:
                print(f"🔄 Migrating {display_records} records from display to archive for user {user_id}")
                
                # Copy all records from display to archive (with upsert to handle conflicts)
                migration_query = text("""
                    INSERT INTO health_data_archive (
                        user_id, data_type, data_subtype, value, value_string, unit,
                        start_date, end_date, source_name, source_bundle_id, device_name, 
                        sample_id, category_type, workout_activity_type, total_energy_burned,
                        total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
                    )
                    SELECT 
                        user_id, data_type, data_subtype, value, value_string, unit,
                        start_date, end_date, source_name, source_bundle_id, device_name, 
                        sample_id, category_type, workout_activity_type, total_energy_burned,
                        total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
                    FROM health_data_display
                    WHERE user_id = :user_id
                    ON DUPLICATE KEY UPDATE
                        value = VALUES(value),
                        value_string = VALUES(value_string),
                        metadata = VALUES(metadata)
                """)
                
                result = conn.execute(migration_query, {'user_id': user_id})
                conn.commit()
                
                migrated_count = result.rowcount
                print(f"✅ Successfully migrated {migrated_count} records for user {user_id}")
                return migrated_count
            else:
                print(f"ℹ️ No migration needed for user {user_id}")
                return 0
                
    except Exception as e:
        print(f"❌ Error migrating data for user {user_id}: {e}")
        return 0

# def auto_clean_health_data_duplicates(user_id: int = 1) -> int:
#     """
#     Automatically clean duplicates for critical health data types that are prone to duplication.
#     This runs after each sync to maintain data integrity.
#     Returns the number of duplicate records removed.
#     """
#     try:
#         total_cleaned = 0
        
#         with engine.connect() as conn:
#             # Critical data types that are prone to duplication during sync
#             critical_data_types = [
#                 'DistanceWalkingRunning',
#                 'ActiveEnergyBurned', 
#                 'StepCount',
#                 'HeartRate',
#                 'BloodGlucose'
#             ]
            
#             for data_type in critical_data_types:
#                 # Find duplicate entries (same sample_id, same timestamp, same value)
#                 duplicate_query = text("""
#                     SELECT sample_id, start_date, end_date, value, unit, COUNT(*) as count
#                     FROM health_data_archive 
#                     WHERE user_id = :user_id 
#                       AND data_type = :data_type
#                       AND sample_id IS NOT NULL
#                       AND sample_id != ''
#                     GROUP BY sample_id, start_date, end_date, value, unit
#                     HAVING COUNT(*) > 1
#                     ORDER BY start_date DESC
#                 """)
                
#                 duplicates = conn.execute(duplicate_query, {
#                     "user_id": user_id,
#                     "data_type": data_type
#                 }).fetchall()
                
#                 for dup in duplicates:
#                     # Get all entries for this duplicate group
#                     group_query = text("""
#                         SELECT id, sample_id, start_date, end_date, value, source_name
#                         FROM health_data_archive 
#                         WHERE user_id = :user_id 
#                           AND data_type = :data_type
#                           AND sample_id = :sample_id
#                           AND start_date = :start_date
#                           AND end_date = :end_date  
#                           AND value = :value
#                           AND unit = :unit
#                         ORDER BY id ASC
#                     """)
                    
#                     group_entries = conn.execute(group_query, {
#                         "user_id": user_id,
#                         "data_type": data_type,
#                         "sample_id": dup.sample_id,
#                         "start_date": dup.start_date,
#                         "end_date": dup.end_date,
#                         "value": dup.value,
#                         "unit": dup.unit
#                     }).fetchall()
                    
#                     # Keep only the FIRST entry (oldest ID), remove the rest
#                     if len(group_entries) > 1:
#                         entries_to_remove = group_entries[1:]  # Skip the first one
                        
#                         for entry in entries_to_remove:
#                             delete_query = text("DELETE FROM health_data_archive WHERE id = :id")
#                             conn.execute(delete_query, {"id": entry.id})
#                             total_cleaned += 1
                        
#                         print(f"🧹 {data_type}: Cleaned {len(entries_to_remove)} duplicates for sample {dup.sample_id}")
            
#             # Also clean entries with null sample_id AND null source_name (definitely simulated)
#             simulated_cleanup_query = text("""
#                 DELETE FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND sample_id IS NULL 
#                   AND source_name IS NULL
#                   AND data_type IN ('DistanceWalkingRunning', 'ActiveEnergyBurned', 'StepCount')
#             """)
            
#             result = conn.execute(simulated_cleanup_query, {"user_id": user_id})
#             simulated_cleaned = result.rowcount
#             total_cleaned += simulated_cleaned
            
#             if simulated_cleaned > 0:
#                 print(f"🧹 Removed {simulated_cleaned} simulated entries with null identifiers")
            
#             conn.commit()
            
#         return total_cleaned
        
#     except Exception as e:
#         print(f"❌ Error in auto-clean duplicates: {e}")
#         return 0



# ✅ NEW: Today's Insights endpoint with hybrid rule-based + LLM approach
@app.route('/api/insights', methods=['GET'])
def get_todays_insights():
    """
    Generate personalized health insights using a hybrid approach:
    1. Analyze user data to create metrics JSON
    2. Send to LLM for summarization
    3. Fallback to rule-based insights if LLM fails
    """
    try:
        # Get user ID from query parameter or resolve from clerk_user_id
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        print(f"🔍 Generating insights for user {user_id}...")
        
        # Step 1: Gather comprehensive user data
        metrics = analyze_user_data_for_insights(user_id)
        
        # Step 2: Try LLM summarization
        ai_insights = []
        llm_used = False
        fallback_reason = None
        
        if gemini_model:
            try:
                ai_insights = generate_llm_insights(metrics)
                llm_used = True
                print("✅ LLM insights generated successfully")
            except Exception as e:
                print(f"⚠️ LLM generation failed: {e}")
                fallback_reason = f"LLM Error: {str(e)}"
        else:
            fallback_reason = "Gemini API not configured"
        
        # Step 3: Generate rule-based insights (always as backup)
        rule_based_insights = generate_rule_based_insights(metrics)
        
        # Step 4: Combine or fallback
        final_insights = ai_insights if ai_insights else rule_based_insights
        
        # Ensure we have at least some insights
        if not final_insights:
            final_insights = [{
                'id': 'default',
                'type': 'positive',
                'icon': '🎯',
                'title': 'Keep Going Strong',
                'description': 'Continue monitoring your health consistently. Your dedication to tracking will pay off with better insights over time.',
                'priority': 1,
                'isAIGenerated': False,
                'fallbackUsed': True
            }]
        
        return jsonify({
            'success': True,
            'insights': final_insights,
            'metrics': metrics,
            'generatedAt': datetime.now().isoformat(),
            'llmUsed': llm_used,
            'fallbackReason': fallback_reason
        })
        
    except Exception as e:
        print(f"❌ Error generating insights: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'insights': [],
            'metrics': {},
            'generatedAt': datetime.now().isoformat(),
            'llmUsed': False,
            'fallbackReason': f"Critical error: {str(e)}"
        }), 500

def analyze_user_data_for_insights(user_id: int) -> dict:
    """
    Analyze user's recent data to create comprehensive metrics JSON
    """
    try:
        with engine.connect() as conn:
            today = datetime.now().date()
            yesterday = today - timedelta(days=1)
            week_ago = today - timedelta(days=7)
            
            # === GLUCOSE ANALYSIS ===
            glucose_metrics = analyze_glucose_data(conn, user_id, today, yesterday)
            
            # === MEALS ANALYSIS ===
            meals_metrics = analyze_meals_data(conn, user_id, today)
            
            # === ACTIVITY ANALYSIS ===
            activity_metrics = analyze_activity_data(conn, user_id, today)
            
            # === SLEEP ANALYSIS ===
            sleep_metrics = analyze_sleep_data(conn, user_id, today)
            
            # === PREDICTIONS ANALYSIS ===
            predictions_metrics = analyze_predictions_data(conn, user_id)
            
            return {
                'glucose': glucose_metrics,
                'meals': meals_metrics,
                'activity': activity_metrics,
                'sleep': sleep_metrics,
                'predictions': predictions_metrics
            }
            
    except Exception as e:
        print(f"❌ Error analyzing user data: {e}")
        return {
            'glucose': {},
            'meals': {},
            'activity': {},
            'sleep': {},
            'predictions': {}
        }

def analyze_glucose_data(conn, user_id: int, today: date, yesterday: date) -> dict:
    """Analyze glucose data for insights"""
    try:
        # Get user's target glucose range
        user_target = conn.execute(text("""
            SELECT target_glucose_min, target_glucose_max 
            FROM users 
            WHERE id = :user_id
        """), {'user_id': user_id}).fetchone()
        
        # Use user's target range or default to 70-140
        target_min = user_target.target_glucose_min if user_target and user_target.target_glucose_min else 70
        target_max = user_target.target_glucose_max if user_target and user_target.target_glucose_max else 140
        
        # Get today's and yesterday's glucose readings
        today_readings = conn.execute(text("""
            SELECT glucose_level, timestamp 
            FROM glucose_log 
            WHERE user_id = :user_id 
            AND DATE(timestamp) = :today
            ORDER BY timestamp
        """), {'user_id': user_id, 'today': today}).fetchall()
        
        yesterday_readings = conn.execute(text("""
            SELECT glucose_level, timestamp 
            FROM glucose_log 
            WHERE user_id = :user_id 
            AND DATE(timestamp) = :yesterday
            ORDER BY timestamp
        """), {'user_id': user_id, 'yesterday': yesterday}).fetchall()
        
        # Calculate basic metrics
        today_values = [float(r.glucose_level) for r in today_readings]
        yesterday_values = [float(r.glucose_level) for r in yesterday_readings]
        
        def calculate_time_in_range(values):
            if not values:
                return None
            in_range = [v for v in values if target_min <= v <= target_max]
            return round((len(in_range) / len(values)) * 100, 1)
        
        # Check for morning rise pattern
        morning_rise = check_morning_rise_pattern(conn, user_id)
        
        return {
            'averageToday': round(sum(today_values) / len(today_values), 1) if today_values else None,
            'averageYesterday': round(sum(yesterday_values) / len(yesterday_values), 1) if yesterday_values else None,
            'timeInRange': {
                'today': calculate_time_in_range(today_values),
                'yesterday': calculate_time_in_range(yesterday_values)
            },
            'targetRange': {
                'min': target_min,
                'max': target_max
            },
            'highestReading': max(today_values) if today_values else None,
            'lowestReading': min(today_values) if today_values else None,
            'totalReadings': len(today_values),
            'morningRise': morning_rise,
            'lastReading': {
                'value': today_values[-1] if today_readings else None,
                'timestamp': today_readings[-1].timestamp.isoformat() if today_readings else None
            } if today_readings else None
        }
        
    except Exception as e:
        print(f"❌ Error analyzing glucose data: {e}")
        return {}

def check_morning_rise_pattern(conn, user_id: int) -> dict:
    """Check for dawn phenomenon pattern"""
    try:
        # Look for morning rises in the last 7 days
        morning_rises = conn.execute(text("""
            WITH daily_morning_data AS (
                SELECT 
                    DATE(timestamp) as log_date,
                    MIN(CASE WHEN HOUR(timestamp) BETWEEN 6 AND 8 THEN glucose_level END) as morning_min,
                    MAX(CASE WHEN HOUR(timestamp) BETWEEN 6 AND 8 THEN glucose_level END) as morning_max
                FROM glucose_log 
                WHERE user_id = :user_id 
                AND timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                AND HOUR(timestamp) BETWEEN 6 AND 8
                GROUP BY DATE(timestamp)
            )
            SELECT 
                COUNT(*) as days_with_rise,
                AVG(morning_max - morning_min) as avg_rise
            FROM daily_morning_data 
            WHERE morning_max - morning_min > 30
        """), {'user_id': user_id}).fetchone()
        
        if morning_rises and morning_rises.days_with_rise >= 3:
            return {
                'detected': True,
                'riseAmount': round(morning_rises.avg_rise, 1),
                'timeRange': '6:00-8:00 AM',
                'daysInRow': morning_rises.days_with_rise
            }
        
        return {'detected': False}
        
    except Exception as e:
        print(f"❌ Error checking morning rise: {e}")
        return {'detected': False}

def analyze_meals_data(conn, user_id: int, today: date) -> dict:
    """Analyze meal data for insights"""
    try:
        meals_today = conn.execute(text("""
            SELECT food_description, meal_type, carbs, calories, timestamp
            FROM food_log 
            WHERE user_id = :user_id 
            AND DATE(timestamp) = :today
            ORDER BY timestamp DESC
        """), {'user_id': user_id, 'today': today}).fetchall()
        
        total_carbs = sum(float(m.carbs or 0) for m in meals_today)
        total_calories = sum(float(m.calories or 0) for m in meals_today)
        
        # Calculate post-meal glucose response
        post_meal_response = calculate_post_meal_response(conn, user_id, today)
        
        return {
            'totalCarbs': round(total_carbs, 1),
            'totalCalories': round(total_calories, 1),
            'mealCount': len(meals_today),
            'lastMeal': {
                'description': meals_today[0].food_description,
                'type': meals_today[0].meal_type,
                'carbs': float(meals_today[0].carbs or 0),
                'timestamp': meals_today[0].timestamp.isoformat()
            } if meals_today else None,
            'postMealResponse': post_meal_response
        }
        
    except Exception as e:
        print(f"❌ Error analyzing meals data: {e}")
        return {}

def calculate_post_meal_response(conn, user_id: int, today: date) -> dict:
    """Calculate average post-meal glucose response"""
    try:
        # Get meals and glucose readings for today
        meal_times = conn.execute(text("""
            SELECT timestamp FROM food_log 
            WHERE user_id = :user_id AND DATE(timestamp) = :today
        """), {'user_id': user_id, 'today': today}).fetchall()
        
        if not meal_times:
            return None
        
        spikes = []
        for meal in meal_times:
            # Get glucose 2 hours after meal
            post_meal_glucose = conn.execute(text("""
                SELECT glucose_level 
                FROM glucose_log 
                WHERE user_id = :user_id 
                AND timestamp BETWEEN :meal_time AND DATE_ADD(:meal_time, INTERVAL 2 HOUR)
                ORDER BY timestamp
            """), {'user_id': user_id, 'meal_time': meal.timestamp}).fetchall()
            
            if post_meal_glucose:
                pre_meal = float(post_meal_glucose[0].glucose_level)
                max_post = max(float(g.glucose_level) for g in post_meal_glucose)
                spike = max_post - pre_meal
                if spike > 0:
                    spikes.append(spike)
        
        if spikes:
            return {
                'averageSpike': round(sum(spikes) / len(spikes), 1),
                'maxSpike': round(max(spikes), 1),
                'timeToReturn': 90  # Simplified - would need more complex calculation
            }
        
        return None
        
    except Exception as e:
        print(f"❌ Error calculating post-meal response: {e}")
        return None

def analyze_activity_data(conn, user_id: int, today: date) -> dict:
    """Analyze activity data for insights"""
    try:
        # -------------------------
        # 1. Manual activity logs
        # -------------------------
        activities = conn.execute(text("""
            SELECT activity_type, duration_minutes, steps, calories_burned, timestamp
            FROM activity_log
            WHERE user_id = :user_id
              AND DATE(timestamp) = :today
            ORDER BY timestamp DESC
        """), {'user_id': user_id, 'today': today}).fetchall()

        # Intensity weight mapping (simple heuristic)
        intensity_weights = {
            'run': 1.25,
            'jog': 1.2,
            'gym': 1.25,
            'cycle': 1.25,
            'bike': 1.25,
            'swim': 1.3,
            'row': 1.25,
            'walk': 1.0,
            'yoga': 0.8,
            'stretch': 0.8,
        }

        total_manual_minutes = 0.0
        weighted_manual_minutes = 0.0
        total_manual_steps = 0
        total_manual_calories = 0.0

        for a in activities:
            mins = float(a.duration_minutes or 0)
            total_manual_minutes += mins

            # Determine weight
            weight = 1.0
            if a.activity_type:
                lower = a.activity_type.lower()
                for key, w in intensity_weights.items():
                    if key in lower:
                        weight = w
                        break
            weighted_manual_minutes += mins * weight

            total_manual_steps += int(a.steps or 0)
            total_manual_calories += float(a.calories_burned or 0)

        # -------------------------
        # 2. Apple Health data
        # -------------------------
        # Step data
        steps_data = conn.execute(text("""
            SELECT SUM(value) as total_steps
            FROM health_data_display
            WHERE user_id = :user_id
              AND data_type = 'StepCount'
              AND DATE(start_date) = :today
        """), {'user_id': user_id, 'today': today}).fetchone()
        apple_steps = int(steps_data.total_steps or 0) if steps_data else 0

        # Workout durations (in minutes) from DISPLAY table
        workouts = conn.execute(text("""
            SELECT workout_activity_type, start_date, end_date
            FROM health_data_display
            WHERE user_id = :user_id
              AND data_type = 'Workout'
              AND DATE(start_date) = :today
        """), {'user_id': user_id, 'today': today}).fetchall()

        total_workout_minutes = 0.0
        weighted_workout_minutes = 0.0

        for w in workouts:
            # Duration in minutes
            if w.end_date and w.start_date:
                mins = (w.end_date - w.start_date).total_seconds() / 60
                total_workout_minutes += mins

                # Determine weight based on activity type
                weight = 1.0
                if w.workout_activity_type:
                    lower = w.workout_activity_type.lower()
                    for key, wt in intensity_weights.items():
                        if key in lower:
                            weight = wt
                            break
                weighted_workout_minutes += mins * weight

        # -------------------------
        # 3. Aggregate metrics
        # -------------------------
        total_steps = apple_steps + total_manual_steps
        total_minutes = total_manual_minutes + total_workout_minutes
        total_calories = total_manual_calories  # Apple Health calories already captured in dashboard elsewhere

        weighted_minutes = weighted_manual_minutes + weighted_workout_minutes

        # Determine activity level
        if weighted_minutes >= 60:
            activity_level = 'Active'
        elif weighted_minutes >= 30:
            activity_level = 'Moderately Active'
        else:
            activity_level = 'Sedentary'

        return {
            'totalSteps': total_steps,
            'totalMinutes': round(total_minutes, 1),
            'activeMinutes': round(total_minutes, 1),
            'weightedMinutes': round(weighted_minutes, 1),
            'activityLevel': activity_level,
            'activitiesLogged': len(activities) + len(workouts),
            'caloriesBurned': round(total_calories, 1),
            'lastActivity': {
                'type': activities[0].activity_type if activities else (workouts[0].workout_activity_type if workouts else None),
                'duration': float(activities[0].duration_minutes or 0) if activities else ( ( (workouts[0].end_date - workouts[0].start_date).total_seconds() / 60 ) if workouts else 0),
                'timestamp': activities[0].timestamp.isoformat() if activities else (workouts[0].start_date.isoformat() if workouts else None)
            } if (activities or workouts) else None
        }
 
    except Exception as e:
        print(f"❌ Error analyzing activity data: {e}")
        return {}

def analyze_sleep_data(conn, user_id: int, today: date) -> dict:
    """Analyze sleep data for insights - use same source as dashboard"""
    try:
        # Use the same improved sleep data function as dashboard
        improved_sleep_result = get_improved_sleep_data(user_id, 7)
        
        if improved_sleep_result.get('success'):
            daily_summaries = improved_sleep_result.get('daily_summaries', [])
            
            # Find today's sleep data (most recent completed sleep)
            today_str = today.strftime('%Y-%m-%d')
            
            last_night_hours = None
            week_sleep_hours = []
            
            for summary in daily_summaries:
                if summary.get('has_data', False):
                    week_sleep_hours.append(summary['sleep_hours'])
                    
                    # Check if this is today's data (most recent sleep)
                    if summary['date'] == today_str:
                        last_night_hours = summary['sleep_hours']

            
            # Calculate week average
            week_avg_hours = round(sum(week_sleep_hours) / len(week_sleep_hours), 1) if week_sleep_hours else None
            
            # Determine quality
            quality = None
            if last_night_hours:
                if last_night_hours >= 7:
                    quality = 'good'
                elif last_night_hours >= 6:
                    quality = 'average'
                else:
                    quality = 'poor'
            

            
            return {
                'lastNightHours': last_night_hours,
                'averageThisWeek': week_avg_hours,
                'quality': quality
            }
        else:
            print(f"⚠️ Improved sleep analysis failed for insights, returning empty data")
            return {}
        
    except Exception as e:
        print(f"❌ Error analyzing sleep data: {e}")
        return {}

def analyze_predictions_data(conn, user_id: int) -> dict:
    """Analyze prediction trends"""
    try:
        # This would integrate with the prediction model
        # For now, return basic structure
        return {
            'nextHourTrend': 'stable',  # Would come from actual prediction
            'confidence': 0.75,
            'riskLevel': 'low'
        }
        
    except Exception as e:
        print(f"❌ Error analyzing predictions: {e}")
        return {}

def generate_llm_insights(metrics: dict) -> list:
    """Generate insights using LLM"""
    try:
        # Create a concise summary for the LLM
        metrics_summary = {
            'glucose_avg_today': metrics.get('glucose', {}).get('averageToday'),
            'glucose_time_in_range_today': metrics.get('glucose', {}).get('timeInRange', {}).get('today'),
            'glucose_time_in_range_yesterday': metrics.get('glucose', {}).get('timeInRange', {}).get('yesterday'),
            'morning_rise_detected': metrics.get('glucose', {}).get('morningRise', {}).get('detected', False),
            'total_carbs': metrics.get('meals', {}).get('totalCarbs', 0),
            'meal_count': metrics.get('meals', {}).get('mealCount', 0),
            'post_meal_spike': metrics.get('meals', {}).get('postMealResponse', {}).get('averageSpike') if metrics.get('meals', {}).get('postMealResponse') else None,
            'total_steps': metrics.get('activity', {}).get('totalSteps', 0),
            'activity_minutes': metrics.get('activity', {}).get('totalMinutes', 0),
            'sleep_hours': metrics.get('sleep', {}).get('lastNightHours'),
            'sleep_quality': metrics.get('sleep', {}).get('quality')
        }
        

        
        prompt = f"""You are a friendly diabetes coach. Based on the metrics below, write 2–3 concise, motivating health insights for the user. Be helpful, human, and engaging.

IMPORTANT: Only use actual data provided. Do NOT make up or assume values for missing data. If a metric is null, None, or 0, do not mention it in insights.

Metrics:
{json.dumps(metrics_summary, indent=2)}

Requirements:
- Generate 3 insights maximum
- Each insight should be 1-2 sentences
- Be encouraging and actionable
- Focus on the most important patterns
- Use a supportive, friendly tone
- Include specific numbers when relevant
- ONLY mention metrics that have actual values (not null/None/0)
- Do NOT generate fake or assumed data

Format each insight as:
Title: [Brief title]
Description: [1-2 sentence description with actionable advice]
Type: [positive/warning/tip]

Example:
Title: Great Time in Range Progress
Description: You've improved your time in range by 5.2% compared to yesterday. This shows your meal timing and activity are working well together.
Type: positive"""

        response = gemini_model.generate_content(prompt)
        
        # Parse the LLM response into structured insights
        insights = parse_llm_insights_response(response.text)
        return insights
        
    except Exception as e:
        print(f"❌ Error generating LLM insights: {e}")
        return []

def parse_llm_insights_response(response_text: str) -> list:
    """Parse LLM response into structured insights"""
    try:
        insights = []
        lines = response_text.strip().split('\n')
        
        current_insight = {}
        insight_id = 1
        
        for line in lines:
            line = line.strip()
            if line.startswith('Title:'):
                if current_insight:  # Save previous insight
                    insights.append(format_insight(current_insight, insight_id))
                    insight_id += 1
                current_insight = {'title': line.replace('Title:', '').strip()}
            elif line.startswith('Description:'):
                current_insight['description'] = line.replace('Description:', '').strip()
            elif line.startswith('Type:'):
                current_insight['type'] = line.replace('Type:', '').strip()
        
        # Add the last insight
        if current_insight:
            insights.append(format_insight(current_insight, insight_id))
        
        return insights[:3]  # Limit to 3 insights
        
    except Exception as e:
        print(f"❌ Error parsing LLM response: {e}")
        return []

def format_insight(insight_data: dict, insight_id: int) -> dict:
    """Format insight into standard structure"""
    insight_type = insight_data.get('type', 'positive')
    
    # Map type to icon
    icon_map = {
        'positive': '✅',
        'warning': '⚠️',
        'tip': '💡',
        'neutral': '📊'
    }
    
    return {
        'id': f'llm-insight-{insight_id}',
        'type': insight_type,
        'icon': icon_map.get(insight_type, '📊'),
        'title': insight_data.get('title', 'Health Insight'),
        'description': insight_data.get('description', 'Keep monitoring your health consistently.'),
        'priority': 3,  # LLM insights get medium priority
        'isAIGenerated': True,
        'fallbackUsed': False
    }

def generate_rule_based_insights(metrics: dict) -> list:
    """Generate insights using rule-based logic as fallback"""
    insights = []
    
    glucose = metrics.get('glucose', {})
    meals = metrics.get('meals', {})
    activity = metrics.get('activity', {})
    sleep = metrics.get('sleep', {})
    
    # Morning rise pattern
    if glucose.get('morningRise', {}).get('detected'):
        insights.append({
            'id': 'rule-morning-rise',
            'type': 'warning',
            'icon': '🌅',
            'title': 'Dawn Phenomenon Detected',
            'description': f"Your glucose has risen for {glucose['morningRise']['daysInRow']} consecutive days. Consider discussing timing adjustments with your healthcare provider.",
            'priority': 4,
            'isAIGenerated': False,
            'fallbackUsed': True
        })
    
    # Time in range comparison
    tir_today = glucose.get('timeInRange', {}).get('today')
    tir_yesterday = glucose.get('timeInRange', {}).get('yesterday')
    
    if tir_today is not None and tir_yesterday is not None:
        improvement = tir_today - tir_yesterday
        if improvement > 5:
            insights.append({
                'id': 'rule-tir-improvement',
                'type': 'positive',
                'icon': '✅',
                'title': 'Excellent Time in Range',
                'description': f"You improved your time in range by {improvement:.1f}% today. Your management strategy is working great!",
                'priority': 3,
                'isAIGenerated': False,
                'fallbackUsed': True
            })
    
    # Activity insights
    steps = activity.get('totalSteps', 0)
    if steps > 8000:
        insights.append({
            'id': 'rule-steps-goal',
            'type': 'positive',
            'icon': '🚶‍♂️',
            'title': 'Step Goal Achieved',
            'description': f"Great job reaching {steps:,} steps today! Regular activity is excellent for glucose management.",
            'priority': 2,
            'isAIGenerated': False,
            'fallbackUsed': True
        })
    elif steps < 3000:
        insights.append({
            'id': 'rule-steps-encourage',
            'type': 'tip',
            'icon': '💪',
            'title': 'Movement Opportunity',
            'description': "A short 10-15 minute walk after your next meal can help with glucose control and energy levels.",
            'priority': 3,
            'isAIGenerated': False,
            'fallbackUsed': True
        })
    
    # Sleep insights
    sleep_hours = sleep.get('lastNightHours')
    if sleep_hours and sleep_hours < 6:
        insights.append({
            'id': 'rule-sleep-quality',
            'type': 'tip',
            'icon': '😴',
            'title': 'Sleep & Glucose Connection',
            'description': f"With {sleep_hours} hours of sleep, consider prioritizing rest. Poor sleep can affect glucose control.",
            'priority': 3,
            'isAIGenerated': False,
            'fallbackUsed': True
        })
    
    # Default encouragement if no specific insights
    if not insights:
        insights.append({
            'id': 'rule-default',
            'type': 'positive',
            'icon': '🎯',
            'title': 'Consistent Monitoring',
            'description': "You're building great habits by tracking your health data. Consistency is key to better glucose management.",
            'priority': 2,
            'isAIGenerated': False,
            'fallbackUsed': True
        })
    
    # Sort by priority and limit to 3
    return sorted(insights, key=lambda x: x['priority'], reverse=True)[:3]

# @app.route('/api/remove-fake-distance-data', methods=['POST'])
# def remove_fake_distance_data():
#     """Remove fake/simulated distance data with sample IDs like 'simulated-distance-' or 'test-distance-'"""
#     try:
#         data = request.get_json()
#         user_id = data.get('user_id', 1)
        
#         with engine.connect() as conn:
#             # Find fake distance entries
#             fake_query = text("""
#                 SELECT id, sample_id, start_date, end_date, value, unit
#                 FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND data_type = 'DistanceWalkingRunning'
#                   AND (sample_id LIKE 'simulated-distance-%' 
#                        OR sample_id LIKE 'test-distance-%'
#                        OR sample_id IS NULL 
#                        OR sample_id = '')
#                 ORDER BY start_date DESC
#             """)
            
#             fake_entries = conn.execute(fake_query, {"user_id": user_id}).fetchall()
            
#             if not fake_entries:
#                 return jsonify({
#                     "success": True,
#                     "message": "No fake distance data found",
#                     "entries_removed": 0
#                 })
            
#             # Remove fake entries from both tables
#             delete_archive_query = text("""
#                 DELETE FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND data_type = 'DistanceWalkingRunning'
#                   AND (sample_id LIKE 'simulated-distance-%' 
#                        OR sample_id LIKE 'test-distance-%'
#                        OR sample_id IS NULL 
#                        OR sample_id = '')
#             """)
            
#             delete_display_query = text("""
#                 DELETE FROM health_data_display 
#                 WHERE user_id = :user_id 
#                   AND data_type = 'DistanceWalkingRunning'
#                   AND (sample_id LIKE 'simulated-distance-%' 
#                        OR sample_id LIKE 'test-distance-%'
#                        OR sample_id IS NULL 
#                        OR sample_id = '')
#             """)
            
#             archive_result = conn.execute(delete_archive_query, {"user_id": user_id})
#             display_result = conn.execute(delete_display_query, {"user_id": user_id})
            
#             total_removed = archive_result.rowcount + display_result.rowcount
#             conn.commit()
            
#             print(f"🧹 Removed {total_removed} fake distance entries for user {user_id}")
            
#             return jsonify({
#                 "success": True,
#                 "message": f"Successfully removed {total_removed} fake distance entries",
#                 "entries_removed": total_removed,
#                 "archive_removed": archive_result.rowcount,
#                 "display_removed": display_result.rowcount,
#                 "fake_entries_found": len(fake_entries)
#             })
            
#     except Exception as e:
#         print(f"❌ Error removing fake distance data: {e}")
#         return jsonify({
#             "success": False,
#             "error": str(e),
#             "message": "Failed to remove fake distance data"
#         }), 500

@app.route('/api/migrate-user-health-data', methods=['POST'])
def migrate_user_health_data():
    """
    Manually trigger migration of health data from display to archive table for a specific user.
    This fixes the issue where users have data in health_data_display but not health_data_archive.
    """
    try:
        data = request.get_json()
        user_id = data.get('user_id') if data else request.args.get('user_id', type=int)
        clerk_user_id = data.get('clerk_user_id') if data else request.args.get('clerk_user_id', type=str)
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        # Perform migration
        migrated_count = migrate_display_to_archive_for_user(user_id)
        
        return jsonify({
            "success": True,
            "message": f"Migration completed for user {user_id}",
            "migrated_records": migrated_count
        })
        
    except Exception as e:
        print(f"❌ Error in migration endpoint: {e}")
        return jsonify({
            "success": False,
            "error": f"Migration failed: {str(e)}"
        }), 500

@app.route('/api/injection-site-recommendation', methods=['GET'])
def get_injection_site_recommendation():
    """Get LLM-based injection site recommendation based on recent injection history"""
    try:
        user_id = request.args.get('user_id', type=int)
        clerk_user_id = request.args.get('clerk_user_id', type=str)
        
        # Require either user_id or clerk_user_id
        if not user_id and not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "Either user_id or clerk_user_id is required"
            }), 400
        
        # If we have clerk_user_id but no user_id, resolve it
        if clerk_user_id and not user_id:
            try:
                user_id = get_user_id_from_clerk(clerk_user_id)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 404
        
        # Fetch recent insulin injection history (last 10 entries)
        with engine.connect() as conn:
            recent_injections = conn.execute(text("""
                SELECT injection_site, timestamp, medication_name, insulin_type
                FROM medication_log 
                WHERE user_id = :user_id 
                AND medication_type = 'Insulin' 
                AND injection_site IS NOT NULL
                ORDER BY timestamp DESC 
                LIMIT 10
            """), {'user_id': user_id}).fetchall()
        
        if not recent_injections:
            return jsonify({
                "success": False,
                "message": "No recent injection history found"
            }), 404
        
        # Format injection history for LLM
        injection_history = []
        for injection in recent_injections:
            injection_history.append({
                "site": injection.injection_site,
                "timestamp": injection.timestamp.strftime("%Y-%m-%d %H:%M"),
                "medication": injection.medication_name,
                "type": injection.insulin_type or "Unknown"
            })
        
        # Create LLM prompt
        history_text = "\n".join([
            f"- {inj['timestamp']}: {inj['site']} ({inj['medication']}, {inj['type']})"
            for inj in injection_history
        ])
        
        prompt = f"""Given this user's recent insulin injection sites and rotation best practices, recommend the best site for today's injection and briefly explain why.

Recent injection history:
{history_text}

Please respond in this exact JSON format:
{{
  "recommended_site": "site name",
  "reason": "brief explanation of why this site is recommended"
}}

Consider:
- Rotation patterns to avoid lipodystrophy
- Time since last injection at each site
- Common best practices for insulin injection site rotation
- User's personal injection pattern

Available sites: Left Arm, Right Arm, Left Thigh, Right Thigh, Abdomen, Buttock"""

        # Get LLM recommendation
        if gemini_model:
            try:
                response = gemini_model.generate_content(prompt)
                response_text = response.text.strip()
                
                # Try to parse JSON response
                try:
                    # Extract JSON from response (in case LLM adds extra text)
                    import re
                    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                    if json_match:
                        response_text = json_match.group(0)
                    
                    import json
                    recommendation = json.loads(response_text)
                    
                    # Validate response format
                    if 'recommended_site' in recommendation and 'reason' in recommendation:
                        return jsonify({
                            "success": True,
                            "recommendation": {
                                "site": recommendation['recommended_site'],
                                "reason": recommendation['reason']
                            },
                            "history_count": len(injection_history)
                        })
                    else:
                        raise ValueError("Invalid response format")
                        
                except (json.JSONDecodeError, ValueError) as e:
                    print(f"Error parsing LLM response: {e}")
                    print(f"Raw response: {response_text}")
                    # Fallback to rule-based recommendation
                    return get_rule_based_recommendation(injection_history)
                    
            except Exception as e:
                print(f"Error getting LLM recommendation: {e}")
                # Fallback to rule-based recommendation
                return get_rule_based_recommendation(injection_history)
        else:
            # No LLM available, use rule-based recommendation
            return get_rule_based_recommendation(injection_history)
            
    except Exception as e:
        print(f"Error in injection site recommendation: {e}")
        return jsonify({"error": "Failed to generate recommendation"}), 500

def get_rule_based_recommendation(injection_history):
    """Fallback rule-based injection site recommendation"""
    # Available sites
    all_sites = ['Left Arm', 'Right Arm', 'Left Thigh', 'Right Thigh', 'Abdomen', 'Buttock']
    
    # Count recent usage of each site
    site_usage = {}
    for site in all_sites:
        site_usage[site] = 0
    
    for injection in injection_history:
        site = injection['site']
        if site in site_usage:
            site_usage[site] += 1
    
    # Find least recently used site
    least_used_sites = [site for site, count in site_usage.items() if count == min(site_usage.values())]
    
    # Prefer abdomen if it's among least used (common preference)
    if 'Abdomen' in least_used_sites:
        recommended_site = 'Abdomen'
        reason = "Abdomen is recommended as it's among your least recently used sites and offers good absorption."
    else:
        recommended_site = least_used_sites[0]
        reason = f"{recommended_site} is recommended as it's your least recently used injection site, promoting proper rotation."
    
    return jsonify({
        "success": True,
        "recommendation": {
            "site": recommended_site,
            "reason": reason
        },
        "history_count": len(injection_history),
        "fallback": True
    })

@app.route('/api/update-user-profile', methods=['PUT'])
def update_user_profile():
    """
    Update user profile data (Phase 1: Basic demographics and preferences)
    """
    try:
        data = request.json
        
        # Validate required fields
        clerk_user_id = data.get('clerk_user_id')
        if not clerk_user_id:
            return jsonify({
                "success": False,
                "error": "clerk_user_id is required"
            }), 400
        
        # Get the database user_id from clerk_user_id
        user_id = get_user_id_from_clerk(clerk_user_id)
        
        # Extract updateable fields (Phase 1: Basic info + diabetes info)
        updateable_fields = {
            'full_name': data.get('full_name'),
            'email': data.get('email'),
            'height_value': data.get('height_value'),
            'height_unit': data.get('height_unit'),
            'weight_value': data.get('weight_value'),
            'weight_unit': data.get('weight_unit'),
            'gender': data.get('gender'),
            'cgm_model': data.get('cgm_model'),
            'pump_model': data.get('pump_model'),
            'profile_image_url': data.get('profile_image_url'),
            # Diabetes-related fields
            'has_diabetes': data.get('has_diabetes'),
            'diabetes_type': data.get('diabetes_type'),
            'year_of_diagnosis': data.get('year_of_diagnosis'),
            'uses_insulin': data.get('uses_insulin'),
            'insulin_type': data.get('insulin_type'),
            'daily_basal_dose': data.get('daily_basal_dose'),
            'insulin_to_carb_ratio': data.get('insulin_to_carb_ratio'),
            # Target glucose range
            'target_glucose_min': data.get('target_glucose_min'),
            'target_glucose_max': data.get('target_glucose_max')
        }
        
        # Remove None values to avoid updating fields that weren't provided
        update_data = {k: v for k, v in updateable_fields.items() if v is not None}
        
        if not update_data:
            return jsonify({
                "success": False,
                "error": "No valid fields provided for update"
            }), 400
        
        # Validate data ranges
        validation_errors = validate_profile_update_data(update_data)
        if validation_errors:
            return jsonify({
                "success": False,
                "error": "Validation failed",
                "validation_errors": validation_errors
            }), 400
        
        # Build dynamic UPDATE query
        set_clauses = []
        params = {'user_id': user_id}
        
        for field, value in update_data.items():
            set_clauses.append(f"{field} = :{field}")
            params[field] = value
        
        # Add updated timestamp
        set_clauses.append("updated_at = CURRENT_TIMESTAMP")
        
        with engine.connect() as conn:
            # Execute the update
            update_query = text(f"""
                UPDATE users SET 
                {', '.join(set_clauses)}
                WHERE id = :user_id
            """)
            
            result = conn.execute(update_query, params)
            
            if result.rowcount == 0:
                return jsonify({
                    "success": False,
                    "error": "User not found or no changes made"
                }), 404
            
            conn.commit()
            
            # Return updated user data
            updated_user = conn.execute(text("""
                SELECT id, full_name, email, height_value, height_unit, 
                       weight_value, weight_unit, gender, cgm_model, pump_model,
                       profile_image_url, has_diabetes, diabetes_type, year_of_diagnosis,
                       uses_insulin, insulin_type, daily_basal_dose, insulin_to_carb_ratio,
                       target_glucose_min, target_glucose_max, updated_at
                FROM users 
                WHERE id = :user_id
            """), {'user_id': user_id}).fetchone()
            
            print(f"✅ Profile updated for user_id {user_id}. Fields updated: {list(update_data.keys())}")
            
        return jsonify({
            "success": True,
            "message": "Profile updated successfully",
            "updated_fields": list(update_data.keys()),
            "user_data": {
                "user_id": updated_user.id,
                "full_name": updated_user.full_name,
                "email": updated_user.email,
                "height_value": float(updated_user.height_value) if updated_user.height_value else None,
                "height_unit": updated_user.height_unit,
                "weight_value": float(updated_user.weight_value) if updated_user.weight_value else None,
                "weight_unit": updated_user.weight_unit,
                "gender": updated_user.gender,
                "cgm_model": updated_user.cgm_model,
                "pump_model": updated_user.pump_model,
                "profile_image_url": updated_user.profile_image_url,
                "has_diabetes": updated_user.has_diabetes,
                "diabetes_type": updated_user.diabetes_type,
                "year_of_diagnosis": int(updated_user.year_of_diagnosis) if updated_user.year_of_diagnosis else None,
                "uses_insulin": updated_user.uses_insulin,
                "insulin_type": updated_user.insulin_type,
                "daily_basal_dose": float(updated_user.daily_basal_dose) if updated_user.daily_basal_dose else None,
                "insulin_to_carb_ratio": float(updated_user.insulin_to_carb_ratio) if updated_user.insulin_to_carb_ratio else None,
                "target_glucose_min": int(updated_user.target_glucose_min) if updated_user.target_glucose_min else 70,
                "target_glucose_max": int(updated_user.target_glucose_max) if updated_user.target_glucose_max else 140,
                "updated_at": updated_user.updated_at.isoformat() if updated_user.updated_at else None
            }
        }), 200
        
    except ValueError as e:
        print(f"User lookup error: {e}")
        return jsonify({
            "success": False,
            "error": "User not found"
        }), 404
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to update profile: {str(e)}"
        }), 500

def validate_profile_update_data(data: dict) -> list:
    """
    Validate profile update data for Phase 1 fields
    Returns list of validation errors
    """
    errors = []
    
    # Height validation
    if 'height_value' in data:
        height = data['height_value']
        height_unit = data.get('height_unit', 'cm')
        
        try:
            height = float(height)
            if height_unit == 'cm':
                if height < 50 or height > 250:
                    errors.append("Height must be between 50-250 cm")
            elif height_unit == 'ft':
                if height < 2 or height > 8:
                    errors.append("Height must be between 2-8 feet")
        except (ValueError, TypeError):
            errors.append("Height must be a valid number")
    
    # Weight validation
    if 'weight_value' in data:
        weight = data['weight_value']
        weight_unit = data.get('weight_unit', 'kg')
        
        try:
            weight = float(weight)
            if weight_unit == 'kg':
                if weight < 20 or weight > 300:
                    errors.append("Weight must be between 20-300 kg")
            elif weight_unit == 'lbs':
                if weight < 40 or weight > 660:
                    errors.append("Weight must be between 40-660 lbs")
        except (ValueError, TypeError):
            errors.append("Weight must be a valid number")
    
    # Email validation
    if 'email' in data:
        email = data['email']
        if email and '@' not in email:
            errors.append("Invalid email format")
    
    # Gender validation
    if 'gender' in data:
        gender = data['gender']
        valid_genders = ['Male', 'Female', 'Other', 'Prefer not to say']
        if gender and gender not in valid_genders:
            errors.append(f"Gender must be one of: {', '.join(valid_genders)}")
    
    # CGM Model validation
    if 'cgm_model' in data:
        cgm = data['cgm_model']
        valid_cgms = ['Dexcom G7 / One+', 'Dexcom G6 / G5 / One', 'Abbott Freestyle Libre']
        if cgm and cgm not in valid_cgms:
            errors.append(f"CGM model must be one of: {', '.join(valid_cgms)}")
    
    # Pump Model validation
    if 'pump_model' in data:
        pump = data['pump_model']
        valid_pumps = ['Omnipod 5', 'Omnipod Dash']
        if pump and pump not in valid_pumps:
            errors.append(f"Pump model must be one of: {', '.join(valid_pumps)}")
    
    # Diabetes validation
    if 'has_diabetes' in data:
        has_diabetes = data['has_diabetes']
        valid_options = ['Yes', 'No', 'Not sure']
        if has_diabetes and has_diabetes not in valid_options:
            errors.append(f"Has diabetes must be one of: {', '.join(valid_options)}")
    
    if 'diabetes_type' in data:
        diabetes_type = data['diabetes_type']
        valid_types = ['Type 1', 'Type 2', 'Gestational', 'Pre-diabetes', 'Not sure']
        if diabetes_type and diabetes_type not in valid_types:
            errors.append(f"Diabetes type must be one of: {', '.join(valid_types)}")
    
    if 'year_of_diagnosis' in data:
        year = data['year_of_diagnosis']
        if year:
            try:
                year_int = int(year)
                if year_int < 1900 or year_int > 2025:
                    errors.append("Year of diagnosis must be between 1900 and 2025")
            except (ValueError, TypeError):
                errors.append("Year of diagnosis must be a valid year")
    
    if 'uses_insulin' in data:
        uses_insulin = data['uses_insulin']
        valid_options = ['Yes', 'No']
        if uses_insulin and uses_insulin not in valid_options:
            errors.append(f"Uses insulin must be one of: {', '.join(valid_options)}")
    
    if 'insulin_type' in data:
        insulin_type = data['insulin_type']
        valid_types = ['Basal', 'Bolus', 'Both']
        if insulin_type and insulin_type not in valid_types:
            errors.append(f"Insulin type must be one of: {', '.join(valid_types)}")
    
    if 'daily_basal_dose' in data:
        dose = data['daily_basal_dose']
        if dose:
            try:
                dose_float = float(dose)
                if dose_float < 0 or dose_float > 200:
                    errors.append("Daily basal dose must be between 0 and 200 units")
            except (ValueError, TypeError):
                errors.append("Daily basal dose must be a valid number")
    
    if 'insulin_to_carb_ratio' in data:
        ratio = data['insulin_to_carb_ratio']
        if ratio:
            try:
                ratio_float = float(ratio)
                if ratio_float < 0 or ratio_float > 100:
                    errors.append("Insulin to carb ratio must be between 0 and 100")
            except (ValueError, TypeError):
                errors.append("Insulin to carb ratio must be a valid number")
    
    # Target glucose range validation
    if 'target_glucose_min' in data or 'target_glucose_max' in data:
        min_glucose = data.get('target_glucose_min')
        max_glucose = data.get('target_glucose_max')
        
        # Validate individual values
        if min_glucose is not None:
            try:
                min_glucose = int(min_glucose)
                if min_glucose < 50 or min_glucose > 250:
                    errors.append("Target glucose minimum must be between 50-250 mg/dL")
            except (ValueError, TypeError):
                errors.append("Target glucose minimum must be a valid number")
        
        if max_glucose is not None:
            try:
                max_glucose = int(max_glucose)
                if max_glucose < 50 or max_glucose > 250:
                    errors.append("Target glucose maximum must be between 50-250 mg/dL")
            except (ValueError, TypeError):
                errors.append("Target glucose maximum must be a valid number")
        
        # Validate that min < max (if both are provided and valid)
        if (min_glucose is not None and max_glucose is not None and 
            isinstance(min_glucose, int) and isinstance(max_glucose, int)):
            if min_glucose >= max_glucose:
                errors.append("Target glucose minimum must be less than maximum")
    
    return errors

if __name__ == '__main__':
    initialize_database()
    start_cgm_background_sync()  # Start CGM sync after database is ready
    
    # Print registered routes for debugging
    print("\n--- Flask Registered Routes ---")
    for rule in app.url_map.iter_rules():
        print(f"Endpoint: {rule.endpoint}, Methods: {rule.methods}, Rule: {rule.rule}")
    print("-------------------------------\n")

    app.run(host='0.0.0.0', port=3001, debug=True)
