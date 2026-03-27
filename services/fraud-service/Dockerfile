FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -o /fraud-service ./cmd/main.go

FROM alpine:3.19
COPY --from=builder /fraud-service /fraud-service
EXPOSE 8084
CMD ["/fraud-service"]
