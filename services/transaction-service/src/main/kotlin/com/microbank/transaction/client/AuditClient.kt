package com.microbank.transaction.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate
import java.util.UUID

@Component
class AuditClient(
    private val restTemplate: RestTemplate,
    @Value("\${AUDIT_SERVICE_URL:http://audit-service:8087}")
    private val auditServiceUrl: String
) {

    fun logAudit(
        action: String,
        entityType: String,
        entityId: UUID,
        userId: String,
        details: Map<String, Any?>,
        sourceService: String
    ) {
        val url = "$auditServiceUrl/api/v1/audit"
        val body = mapOf(
            "action" to action,
            "entityType" to entityType,
            "entityId" to entityId.toString(),
            "userId" to userId,
            "details" to details,
            "sourceService" to sourceService
        )
        restTemplate.postForObject(url, body, Map::class.java)
    }
}
