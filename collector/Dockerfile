FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml ./
COPY ufcim_collector ./ufcim_collector
RUN pip install --no-cache-dir . && useradd --system --uid 10001 collector && mkdir /data && chown collector /data

USER collector
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD ["python", "-m", "ufcim_collector.health", "/data"]
CMD ["python", "-m", "ufcim_collector", "--config", "/app/config.toml"]
