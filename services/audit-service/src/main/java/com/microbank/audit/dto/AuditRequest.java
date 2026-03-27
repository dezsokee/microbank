package com.microbank.audit.dto;

import java.util.Map;
import java.util.UUID;

public record AuditRequest(
    String action,
    String entityType,
    UUID entityId,
    UUID userId,
    Map<String, Object> details,
    String sourceService
) {}
