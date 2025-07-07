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

# Load environment variables from .env file
load_dotenv()

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
    gemini_model = genai.GenerativeModel('gemini-1.5-flash')
else:
    print("GEMINI_API_KEY not found in .env. Gemini functionality will be disabled.")
    gemini_model = None

# MySQL connection
MYSQL_URL = os.getenv("MYSQL_URL", "mysql+pymysql://root:Alex%4012345@localhost/sugarsense")
engine = create_engine(MYSQL_URL)

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
    """Create the glucose_log table for glucose readings"""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS glucose_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    glucose_level DECIMAL(5,1) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp)
                )
            """))
            conn.commit()
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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_timestamp (user_id, timestamp),
                    INDEX idx_medication_type (medication_type)
                )
            """))
            conn.commit()
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

def initialize_database():
    """Creates all necessary database tables if they don't exist."""
    print("--- Initializing Database ---")
    create_glucose_log_table()
    create_food_log_table()
    create_activity_log_table()
    create_medication_log_table()
    create_sleep_log_table()
    create_health_data_archive_table()
    create_health_data_display_table()
    create_verification_health_data_table()
    print("--- Database Initialization Complete ---")

# Run initialization at startup
initialize_database()

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

# Placeholder for MySQL data (as discussed, this would come from a real DB)
# USER_HEALTH_SUMMARY = """
# User is a 35-year-old male with Type 2 Diabetes.
# Average glucose level over the last 7 days: 145 mg/dL.
# Time in range (70-180 mg/dL) today: 70%.
# Last meal: 3 hours ago, rice and chicken.
# Last activity: 1 hour ago, 30-minute walk.
# Current medications: Metformin 500mg twice daily.
# Recent trend: Glucose levels tend to spike after high-carb meals.
# """

# def generate_rag_prompt(query: str) -> str:
#     # This function is now mostly for the Gemini text-only path, or can be adapted for RAG with Gemini.
#     rag_context = f"User health summary: {USER_HEALTH_SUMMARY}\n\n"
#     prompt = f"Using the following context and health summary, answer the user's question:\n\n" \
#              f"{rag_context}" \
#              f"Question: {query}\n\n" \
#              f"Provide a concise answer, ideally under 60 words, and directly address the user's question. " \
#              f"If the information is not available in the provided context, state that clearly."
#     return prompt

