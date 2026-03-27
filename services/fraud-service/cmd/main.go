package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ---------- Prometheus metrics ----------

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)
)

func init() {
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpRequestDuration)
}

// ---------- Types ----------

type FraudCheckRequest struct {
	TransactionID string  `json:"transactionId"`
	FromAccountID string  `json:"fromAccountId"`
	ToAccountID   string  `json:"toAccountId"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
}

type RuleResult struct {
	Rule   string `json:"rule"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail"`
}

type FraudCheckResponse struct {
	TransactionID string       `json:"transactionId"`
	Result        string       `json:"result"`
	RiskScore     int          `json:"riskScore"`
	Rules         []RuleResult `json:"rules"`
}

type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type ErrorResponse struct {
	Error     string `json:"error"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

// ---------- JSON logger ----------

type logEntry struct {
	Level   string `json:"level"`
	Time    string `json:"time"`
	Message string `json:"message"`
	Method  string `json:"method,omitempty"`
	Path    string `json:"path,omitempty"`
	Status  int    `json:"status,omitempty"`
}

func logJSON(level, message string) {
	entry := logEntry{
		Level:   level,
		Time:    time.Now().UTC().Format(time.RFC3339),
		Message: message,
	}
	data, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(data))
}

func logRequest(method, path string, status int, dur time.Duration) {
	entry := logEntry{
		Level:   "INFO",
		Time:    time.Now().UTC().Format(time.RFC3339),
		Message: fmt.Sprintf("%s %s %d %s", method, path, status, dur),
		Method:  method,
		Path:    path,
		Status:  status,
	}
	data, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(data))
}

// ---------- Middleware ----------

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		duration := time.Since(start)
		status := strconv.Itoa(ww.Status())
		path := r.URL.Path

		httpRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration.Seconds())
		logRequest(r.Method, path, ww.Status(), duration)
	})
}

// ---------- Handlers ----------

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HealthResponse{
		Status:  "UP",
		Service: "fraud-service",
	})
}

func fraudCheckHandler(w http.ResponseWriter, r *http.Request) {
	var req FraudCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body: "+err.Error())
		return
	}

	if req.TransactionID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELD", "transactionId is required")
		return
	}
	if req.FromAccountID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELD", "fromAccountId is required")
		return
	}
	if req.ToAccountID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELD", "toAccountId is required")
		return
	}
	if req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_AMOUNT", "amount must be greater than 0")
		return
	}
	if req.Currency == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELD", "currency is required")
		return
	}

	resp := evaluateFraud(req)
	logJSON("INFO", fmt.Sprintf("Fraud check completed: txId=%s result=%s riskScore=%d", resp.TransactionID, resp.Result, resp.RiskScore))
	writeJSON(w, http.StatusOK, resp)
}

// ---------- Fraud evaluation ----------

func evaluateFraud(req FraudCheckRequest) FraudCheckResponse {
	riskScore := 0
	var rules []RuleResult

	// Rule: AMOUNT_LIMIT
	if req.Amount > 10000 {
		riskScore += 50
		rules = append(rules, RuleResult{
			Rule:   "AMOUNT_LIMIT",
			Passed: false,
			Detail: "Amount exceeds 10000 limit",
		})
	} else {
		rules = append(rules, RuleResult{
			Rule:   "AMOUNT_LIMIT",
			Passed: true,
			Detail: "Amount under 10000 limit",
		})
	}

	// Rule: HIGH_AMOUNT
	if req.Amount > 5000 {
		riskScore += 20
		rules = append(rules, RuleResult{
			Rule:   "HIGH_AMOUNT",
			Passed: false,
			Detail: "High amount warning",
		})
	}

	// Rule: FREQUENCY (5% chance of anomaly)
	if rand.Float64() < 0.05 {
		riskScore += 30
		rules = append(rules, RuleResult{
			Rule:   "FREQUENCY",
			Passed: false,
			Detail: "Simulated high frequency anomaly",
		})
	} else {
		rules = append(rules, RuleResult{
			Rule:   "FREQUENCY",
			Passed: true,
			Detail: "Normal frequency",
		})
	}

	// Rule: SUSPICIOUS_ACCOUNT (2% chance)
	if rand.Float64() < 0.02 {
		riskScore += 40
		rules = append(rules, RuleResult{
			Rule:   "SUSPICIOUS_ACCOUNT",
			Passed: false,
			Detail: "Simulated suspicious account",
		})
	}

	// Determine result
	var result string
	if riskScore >= 70 {
		result = "REJECTED"
	} else if riskScore >= 40 {
		result = "REVIEW"
	} else {
		result = "APPROVED"
	}

	return FraudCheckResponse{
		TransactionID: req.TransactionID,
		Result:        result,
		RiskScore:     riskScore,
		Rules:         rules,
	}
}

// ---------- Helpers ----------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorResponse{
		Error:     code,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------- Main ----------

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8084"
	}

	r := chi.NewRouter()
	r.Use(metricsMiddleware)

	r.Get("/healthz", healthHandler)
	r.Post("/api/v1/fraud/check", fraudCheckHandler)
	r.Handle("/metrics", promhttp.Handler())

	logJSON("INFO", fmt.Sprintf("Fraud Detection Service starting on port %s", port))

	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
