package com.microbank.transaction.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate
import java.util.UUID

@Component
class NotificationClient(
    private val restTemplate: RestTemplate,
    @Value("\${NOTIFICATION_SERVICE_URL:http://notification-service:8086}")
    private val notificationServiceUrl: String
) {

    fun sendNotification(type: String, userId: String, transactionId: UUID, message: String) {
        val url = "$notificationServiceUrl/api/v1/notifications"
        val body = mapOf(
            "type" to type,
            "userId" to userId,
            "transactionId" to transactionId.toString(),
            "message" to message
        )
        restTemplate.postForObject(url, body, Map::class.java)
    }
}
