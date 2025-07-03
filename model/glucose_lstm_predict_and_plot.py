import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sqlalchemy import create_engine
import os
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense

# MySQL connection
MYSQL_URL = os.getenv("MYSQL_URL", "mysql+pymysql://root:Alex%4012345@localhost/sugarsense")
engine = create_engine(MYSQL_URL)
user_id = 1

# 1. Extract data (use all available data)
with engine.connect() as conn:
    glucose_df = pd.read_sql(f'''
        SELECT timestamp, glucose_level FROM glucose_log
        WHERE user_id = {user_id} AND timestamp >= '2025-05-01'
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    food_df = pd.read_sql(f'''
        SELECT timestamp, carbs FROM food_log
        WHERE user_id = {user_id} AND timestamp >= '2025-05-01'
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    activity_df = pd.read_sql(f'''
        SELECT timestamp, duration_minutes FROM activity_log
        WHERE user_id = {user_id} AND timestamp >= '2025-05-01'
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

    sleep_df = pd.read_sql(f'''
        SELECT sleep_end as timestamp, sleep_quality FROM sleep_log
        WHERE user_id = {user_id} AND sleep_end >= '2025-05-01'
        ORDER BY sleep_end
    ''', conn, parse_dates=['timestamp'])

    med_df = pd.read_sql(f'''
        SELECT timestamp, glucose_delta FROM medication_log
        WHERE user_id = {user_id} AND timestamp >= '2025-05-01'
        ORDER BY timestamp
    ''', conn, parse_dates=['timestamp'])

# 2. Merge features into a single DataFrame (hourly)
df = glucose_df.set_index('timestamp').resample('1H').mean()
df['carbs'] = food_df.set_index('timestamp').resample('1H').sum()['carbs']
df['activity'] = activity_df.set_index('timestamp').resample('1H').sum()['duration_minutes']
df['med_delta'] = med_df.set_index('timestamp').resample('1H').sum()['glucose_delta']
# Sleep quality: encode as numeric
def encode_sleep_quality(x):
    if x == 'good': return 2
    if x == 'average': return 1
    if x == 'poor': return 0
    return np.nan
sleep_df['sleep_quality_num'] = sleep_df['sleep_quality'].map(encode_sleep_quality)
df['sleep_quality'] = sleep_df.set_index('timestamp').resample('1H').max()['sleep_quality_num']
df = df.fillna(0)

# 3. Prepare data for LSTM
scaler = MinMaxScaler()
scaled = scaler.fit_transform(df)

window = 12  # use last 12 hours to predict next hour
X, y = [], []
for i in range(window, len(scaled)-6):
    X.append(scaled[i-window:i])
    y.append(scaled[i:i+6, 0])  # predict next 6 glucose values
X, y = np.array(X), np.array(y)

# 4. Train/test split (use last 6 for prediction)
X_train, y_train = X[:-1], y[:-1]
X_pred = X[-1:]

# 5. Build and train LSTM
model = Sequential([
    LSTM(32, input_shape=(window, scaled.shape[1])),
    Dense(6)
])
model.compile(optimizer='adam', loss='mse')
model.fit(X_train, y_train, epochs=30, batch_size=8, verbose=0)

# 6. Predict next 6 hours
y_pred = model.predict(X_pred)[0]

# 7. Inverse scale for plotting
last_time = df.index[-1]
future_times = pd.date_range(last_time, periods=7, freq='1H')[1:]
measured = scaler.inverse_transform(np.concatenate([X_pred[0], np.zeros((6, scaled.shape[1]))]))[:,0]
predicted = scaler.inverse_transform(np.concatenate([np.zeros((window, scaled.shape[1])), np.column_stack([y_pred, np.zeros((6, scaled.shape[1]-1))])]))[window:,0]

# 8. Plot
plt.figure(figsize=(12,6))
plt.plot(df.index[-window:], measured[-window:], 'o-', label='Measured')
plt.plot(future_times, predicted, 'o--', label='Predicted (LSTM)')
plt.xlabel('Time')
plt.ylabel('Glucose Level (mg/dL)')
plt.title('Glucose Level: Measured & Next 6 Hours Prediction (LSTM)')
plt.legend()
plt.tight_layout()
plt.show() 