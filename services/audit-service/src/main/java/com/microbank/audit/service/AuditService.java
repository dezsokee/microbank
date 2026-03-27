package com.microbank.audit.service;

import com.microbank.audit.dto.AuditRequest;
import com.microbank.audit.dto.AuditResponse;
import com.microbank.audit.model.AuditLog;
import com.microbank.audit.repository.AuditLogRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class AuditService {

    private final AuditLogRepository auditLogRepository;

    public AuditService(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    @Transactional
    public AuditResponse createAuditLog(AuditRequest request) {
        if (request.action() == null || request.action().isBlank()) {
            throw new IllegalArgumentException("Action is required");
        }
        if (request.entityType() == null || request.entityType().isBlank()) {
            throw new IllegalArgumentException("Entity type is required");
        }

        AuditLog auditLog = new AuditLog();
        auditLog.setAction(request.action());
        auditLog.setEntityType(request.entityType());
        auditLog.setEntityId(request.entityId());
        auditLog.setUserId(request.userId());
        auditLog.setDetails(request.details());
        auditLog.setSourceService(request.sourceService());

        AuditLog saved = auditLogRepository.save(auditLog);
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<AuditResponse> queryAuditLogs(UUID userId, String action,
                                               LocalDateTime from, LocalDateTime to) {
        List<AuditLog> logs = auditLogRepository.findByFilters(userId, action, from, to);
        return logs.stream().map(this::toResponse).toList();
    }

    private AuditResponse toResponse(AuditLog auditLog) {
        return new AuditResponse(
                auditLog.getId(),
                auditLog.getAction(),
                auditLog.getEntityType(),
                auditLog.getEntityId(),
                auditLog.getUserId(),
                auditLog.getDetails(),
                auditLog.getSourceService(),
                auditLog.getCreatedAt()
        );
    }
}