# --- Flask Route for Chat API ---
@app.route('/api/chat', methods=['POST'])
def chat():
    if not gemini_model:
        return jsonify({"error": "Gemini API key not configured on the backend."}), 503

    data = request.json
    user_message = data.get('user_message', '')
    image_data_b64 = data.get('image_data')
    chat_history = data.get('chat_history', [])

    print(f"Received user_message: '{user_message}'")
    print(f"Received image_data (present): {bool(image_data_b64)}")

    # If an image is present, handle food analysis
    if image_data_b64:
        try:
            print("🖼️  CHAT ENDPOINT: Processing image in chat - attempting food analysis...")
            
            # Use the existing Gemini food analysis infrastructure
            genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
            model = genai.GenerativeModel('gemini-1.5-flash')

            # Decode the base64 image
            image_data = base64.b64decode(image_data_b64)
            image_part = {"mime_type": "image/jpeg", "data": image_data}

            # Use the same structured food analysis prompt as /gemini-analyze
            prompt_text = """
            Analyze the image provided. Your first task is to determine if the image contains food.
            
            - If the image contains food, respond with 'contains_food: true' and provide the analysis.
            - If the image does NOT contain food, respond with 'contains_food: false' and a brief 'description' explaining why it cannot be analyzed.

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
            """

            print("🔍 Analyzing image for food content...")
            response = model.generate_content([prompt_text, image_part], stream=False)
            response.resolve()

            # Parse the response
            analysis_result = parse_gemini_food_analysis(response.text)

            if 'error' in analysis_result:
                print("❌ Non-food image detected, providing general health guidance...")
                response_text = f"I can see this isn't a food image. {analysis_result['error']} Feel free to ask me any questions about your diabetes management, glucose trends, or health data!"
            else:
                print("✅ Food detected, creating conversational analysis...")
                
                nutrition = analysis_result['nutritional_values']
                description = analysis_result['description']
                ingredients = ', '.join(analysis_result['ingredients'])
                
                nutrition_text = f"📊 **Nutritional Breakdown:**\n"
                nutrition_text += f"• Calories: {nutrition['calories']:.0f}\n"
                nutrition_text += f"• Carbs: {nutrition['carbs_g']:.0f}g\n"
                nutrition_text += f"• Protein: {nutrition['protein_g']:.0f}g\n"
                nutrition_text += f"• Fat: {nutrition['fat_g']:.0f}g"
                
                carbs = nutrition['carbs_g']
                if carbs > 45:
                    glucose_impact = "🔴 **High carb content** - expect significant glucose rise in 1-2 hours"
                elif carbs > 15:
                    glucose_impact = "🟡 **Moderate carb content** - expect moderate glucose rise"
                else:
                    glucose_impact = "🟢 **Low carb content** - minimal glucose impact expected"
                
                try:
                    with engine.connect() as conn:
                        recent_avg = conn.execute(text("""
                            SELECT AVG(glucose_level) FROM glucose_log 
                            WHERE user_id = 1 AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                        """)).scalar()
                        
                        if recent_avg and recent_avg > 180:
                            personalized_advice = "💡 **Tip:** Your recent levels have been elevated. Consider light activity after eating."
                        elif recent_avg and recent_avg < 100:
                            personalized_advice = "💡 **Tip:** Your recent levels have been good. This meal may cause a spike, so monitor closely."
                        else:
                            personalized_advice = "💡 **Tip:** Monitor your glucose 1-2 hours after eating to see how this meal affects you."
                except:
                    personalized_advice = "💡 **Tip:** Monitor your glucose 1-2 hours after eating to see how this meal affects you."
                
                response_text = f"I can see this is **{description}** 🍽️\n\n"
                response_text += f"**Main ingredients:** {ingredients}\n\n"
                response_text += f"{nutrition_text}\n\n"
                response_text += f"{glucose_impact}\n\n"
                response_text += personalized_advice
                
                if collection:
                    food_context = f"User just analyzed: {description}. Nutritional info: {nutrition['calories']} calories, {nutrition['carbs_g']}g carbs, {nutrition['protein_g']}g protein, {nutrition['fat_g']}g fat. Ingredients: {ingredients}."
                    collection.add(
                        documents=[food_context], 
                        ids=[f"food_analysis_{int(datetime.now().timestamp())}"]
                    )
                    print("🧠 Stored food analysis in memory for follow-up questions")

            return jsonify({'response': response_text})

        except Exception as e:
            print(f"Error processing image: {e}")
            return jsonify({'response': "I had trouble processing that image. Please try again."}), 500

    # If no image, proceed with text-based logic
    if not user_message:
        return jsonify({'response': "Please provide a text message or an image."})

    try:
        # (The existing text-based logic remains here)
        # --- Database Queries, Health Summary, ChromaDB Retrieval, LLM Prompt ---
        # ... (all the existing code for handling text messages) ...
        # --- Database Queries ---
        with engine.connect() as conn:
            # Helper function to parse date ranges from user input
            def parse_date_range(query: str):
                today = date.today()
                start_date = None
                end_date = None

                query_lower = query.lower()

                # Try to parse specific week of month and year (e.g., "2nd week of May 2025")
                week_of_month_match = re.search(r'(first|second|third|fourth|fifth|last|[1-5]st|[1-5]nd|[1-5]rd|[1-5]th)\s+week\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})', query_lower)
                if week_of_month_match:
                    week_ordinal_str = week_of_month_match.group(1)
                    month_name = week_of_month_match.group(2)
                    year = int(week_of_month_match.group(3))
                    month_num = datetime.strptime(month_name.capitalize(), '%B').month

                    # Map ordinal words/strings to week index (0-indexed)
                    week_map = {'first': 0, '1st': 0, 'second': 1, '2nd': 1, 'third': 2, '3rd': 2, 'fourth': 3, '4th': 3, 'fifth': 4, '5th': 4, 'last': -1}
                    week_index = week_map.get(week_ordinal_str, 0)
                    
                    # Calculate start of the specified month
                    start_of_month = date(year, month_num, 1)
                    
                    # Handle 'last' week separately to ensure it's the last full or partial week
                    if week_ordinal_str == 'last':
                        # Get number of days in the month
                        days_in_month = calendar.monthrange(year, month_num)[1]
                        # Find the last day of the month
                        end_date_calc = date(year, month_num, days_in_month)
                        # Find the first day of the last week (Monday-based)
                        start_date_calc = end_date_calc - timedelta(days=end_date_calc.weekday()) # Monday of that week
                        start_date = max(start_date_calc, start_of_month) # Ensure it doesn't go into previous month
                        end_date = end_date_calc
                    else:
                        # Calculate start and end dates for the specific week
                        start_date = start_of_month + timedelta(weeks=week_index)
                        end_date = start_date + timedelta(days=6) # 7 days for the week

                        # Ensure end_date does not exceed month end
                        end_of_month = date(year, month_num, calendar.monthrange(year, month_num)[1])
                        end_date = min(end_date, end_of_month)

                # Try to parse specific month and year (e.g., "May 2025")
                elif re.search(r'(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})', query_lower):
                    month_year_match = re.search(r'(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})', query_lower)
                    month_name = month_year_match.group(1)
                    year = int(month_year_match.group(2))
                    month_num = datetime.strptime(month_name.capitalize(), '%B').month
                    start_date = date(year, month_num, 1)
                    end_date = date(year, month_num, calendar.monthrange(year, month_num)[1])

                elif "yesterday" in query_lower:
                    start_date = today - timedelta(days=1)
                    end_date = today - timedelta(days=1)
                elif "today" in query_lower:
                    start_date = today
                    end_date = today
                elif "last 7 days" in query_lower or "past week" in query_lower or "last week" in query_lower:
                    start_date = today - timedelta(days=6)
                    end_date = today
                elif "last month" in query_lower:
                    # Calculate start and end of previous month
                    last_day_of_prev_month = today.replace(day=1) - timedelta(days=1)
                    start_date = last_day_of_prev_month.replace(day=1)
                    end_date = last_day_of_prev_month
                else:
                    # If no specific date range is mentioned, try to get the overall data range
                    try:
                        with engine.connect() as conn:
                            overall_min_date = conn.execute(text("SELECT MIN(DATE(timestamp)) FROM glucose_log WHERE user_id = 1")).scalar()
                            overall_max_date = conn.execute(text("SELECT MAX(DATE(timestamp)) FROM glucose_log WHERE user_id = 1")).scalar()
                        if overall_min_date and overall_max_date:
                            start_date = overall_min_date
                            end_date = overall_max_date
                        else:
                            # Fallback to last 7 days if no data exists
                            start_date = today - timedelta(days=6)
                            end_date = today
                    except Exception as e:
                        print(f"Error fetching overall glucose data range: {e}")
                        # Fallback to last 7 days in case of DB error
                        start_date = today - timedelta(days=6)
                        end_date = today
                
                return start_date, end_date

            query_start_date, query_end_date = parse_date_range(user_message)

            glucose_daily_avg = conn.execute(text("""
                SELECT DATE(timestamp) as log_date, ROUND(AVG(glucose_level), 1) as avg_glucose
                FROM glucose_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                GROUP BY log_date
                ORDER BY log_date
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            glucose_overall_avg = conn.execute(text("""
                SELECT ROUND(AVG(glucose_level), 1) FROM glucose_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                LIMIT 1
            """), {'start_date': query_start_date, 'end_date': query_end_date}).scalar()

            food = conn.execute(text("""
                SELECT meal_type, ROUND(AVG(carbs), 1)
                FROM food_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                GROUP BY meal_type
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            meds = conn.execute(text("""
                SELECT meal_context, COUNT(*)
                FROM medication_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                GROUP BY meal_context
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            activity = conn.execute(text("""
                SELECT activity_type, ROUND(AVG(duration_minutes), 1)
                FROM activity_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                GROUP BY activity_type
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            sleep = conn.execute(text("""
                SELECT sleep_quality, COUNT(*), ROUND(AVG(TIMESTAMPDIFF(MINUTE, sleep_start, sleep_end))/60, 1)
                FROM sleep_log
                WHERE user_id = 1 AND DATE(sleep_end) BETWEEN :start_date AND :end_date
                GROUP BY sleep_quality
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            recent_glucose = conn.execute(text("""
                SELECT timestamp, glucose_level FROM glucose_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                ORDER BY timestamp DESC LIMIT 10
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            recent_food = conn.execute(text("""
                SELECT timestamp, meal_type, carbs FROM food_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                ORDER BY timestamp DESC LIMIT 10
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            recent_activity = conn.execute(text("""
                SELECT timestamp, activity_type, duration_minutes FROM activity_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                ORDER BY timestamp DESC LIMIT 10
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            recent_sleep = conn.execute(text("""
                SELECT sleep_start, sleep_end, sleep_quality FROM sleep_log
                WHERE user_id = 1 AND DATE(sleep_end) BETWEEN :start_date AND :end_date
                ORDER BY sleep_end DESC LIMIT 5
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            recent_meds = conn.execute(text("""
                SELECT timestamp, medication_name, dosage, meal_context FROM medication_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                ORDER BY timestamp DESC LIMIT 10
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

            min_max_glucose_daily = conn.execute(text("""
                SELECT
                    DATE(timestamp) as log_date,
                    MIN(glucose_level) as min_glucose,
                    MAX(glucose_level) as max_glucose
                FROM glucose_log
                WHERE user_id = 1 AND DATE(timestamp) BETWEEN :start_date AND :end_date
                GROUP BY log_date
                ORDER BY log_date
            """), {'start_date': query_start_date, 'end_date': query_end_date}).fetchall()

        # --- Build Health Summary ---
        health_summary = "### Health Summary\n"
        health_summary += "Carbs per meal:\n" + "\n".join(f"- {m[0]}: {m[1]}g" for m in food)
        health_summary += "\nMedication effects:\n" + "\n".join(f"- {m[0]}: {m[1]} times" for m in meds)
        health_summary += "\nActivity summary:\n" + "\n".join(f"- {a[0]}: {a[1]} minutes" for a in activity)
        health_summary += "\nSleep summary:\n" + "\n".join(f"- {s[0]}: {s[1]} nights, avg duration: {s[2]} hours" for s in sleep)

        if glucose_overall_avg is not None:
            health_summary += f"\nOverall Avg Glucose ({query_start_date} to {query_end_date}): {glucose_overall_avg} mg/dL"

        health_summary += "\nDaily Avg Glucose:\n" + "\n".join(f"- {row.log_date.strftime('%Y-%m-%d')}: {row.avg_glucose} mg/dL" for row in glucose_daily_avg)

        # Find the day with the largest glucose fluctuation
        largest_fluctuation = None
        largest_fluctuation_date = None
        largest_fluctuation_min = None
        largest_fluctuation_max = None
        for row in min_max_glucose_daily:
            fluctuation = row.max_glucose - row.min_glucose
            if (largest_fluctuation is None) or (fluctuation > largest_fluctuation):
                largest_fluctuation = fluctuation
                largest_fluctuation_date = row.log_date
                largest_fluctuation_min = row.min_glucose
                largest_fluctuation_max = row.max_glucose
        if largest_fluctuation_date is not None:
            health_summary += f"\nLargest Fluctuation: {largest_fluctuation_date.strftime('%Y-%m-%d')} (Range: {largest_fluctuation_min}-{largest_fluctuation_max} mg/dL, Δ={largest_fluctuation} mg/dL)"

        health_summary += "\nDaily Glucose Range:\n" + "\n".join(f"- {row.log_date.strftime('%Y-%m-%d')}: {row.min_glucose} - {row.max_glucose} mg/dL" for row in min_max_glucose_daily)

        health_summary += "\n### Recent Events (within selected range)\n"
        health_summary += "Glucose:\n" + "\n".join(f"- {row.timestamp.strftime('%Y-%m-%d %H:%M')}: {row.glucose_level} mg/dL" for row in recent_glucose)
        health_summary += "\nFood:\n" + "\n".join(f"- {row.timestamp.strftime('%Y-%m-%d %H:%M')}: {row.meal_type}, {row.carbs}g carbs" for row in recent_food)
        health_summary += "\nActivity:\n" + "\n".join(f"- {row.timestamp.strftime('%Y-%m-%d %H:%M')}: {row.activity_type}, {row.duration_minutes} mins" for row in recent_activity)
        health_summary += "\nSleep:\n" + "\n".join(f"- {row.sleep_start.strftime('%Y-%m-%d %H:%M')} to {row.sleep_end.strftime('%Y-%m-%d %H:%M')}: {row.sleep_quality}" for row in recent_sleep)
        health_summary += "\nMedication:\n" + "\n".join(f"- {row.timestamp.strftime('%Y-%m-%d %H:%M')}: {row.medication_name}, {row.dosage}mg, {row.meal_context}" for row in recent_meds)

        # --- ChromaDB Retrieval ---
        if collection:
            retrieved = collection.query(query_texts=[user_message], n_results=2)
            memory = "\n".join(retrieved["documents"][0])
        else:
            memory = "No contextual insights available."

        # --- LLM Prompt Construction ---
        prompt = f"""You are SugarSense.ai, a personal diabetes and wellness assistant.
Your role is to analyze the user's health data and provide concise, helpful explanations about glucose patterns, medication timing, food/carb intake, sleep, activity, and how these factors may influence their glucose levels.

If the user's message is a simple expression of gratitude (e.g., 'Thank you', 'Thanks'), respond with a warm, supportive, and concise conversational message like 'You're welcome! I'm always here to help you.' or 'Glad I could assist!' Do not provide any unrelated data insights in these instances.

IMPORTANT: If the user's question is not directly related to health data, glucose, nutrition, activity, sleep, or medication, please state that you can only assist with health-related queries and ask them to rephrase their question. Otherwise, analyze the provided health summary and contextual insights to answer the user's question concisely (max 70 words). When asked about glucose stability, identify the day with the *smallest difference* between MIN and MAX glucose levels (i.e., the smallest daily range) and provide that date and its glucose range. Always aim to provide the best possible answer based on the data, even if it's limited. Be direct and clear while maintaining accuracy. Only offer data insights when explicitly asked or when relevant to a health-related query.

User asked: "{user_message}"

Health Summary:
{health_summary}

Contextual Insights (only use if directly relevant to the specific question):
{memory}

Provide a concise response (max 70 words) that directly addresses the user's question using the data provided. If the question is not health-related, state so and ask for a relevant query."""

        # Start a chat session for context-aware text responses
        chat_history_formatted = []
        for msg in chat_history:
            role = "user" if msg["type"] == "user" else "model"
            if msg.get("text"):
                chat_history_formatted.append({"role": role, "parts": [{"text": msg["text"]}]})
        print(f"chat_history_formatted: {chat_history_formatted}")

        convo = gemini_model.start_chat(history=chat_history_formatted)
        response = convo.send_message(prompt)
        response_text = response.text

        # Add response to ChromaDB memory (if not an error)
        if collection and not response_text.startswith("Error"): # Simple check to avoid storing error messages
            collection.add(documents=[response_text], ids=[f"chat_{uuid.uuid4()}"])
            print("Added response to ChromaDB memory.")
        
        print(f"Gemini text response: {response_text}")
        return jsonify({'response': response_text})

    except Exception as e:
        print(f"Error processing text chat: {e}")
        return jsonify({'response': "I'm sorry, I couldn't process your request at the moment. Please try again."}), 500
    
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
        model = genai.GenerativeModel('gemini-1.5-flash')

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
            with engine.connect() as conn:
                recent_avg = conn.execute(text("""
                    SELECT AVG(glucose_level) FROM glucose_log 
                    WHERE user_id = 1 AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                """)).scalar()
                
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
    user_id = 1 # Assuming user_id 1 for now
    glucose_level = data.get('glucoseLevel')
    log_time_str = data.get('time')

    if not all([glucose_level, log_time_str]):
        return jsonify({"error": "Missing glucose level or time"}), 400
    
    try:
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
    except Exception as e:
        print(f"Error logging glucose: {e}")
        return jsonify({"error": "Failed to log glucose data."}), 500

# New endpoint for logging meal data
@app.route('/api/log-meal', methods=['POST'])
def log_meal():
    # Ensure the food_log table exists
    create_food_log_table()
    
    data = request.json
    user_id = 1 # Hardcoded for now
    
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
    if not all([meal_type, food_description]):
        return jsonify({"error": "Missing meal_type or food_description"}), 400
    
    # Coalesce None to 0 for numerical fields
    calories = float(calories or 0)
    carbs = float(carbs or 0)
    protein = float(protein or 0)
    fat = float(fat or 0)
    sugar = float(sugar or 0)
    fiber = float(fiber or 0)

    try:
        with engine.connect() as conn:
            # Updated SQL query with all nutritional columns
            conn.execute(text("""
                INSERT INTO food_log (
                    user_id, timestamp, meal_type, food_description, 
                    calories, carbs, protein, fat, sugar, fiber
                )
                VALUES (
                    :user_id, NOW(), :meal_type, :food_description, 
                    :calories, :carbs, :protein, :fat, :sugar, :fiber
                )
            """), {
                'user_id': user_id,
                'meal_type': meal_type,
                'food_description': food_description,
                'calories': calories,
                'carbs': carbs,
                'protein': protein,
                'fat': fat,
                'sugar': sugar,
                'fiber': fiber,
            })
            conn.commit()
        return jsonify({"message": "Meal logged successfully"}), 200
    except Exception as e:
        print(f"Error logging meal: {e}")
        # Provide a more specific error message if it's a known schema issue
        if "Unknown column" in str(e):
             return jsonify({"error": "Database schema error. Make sure the 'food_log' table has columns for protein, fat, sugar, and fiber."}), 500
        return jsonify({"error": "Failed to log meal data."}), 500

# New endpoint for logging activity data
@app.route('/api/log-activity', methods=['POST'])
def log_activity():
    # Ensure the activity_log table exists
    create_activity_log_table()
    
    data = request.json
    user_id = 1 # Assuming user_id 1 for now
    activity_type = data.get('activity_type')
    duration_minutes = data.get('duration_minutes')
    steps = data.get('steps', 0) # Optional
    calories_burned = data.get('calories_burned', 0) # Optional
    # Assuming activity is logged at current time
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if not all([activity_type, duration_minutes]):
        return jsonify({"error": "Missing activity details"}), 400
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO activity_log (user_id, timestamp, activity_type, duration_minutes, steps, calories_burned)
                VALUES (:user_id, :timestamp, :activity_type, :duration_minutes, :steps, :calories_burned)
            """), {'user_id': user_id, 'timestamp': timestamp, 'activity_type': activity_type, 'duration_minutes': duration_minutes, 'steps': steps, 'calories_burned': calories_burned})
            conn.commit()
        return jsonify({"message": "Activity logged successfully"}), 200
    except Exception as e:
        print(f"Error logging activity: {e}")
        return jsonify({"error": "Failed to log activity data."}), 500

# New endpoint for glucose prediction
@app.route('/api/predict-glucose', methods=['POST'])
def predict_glucose():
    data = request.json
    current_glucose = data.get('current_glucose')
    recent_carbs = data.get('recent_carbs', 0) # Carbs from last meal
    recent_activity_minutes = data.get('recent_activity_minutes', 0) # Minutes of last activity
    recent_sleep_quality = data.get('recent_sleep_quality', 'average') # 'good', 'average', 'poor'

    if current_glucose is None:
        return jsonify({"error": "Current glucose level is required."}), 400

    if not nixtla_client:
        return jsonify({"error": "Nixtla TimeGPT is not initialized. Please check backend logs."}), 503

    try:
        # 1. Fetch historical data for TimeGPT
        # Query a broader range to provide sufficient context for TimeGPT
        # We'll fetch data for the last 30 days as a reasonable window.
        lookback_days = 30
        history_start_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
        history_end_date = datetime.now().strftime('%Y-%m-%d')

        with engine.connect() as conn:
            historical_data = conn.execute(text("""
                SELECT
                    gl.timestamp, gl.glucose_level,
                    fl.carbs, al.duration_minutes, sl.sleep_quality
                FROM glucose_log gl
                LEFT JOIN food_log fl ON gl.timestamp = fl.timestamp AND gl.user_id = fl.user_id
                LEFT JOIN activity_log al ON gl.timestamp = al.timestamp AND gl.user_id = al.user_id
                LEFT JOIN sleep_log sl ON gl.timestamp = sl.sleep_end AND gl.user_id = sl.user_id
                WHERE gl.user_id = 1 AND DATE(gl.timestamp) BETWEEN :start_date AND :end_date
                ORDER BY gl.timestamp ASC
            """), {'start_date': history_start_date, 'end_date': history_end_date}).fetchall()

        if not historical_data:
            # Fallback if no historical data exists, use mock prediction
            print("No historical data found for TimeGPT. Using mock prediction.")
            # --- Existing Mock Prediction Logic --- (copying for fallback)
            predicted_levels = []
            initial_prediction = current_glucose
            if recent_carbs > 30: initial_prediction += 30
            elif recent_carbs > 10: initial_prediction += 15
            if recent_activity_minutes > 30: initial_prediction -= 20
            elif recent_activity_minutes > 10: initial_prediction -= 10
            if recent_sleep_quality == 'poor': initial_prediction += 10
            elif recent_sleep_quality == 'good': initial_prediction -= 5
            predicted_levels.append(round(initial_prediction, 1))
            for i in range(1, 4): next_level = predicted_levels[-1] * 0.95 + 100 * 0.05; predicted_levels.append(round(next_level, 1))
            while len(predicted_levels) < 6: next_level = predicted_levels[-1] * 0.95 + 100 * 0.05; predicted_levels.append(round(next_level, 1))
            predicted_levels = [max(40.0, min(300.0, level)) for level in predicted_levels]
            return jsonify({"predictions": predicted_levels})
        
        # 2. Prepare data for TimeGPT
        # Convert to Pandas DataFrame
        df_history = pd.DataFrame(historical_data, columns=['timestamp', 'glucose_level', 'carbs', 'activity_minutes', 'sleep_quality'])
        df_history['ds'] = pd.to_datetime(df_history['timestamp'])
        df_history['y'] = df_history['glucose_level']
        df_history = df_history.drop(columns=['timestamp', 'glucose_level'])

        # Handle missing exogenous values (fill with 0 or last known good value)
        df_history['carbs'] = df_history['carbs'].fillna(0) # Or use .bfill().ffill() for more sophisticated filling
        df_history['activity_minutes'] = df_history['activity_minutes'].fillna(0)
        # Encode sleep_quality numerically
        sleep_quality_map = {'good': 2, 'average': 1, 'poor': 0}
        df_history['sleep_quality'] = df_history['sleep_quality'].map(sleep_quality_map).fillna(1) # Default to average

        # Ensure consistent time granularity if needed by TimeGPT. For simplicity,
        # assuming your current data is suitable or will be handled by TimeGPT's internal logic.

        # 3. Generate future exogenous variables
        # For a 4-6 hour prediction horizon, let's assume 6 future points.
        # We'll use the most recent values for future exogenous variables.
        last_known_carbs = df_history['carbs'].iloc[-1] if not df_history['carbs'].empty else recent_carbs
        last_known_activity = df_history['activity_minutes'].iloc[-1] if not df_history['activity_minutes'].empty else recent_activity_minutes
        last_known_sleep = df_history['sleep_quality'].iloc[-1] if not df_history['sleep_quality'].empty else sleep_quality_map.get(recent_sleep_quality, 1)

        # Create a DataFrame for future exogenous variables for the prediction horizon (h)
        h_horizon = 6 # Predict for next 6 hours (adjust as needed)
        future_exog_df = pd.DataFrame({
            'ds': [df_history['ds'].iloc[-1] + timedelta(hours=i+1) for i in range(h_horizon)],
            'carbs': [last_known_carbs] * h_horizon,
            'activity_minutes': [last_known_activity] * h_horizon,
            'sleep_quality': [last_known_sleep] * h_horizon
        })

        # Add the current glucose level as the very last historical point to ensure continuity
        current_time_series_point = pd.DataFrame({
            'ds': [datetime.now()],
            'y': [current_glucose],
            'carbs': [recent_carbs],
            'activity_minutes': [recent_activity_minutes],
            'sleep_quality': [sleep_quality_map.get(recent_sleep_quality, 1)]
        })
        df_history = pd.concat([df_history, current_time_series_point], ignore_index=True)
        df_history = df_history.sort_values(by='ds').reset_index(drop=True)

        # 4. Call nixtla_client.forecast()
        # Note: TimeGPT expects 'ds' and 'y' in the input df, and 'ds' for X_df
        forecast_df = nixtla_client.forecast(
            df=df_history,
            X_df=future_exog_df,
            h=h_horizon,
            time_col='ds',
            target_col='y',
            # Provide the names of your exogenous variables
            # 'carbs', 'activity_minutes', and 'sleep_quality' must be present in both df and X_df
            freq='H' # Assuming hourly data frequency, adjust if your data is different
        )

        predicted_levels = forecast_df['y'].tolist()
        predicted_levels = [round(level, 1) for level in predicted_levels]

        # Ensure predictions are within a reasonable physiological range
        predicted_levels = [max(40.0, min(300.0, level)) for level in predicted_levels]

        print(f"TimeGPT Predicted Glucose Levels: {predicted_levels}")
        return jsonify({"predictions": predicted_levels})

    except Exception as e:
        print(f"Error during glucose prediction with TimeGPT: {e}")
        # Fallback to mock prediction in case of TimeGPT error
        predicted_levels = []
        initial_prediction = current_glucose
        if recent_carbs > 30: initial_prediction += 30
        elif recent_carbs > 10: initial_prediction += 15
        if recent_activity_minutes > 30: initial_prediction -= 20
        elif recent_activity_minutes > 10: initial_prediction -= 10
        if recent_sleep_quality == 'poor': initial_prediction += 10
        elif recent_sleep_quality == 'good': initial_prediction -= 5
        predicted_levels.append(round(initial_prediction, 1))
        for i in range(1, 4): next_level = predicted_levels[-1] * 0.95 + 100 * 0.05; predicted_levels.append(round(next_level, 1))
        while len(predicted_levels) < 6: next_level = predicted_levels[-1] * 0.95 + 100 * 0.05; predicted_levels.append(round(next_level, 1))
        predicted_levels = [max(40.0, min(300.0, level)) for level in predicted_levels]
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

@app.route('/api/sync-dashboard-health-data', methods=['POST'])
def sync_dashboard_health_data():
    """
    New two-table sync endpoint for dashboard data (Steps, Distance, Calories, etc.)
    - All incoming data is safely UPSERTED into `health_data_archive` to maintain a permanent, de-duplicated log.
    - The `health_data_display` table is wiped for the user/data types and completely rebuilt with the new data.
    This ensures the dashboard is always fast, accurate, and de-duplicated without data loss.
    """
    data = request.json
    user_id = data.get('user_id', 1)
    health_data = data.get('health_data', {})
    
    if not health_data:
        return jsonify({"error": "No health data provided"}), 400
    
    try:
        # Ensure all tables exist
        create_health_data_archive_table()
        create_health_data_display_table()

        records_archived = 0
        records_displayed = 0
        
        with engine.begin() as conn: # Use a single transaction
            
            # Get a list of all data types in this sync
            data_types_in_sync = [map_healthkit_data_type(dt) for dt in health_data.keys()]

            # 1. Clear the DISPLAY table for the data types being synced
            if data_types_in_sync:
                clear_health_data_display_for_sync(conn, user_id, data_types_in_sync)

            # 2. Process each entry: ARCHIVE it and then add to DISPLAY
            for data_type, entries in health_data.items():
                internal_data_type = map_healthkit_data_type(data_type)
                
                if isinstance(entries, list) and entries:
                    for entry in entries:
                        record = process_health_entry(user_id, internal_data_type, entry)
                        if record:
                            # Upsert into permanent archive (idempotent)
                            upsert_health_record(conn, record)
                            records_archived += 1
                            
                            # Insert into the clean display table
                            insert_health_data_display(conn, record)
                            records_displayed += 1
        
        print(f"✅ DISPLAY SYNC COMPLETE: Archived {records_archived} records, Displayed {records_displayed} records.")
        
        return jsonify({
            "message": "Successfully synced display data",
            "records_archived": records_archived,
            "records_displayed": records_displayed
        }), 200
        
    except Exception as e:
        print(f"Error during two-table sync: {e}")
        return jsonify({"error": f"Failed to sync display health data: {str(e)}"}), 500

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
        if 'quantity' in entry:
            record['value'] = float(entry['quantity'])
        elif 'value' in entry:
            if isinstance(entry['value'], (int, float)):
                record['value'] = float(entry['value'])
            else:
                record['value_string'] = str(entry['value'])
        
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

# def insert_health_record(conn, record):
#     """Insert a health record into the database with enhanced field support"""
#     try:
#         conn.execute(text("""
#             INSERT INTO health_data_archive (
#                 user_id, data_type, data_subtype, value, value_string, unit,
#                 start_date, end_date, source_name, source_bundle_id, device_name, 
#                 sample_id, category_type, workout_activity_type, total_energy_burned,
#                 total_distance, average_quantity, minimum_quantity, maximum_quantity, metadata
#             ) VALUES (
#                 :user_id, :data_type, :data_subtype, :value, :value_string, :unit,
#                 :start_date, :end_date, :source_name, :source_bundle_id, :device_name,
#                 :sample_id, :category_type, :workout_activity_type, :total_energy_burned,
#                 :total_distance, :average_quantity, :minimum_quantity, :maximum_quantity, :metadata
#             )
#         """), record)
#     except Exception as e:
#         print(f"Error inserting health record: {e}")
#         print(f"Record data: {record}")
#         raise

def upsert_health_record(conn, record):
    """
    Insert or update a health record in the ARCHIVE table.
    Now strictly enforces upsert based on sample_id.
    """
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
    except Exception as e:
        print(f"Error upserting health record: {e}")
        print(f"Record data: {record}")
        raise

# def create_sync_time_period_replacement(conn, user_id, data_type, start_date, end_date):
#     """
#     [DEPRECATED] - This function is no longer recommended for the two-table model.
#     Use `clear_health_data_display_for_sync` instead.
#     It deletes existing records for a specific time period to ensure clean replacement.
#     """
#     try:
#         result = conn.execute(text("""
#             DELETE FROM health_data_archive 
#             WHERE user_id = :user_id 
#             AND data_type = :data_type 
#             AND start_date >= :start_date 
#             AND end_date <= :end_date
#         """), {
#             'user_id': user_id,
#             'data_type': data_type, 
#             'start_date': start_date,
#             'end_date': end_date
#         })
        
#         deleted_count = result.rowcount
#         if deleted_count > 0:
#             print(f"🗑️ Cleared {deleted_count} existing {data_type} records for time period replacement")
#         return deleted_count
        
#     except Exception as e:
#         print(f"Error clearing time period for {data_type}: {e}")
#         return 0

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
    user_id = 1 # Assuming user_id 1 for now
    medication_type = data.get('medication_type')
    medication_name = data.get('medication_name')
    dosage = data.get('dosage')
    log_time_str = data.get('time')
    meal_context = data.get('meal_context')
    insulin_type = data.get('insulin_type', None) # Optional for insulin

    if not all([medication_type, medication_name, dosage, log_time_str]):
        return jsonify({"error": "Missing medication details"}), 400

    try:
        # The timestamp string is now sent in 'YYYY-MM-DD HH:MM:SS' format from the frontend,
        # which is directly usable by MySQL.
        timestamp = log_time_str

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO medication_log (user_id, timestamp, medication_type, medication_name, dosage, insulin_type, meal_context)
                VALUES (:user_id, :timestamp, :medication_type, :medication_name, :dosage, :insulin_type, :meal_context)
            """), {
                'user_id': user_id,
                'timestamp': timestamp,
                'medication_type': medication_type,
                'medication_name': medication_name,
                'dosage': dosage,
                'insulin_type': insulin_type,
                'meal_context': meal_context
            })
            conn.commit()
        return jsonify({"message": "Medication logged successfully"}), 200
    except Exception as e:
        print(f"Error logging medication: {e}")
        return jsonify({"error": "Failed to log medication data."}), 500

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
            # Get all raw sleep analysis samples for the user
            raw_sleep_records = conn.execute(text("""
                SELECT start_date, end_date, metadata, value
                FROM health_data_archive
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
                sleep_efficiency = 0.85
                actual_sleep_hours = (total_sleep_minutes / 60) * sleep_efficiency

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
        
# Debug endpoint to check sleep values
# @app.route('/api/debug-sleep', methods=['GET'])
# def debug_sleep():
#     try:
#         with engine.connect() as conn:
#             result = conn.execute(text("""
#                 SELECT 
#                     value, 
#                     COUNT(*) as count,
#                     MIN(start_date) as earliest,
#                     MAX(end_date) as latest,
#                     ROUND(SUM(TIMESTAMPDIFF(SECOND,start_date,end_date))/3600, 2) as total_hours
#                 FROM health_data_archive 
#                 WHERE data_type = 'SleepAnalysis' AND user_id = 1
#                 GROUP BY value
#                 ORDER BY value
#             """)).fetchall()
            
#             sleep_values = []
#             for row in result:
#                 sleep_values.append({
#                     'value': row[0],
#                     'count': row[1], 
#                     'earliest': str(row[2]),
#                     'latest': str(row[3]),
#                     'total_hours': row[4]
#                 })
            
#             return jsonify({'sleep_values': sleep_values})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

# Manual endpoint to refresh sleep summary
# @app.route('/api/refresh-sleep-summary', methods=['POST'])
# def refresh_sleep_summary_endpoint():
#     try:
#         user_id = request.json.get('user_id', 1) if request.json else 1
#         refresh_sleep_summary(user_id)
#         return jsonify({'message': 'Sleep summary refreshed successfully'})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

# Endpoint to check sleep_summary table contents
# @app.route('/api/check-sleep-summary', methods=['GET'])
# def check_sleep_summary():
#     try:
#         with engine.connect() as conn:
#             result = conn.execute(text("""
#                 SELECT 
#                     sleep_date,
#                     CONCAT(
#                         FLOOR(sleep_hours), ' hr ',
#                         LPAD(ROUND((sleep_hours - FLOOR(sleep_hours))*60),2,'0'),
#                         ' min'
#                     ) AS formatted_sleep,
#                     DATE_FORMAT(sleep_start, '%H:%i') AS start_time,
#                     DATE_FORMAT(sleep_end, '%H:%i') AS end_time,
#                     sleep_hours
#                 FROM sleep_summary 
#                 WHERE user_id = 1 
#                 ORDER BY sleep_date DESC
#             """)).fetchall()
            
#             sleep_summary_data = []
#             for row in result:
#                 sleep_summary_data.append({
#                     'sleep_date': str(row[0]),
#                     'formatted_sleep': row[1],
#                     'start_time': row[2],
#                     'end_time': row[3],
#                     'sleep_hours': float(row[4])
#                 })
            
#             return jsonify({
#                 'count': len(sleep_summary_data),
#                 'sleep_summary': sleep_summary_data
#             })
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

# New endpoint to test Apple Health-like sleep calculation directly
# @app.route('/api/test-apple-sleep-calculation', methods=['GET'])
# def test_apple_sleep_calculation():
#     try:
#         with engine.connect() as conn:
#             # Get raw sleep data for comparison
#             raw_sleep_data = conn.execute(text("""
#                 SELECT 
#                     data_type,
#                     data_subtype,
#                     value,
#                     start_date,
#                     end_date,
#                     source_name,
#                     TIMESTAMPDIFF(SECOND, start_date, end_date) / 3600.0 AS duration_hours
#                 FROM health_data_archive 
#                 WHERE data_type = 'SleepAnalysis' AND user_id = 1
#                 ORDER BY start_date DESC
#                 LIMIT 50
#             """)).fetchall()
            
#             # Get calculated summaries
#             calculated_summaries = conn.execute(text("""
#                 SELECT 
#                     data_subtype,
#                     value AS sleep_hours,
#                     value_string AS formatted_sleep,
#                     start_date,
#                     end_date,
#                     source_name,
#                     metadata
#                 FROM health_data_archive 
#                 WHERE data_type = 'SleepAnalysis' 
#                   AND data_subtype = 'sleep_summary'
#                   AND user_id = 1
#                 ORDER BY start_date DESC
#             """)).fetchall()
            
#             # Get sleep_summary table data
#             sleep_summary_data = conn.execute(text("""
#                 SELECT 
#                     sleep_date,
#                     sleep_hours,
#                     CONCAT(
#                         FLOOR(sleep_hours), ' hr ',
#                         LPAD(ROUND((sleep_hours - FLOOR(sleep_hours))*60),2,'0'),
#                         ' min'
#                     ) AS formatted_sleep,
#                     sleep_start,
#                     sleep_end
#                 FROM sleep_summary 
#                 WHERE user_id = 1 
#                 ORDER BY sleep_date DESC
#                 LIMIT 10
#             """)).fetchall()
            
#             return jsonify({
#                 'raw_sleep_samples': [
#                     {
#                         'data_type': row[0],
#                         'data_subtype': row[1],
#                         'value': row[2],
#                         'start_date': str(row[3]),
#                         'end_date': str(row[4]),
#                         'source_name': row[5],
#                         'duration_hours': float(row[6]) if row[6] else 0
#                     } for row in raw_sleep_data
#                 ],
#                 'calculated_summaries': [
#                     {
#                         'data_subtype': row[0],
#                         'sleep_hours': float(row[1]) if row[1] else 0,
#                         'formatted_sleep': row[2],
#                         'start_date': str(row[3]),
#                         'end_date': str(row[4]),
#                         'source_name': row[5],
#                         'metadata': row[6]
#                     } for row in calculated_summaries
#                 ],
#                 'sleep_summary_table': [
#                     {
#                         'sleep_date': str(row[0]),
#                         'sleep_hours': float(row[1]),
#                         'formatted_sleep': row[2],
#                         'sleep_start': str(row[3]),
#                         'sleep_end': str(row[4])
#                     } for row in sleep_summary_data
#                 ]
#             })
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

@app.route('/api/diabetes-dashboard', methods=['GET'])
def get_diabetes_dashboard():
    """Provides a comprehensive summary for the diabetes dashboard."""
    try:
        user_id = request.args.get('user_id', 1, type=int)
        days = request.args.get('days', 15, type=int)
        
        end_date = date.today()
        start_date = end_date - timedelta(days=days)
        start_of_range_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)

        with engine.connect() as conn:
            # --- 1. GLUCOSE DATA ---
            glucose_query = text("""
                SELECT timestamp, glucose_level FROM glucose_log
                WHERE user_id = :user_id AND timestamp >= :start_date
                ORDER BY timestamp
            """)
            glucose_records = conn.execute(glucose_query, {'user_id': user_id, 'start_date': start_date}).fetchall()

            glucose_by_day = {}
            for r in glucose_records:
                day = r.timestamp.strftime('%Y-%m-%d')
                if day not in glucose_by_day:
                    glucose_by_day[day] = []
                glucose_by_day[day].append(r.glucose_level)
            
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
            # Always get exactly 7 days for Sleep Patterns consistency
            sleep_days_range = 7
            print(f"🛏️ Dashboard: Using improved sleep analysis for {sleep_days_range} days (Sleep Patterns)")
            improved_sleep_result = get_improved_sleep_data(user_id, sleep_days_range)
            
            sleep_data = []
            if improved_sleep_result.get('success'):
                daily_summaries = improved_sleep_result.get('daily_summaries', [])
                for summary in daily_summaries:
                    sleep_data.append({
                        'date': summary['date'],
                        'bedtime': summary['bedtime'],
                        'wake_time': summary['wake_time'],
                        'sleep_hours': summary['sleep_hours'],
                        'formatted_sleep': summary['formatted_sleep'],
                        'has_data': summary.get('has_data', True)
                    })
                print(f"✅ Dashboard: Using {len(sleep_data)} sleep summaries (including {improved_sleep_result.get('days_without_data', 0)} days with no data)")
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
            
            # Note: sleep_data is already in chronological order from the function
            avg_sleep_hours = sum(s['sleep_hours'] for s in sleep_data if s['has_data']) / len([s for s in sleep_data if s['has_data']]) if any(s['has_data'] for s in sleep_data) else 0

            # --- 5. ACTIVITY DATA (STEPS + CALORIES FROM APPLE HEALTH + MANUAL) ---
            # Get Apple Health step data
            apple_steps_query = text("""
                SELECT DATE(start_date) as date, SUM(CAST(value AS DECIMAL(10,2))) as total_steps 
                FROM health_data_archive
                WHERE user_id = :user_id AND data_type = 'StepCount' 
                  AND start_date >= :start_date
                GROUP BY DATE(start_date)
                ORDER BY DATE(start_date) DESC
            """)
            apple_step_records = conn.execute(apple_steps_query, {'user_id': user_id, 'start_date': start_of_range_dt}).fetchall()
            
            # Get Apple Health active calories burned data
            apple_calories_query = text("""
                SELECT DATE(start_date) as date, SUM(CAST(value AS DECIMAL(10,2))) as total_calories 
                FROM health_data_archive
                WHERE user_id = :user_id AND data_type = 'ActiveEnergyBurned' 
                  AND start_date >= :start_date
                GROUP BY DATE(start_date)
                ORDER BY DATE(start_date) DESC
            """)
            apple_calories_records = conn.execute(apple_calories_query, {'user_id': user_id, 'start_date': start_of_range_dt}).fetchall()
            
            # Get manual activity data from activity_log table
            manual_activity_query = text("""
                SELECT DATE(timestamp) as date, SUM(COALESCE(steps, 0)) as total_steps, SUM(COALESCE(calories_burned, 0)) as total_calories
                FROM activity_log
                WHERE user_id = :user_id AND DATE(timestamp) >= :start_date
                  AND (steps > 0 OR calories_burned > 0)
                GROUP BY DATE(timestamp)
            """)
            manual_activity_records = conn.execute(manual_activity_query, {'user_id': user_id, 'start_date': start_date}).fetchall()
            
            # Combine Apple Health and manual activity data
            daily_activity = {}
            
            # Add Apple Health steps
            for r in apple_step_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0}
                daily_activity[day_key]['steps'] = int(r.total_steps)
            
            # Add Apple Health calories
            for r in apple_calories_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0}
                daily_activity[day_key]['calories'] = int(r.total_calories)
            
            # Add manual activity data (combine with Apple Health for same day)
            for r in manual_activity_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                if day_key not in daily_activity:
                    daily_activity[day_key] = {'steps': 0, 'calories': 0}
                
                # Add manual steps to existing Apple Health steps
                daily_activity[day_key]['steps'] += int(r.total_steps) if r.total_steps else 0
                # Add manual calories to existing Apple Health calories
                daily_activity[day_key]['calories'] += int(r.total_calories) if r.total_calories else 0
            
            # Create activity data structure
            activity_data = []
            for date_key, activity in daily_activity.items():
                activity_data.append({
                    'date': date_key, 
                    'steps': activity['steps'], 
                    'calories_burned': activity['calories'],
                    'distance_km': 0
                })
            activity_data.sort(key=lambda x: x['date'], reverse=True)
            
            # Calculate averages
            total_steps = sum(a['steps'] for a in activity_data)
            total_calories = sum(a['calories_burned'] for a in activity_data)
            avg_daily_steps = total_steps / len(activity_data) if activity_data else 0
            avg_daily_calories = total_calories / len(activity_data) if activity_data else 0
            
            print(f"📊 ACTIVITY SUMMARY: {len(activity_data)} days, {total_steps} total steps, {int(avg_daily_steps)} avg daily")
            print(f"🔥 CALORIES SUMMARY: {len(activity_data)} days, {total_calories} total calories, {int(avg_daily_calories)} avg daily")

            # --- 6. WALKING + RUNNING DISTANCE DATA ---
            # Get Apple Health distance data
            apple_distance_query = text("""
                SELECT DATE(start_date) as date, SUM(CAST(value AS DECIMAL(10,4))) as total_distance 
                FROM health_data_archive
                WHERE user_id = :user_id AND data_type = 'DistanceWalkingRunning' 
                  AND start_date >= :start_date
                GROUP BY DATE(start_date)
                ORDER BY DATE(start_date) DESC
            """)
            apple_distance_records = conn.execute(apple_distance_query, {'user_id': user_id, 'start_date': start_of_range_dt}).fetchall()
            
            # Use only Apple Health distance data for now (manual activities don't track distance)
            daily_distances = {}
            
            # Add Apple Health distances (convert miles to km for consistency)
            for r in apple_distance_records:
                day_key = r.date.strftime('%Y-%m-%d') if hasattr(r.date, 'strftime') else str(r.date)
                daily_distances[day_key] = round(float(r.total_distance) * 1.60934, 2)  # Convert miles to km
            
            # Create walking + running data structure
            walking_running_data = []
            for date_key, distance_km in daily_distances.items():
                walking_running_data.append({'date': date_key, 'distance_km': round(distance_km, 2), 'distance_miles': round(distance_km / 1.60934, 2)})
            walking_running_data.sort(key=lambda x: x['date'], reverse=True)
            
            # Calculate average distance
            total_distance_km = sum(d['distance_km'] for d in walking_running_data)
            avg_daily_distance_km = total_distance_km / len(walking_running_data) if walking_running_data else 0
            avg_daily_distance_miles = avg_daily_distance_km / 1.60934 if avg_daily_distance_km > 0 else 0
            
            print(f"📏 DISTANCE SUMMARY: {len(walking_running_data)} days, {total_distance_km:.2f} km total, {avg_daily_distance_km:.2f} km avg daily")

            return jsonify({
                "date_range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": days},
                "glucose": {
                    "data": sorted(glucose_summary, key=lambda x: x['date'], reverse=True),
                    "summary": {"avg_glucose_15_days": round(avg_glucose_total, 1), "avg_glucose_7_days": round(avg_glucose_total, 1), "avg_time_in_range": f"{avg_time_in_range:.1f}", "total_readings": total_readings}
                },
                "activity": {
                    "data": activity_data,
                    "summary": {"avg_daily_steps": int(avg_daily_steps), "avg_daily_calories": int(avg_daily_calories), "total_distance_km": 0.0}
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
        
        user_id = request.args.get('user_id', 1, type=int)
        days_back = request.args.get('days', 30, type=int)
        
        # Calculate date range
        end_date = date.today()
        start_date = end_date - timedelta(days=days_back)
        
        activity_logs = []
        
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

            # 2. APPLE HEALTH WORKOUT DATA from health_data_archive table (simplified - disabled for now to avoid GROUP BY issues)
            try:
                apple_workouts = conn.execute(text("""
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
            except Exception as e:
                print(f"⚠️ Apple Health workouts query failed: {e}")
                apple_workouts = []

            # 3. APPLE HEALTH STEP COUNT DATA (daily summaries)
            try:
                apple_steps = conn.execute(text("""
                    SELECT 
                        CONCAT('apple_steps_', date_col) as id,
                        date_col as date,
                        '23:59:00' as time,
                        'apple_health' as type,
                        'Daily Steps' as activity_type,
                        CONCAT(
                            ROUND(total_steps, 0), ' steps recorded by Apple Health'
                        ) as description,
                        NULL as duration_minutes,
                        ROUND(total_steps, 0) as steps,
                        NULL as calories_burned,
                        NULL as distance_km,
                        'Apple Health Steps' as source,
                        date_col as sort_timestamp
                    FROM (
                        SELECT 
                            DATE(start_date) as date_col,
                            SUM(value) as total_steps
                        FROM health_data_archive 
                        WHERE user_id = :user_id 
                          AND data_type = 'StepCount'
                          AND DATE(start_date) BETWEEN :start_date AND :end_date
                          AND value > 0
                        GROUP BY DATE(start_date)
                    ) step_summary
                    ORDER BY date_col DESC
                """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
                
                print(f"📊 Found {len(apple_steps)} Apple Health step entries")
                for row in apple_steps:
                    print(f"  • {row[1]}: {row[7]} steps")
                    
            except Exception as e:
                print(f"⚠️ Apple Health steps query failed: {e}")
                apple_steps = []

            # 4. APPLE HEALTH DISTANCE DATA (daily summaries)
            try:
                apple_distance = conn.execute(text("""
                    SELECT 
                        CONCAT('apple_distance_', date_col) as id,
                        date_col as date,
                        '23:58:00' as time,
                        'apple_health' as type,
                        'Walking/Running Distance' as activity_type,
                        CONCAT(
                            ROUND(total_distance_km, 2), ' km distance recorded by Apple Health'
                        ) as description,
                        NULL as duration_minutes,
                        NULL as steps,
                        NULL as calories_burned,
                        ROUND(total_distance_km, 2) as distance_km,
                        'Apple Health Distance' as source,
                        date_col as sort_timestamp
                    FROM (
                        SELECT 
                            DATE(start_date) as date_col,
                            SUM(value) / 1000 as total_distance_km
                        FROM health_data_archive 
                        WHERE user_id = :user_id 
                          AND data_type = 'DistanceWalkingRunning'
                          AND DATE(start_date) BETWEEN :start_date AND :end_date
                          AND value > 500
                        GROUP BY DATE(start_date)
                    ) distance_summary
                    ORDER BY date_col DESC
                """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
                
                print(f"📊 Found {len(apple_distance)} Apple Health distance entries")
                for row in apple_distance:
                    print(f"  • {row[1]}: {row[9]} km")
                    
            except Exception as e:
                print(f"⚠️ Apple Health distance query failed: {e}")
                apple_distance = []
            
            # Debug: Check what step data exists in health_data_archive table
            try:
                step_debug = conn.execute(text("""
                    SELECT 
                        DATE(start_date) as date,
                        data_type,
                        COUNT(*) as entry_count,
                        SUM(value) as total_value,
                        AVG(value) as avg_value,
                        MIN(value) as min_value,
                        MAX(value) as max_value,
                        MAX(unit) as unit
                    FROM health_data_archive 
                    WHERE user_id = :user_id 
                      AND data_type IN ('StepCount', 'ActiveEnergyBurned', 'DistanceWalkingRunning')
                      AND DATE(start_date) >= :debug_start_date
                    GROUP BY DATE(start_date), data_type
                    ORDER BY DATE(start_date) DESC, data_type
                    LIMIT 20
                """), {'user_id': user_id, 'debug_start_date': end_date - timedelta(days=7)}).fetchall()
                
                print(f"🔍 HEALTH DATA DEBUG (last 7 days):")
                for row in step_debug:
                    print(f"  📅 {row[0]} | {row[1]} | Count: {row[2]} | Total: {row[3]} | Unit: {row[7]}")
                    
            except Exception as e:
                print(f"⚠️ Health data debug query failed: {e}")

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

        # Process Apple Health distance
        for row in apple_distance:
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

        # Debug: Log what we found
        print(f"📊 Activity logs found:")
        print(f"  • Manual activities: {len(manual_activities)}")
        print(f"  • Apple workouts: {len(apple_workouts)}")
        print(f"  • Apple steps: {len(apple_steps)}")
        print(f"  • Apple distance: {len(apple_distance)}")
        print(f"  • Total combined: {len(all_activities)}")
        
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
        user_id = request.args.get('user_id', 1, type=int)
        days_back = request.args.get('days', 7, type=int)  # Default to last 7 days
        
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

@app.route('/api/debug-health-data', methods=['GET'])
def debug_health_data():
    """Provides raw data from the health_data_archive table for debugging."""
    try:
        user_id = request.args.get('user_id', 1)
        days = int(request.args.get('days', 7))
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        with engine.connect() as conn:
            query = text("""
                SELECT data_type, start_date, end_date, value, unit, sample_id, source_name, metadata
                FROM health_data_archive
                WHERE user_id = :user_id
                  AND start_date >= :start_date
                ORDER BY start_date DESC
            """)
            
            results = conn.execute(query, {
                'user_id': user_id,
                'start_date': start_date
            }).fetchall()

            data = [{
                'data_type': r.data_type,
                'start_date': r.start_date.isoformat() if r.start_date else None,
                'end_date': r.end_date.isoformat() if r.end_date else None,
                'value': r.value,
                'unit': r.unit,
                'sample_id': r.sample_id,
                'source_name': r.source_name,
                'metadata': r.metadata,
            } for r in results]

        return jsonify({
            'success': True,
            'user_id': user_id,
            'days_queried': days,
            'record_count': len(data),
            'table_queried': 'health_data_archive',
            'data': data
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# @app.route('/api/simulate-step-data', methods=['POST'])
# def simulate_step_data():
#     """Simulate Apple Health step data for testing dashboard display"""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
        
#         with engine.connect() as conn:
#             # Add step data for June 25, 2025 (your Apple Health data)
#             test_dates = [
#                 ('2025-06-24', 4200),
#                 ('2025-06-25', 3411),  # Your actual data
#                 ('2025-06-23', 5800),
#                 ('2025-06-22', 7100),
#                 ('2025-06-21', 2900)
#             ]
            
#             simulated_entries = []
            
#             for date_str, steps in test_dates:
#                 insert_query = text("""
#                     INSERT INTO health_data_archive 
#                     (user_id, data_type, value, unit, start_date, end_date, source_name, data_subtype, created_at)
#                     VALUES (:user_id, :data_type, :value, :unit, :start_date, :end_date, :source_name, :data_subtype, NOW())
#                     ON DUPLICATE KEY UPDATE 
#                     value = VALUES(value),
#                     updated_at = NOW()
#                 """)
                
#                 conn.execute(insert_query, {
#                     'user_id': user_id,
#                     'data_type': 'StepCount',
#                     'value': steps,
#                     'unit': 'count',
#                     'start_date': f'{date_str} 00:00:00',
#                     'end_date': f'{date_str} 23:59:59',
#                     'source_name': 'Apple Health (Simulated)',
#                     'data_subtype': 'DailyTotal'
#                 })
                
#                 simulated_entries.append({
#                     'date': date_str,
#                     'steps': steps
#                 })
            
#             conn.commit()
            
#         return jsonify({
#             'success': True,
#             'message': f'Successfully simulated {len(simulated_entries)} step data entries',
#             'simulated_data': simulated_entries
#         })
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e),
#             'message': 'Failed to simulate step data'
#         }), 500

# @app.route('/api/clear-simulated-health-data', methods=['POST'])
# def clear_simulated_health_data():
#     """Clear simulated health data to prepare for real Apple Health sync"""
#     try:
#         data = request.get_json()
#         user_id = data.get('user_id', 1)
        
#         with engine.connect() as conn:
#             # Delete simulated health data (identified by source_name containing 'Simulated')
#             delete_query = text("""
#                 DELETE FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND (
#                     source_name LIKE '%Simulated%' 
#                     OR source_name LIKE '%Apple Health (Simulated)%'
#                     OR data_subtype = 'DailyTotal'
#                   )
#             """)
            
#             result = conn.execute(delete_query, {'user_id': user_id})
#             deleted_count = result.rowcount
#             conn.commit()
            
#             print(f"🗑️ Cleared {deleted_count} simulated health data entries for user {user_id}")
            
#         return jsonify({
#             'success': True,
#             'deleted_count': deleted_count,
#             'message': f'Successfully cleared {deleted_count} simulated health data entries'
#         })
        
#     except Exception as e:
#         print(f"❌ Error clearing simulated health data: {e}")
#         return jsonify({
#             'success': False,
#             'error': str(e),
#             'message': 'Failed to clear simulated health data'
#         }), 500

# @app.route('/api/test-step-query', methods=['POST'])
# def test_step_query():
#     """Test endpoint to diagnose Apple Health step query issues"""
#     try:
#         data = request.get_json()
#         user_id = data.get('user_id', 1)
        
#         # Calculate date range (last 7 days)
#         end_date = date.today()
#         start_date = end_date - timedelta(days=7)
        
#         with engine.connect() as conn:
#             # Test the exact query used in activity logs
#             print(f"🧪 Testing Apple Health step query for user {user_id}, date range: {start_date} to {end_date}")
            
#             try:
#                 apple_steps = conn.execute(text("""
#                     SELECT 
#                         CONCAT('apple_steps_', date_col) as id,
#                         date_col as date,
#                         '23:59:00' as time,
#                         'apple_health' as type,
#                         'Daily Steps' as activity_type,
#                         CONCAT(
#                             ROUND(total_steps, 0), ' steps recorded by Apple Health'
#                         ) as description,
#                         NULL as duration_minutes,
#                         ROUND(total_steps, 0) as steps,
#                         NULL as calories_burned,
#                         NULL as distance_km,
#                         'Apple Health Steps' as source,
#                         date_col as sort_timestamp
#                     FROM (
#                         SELECT 
#                             DATE(start_date) as date_col,
#                             SUM(value) as total_steps
#                         FROM health_data_archive 
#                         WHERE user_id = :user_id 
#                           AND data_type = 'StepCount'
#                           AND DATE(start_date) BETWEEN :start_date AND :end_date
#                           AND value > 0
#                         GROUP BY DATE(start_date)
#                     ) step_summary
#                     ORDER BY date_col DESC
#                 """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
                
#                 print(f"🧪 Apple Health step query returned {len(apple_steps)} results")
                
#                 results = []
#                 for row in apple_steps:
#                     result_dict = {
#                         'id': row[0],
#                         'date': str(row[1]),
#                         'time': str(row[2]),
#                         'type': row[3],
#                         'activity_type': row[4],
#                         'description': row[5],
#                         'duration_minutes': row[6],
#                         'steps': row[7],
#                         'calories_burned': row[8],
#                         'distance_km': row[9],
#                         'source': row[10]
#                     }
#                     results.append(result_dict)
#                     print(f"🧪 Result: {result_dict}")
                
#                 # Also test the raw data
#                 raw_step_data = conn.execute(text("""
#                     SELECT 
#                         DATE(start_date) as date,
#                         data_type,
#                         value,
#                         unit,
#                         source_name,
#                         start_date,
#                         end_date
#                     FROM health_data_archive 
#                     WHERE user_id = :user_id 
#                       AND data_type = 'StepCount'
#                       AND DATE(start_date) BETWEEN :start_date AND :end_date
#                     ORDER BY start_date DESC
#                 """), {'user_id': user_id, 'start_date': start_date, 'end_date': end_date}).fetchall()
                
#                 raw_data = []
#                 for row in raw_step_data:
#                     raw_data.append({
#                         'date': str(row[0]),
#                         'data_type': row[1],
#                         'value': row[2],
#                         'unit': row[3],
#                         'source_name': row[4],
#                         'start_date': str(row[5]),
#                         'end_date': str(row[6])
#                     })
                
#                 return jsonify({
#                     'success': True,
#                     'query_results': results,
#                     'raw_step_data': raw_data,
#                     'query_result_count': len(results),
#                     'raw_data_count': len(raw_data),
#                     'date_range': f"{start_date} to {end_date}",
#                     'message': f"Found {len(results)} processed step entries and {len(raw_data)} raw step records"
#                 })
                
#             except Exception as query_error:
#                 print(f"🧪 Query error: {query_error}")
#                 return jsonify({
#                     'success': False,
#                     'error': f"Query failed: {str(query_error)}",
#                     'date_range': f"{start_date} to {end_date}"
#                 })
        
#     except Exception as e:
#         print(f"🧪 Test endpoint error: {e}")
#         return jsonify({
#             'success': False,
#             'error': f"Test failed: {str(e)}"
#         }), 500

# @app.route('/api/clear-all-health-data', methods=['POST'])
# def clear_all_health_data():
#     """Clear ALL health data for a user from both archive and display tables."""
#     try:
#         data = request.get_json()
#         user_id = data.get('user_id', 1)
        
#         with engine.begin() as conn: # Use a transaction
#             # Delete ALL health data for the user from archive
#             delete_archive_query = text("""
#                 DELETE FROM health_data_archive 
#                 WHERE user_id = :user_id
#             """)
#             archive_result = conn.execute(delete_archive_query, {'user_id': user_id})
#             archive_deleted_count = archive_result.rowcount
            
#             # Delete ALL health data for the user from display
#             delete_display_query = text("""
#                 DELETE FROM health_data_display 
#                 WHERE user_id = :user_id
#             """)
#             display_result = conn.execute(delete_display_query, {'user_id': user_id})
#             display_deleted_count = display_result.rowcount
            
#             total_deleted = archive_deleted_count + display_deleted_count
#             print(f"🗑️ Cleared {archive_deleted_count} archive and {display_deleted_count} display entries for user {user_id}")
            
#         return jsonify({
#             'success': True,
#             'deleted_count': total_deleted,
#             'message': f'Successfully cleared {total_deleted} total health data entries. Ready for real Apple Health sync.'
#         })
        
#     except Exception as e:
#         print(f"❌ Error clearing all health data: {e}")
#         return jsonify({
#             'success': False,
#             'error': str(e),
#             'message': 'Failed to clear all health data'
#         }), 500

@app.route('/api/verify-apple-health-data', methods=['POST'])
def verify_apple_health_data():
    """Receive and log Apple Health data for manual verification before dashboard integration"""
    # create_verification_health_data_table() # This is now called at startup
    try:
        data = request.get_json()
        user_id = data.get('user_id', 1)
        health_data = data.get('health_data', {})
        
        print("🔍 Receiving Apple Health data for verification...")
        
        with engine.connect() as conn:
            transaction = conn.begin()
            now = datetime.now()
            total_records = 0
            for data_type, records in health_data.items():
                if isinstance(records, list) and records:
                    total_records += len(records)
                    conn.execute(text("""
                        INSERT INTO verification_health_data (user_id, data_type, data, created_at)
                        VALUES (:user_id, :data_type, :data, :created_at)
                    """), {
                        'user_id': user_id,
                        'data_type': data_type,
                        'data': json.dumps(records),
                        'created_at': now
                    })
            
            transaction.commit()
        
        print(f"✅ Stored {total_records} records for verification.")
        
        return jsonify({
            'success': True,
            'message': 'Apple Health data received and stored for verification.',
        })
        
    except Exception as e:
        print(f"❌ Error in /api/verify-apple-health-data: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'Failed to process Apple Health verification data'
        }), 500

@app.route('/api/approve-apple-health-data', methods=['POST'])
def approve_apple_health_data():
    data = request.get_json()
    user_id = data.get('user_id', 1)

    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            # 1. Fetch all unverified data for the user
            verified_data_query = text("""
                SELECT id, data_type, data, created_at
                FROM verification_health_data
                WHERE user_id = :user_id AND verified = FALSE
            """)
            unverified_records = conn.execute(verified_data_query, {'user_id': user_id}).fetchall()

            if not unverified_records:
                return jsonify({"success": True, "message": "No unverified Apple Health data to approve.", "approved_records": 0})

            # Get the timestamp of the most recent sync to process only that batch
            latest_timestamp = max(r.created_at for r in unverified_records)
            
            # Filter for only the records from the most recent sync
            records_to_process = [r for r in unverified_records if r.created_at == latest_timestamp]

            all_records_to_insert = []

            for record in records_to_process:
                data_type = record.data_type
                health_data_list = json.loads(record.data)
                
                print(f"✅ Processing approval for {data_type} with {len(health_data_list)} records.")

                # --- SPECIALIZED HANDLING FOR STEPCOUNT ---
                if data_type == 'StepCount':
                    for entry in health_data_list:
                        entry_date_str = entry['date'].split('T')[0]
                        entry_date = datetime.fromisoformat(entry_date_str)
                        start_of_day_utc = datetime(entry_date.year, entry_date.month, entry_date.day, tzinfo=timezone.utc)
                        end_of_day_utc = start_of_day_utc + timedelta(days=1, seconds=-1)

                        record_to_insert = {
                            'user_id': user_id, 'data_type': 'StepCount', 'data_subtype': 'daily_summary',
                            'value': entry['value'], 'value_string': None, 'unit': 'count',
                            'start_date': start_of_day_utc, 'end_date': end_of_day_utc,
                            'source_name': entry.get('source', 'Multiple'), 'source_bundle_id': None, 
                            'device_name': None, 'device_manufacturer': None,
                            'sample_id': f"daily_summary_{user_id}_{entry_date_str}",
                            'entry_type': 'summary', 'category_type': None, 'workout_activity_type': None,
                            'total_energy_burned': None, 'total_distance': None,
                            'average_quantity': None, 'minimum_quantity': None, 'maximum_quantity': None,
                            'metadata': json.dumps({'original_source': entry.get('source', 'Multiple')})
                        }
                        all_records_to_insert.append(record_to_insert)

                # --- GENERIC HANDLING FOR OTHER HEALTH DATA (Sleep, etc.) ---
                else:
                    for entry in health_data_list:
                        # Initialize a full dictionary for the table schema
                        record_to_insert = {
                            'user_id': user_id, 'data_type': data_type,
                            'data_subtype': None, 'value': None, 'value_string': None, 'unit': None,
                            'start_date': parse_iso_datetime(entry.get('startDate')),
                            'end_date': parse_iso_datetime(entry.get('endDate')),
                            'source_name': None, 'source_bundle_id': None, 'device_name': None, 'device_manufacturer': None,
                            'sample_id': entry.get('sampleId') or entry.get('uuid') or str(uuid.uuid4()),
                            'entry_type': 'sample', 'category_type': None, 'workout_activity_type': None,
                            'total_energy_burned': None, 'total_distance': None,
                            'average_quantity': None, 'minimum_quantity': None, 'maximum_quantity': None,
                            'metadata': None
                        }
                        
                        metadata = entry.get('metadata', {}) or {}
                        if isinstance(metadata, str):
                            try:
                                metadata = json.loads(metadata)
                            except json.JSONDecodeError:
                                metadata = {}
                        
                        # Populate fields from entry
                        record_to_insert.update({
                            'data_subtype': entry.get('dataSubtype') or entry.get('value'),
                            'value': entry.get('quantity') or entry.get('value'),
                            'unit': entry.get('unit'),
                            'source_name': entry.get('sourceName') or (entry.get('source', {}) or {}).get('name') or (entry.get('device', {}) or {}).get('name'),
                            'source_bundle_id': (entry.get('source', {}) or {}).get('bundleIdentifier'),
                            'device_name': (entry.get('device', {}) or {}).get('name'),
                            'device_manufacturer': (entry.get('device', {}) or {}).get('manufacturer'),
                            'entry_type': 'sample' if 'quantity' in entry else 'category',
                            'metadata': json.dumps(metadata) # Store metadata with timezone
                        })
                        all_records_to_insert.append(record_to_insert)

            # 3. BULK INSERT ALL PROCESSED RECORDS
            if all_records_to_insert:
                sample_ids_to_delete = [r['sample_id'] for r in all_records_to_insert if r['sample_id']]
                if sample_ids_to_delete:
                    delete_query = text("""
                        DELETE FROM health_data_archive
                        WHERE user_id = :user_id AND sample_id IN :sample_ids
                    """)
                    conn.execute(delete_query, {'user_id': user_id, 'sample_ids': tuple(sample_ids_to_delete)})
                    print(f"✅ Cleared {len(sample_ids_to_delete)} existing records for fresh insertion.")

                print(f"✅ Inserting {len(all_records_to_insert)} total records into the health_data_archive table.")
                health_data_table = Table('health_data_archive', MetaData(), autoload_with=engine)
                conn.execute(health_data_table.insert(), all_records_to_insert)
            else:
                print("ℹ️ No new records to insert.")

            # 4. MARK THE BATCH AS VERIFIED
            update_query = text("""
                UPDATE verification_health_data
                SET verified = TRUE
                WHERE user_id = :user_id AND created_at = :timestamp
            """)
            conn.execute(update_query, {'user_id': user_id, 'timestamp': latest_timestamp})

            transaction.commit()
            return jsonify({
                "success": True,
                "message": f"Successfully approved and integrated {len(all_records_to_insert)} Apple Health records into dashboard",
                "approved_records": len(all_records_to_insert)
            })

        except Exception as e:
            if 'transaction' in locals() and transaction.is_active:
                transaction.rollback()
            print(f"❌ Error during data approval: {e}")
            return jsonify({"success": False, "message": f"An error occurred: {e}"}), 500

# @app.route('/api/get-verification-data', methods=['GET'])
# def get_verification_data():
#     """Get the current verification data for manual review"""
#     try:
#         user_id = request.args.get('user_id', 1)
        
#         with engine.connect() as conn:
#             verification_data = conn.execute(text("""
#                 SELECT data_type, verification_data, created_at, verified
#                 FROM apple_health_verification 
#                 WHERE user_id = :user_id 
#                 ORDER BY created_at DESC
#                 LIMIT 10
#             """), {'user_id': user_id}).fetchall()
            
#             results = []
#             for row in verification_data:
#                 results.append({
#                     'data_type': row[0],
#                     'data': json.loads(row[1]),
#                     'created_at': str(row[2]),
#                     'verified': bool(row[3])
#                 })
        
#         return jsonify({
#             'success': True,
#             'verification_data': results
#         })
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

# def get_comprehensive_sleep_data(user_id: int = 1, days_back: int = 25):
#     """Get comprehensive sleep data for extended period with less restrictive filtering."""
#     try:
#         with engine.connect() as conn:
#             # Get all raw sleep analysis samples for the user for the specified period
#             start_date = datetime.now() - timedelta(days=days_back)
            
#             raw_sleep_records = conn.execute(text("""
#                 SELECT start_date, end_date, metadata, value
#                 FROM health_data_archive
#                 WHERE data_type = 'SleepAnalysis' AND user_id = :uid
#                 AND start_date >= :start_date
#                 ORDER BY start_date
#             """), {"uid": user_id, "start_date": start_date}).fetchall()

#             if not raw_sleep_records:
#                 return {"message": "No sleep data found", "sleep_sessions": []}

#             print(f"🛏️ Processing {len(raw_sleep_records)} raw sleep records for comprehensive analysis...")

#             # --- LESS RESTRICTIVE FILTERING ---
#             sleep_sessions = []
#             for record in raw_sleep_records:
#                 # Parse timezone info
#                 metadata_str = record.metadata or '{}'
#                 metadata = {}
#                 try:
#                     temp_data = json.loads(metadata_str)
#                     while isinstance(temp_data, str):
#                         temp_data = json.loads(temp_data)
#                     metadata = temp_data
#                 except (json.JSONDecodeError, TypeError):
#                     metadata = {}

#                 user_timezone_str = metadata.get('HKTimeZone', 'UTC')
#                 try:
#                     user_tz = ZoneInfo(user_timezone_str)
#                 except ZoneInfoNotFoundError:
#                     user_tz = ZoneInfo('UTC')

#                 start_local = record.start_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                 end_local = record.end_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                 duration_hours = (end_local - start_local).total_seconds() / 3600

#                 # --- MORE INCLUSIVE FILTERING ---
#                 # Only skip very short sessions (< 5 minutes) - these are likely just movements
#                 if duration_hours < 0.08:  # Less than 5 minutes
#                     continue
                
#                 # Don't filter by exact times - include everything that could be sleep
#                 # Only exclude if duration is unreasonable (> 16 hours)
#                 if duration_hours > 16:
#                     continue

#                 sleep_sessions.append({
#                     'start': start_local,
#                     'end': end_local,
#                     'duration': duration_hours,
#                     'start_time': start_local.strftime('%H:%M'),
#                     'end_time': end_local.strftime('%H:%M'),
#                     'date': start_local.strftime('%Y-%m-%d'),
#                     'end_date': end_local.strftime('%Y-%m-%d'),
#                     'formatted_duration': f"{int(duration_hours)}h {int((duration_hours % 1) * 60)}m",
#                     'value': record.value
#                 })

#             print(f"📊 Found {len(sleep_sessions)} total sleep sessions (inclusive filtering)")

#             # --- GROUP BY NIGHT FOR DAILY SUMMARIES ---
#             daily_summaries = {}
#             for session in sleep_sessions:
#                 # Determine which night/day this belongs to
#                 # If sleep ends before 2 PM, it belongs to that end date
#                 # If sleep ends after 2 PM, it belongs to the next day
#                 if session['end'].hour < 14:  # Before 2 PM
#                     night_date = session['end_date']
#                 else:
#                     next_day = session['end'] + timedelta(days=1)
#                     night_date = next_day.strftime('%Y-%m-%d')

#                 if night_date not in daily_summaries:
#                     daily_summaries[night_date] = []
#                 daily_summaries[night_date].append(session)

#             # --- CREATE COMPREHENSIVE DAILY SUMMARIES ---
#             comprehensive_summaries = []
#             for date_key, sessions in daily_summaries.items():
#                 if not sessions:
#                     continue

#                 # Sort sessions by duration to find main sleep period
#                 sessions.sort(key=lambda x: x['duration'], reverse=True)
                
#                 # Take the longest session as primary sleep, but include others if significant
#                 main_session = sessions[0]
#                 total_sleep_hours = main_session['duration']
#                 earliest_start = main_session['start']
#                 latest_end = main_session['end']
                
#                 # Include other sessions if they're substantial (> 30 minutes)
#                 for session in sessions[1:]:
#                     if session['duration'] > 0.5:  # More than 30 minutes
#                         total_sleep_hours += session['duration'] * 0.6  # Weight secondary sessions less
#                         earliest_start = min(earliest_start, session['start'])
#                         latest_end = max(latest_end, session['end'])

#                 # Apply moderate sleep efficiency
#                 efficient_sleep_hours = total_sleep_hours * 0.85

#                 # Only include reasonable sleep durations
#                 if 0.5 <= efficient_sleep_hours <= 15:
#                     comprehensive_summaries.append({
#                         "sleep_date": date_key,
#                         "sleep_start": earliest_start.strftime('%H:%M'),
#                         "sleep_end": latest_end.strftime('%H:%M'),
#                         "sleep_hours": round(efficient_sleep_hours, 2),
#                         "formatted_sleep": f"{int(efficient_sleep_hours)}h {int((efficient_sleep_hours % 1) * 60)}m",
#                         "raw_sessions": len([s for s in sessions if s['duration'] > 0.08]),
#                         "main_duration": round(main_session['duration'], 2),
#                         "bedtime": earliest_start.strftime('%Y-%m-%d %H:%M'),
#                         "wake_time": latest_end.strftime('%Y-%m-%d %H:%M')
#                     })

#             # Sort by date
#             comprehensive_summaries.sort(key=lambda x: x['sleep_date'], reverse=True)
            
#             print(f"✅ Generated {len(comprehensive_summaries)} comprehensive daily sleep summaries")
            
#             return {
#                 "success": True,
#                 "total_raw_sessions": len(sleep_sessions),
#                 "daily_summaries": comprehensive_summaries,
#                 "raw_sessions": sleep_sessions[:50],  # Limit to first 50 for response size
#                 "days_analyzed": days_back
#             }

#     except Exception as e:
#         print(f"❌ Error getting comprehensive sleep data: {e}")
#         return {"error": str(e), "success": False}

# Add endpoint for comprehensive sleep analysis
# @app.route('/api/comprehensive-sleep-analysis', methods=['GET'])
# def comprehensive_sleep_analysis():
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 25, type=int)
        
#         result = get_comprehensive_sleep_data(user_id, days_back)
#         return jsonify(result)
        
#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

def get_improved_sleep_data(user_id: int = 1, days_back: int = 25):
    """
    IMPROVED sleep data processing that correctly aggregates all sleep sessions from HealthKit.
    This version ensures a complete 7-day range is always returned for consistent UI display.
    """
    try:
        with engine.connect() as conn:
            start_date_dt = datetime.now(timezone.utc) - timedelta(days=days_back)
            
            # Fetch all raw sleep analysis records
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
            
            # Calculate the 7-day range based on user's timezone
            today_local = datetime.now(user_tz).date()
            seven_days_range = []
            
            for i in range(7):
                target_date = today_local - timedelta(days=i)
                seven_days_range.append(target_date.strftime('%Y-%m-%d'))
            
            print(f"📅 Generating complete 7-day range: {seven_days_range}")

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
                        
                        authentic_bedtime = main_start_local.strftime('%H:%M')
                        authentic_wake_time = main_end_local.strftime('%H:%M')

                        summary = {
                            "date": day_key,
                            "bedtime": authentic_bedtime,
                            "wake_time": authentic_wake_time,
                            "sleep_hours": round(main_session_duration, 2),
                            "formatted_sleep": f"{int(main_session_duration)}h {int((main_session_duration % 1) * 60)}m",
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
@app.route('/api/improved-sleep-analysis', methods=['GET'])
def improved_sleep_analysis():
    try:
        user_id = request.args.get('user_id', 1, type=int)
        days_back = request.args.get('days', 25, type=int)
        
        result = get_improved_sleep_data(user_id, days_back)
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500

# @app.route('/api/debug-sleep-timezone', methods=['GET'])
# def debug_sleep_timezone():
#     """Debug endpoint to analyze sleep data timezone issues."""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 7, type=int)
        
#         with engine.connect() as conn:
#             # Get raw sleep data with all metadata
#             raw_sleep_query = text("""
#                 SELECT id, start_date, end_date, value, metadata, sample_id, source_name, created_at
#                 FROM health_data_archive
#                 WHERE data_type = 'SleepAnalysis' AND user_id = :uid
#                 AND start_date >= NOW() - INTERVAL :days DAY
#                 ORDER BY start_date DESC
#             """)
#             raw_sleep_results = conn.execute(raw_sleep_query, {"uid": user_id, "days": days_back}).fetchall()
            
#             # Count timezone metadata
#             samples_with_timezone = 0
#             samples_without_timezone = 0
#             suspicious_patterns = []
            
#             raw_samples = []
#             for row in raw_sleep_results:
#                 # Parse metadata for timezone info
#                 metadata_str = row.metadata or '{}'
#                 metadata = {}
#                 timezone_from_metadata = None
                
#                 try:
#                     temp_data = json.loads(metadata_str)
#                     while isinstance(temp_data, str):
#                         temp_data = json.loads(temp_data)
#                     metadata = temp_data
#                     timezone_from_metadata = metadata.get('HKTimeZone', None)
#                 except (json.JSONDecodeError, TypeError):
#                     pass
                
#                 if timezone_from_metadata:
#                     samples_with_timezone += 1
#                 else:
#                     samples_without_timezone += 1
                
#                 # Check for suspicious patterns (exact times)
#                 end_time = row.end_date.strftime('%H:%M:%S')
#                 if end_time.endswith(':30:00') or end_time.endswith(':30:01'):
#                     suspicious_patterns.append({
#                         'sample_id': row.sample_id,
#                         'start_date': row.start_date.isoformat(),
#                         'end_date': row.end_date.isoformat(),
#                         'end_time': end_time,
#                         'duration_hours': round((row.end_date - row.start_date).total_seconds() / 3600, 2)
#                     })
                
#                 raw_samples.append({
#                     'sample_id': row.sample_id,
#                     'start_date': row.start_date.isoformat() if row.start_date else None,
#                     'end_date': row.end_date.isoformat() if row.end_date else None,
#                     'value': row.value,
#                     'duration_hours': round((row.end_date - row.start_date).total_seconds() / 3600, 2) if row.start_date and row.end_date else 0,
#                     'source_name': row.source_name,
#                     'timezone_from_metadata': timezone_from_metadata or "None"
#                 })
        
#         return jsonify({
#             'success': True,
#             'debug_info': {
#                 'total_sleep_records': len(raw_sleep_results),
#                 'server_timezone': str(datetime.now().astimezone().tzinfo),
#                 'timezone_analysis': {
#                     'samples_with_timezone': samples_with_timezone,
#                     'samples_without_timezone': samples_without_timezone
#                 },
#                 'suspicious_patterns': suspicious_patterns,
#                 'raw_samples': raw_samples[:20]  # Limit for response size
#             }
#         })
        
#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

# @app.route('/api/verify-real-wake-times', methods=['GET'])
# def verify_real_wake_times():
#     """NEW: Debug endpoint to verify that we're preserving exact Apple Health wake times."""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 7, type=int)
        
#         # Get improved sleep analysis
#         sleep_analysis = get_improved_sleep_data(user_id, days_back)
        
#         if not sleep_analysis.get('success'):
#             return jsonify({'error': 'Sleep analysis failed'}), 500
        
#         # Get raw data for comparison
#         with engine.connect() as conn:
#             raw_sleep_query = text("""
#                 SELECT start_date, end_date, value, sample_id
#                 FROM health_data_archive
#                 WHERE data_type = 'SleepAnalysis' AND user_id = :uid
#                 AND start_date >= NOW() - INTERVAL :days DAY
#                 ORDER BY start_date DESC
#             """)
#             raw_results = conn.execute(raw_sleep_query, {"uid": user_id, "days": days_back}).fetchall()
        
#         # Create comparison
#         verification_results = []
#         for summary in sleep_analysis['daily_summaries']:
#             # Find corresponding raw sessions for this date
#             date_str = summary['date']
#             raw_sessions_for_date = []
            
#             for row in raw_results:
#                 # Check if this session belongs to this sleep date
#                 session_date = row.end_date.strftime('%Y-%m-%d')
#                 if session_date == date_str:
#                     raw_sessions_for_date.append({
#                         'start': row.start_date.strftime('%H:%M:%S'),
#                         'end': row.end_date.strftime('%H:%M:%S'),
#                         'duration_h': round((row.end_date - row.start_date).total_seconds() / 3600, 2),
#                         'sample_id': row.sample_id
#                     })
            
#             verification_results.append({
#                 'sleep_date': date_str,
#                 'processed_wake_time': summary.get('wake_time'),
#                 'processed_sleep_end': summary.get('sleep_end'),
#                 'raw_wake_time': summary.get('raw_wake_time'),
#                 'raw_sessions_count': len(raw_sessions_for_date),
#                 'raw_sessions': raw_sessions_for_date[:3],  # Show top 3
#                 'timezone_preserved': 'timezone_info' in summary
#             })
        
#         return jsonify({
#             'success': True,
#             'verification_results': verification_results,
#             'summary': {
#                 'total_sleep_days': len(verification_results),
#                 'days_with_exact_times': len([r for r in verification_results if r.get('raw_wake_time')]),
#                 'analysis_method': 'exact_healthkit_timestamps_preserved'
#             }
#         })
        
#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

# @app.route('/api/clean-duplicate-distance-data', methods=['POST'])
# def clean_duplicate_distance_data():
#     """Clean up duplicate distance data that's causing inflated walking/running distances."""
#     try:
#         user_id = request.json.get('user_id', 1)
        
#         with engine.connect() as conn:
#             # Find duplicate distance entries (same value, same timestamp, different or missing sample_id)
#             duplicate_query = text("""
#                 SELECT start_date, end_date, value, unit, COUNT(*) as count
#                 FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND data_type = 'DistanceWalkingRunning'
#                 GROUP BY start_date, end_date, value, unit
#                 HAVING COUNT(*) > 1
#                 ORDER BY start_date DESC, count DESC
#             """)
            
#             duplicates = conn.execute(duplicate_query, {"user_id": user_id}).fetchall()
            
#             if not duplicates:
#                 return jsonify({
#                     "success": True,
#                     "message": "No duplicate distance data found",
#                     "duplicates_removed": 0
#                 })
            
#             total_removed = 0
#             duplicate_analysis = []
            
#             for dup in duplicates:
#                 # Get all entries for this duplicate group
#                 group_query = text("""
#                     SELECT id, sample_id, start_date, end_date, value, source_name
#                     FROM health_data_archive 
#                     WHERE user_id = :user_id 
#                       AND data_type = 'DistanceWalkingRunning'
#                       AND start_date = :start_date
#                       AND end_date = :end_date  
#                       AND value = :value
#                       AND unit = :unit
#                     ORDER BY id
#                 """)
                
#                 group_entries = conn.execute(group_query, {
#                     "user_id": user_id,
#                     "start_date": dup.start_date,
#                     "end_date": dup.end_date,
#                     "value": dup.value,
#                     "unit": dup.unit
#                 }).fetchall()
                
#                 # Keep only ONE entry per group - prefer the one with a real sample_id
#                 entries_to_keep = []
#                 entries_to_remove = []
                
#                 for entry in group_entries:
#                     if entry.sample_id and entry.sample_id != 'None' and len(entries_to_keep) == 0:
#                         entries_to_keep.append(entry)
#                     else:
#                         entries_to_remove.append(entry)
                
#                 # If no entry has a real sample_id, keep the first one
#                 if not entries_to_keep and group_entries:
#                     entries_to_keep.append(group_entries[0])
#                     entries_to_remove = group_entries[1:]
                
#                 # Remove the duplicate entries
#                 for entry in entries_to_remove:
#                     delete_query = text("DELETE FROM health_data_archive WHERE id = :id")
#                     conn.execute(delete_query, {"id": entry.id})
#                     total_removed += 1
                
#                 duplicate_analysis.append({
#                     "timestamp": f"{dup.start_date} to {dup.end_date}",
#                     "value": f"{dup.value} {dup.unit}",
#                     "duplicates_found": dup.count,
#                     "duplicates_removed": len(entries_to_remove),
#                     "kept_entry": entries_to_keep[0].sample_id if entries_to_keep else None
#                 })
            
#             conn.commit()
            
#             return jsonify({
#                 "success": True,
#                 "message": f"Successfully cleaned {total_removed} duplicate distance entries",
#                 "total_duplicates_removed": total_removed,
#                 "duplicate_groups_processed": len(duplicates),
#                 "analysis": duplicate_analysis
#             })
            
#     except Exception as e:
#         print(f"❌ Error cleaning duplicate distance data: {e}")
#         return jsonify({
#             "success": False,
#             "error": str(e),
#             "message": "Failed to clean duplicate distance data"
#         }), 500

# @app.route('/api/clean-simulated-entries', methods=['POST'])
# def clean_simulated_entries():
#     """Remove entries with null sample_id and source_name, which are indicators of simulated/test data."""
#     try:
#         user_id = request.json.get('user_id', 1)
        
#         with engine.connect() as conn:
#             # Find entries that look like simulated data
#             simulated_query = text("""
#                 SELECT id, data_type, start_date, end_date, value, unit, sample_id, source_name
#                 FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND sample_id IS NULL 
#                   AND source_name IS NULL
#                 ORDER BY start_date DESC
#             """)
            
#             simulated_entries = conn.execute(simulated_query, {"user_id": user_id}).fetchall()
            
#             if not simulated_entries:
#                 return jsonify({
#                     "success": True,
#                     "message": "No simulated entries found",
#                     "entries_removed": 0
#                 })
            
#             # Remove the simulated entries
#             delete_query = text("""
#                 DELETE FROM health_data_archive 
#                 WHERE user_id = :user_id 
#                   AND sample_id IS NULL 
#                   AND source_name IS NULL
#             """)
            
#             result = conn.execute(delete_query, {"user_id": user_id})
#             removed_count = result.rowcount
#             conn.commit()
            
#             # Categorize what was removed
#             removed_analysis = {}
#             for entry in simulated_entries:
#                 data_type = entry.data_type
#                 if data_type not in removed_analysis:
#                     removed_analysis[data_type] = []
#                 removed_analysis[data_type].append({
#                     "value": entry.value,
#                     "unit": entry.unit,
#                     "date": f"{entry.start_date} to {entry.end_date}"
#                 })
            
#             return jsonify({
#                 "success": True,
#                 "message": f"Successfully removed {removed_count} simulated entries",
#                 "entries_removed": removed_count,
#                 "removed_by_type": removed_analysis
#             })
            
#     except Exception as e:
#         print(f"❌ Error cleaning simulated entries: {e}")
#         return jsonify({
#             "success": False,
#             "error": str(e),
#             "message": "Failed to clean simulated entries"
#         }), 500

def auto_clean_health_data_duplicates(user_id: int = 1) -> int:
    """
    Automatically clean duplicates for critical health data types that are prone to duplication.
    This runs after each sync to maintain data integrity.
    Returns the number of duplicate records removed.
    """
    try:
        total_cleaned = 0
        
        with engine.connect() as conn:
            # Critical data types that are prone to duplication during sync
            critical_data_types = [
                'DistanceWalkingRunning',
                'ActiveEnergyBurned', 
                'StepCount',
                'HeartRate',
                'BloodGlucose'
            ]
            
            for data_type in critical_data_types:
                # Find duplicate entries (same sample_id, same timestamp, same value)
                duplicate_query = text("""
                    SELECT sample_id, start_date, end_date, value, unit, COUNT(*) as count
                    FROM health_data_archive 
                    WHERE user_id = :user_id 
                      AND data_type = :data_type
                      AND sample_id IS NOT NULL
                      AND sample_id != ''
                    GROUP BY sample_id, start_date, end_date, value, unit
                    HAVING COUNT(*) > 1
                    ORDER BY start_date DESC
                """)
                
                duplicates = conn.execute(duplicate_query, {
                    "user_id": user_id,
                    "data_type": data_type
                }).fetchall()
                
                for dup in duplicates:
                    # Get all entries for this duplicate group
                    group_query = text("""
                        SELECT id, sample_id, start_date, end_date, value, source_name
                        FROM health_data_archive 
                        WHERE user_id = :user_id 
                          AND data_type = :data_type
                          AND sample_id = :sample_id
                          AND start_date = :start_date
                          AND end_date = :end_date  
                          AND value = :value
                          AND unit = :unit
                        ORDER BY id ASC
                    """)
                    
                    group_entries = conn.execute(group_query, {
                        "user_id": user_id,
                        "data_type": data_type,
                        "sample_id": dup.sample_id,
                        "start_date": dup.start_date,
                        "end_date": dup.end_date,
                        "value": dup.value,
                        "unit": dup.unit
                    }).fetchall()
                    
                    # Keep only the FIRST entry (oldest ID), remove the rest
                    if len(group_entries) > 1:
                        entries_to_remove = group_entries[1:]  # Skip the first one
                        
                        for entry in entries_to_remove:
                            delete_query = text("DELETE FROM health_data_archive WHERE id = :id")
                            conn.execute(delete_query, {"id": entry.id})
                            total_cleaned += 1
                        
                        print(f"🧹 {data_type}: Cleaned {len(entries_to_remove)} duplicates for sample {dup.sample_id}")
            
            # Also clean entries with null sample_id AND null source_name (definitely simulated)
            simulated_cleanup_query = text("""
                DELETE FROM health_data_archive 
                WHERE user_id = :user_id 
                  AND sample_id IS NULL 
                  AND source_name IS NULL
                  AND data_type IN ('DistanceWalkingRunning', 'ActiveEnergyBurned', 'StepCount')
            """)
            
            result = conn.execute(simulated_cleanup_query, {"user_id": user_id})
            simulated_cleaned = result.rowcount
            total_cleaned += simulated_cleaned
            
            if simulated_cleaned > 0:
                print(f"🧹 Removed {simulated_cleaned} simulated entries with null identifiers")
            
            conn.commit()
            
        return total_cleaned
        
    except Exception as e:
        print(f"❌ Error in auto-clean duplicates: {e}")
        return 0

# NOTE: Manual sync endpoint removed 
# The previous endpoint was generating simulated data with fake UUIDs instead of 
# pulling real Apple Health data. Real HealthKit integration should be implemented instead.
#
# For missing sleep data, the proper solution is to:
# 1. Implement real HealthKit integration on iOS
# 2. Use proper Apple HealthKit APIs to pull authentic data
# 3. Ensure data authenticity and user trust

# ✅ NEW: Verification endpoint to compare raw HealthKit vs processed sleep data
# @app.route('/api/verify-sleep-authenticity', methods=['GET'])
# def verify_sleep_authenticity():
#     """Compare raw HealthKit sleep data against processed dashboard data to verify authenticity"""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 7, type=int)
        
#         with engine.connect() as conn:
#             # Get raw HealthKit sleep data with timezone
#             raw_sleep_query = text("""
#                 SELECT start_date, end_date, metadata, value
#                 FROM health_data_archive
#                 WHERE data_type = 'SleepAnalysis' AND user_id = :uid
#                 AND start_date >= NOW() - INTERVAL :days DAY
#                 ORDER BY start_date DESC
#             """)
#             raw_sleep_results = conn.execute(raw_sleep_query, {"uid": user_id, "days": days_back}).fetchall()
            
#         # Get processed sleep data from our improved function
#         improved_result = get_improved_sleep_data(user_id, days_back)
        
#         # Create comparison
#         comparison_results = []
        
#         for summary in improved_result.get('daily_summaries', []):
#             date_str = summary['date']
            
#             # Find corresponding raw data for this date
#             raw_sessions_for_date = []
#             for row in raw_sleep_results:
#                 # Parse timezone from metadata
#                 metadata_str = row.metadata or '{}'
#                 try:
#                     metadata = json.loads(metadata_str)
#                     while isinstance(metadata, str):
#                         metadata = json.loads(metadata)
#                 except (json.JSONDecodeError, TypeError):
#                     metadata = {}
                
#                 user_timezone_str = metadata.get('HKTimeZone', 'UTC')
#                 try:
#                     user_tz = ZoneInfo(user_timezone_str)
#                 except ZoneInfoNotFoundError:
#                     user_tz = ZoneInfo('UTC')
                
#                 # Convert to local time to check date
#                 end_local = row.end_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                 if end_local.strftime('%Y-%m-%d') == date_str:
#                     start_local = row.start_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                     duration_hours = (end_local - start_local).total_seconds() / 3600
                    
#                     raw_sessions_for_date.append({
#                         'raw_start_utc': row.start_date.isoformat(),
#                         'raw_end_utc': row.end_date.isoformat(),
#                         'raw_start_local': start_local.strftime('%H:%M:%S'),
#                         'raw_end_local': end_local.strftime('%H:%M:%S'),
#                         'raw_duration_hours': round(duration_hours, 3),
#                         'timezone': user_timezone_str
#                     })
            
#             comparison_results.append({
#                 'date': date_str,
#                 'processed_bedtime': summary.get('bedtime'),
#                 'processed_wake_time': summary.get('wake_time'),
#                 'processed_sleep_hours': summary.get('sleep_hours'),
#                 'processed_formatted': summary.get('formatted_sleep'),
#                 'debug_timezone': summary.get('_debug_timezone'),
#                 'debug_raw_start': summary.get('_debug_raw_start'),
#                 'debug_raw_end': summary.get('_debug_raw_end'),
#                 'raw_sessions': raw_sessions_for_date,
#                 'raw_sessions_count': len(raw_sessions_for_date),
#                 'authenticity_status': 'VERIFIED' if raw_sessions_for_date else 'NO_RAW_DATA'
#             })
        
#         return jsonify({
#             'success': True,
#             'verification_date': datetime.now().isoformat(),
#             'total_days_checked': len(comparison_results),
#             'comparison_results': comparison_results,
#             'summary': {
#                 'days_with_raw_data': len([r for r in comparison_results if r['raw_sessions_count'] > 0]),
#                 'days_missing_raw_data': len([r for r in comparison_results if r['raw_sessions_count'] == 0]),
#                 'verification_status': 'Authentic HealthKit data preserved' if any(r['raw_sessions_count'] > 0 for r in comparison_results) else 'No raw HealthKit data found'
#             }
#         })
        
#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

# ✅ NEW: Enhanced sleep data collection to bypass Sleep Schedule truncation
# @app.route('/api/enhanced-sleep-analysis', methods=['GET'])
# def enhanced_sleep_analysis():
#     """Enhanced sleep analysis that captures both InBed and Asleep samples to bypass Sleep Schedule limitations."""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
#         days_back = request.args.get('days', 7, type=int)
        
#         with engine.connect() as conn:
#             # Get ALL sleep analysis samples (InBed=0, Asleep=1, Awake=2)
#             enhanced_sleep_query = text("""
#                 SELECT start_date, end_date, value, metadata, sample_id, source_name
#                 FROM health_data_archive
#                 WHERE data_type = 'SleepAnalysis' AND user_id = :uid
#                 AND start_date >= NOW() - INTERVAL :days DAY
#                 ORDER BY start_date
#             """)
#             raw_sleep_results = conn.execute(enhanced_sleep_query, {"uid": user_id, "days": days_back}).fetchall()

#             # Separate samples by type
#             inbed_samples = []
#             asleep_samples = []
#             awake_samples = []
            
#             for record in raw_sleep_results:
#                 # Parse timezone
#                 metadata_str = record.metadata or '{}'
#                 metadata = {}
#                 try:
#                     temp_data = json.loads(metadata_str)
#                     while isinstance(temp_data, str):
#                         temp_data = json.loads(temp_data)
#                     metadata = temp_data
#                 except (json.JSONDecodeError, TypeError):
#                     metadata = {}

#                 user_timezone_str = metadata.get('HKTimeZone', 'UTC')
#                 try:
#                     user_tz = ZoneInfo(user_timezone_str)
#                 except ZoneInfoNotFoundError:
#                     user_tz = ZoneInfo('UTC')

#                 start_local = record.start_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                 end_local = record.end_date.replace(tzinfo=timezone.utc).astimezone(user_tz)
#                 duration_hours = (end_local - start_local).total_seconds() / 3600

#                 sample_data = {
#                     'sample_id': record.sample_id,
#                     'start_local': start_local.strftime('%Y-%m-%d %H:%M:%S'),
#                     'end_local': end_local.strftime('%Y-%m-%d %H:%M:%S'),
#                     'duration_hours': round(duration_hours, 3),
#                     'source_name': record.source_name,
#                     'raw_value': float(record.value)
#                 }
                
#                 # Categorize by sleep analysis type
#                 value = float(record.value)
#                 if value == 0.0:  # HKCategoryValueSleepAnalysisInBed
#                     inbed_samples.append(sample_data)
#                 elif value == 1.0:  # HKCategoryValueSleepAnalysisAsleep  
#                     asleep_samples.append(sample_data)
#                 elif value == 2.0:  # HKCategoryValueSleepAnalysisAwake
#                     awake_samples.append(sample_data)

#             # Check for Sleep Schedule truncation patterns
#             truncated_sessions = []
#             for sample in inbed_samples:
#                 end_time = sample['end_local'].split(' ')[1]  # Get time part
#                 if end_time.startswith('07:00:0'):  # Ends at exactly 7:00:00 or 7:00:01
#                     truncated_sessions.append(sample)

#             # Analysis summary
#             analysis = {
#                 'total_samples': len(raw_sleep_results),
#                 'sample_breakdown': {
#                     'inbed_samples': len(inbed_samples),
#                     'asleep_samples': len(asleep_samples), 
#                     'awake_samples': len(awake_samples)
#                 },
#                 'sleep_schedule_analysis': {
#                     'potentially_truncated_sessions': len(truncated_sessions),
#                     'truncation_percentage': round((len(truncated_sessions) / len(inbed_samples)) * 100, 1) if inbed_samples else 0,
#                     'truncated_sessions': truncated_sessions
#                 },
#                 'recommendations': []
#             }

#             # Generate recommendations
#             if len(truncated_sessions) > len(inbed_samples) * 0.5:  # More than 50% truncated
#                 analysis['recommendations'].append({
#                     'type': 'sleep_schedule_extension',
#                     'priority': 'HIGH',
#                     'message': f'{analysis["sleep_schedule_analysis"]["truncation_percentage"]}% of sleep sessions end exactly at 7:00 AM, suggesting Sleep Schedule truncation. Consider extending your Apple Health Sleep Schedule to 9:00 AM or later to capture full sleep data.',
#                     'action': 'Extend Sleep Schedule in Apple Health app'
#                 })
            
#             if len(asleep_samples) == 0:
#                 analysis['recommendations'].append({
#                     'type': 'missing_asleep_data', 
#                     'priority': 'MEDIUM',
#                     'message': 'No "Asleep" samples found - only "InBed" samples. Enable detailed sleep tracking on Apple Watch or ensure sleep focus mode is active.',
#                     'action': 'Check Apple Watch sleep tracking settings'
#                 })

#             return jsonify({
#                 'success': True,
#                 'analysis': analysis,
#                 'sample_details': {
#                     'inbed_samples': inbed_samples[:10],  # Show first 10
#                     'asleep_samples': asleep_samples[:10],
#                     'awake_samples': awake_samples[:10]
#                 }
#             })

#     except Exception as e:
#         return jsonify({'error': str(e), 'success': False}), 500

# Test endpoint to verify 7-day sleep pattern fix
# @app.route('/api/test-7-day-sleep-patterns', methods=['GET'])
# def test_7_day_sleep_patterns():
#     """Test endpoint to verify that sleep patterns always return exactly 7 days"""
#     try:
#         user_id = request.args.get('user_id', 1, type=int)
        
#         # Call the improved sleep function with 7 days
#         sleep_result = get_improved_sleep_data(user_id, 7)
        
#         if not sleep_result.get('success'):
#             return jsonify({
#                 'success': False,
#                 'error': sleep_result.get('error', 'Unknown error'),
#                 'message': 'Sleep analysis failed'
#             })
        
#         daily_summaries = sleep_result.get('daily_summaries', [])
        
#         # Verify we have exactly 7 days
#         expected_days = 7
#         actual_days = len(daily_summaries)
        
#         # Check dates are consecutive and in proper order
#         today = datetime.now().date()
#         expected_dates = []
#         for i in range(7):
#             expected_dates.append((today - timedelta(days=i)).strftime('%Y-%m-%d'))
        
#         actual_dates = [summary['date'] for summary in daily_summaries]
        
#         # Count days with and without data
#         days_with_data = len([s for s in daily_summaries if s.get('has_data', True)])
#         days_without_data = len([s for s in daily_summaries if not s.get('has_data', True)])
        
#         test_results = {
#             'success': True,
#             'test_name': '7-Day Sleep Pattern Consistency Test',
#             'results': {
#                 'expected_days': expected_days,
#                 'actual_days': actual_days,
#                 'days_match': actual_days == expected_days,
#                 'expected_dates': expected_dates,
#                 'actual_dates': actual_dates,
#                 'dates_match': actual_dates == expected_dates,
#                 'days_with_data': days_with_data,
#                 'days_without_data': days_without_data,
#                 'complete_range_returned': sleep_result.get('complete_range', False)
#             },
#             'test_status': 'PASS' if (actual_days == expected_days and actual_dates == expected_dates) else 'FAIL',
#             'sleep_summaries': daily_summaries
#         }
        
#         if test_results['test_status'] == 'PASS':
#             print(f"✅ 7-Day Sleep Pattern Test PASSED: {actual_days} days returned with complete date range")
#         else:
#             print(f"❌ 7-Day Sleep Pattern Test FAILED: Expected {expected_days} days, got {actual_days}")
        
#         return jsonify(test_results)
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'test_status': 'ERROR',
#             'error': str(e),
#             'message': 'Test endpoint failed'
#         }), 500

if __name__ == '__main__':
    # Print registered routes for debugging
    print("\n--- Flask Registered Routes ---")
    for rule in app.url_map.iter_rules():
        print(f"Endpoint: {rule.endpoint}, Methods: {rule.methods}, Rule: {rule.rule}")
    print("-------------------------------\n")

    app.run(host='0.0.0.0', port=3001, debug=True)
