package com.microbank.transaction.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate
import java.math.BigDecimal
import java.util.UUID

@Component
class FraudClient(
    private val restTemplate: RestTemplate,
    @Value("\${FRAUD_SERVICE_URL:http://fraud-service:8084}")
    private val fraudServiceUrl: String
) {

    fun checkFraud(
        transactionId: UUID,
        fromAccountId: UUID,
        toAccountId: UUID,
        amount: BigDecimal,
        currency: String
    ): Map<*, *>? {
        val url = "$fraudServiceUrl/api/v1/fraud/check"
        val body = mapOf(
            "transactionId" to transactionId.toString(),
            "fromAccountId" to fromAccountId.toString(),
            "toAccountId" to toAccountId.toString(),
            "amount" to amount,
            "currency" to currency
        )
        return restTemplate.postForObject(url, body, Map::class.java)
    }
}
