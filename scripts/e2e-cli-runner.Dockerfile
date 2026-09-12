FROM python:3.12-slim
COPY chouse /usr/local/bin/chouse
RUN chmod +x /usr/local/bin/chouse && /usr/local/bin/chouse --help > /dev/null
