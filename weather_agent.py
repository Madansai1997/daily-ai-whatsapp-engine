"""
Weather Agent — self-contained skill module.

Uses Open-Meteo (free, no API key) for Hyderabad. Matches the codebase's existing
blocking-I/O pattern: requests.get() wrapped in loop.run_in_executor(), since
httpx is not in requirements.txt and requests already is.
"""

import asyncio
import requests
from datetime import datetime

HYDERABAD_LAT = 17.3850
HYDERABAD_LON = 78.4867

WEATHER_CODES = {
    0: "Clear sky ☀️",
    1: "Mainly clear 🌤️",
    2: "Partly cloudy ⛅",
    3: "Overcast ☁️",
    45: "Foggy 🌫️",
    48: "Icy fog 🌫️",
    51: "Light drizzle 🌦️",
    53: "Drizzle 🌦️",
    55: "Heavy drizzle 🌧️",
    56: "Light freezing drizzle 🌧️",
    57: "Freezing drizzle 🌧️",
    61: "Light rain 🌧️",
    63: "Rain 🌧️",
    65: "Heavy rain 🌧️",
    66: "Light freezing rain 🌧️",
    67: "Freezing rain 🌧️",
    71: "Light snow 🌨️",
    73: "Snow 🌨️",
    75: "Heavy snow 🌨️",
    77: "Snow grains 🌨️",
    80: "Light rain showers 🌦️",
    81: "Rain showers 🌧️",
    82: "Heavy rain showers ⛈️",
    85: "Light snow showers 🌨️",
    86: "Snow showers 🌨️",
    95: "Thunderstorm ⛈️",
    96: "Thunderstorm with light hail ⛈️",
    99: "Thunderstorm with heavy hail ⛈️",
}


def _fetch_weather_sync(include_humidity: bool) -> dict:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={HYDERABAD_LAT}&longitude={HYDERABAD_LON}"
        "&current_weather=true"
        + ("&hourly=relativehumidity_2m" if include_humidity else "")
        + "&timezone=Asia%2FKolkata"
    )
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()


async def get_weather() -> str:
    """Full detailed weather message for an on-demand WhatsApp/web query."""
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, lambda: _fetch_weather_sync(True))

        current = data["current_weather"]
        temp = current["temperature"]
        windspeed = current["windspeed"]
        condition = WEATHER_CODES.get(current["weathercode"], "Unknown conditions")

        humidity = None
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        humidities = hourly.get("relativehumidity_2m", [])
        current_hour_str = current.get("time", "")[:13]  # "YYYY-MM-DDTHH"
        for t, h in zip(times, humidities):
            if t.startswith(current_hour_str):
                humidity = h
                break

        lines = [
            "🌤️ *Hyderabad Weather*",
            "",
            condition,
            f"🌡️ Temperature: {temp}°C",
        ]
        if humidity is not None:
            lines.append(f"💧 Humidity: {humidity}%")
        lines.append(f"💨 Wind: {windspeed} km/h")

        return "\n".join(lines)

    except Exception as e:
        print(f"⚠️ [weather_agent] get_weather failed: {e}")
        return "⚠️ Weather unavailable right now."


async def get_weather_brief() -> str:
    """Short one-liner for the daily briefing."""
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, lambda: _fetch_weather_sync(False))
        current = data["current_weather"]
        temp = current["temperature"]
        condition = WEATHER_CODES.get(current["weathercode"], "Unknown")
        return f"{condition} — {temp}°C in Hyderabad"
    except Exception as e:
        print(f"⚠️ [weather_agent] get_weather_brief failed: {e}")
        return "Weather unavailable right now."
