FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -o /gateway ./cmd/main.go

FROM alpine:3.19
COPY --from=builder /gateway /gateway
EXPOSE 8080
CMD ["/gateway"]
