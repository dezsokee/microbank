package com.microbank.transaction.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate
import java.math.BigDecimal

@Component
class ExchangeClient(
    private val restTemplate: RestTemplate,
    @Value("\${EXCHANGE_SERVICE_URL:http://exchange-service:8085}")
    private val exchangeServiceUrl: String
) {

    fun getRate(from: String, to: String): BigDecimal {
        val url = "$exchangeServiceUrl/api/v1/exchange-rates/$from/$to"
        val response = restTemplate.getForObject(url, Map::class.java)
        val rate = response?.get("rate")
        return when (rate) {
            is Number -> BigDecimal(rate.toString())
            is String -> BigDecimal(rate)
            else -> throw RuntimeException("Invalid exchange rate response")
        }
    }
}
