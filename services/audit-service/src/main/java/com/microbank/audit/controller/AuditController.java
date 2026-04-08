package com.microbank.audit.controller;

import com.microbank.audit.dto.AuditRequest;
import com.microbank.audit.dto.AuditResponse;
import com.microbank.audit.dto.ErrorResponse;
import com.microbank.audit.service.AuditService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class AuditController {

    private final AuditService auditService;
    private final DataSource dataSource;

    public AuditController(AuditService auditService, DataSource dataSource) {
        this.auditService = auditService;
        this.dataSource = dataSource;
    }

    @PostMapping("/api/v1/audit")
    public ResponseEntity<?> createAuditLog(@RequestBody AuditRequest request) {
        try {
            AuditResponse response = auditService.createAuditLog(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(new ErrorResponse(
                    "VALIDATION_ERROR",
                    e.getMessage(),
                    LocalDateTime.now()
            ));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ErrorResponse(
                    "INTERNAL_ERROR",
                    "Failed to create audit log entry",
                    LocalDateTime.now()
            ));
        }
    }

    @GetMapping("/api/v1/audit")
    public ResponseEntity<?> queryAuditLogs(
            @RequestParam(required = false) UUID userId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        try {
            LocalDateTime fromDateTime = from != null ? from.atStartOfDay() : null;
            LocalDateTime toDateTime = to != null ? to.plusDays(1).atStartOfDay() : null;

            List<AuditResponse> logs = auditService.queryAuditLogs(userId, action, fromDateTime, toDateTime);
            return ResponseEntity.ok(Map.of("logs", logs));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ErrorResponse(
                    "INTERNAL_ERROR",
                    "Failed to query audit logs",
                    LocalDateTime.now()
            ));
        }
    }

    @GetMapping("/healthz")
    public ResponseEntity<Map<String, String>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "audit-service"
        ));
    }

    @GetMapping("/readyz")
    public ResponseEntity<Map<String, String>> readyCheck() {
        try (Connection connection = dataSource.getConnection()) {
            if (connection.isValid(2)) {
                return ResponseEntity.ok(Map.of(
                        "status", "READY",
                        "service", "audit-service"
                ));
            }
        } catch (Exception e) {
            // fall through to unavailable
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                "status", "UNAVAILABLE",
                "service", "audit-service"
        ));
    }
}
