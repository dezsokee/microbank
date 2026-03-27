FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -o /auth-service ./cmd/main.go

FROM alpine:3.19
COPY --from=builder /auth-service /auth-service
EXPOSE 8081
CMD ["/auth-service"]
