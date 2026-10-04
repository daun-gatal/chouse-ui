FROM python:3.12-slim
# PyYAML validates -o yaml in the output matrix (e2e-cli-output-check.py).
RUN pip install --no-cache-dir pyyaml==6.0.2
COPY chouse /usr/local/bin/chouse
RUN chmod +x /usr/local/bin/chouse && /usr/local/bin/chouse --help > /dev/null
