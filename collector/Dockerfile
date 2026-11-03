# Imagem mínima do coletor (~55 MB, contra 211 MB do python:slim): Alpine limpo + o Python oficial enxugado +
# tinytuya e o AES dele. Nada de pip, compilador ou módulos sem uso na final.
#
# - tinytuya vai sem dependências: `requests` só serve à API de nuvem e
#   `colorama` só colore terminal. O AES-GCM do protocolo 3.5 vem do
#   pycryptodomex, bem menor que o `cryptography`.
# - Da biblioteca padrão saem o que o coletor não usa (pip, IDLE, tkinter,
#   curses, readline, dbm, bz2/lzma, testes) e, com isso, as libs de sistema
#   correspondentes. Ficam ssl (HTTPS), sqlite3 (fila), ctypes (pycryptodomex).

ARG PYTHON=3.12
ARG ALPINE=3.24

FROM python:${PYTHON}-alpine${ALPINE} AS deps
RUN pip install --no-cache-dir --no-compile --target /deps --no-deps tinytuya==1.20.0 \
 && pip install --no-cache-dir --no-compile --target /deps --only-binary=:all: "pycryptodomex>=3.20,<4" \
 && rm -rf /deps/bin /deps/*.dist-info/RECORD

FROM python:${PYTHON}-alpine${ALPINE} AS python
ARG PYTHON
RUN set -eux; \
    lib=/usr/local/lib/python${PYTHON}; \
    rm -rf "$lib"/site-packages/* "$lib"/ensurepip "$lib"/idlelib "$lib"/tkinter "$lib"/turtledemo \
           "$lib"/lib2to3 "$lib"/pydoc_data "$lib"/test "$lib"/unittest/test "$lib"/venv \
           "$lib"/curses "$lib"/dbm "$lib"/config-"${PYTHON}"-* \
           /usr/local/include /usr/local/lib/pkgconfig /usr/local/share \
           /usr/local/bin/pip* /usr/local/bin/idle* /usr/local/bin/pydoc* /usr/local/bin/2to3*; \
    cd "$lib"/lib-dynload; \
    rm -f _bz2.* _lzma.* _dbm.* _gdbm.* _curses*.* readline.* nis.* _uuid.* _tkinter.* \
          _test*.* _ctypes_test.* xxlimited*.* _xxtestfuzz.* xxsubtype.*; \
    find /usr/local -depth -type d -name __pycache__ -exec rm -rf {} +

FROM alpine:${ALPINE}
ARG PYTHON
RUN apk add --no-cache libssl3 libcrypto3 sqlite-libs libffi zlib \
 && adduser -D -H -u 10001 collector \
 && mkdir /data && chown collector /data
COPY --from=python /usr/local /usr/local
COPY --from=deps /deps /deps
COPY ufcim_collector /app/ufcim_collector
ENV PYTHONPATH=/deps:/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UFCIM_DATA_DIR=/data

USER collector
WORKDIR /app
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD ["python", "-m", "ufcim_collector.health", "/data"]
# Um aparelho, tudo por variáveis UFCIM_* (ver .env.example). Para vários, monte
# um config.toml e troque o comando por: python -m ufcim_collector --config /app/config.toml
CMD ["python", "-m", "ufcim_collector"]
