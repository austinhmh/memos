FROM golang:1.25-alpine AS backend
WORKDIR /backend-build
COPY go.mod go.sum ./
RUN GOMAXPROCS=2 GOMEMLIMIT=1024MiB go mod download
COPY . .
RUN GOMAXPROCS=2 GOMEMLIMIT=1024MiB go build -p=1 -o memos ./cmd/memos

FROM alpine:3.21
WORKDIR /usr/local/memos
COPY --from=backend /backend-build/memos /usr/local/memos/
EXPOSE 5230
RUN mkdir -p /var/opt/memos
ENV MEMOS_MODE="prod"
ENV MEMOS_PORT="5230"
ENTRYPOINT ["./memos"]
