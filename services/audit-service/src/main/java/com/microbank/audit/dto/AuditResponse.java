package com.microbank.audit.dto;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

public record AuditResponse(
    UUID id,
    String action,
    String entityType,
    UUID entityId,
    UUID userId,
    Map<String, Object> details,
    String sourceService,
    LocalDateTime createdAt
) {}
