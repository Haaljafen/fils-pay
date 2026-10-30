# Multi-stage build of apps/settlement. Build context is the repo root.
# The final image holds only the static binary: no shell, no package manager,
# about 20 MB. time/tzdata is compiled in (cmd/settlement imports it), so
# Asia/Bahrain loads without OS zoneinfo.
FROM golang:1.25-alpine AS build

WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download

COPY apps/settlement/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/settlement ./cmd/settlement

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/settlement /app/settlement
