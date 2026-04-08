package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type Config struct {
	DBHost     string
	DBPort     int
	DBUser     string
	DBPassword string
	DBName     string
	Port       int
}

func loadConfig() Config {
	return Config{
		DBHost:     envOrDefault("DB_HOST", "postgres"),
		DBPort:     envOrDefaultInt("DB_PORT", 5432),
		DBUser:     envOrDefault("DB_USER", "microbank"),
		DBPassword: envOrDefault("DB_PASSWORD", "microbank"),
		DBName:     envOrDefault("DB_NAME", "auth_db"),
		Port:       envOrDefaultInt("PORT", 8081),
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrDefaultInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// ---------------------------------------------------------------------------
// JSON logging
// ---------------------------------------------------------------------------

type logEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Service   string `json:"service"`
	Message   string `json:"message"`
}

func jsonLog(level, message string) {
	entry := logEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Service:   "auth-service",
		Message:   message,
	}
	data, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(data))
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":     code,
		"message":   message,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
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

// metricsMiddleware records request count and duration.
func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		duration := time.Since(start).Seconds()

		path := r.URL.Path
		method := r.Method
		status := strconv.Itoa(rw.statusCode)

		httpRequestsTotal.WithLabelValues(method, path, status).Inc()
		httpRequestDuration.WithLabelValues(method, path).Observe(duration)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------

func initDB(cfg Config) *sql.DB {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName,
	)

	var db *sql.DB
	var err error

	for i := 0; i < 30; i++ {
		db, err = sql.Open("postgres", dsn)
		if err == nil {
			err = db.Ping()
		}
		if err == nil {
			break
		}
		jsonLog("WARN", fmt.Sprintf("DB not ready, retrying (%d/30): %v", i+1, err))
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS users (
		id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		username   VARCHAR(100) UNIQUE NOT NULL,
		token      VARCHAR(255) UNIQUE,
		created_at TIMESTAMP DEFAULT NOW()
	);`
	if _, err := db.Exec(createTable); err != nil {
		log.Fatalf("failed to create users table: %v", err)
	}
	jsonLog("INFO", "Database table 'users' ensured")

	// Seed data if the table is empty.
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		log.Fatalf("failed to count users: %v", err)
	}
	if count == 0 {
		seedUsers := []string{"alice", "bob", "charlie"}
		for _, username := range seedUsers {
			token := uuid.New().String()
			_, err := db.Exec(
				"INSERT INTO users (id, username, token) VALUES ($1, $2, $3)",
				uuid.New().String(), username, token,
			)
			if err != nil {
				log.Fatalf("failed to seed user %s: %v", username, err)
			}
			jsonLog("INFO", fmt.Sprintf("Seeded user: %s", username))
		}
	}

	return db
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func handleRegister(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "username is required")
			return
		}

		userID := uuid.New().String()
		token := uuid.New().String()

		_, err := db.Exec(
			"INSERT INTO users (id, username, token) VALUES ($1, $2, $3)",
			userID, req.Username, token,
		)
		if err != nil {
			jsonLog("ERROR", fmt.Sprintf("register failed: %v", err))
			writeError(w, http.StatusConflict, "USER_EXISTS", "username already taken")
			return
		}

		jsonLog("INFO", fmt.Sprintf("User registered: %s", req.Username))
		writeJSON(w, http.StatusCreated, map[string]string{
			"userId":   userID,
			"username": req.Username,
			"token":    token,
		})
	}
}

func handleLogin(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "username is required")
			return
		}

		var userID string
		err := db.QueryRow("SELECT id FROM users WHERE username = $1", req.Username).Scan(&userID)
		if err != nil {
			writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
			return
		}

		newToken := uuid.New().String()
		_, err = db.Exec("UPDATE users SET token = $1 WHERE id = $2", newToken, userID)
		if err != nil {
			jsonLog("ERROR", fmt.Sprintf("login token update failed: %v", err))
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update token")
			return
		}

		jsonLog("INFO", fmt.Sprintf("User logged in: %s", req.Username))
		writeJSON(w, http.StatusOK, map[string]string{
			"userId":   userID,
			"username": req.Username,
			"token":    newToken,
		})
	}
}

func handleValidate(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
			return
		}

		var userID, username string
		err := db.QueryRow(
			"SELECT id, username FROM users WHERE token = $1", token,
		).Scan(&userID, &username)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"valid":    true,
			"userId":   userID,
			"username": username,
		})
	}
}

func handleHealthz() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "UP",
			"service": "auth-service",
		})
	}
}

func handleReadyz(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status":  "DOWN",
				"service": "auth-service",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "UP",
			"service": "auth-service",
		})
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	cfg := loadConfig()

	jsonLog("INFO", "Starting auth-service")

	db := initDB(cfg)
	defer db.Close()

	r := chi.NewRouter()
	r.Use(metricsMiddleware)

	// Public API
	r.Post("/api/v1/auth/register", handleRegister(db))
	r.Post("/api/v1/auth/login", handleLogin(db))

	// Internal
	r.Get("/internal/validate", handleValidate(db))

	// Operational
	r.Get("/healthz", handleHealthz())
	r.Get("/readyz", handleReadyz(db))
	r.Handle("/metrics", promhttp.Handler())

	addr := fmt.Sprintf(":%d", cfg.Port)
	jsonLog("INFO", fmt.Sprintf("Listening on %s", addr))

	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
