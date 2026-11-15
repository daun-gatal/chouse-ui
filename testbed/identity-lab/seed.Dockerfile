# Runs the lab's one-shot seed against the CHouse UI API.
FROM oven/bun:1-alpine
WORKDIR /seed
COPY seed.ts ./
CMD ["bun", "run", "seed.ts"]
