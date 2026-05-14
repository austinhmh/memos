FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend
WORKDIR /backend-build
COPY go.mod go.sum ./
RUN GOMAXPROCS=2 GOMEMLIMIT=1024MiB go mod download
COPY . .
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOMAXPROCS=2 GOMEMLIMIT=1024MiB \
    go build \
      -trimpath \
      -ldflags="-s -w -extldflags '-static'" \
      -tags netgo,osusergo \
      -p=1 \
      -o memos \
      ./cmd/memos

FROM alpine:3.21
WORKDIR /usr/local/memos
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -g 10001 -S nonroot && \
    adduser -u 10001 -S -G nonroot -h /var/opt/memos nonroot && \
    mkdir -p /var/opt/memos && \
    chown -R nonroot:nonroot /var/opt/memos
COPY --from=backend /backend-build/memos /usr/local/memos/memos
USER nonroot:nonroot
VOLUME /var/opt/memos
EXPOSE 5230
ENV MEMOS_MODE="prod" \
    MEMOS_PORT="5230"
ENTRYPOINT ["/usr/local/memos/memos"]
