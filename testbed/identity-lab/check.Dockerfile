# Builds the CLI from this working tree and runs check.ts against the lab
# (scripts/e2e-identity-surfaces.sh). Build context: the repository root.
FROM golang:1.23-alpine AS cli
WORKDIR /src
COPY cli ./cli
RUN cd cli && CGO_ENABLED=0 go build -o /out/chouse ./cmd/chouse

FROM oven/bun:1-alpine
WORKDIR /check
COPY --from=cli /out/chouse /usr/local/bin/chouse
COPY testbed/identity-lab/check.ts ./
CMD ["bun", "run", "check.ts"]
