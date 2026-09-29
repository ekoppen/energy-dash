# backend/Dockerfile — FastAPI proxy naar Home Assistant
FROM python:3.12-slim

WORKDIR /app

# Alleen requirements eerst → betere layer-caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Draai als niet-root gebruiker
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# uvicorn serveert de FastAPI-app (main.py → app)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
