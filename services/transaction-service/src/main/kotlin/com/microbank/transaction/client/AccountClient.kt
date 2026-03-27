package com.microbank.transaction.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate
import java.math.BigDecimal
import java.util.UUID

@Component
class AccountClient(
    private val restTemplate: RestTemplate,
    @Value("\${ACCOUNT_SERVICE_URL:http://account-service:8082}")
    private val accountServiceUrl: String
) {

    fun getAccount(accountId: UUID): Map<*, *>? {
        val url = "$accountServiceUrl/api/v1/accounts/$accountId"
        return restTemplate.getForObject(url, Map::class.java)
    }

    fun checkAccountExists(accountId: UUID): Boolean {
        return try {
            val url = "$accountServiceUrl/api/v1/accounts/$accountId/exists"
            val response = restTemplate.getForObject(url, Map::class.java)
            response?.get("exists") as? Boolean ?: false
        } catch (e: Exception) {
            false
        }
    }

    fun updateBalance(accountId: UUID, amount: BigDecimal, transactionId: UUID) {
        val url = "$accountServiceUrl/api/v1/accounts/$accountId/balance"
        val body = mapOf(
            "amount" to amount,
            "transactionId" to transactionId.toString()
        )
        restTemplate.put(url, body)
    }
}
