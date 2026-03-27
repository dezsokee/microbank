package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ---------------------------------------------------------------------------
// JSON logger
// ---------------------------------------------------------------------------

type jsonLogger struct{}

func (j *jsonLogger) Info(msg string, fields map[string]string) {
	entry := map[string]string{
		"level":     "info",
		"message":   msg,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	for k, v := range fields {
		entry[k] = v
	}
	data, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(data))
}

func (j *jsonLogger) Error(msg string, fields map[string]string) {
	entry := map[string]string{
		"level":     "error",
		"message":   msg,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	for k, v := range fields {
		entry[k] = v
	}
	data, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(data))
}

var logger = &jsonLogger{}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

type errorResponse struct {
	Error     string `json:"error"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func writeError(w http.ResponseWriter, statusCode int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(errorResponse{
		Error:     code,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status"},
	)
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)
)

func init() {
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpRequestDuration)
}

// ---------------------------------------------------------------------------
// Metrics middleware
// ---------------------------------------------------------------------------

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rec, r)
		duration := time.Since(start).Seconds()

		path := r.URL.Path
		httpRequestsTotal.WithLabelValues(r.Method, path, fmt.Sprintf("%d", rec.statusCode)).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

func authMiddleware(authServiceURL string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				logger.Error("missing or malformed authorization header", map[string]string{"path": r.URL.Path})
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing or invalid authorization token")
				return
			}

			token := strings.TrimPrefix(authHeader, "Bearer ")

			validateURL := fmt.Sprintf("%s/internal/validate?token=%s", authServiceURL, url.QueryEscape(token))
			resp, err := http.Get(validateURL)
			if err != nil {
				logger.Error("auth service unreachable", map[string]string{"error": err.Error()})
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication service unavailable")
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				logger.Error("token validation failed", map[string]string{"status": fmt.Sprintf("%d", resp.StatusCode)})
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired token")
				return
			}

			var result struct {
				Valid    bool   `json:"valid"`
				UserID   string `json:"userId"`
				Username string `json:"username"`
			}
			body, _ := io.ReadAll(resp.Body)
			if err := json.Unmarshal(body, &result); err != nil || !result.Valid || result.UserID == "" {
				logger.Error("invalid auth response", map[string]string{"body": string(body)})
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid authentication response")
				return
			}

			r.Header.Set("X-User-Id", result.UserID)
			next.ServeHTTP(w, r)
		})
	}
}

// ---------------------------------------------------------------------------
// Reverse proxy factory
// ---------------------------------------------------------------------------

func newReverseProxy(target string) http.Handler {
	targetURL, err := url.Parse(target)
	if err != nil {
		log.Fatalf("invalid proxy target URL %q: %v", target, err)
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		// Preserve the original path and query as-is.
		req.Host = targetURL.Host
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Error("proxy error", map[string]string{
			"target": target,
			"path":   r.URL.Path,
			"error":  err.Error(),
		})
		writeError(w, http.StatusBadGateway, "BAD_GATEWAY", "Upstream service unavailable")
	}

	return proxy
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	authServiceURL := env("AUTH_SERVICE_URL", "http://auth-service:8081")
	accountServiceURL := env("ACCOUNT_SERVICE_URL", "http://account-service:8082")
	transactionServiceURL := env("TRANSACTION_SERVICE_URL", "http://transaction-service:8083")
	exchangeServiceURL := env("EXCHANGE_SERVICE_URL", "http://exchange-service:8085")
	port := env("PORT", "8080")

	// Build proxies
	authProxy := newReverseProxy(authServiceURL)
	accountProxy := newReverseProxy(accountServiceURL)
	transactionProxy := newReverseProxy(transactionServiceURL)
	exchangeProxy := newReverseProxy(exchangeServiceURL)

	r := chi.NewRouter()

	// Global metrics middleware
	r.Use(metricsMiddleware)

	// ---- Public routes (no auth) ----
	r.Get("/healthz", healthHandler)
	r.Handle("/metrics", promhttp.Handler())

	// Auth routes - no token required
	r.Post("/api/v1/auth/login", authProxy.ServeHTTP)
	r.Post("/api/v1/auth/register", authProxy.ServeHTTP)

	// ---- Protected routes (auth required) ----
	r.Group(func(protected chi.Router) {
		protected.Use(authMiddleware(authServiceURL))

		// Account service
		protected.Get("/api/v1/accounts", accountProxy.ServeHTTP)
		protected.Get("/api/v1/accounts/*", accountProxy.ServeHTTP)
		protected.Post("/api/v1/accounts", accountProxy.ServeHTTP)
		protected.Post("/api/v1/accounts/*", accountProxy.ServeHTTP)
		protected.Put("/api/v1/accounts/*", accountProxy.ServeHTTP)

		// Transaction service
		protected.Get("/api/v1/transactions", transactionProxy.ServeHTTP)
		protected.Get("/api/v1/transactions/*", transactionProxy.ServeHTTP)
		protected.Post("/api/v1/transactions", transactionProxy.ServeHTTP)
		protected.Post("/api/v1/transactions/*", transactionProxy.ServeHTTP)

		// Exchange rate service
		protected.Get("/api/v1/exchange-rates", exchangeProxy.ServeHTTP)
		protected.Get("/api/v1/exchange-rates/*", exchangeProxy.ServeHTTP)
	})

	logger.Info("API Gateway starting", map[string]string{
		"port":                port,
		"auth_service":        authServiceURL,
		"account_service":     accountServiceURL,
		"transaction_service": transactionServiceURL,
		"exchange_service":    exchangeServiceURL,
	})

	addr := fmt.Sprintf(":%s", port)
	if err := http.ListenAndServe(addr, r); err != nil {
		logger.Error("server failed", map[string]string{"error": err.Error()})
		os.Exit(1)
	}
}
