package com.microbank.audit.repository;

import com.microbank.audit.model.AuditLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Repository
public interface AuditLogRepository extends JpaRepository<AuditLog, UUID> {

    List<AuditLog> findByUserId(UUID userId);

    List<AuditLog> findByAction(String action);

    List<AuditLog> findByCreatedAtBetween(LocalDateTime from, LocalDateTime to);

    List<AuditLog> findByUserIdAndAction(UUID userId, String action);

    @Query("SELECT a FROM AuditLog a WHERE "
            + "(:userId IS NULL OR a.userId = :userId) "
            + "AND (:action IS NULL OR a.action = :action) "
            + "AND (:from IS NULL OR a.createdAt >= :from) "
            + "AND (:to IS NULL OR a.createdAt <= :to) "
            + "ORDER BY a.createdAt DESC")
    List<AuditLog> findByFilters(
            @Param("userId") UUID userId,
            @Param("action") String action,
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to
    );
}
