import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sqlalchemy import create_engine, text
import os

# MySQL connection
MYSQL_URL = os.getenv("MYSQL_URL", "mysql+pymysql://root:Alex%4012345@localhost/sugarsense")
engine = create_engine(MYSQL_URL)

user_id = 1

# 1. Extract glucose data (last 48 hours)
with engine.connect() as conn:
    glucose_df = pd.read_sql(f'''
        SELECT timestamp, glucose_level FROM glucose_log
        WHERE user_id = {user_id} AND timestamp >= '2025-05-01'
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    food_df = pd.read_sql(f'''
        SELECT timestamp, carbs FROM food_log
        WHERE user_id = {user_id} AND timestamp >= NOW() - INTERVAL 2 DAY
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    activity_df = pd.read_sql(f'''
        SELECT timestamp, duration_minutes FROM activity_log
        WHERE user_id = {user_id} AND timestamp >= NOW() - INTERVAL 2 DAY
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    sleep_df = pd.read_sql(f'''
        SELECT sleep_start, sleep_end, sleep_quality FROM sleep_log
        WHERE user_id = {user_id} AND sleep_end >= NOW() - INTERVAL 2 DAY
        ORDER BY sleep_end
    ''', conn, parse_dates=['sleep_start', 'sleep_end'])

    med_df = pd.read_sql(f'''
        SELECT timestamp, med_name, glucose_delta FROM medication_log
        WHERE user_id = {user_id} AND timestamp >= NOW() - INTERVAL 2 DAY
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    if glucose_df.empty:
        print("No glucose data found for the last 2 days.")
        exit(1)

    print(glucose_df)

# 2. Simple prediction: moving average for next 6 hours (every hour)
last_time = glucose_df['timestamp'].max()
future_times = pd.date_range(last_time, periods=7, freq='1H')[1:]
window = 6  # hours
predicted = []
for t in future_times:
    avg = glucose_df['glucose_level'].tail(window).mean()
    predicted.append(avg)

# 3. Plot
plt.figure(figsize=(12,6))
plt.plot(glucose_df['timestamp'], glucose_df['glucose_level'], 'o-', label='Measured')
plt.plot(future_times, predicted, 'o--', label='Predicted (Moving Avg)')
plt.xlabel('Time')
plt.ylabel('Glucose Level (mg/dL)')
plt.title('Glucose Level: Measured & Next 6 Hours Prediction')
plt.legend()
plt.tight_layout()
plt.show()

# Apply forward fill and backward fill to handle missing data
glucose_df = glucose_df.ffill().bfill()
food_df = food_df.ffill().bfill()
activity_df = activity_df.ffill().bfill()
sleep_df = sleep_df.ffill().bfill()
med_df = med_df.ffill().bfill()

# Apply interpolation to handle missing data
glucose_df = glucose_df.interpolate(method='time').ffill().bfill()
food_df = food_df.interpolate(method='time').ffill().bfill()
activity_df = activity_df.interpolate(method='time').ffill().bfill()
sleep_df = sleep_df.interpolate(method='time').ffill().bfill()
med_df = med_df.interpolate(method='time').ffill().bfill() 