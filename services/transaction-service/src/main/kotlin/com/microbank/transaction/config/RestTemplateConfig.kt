package com.microbank.transaction.config

import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpRequest
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.http.client.ClientHttpResponse
import org.springframework.web.client.RestTemplate

@Configuration
class RestTemplateConfig(private val meterRegistry: MeterRegistry) {

    @Bean
    fun restTemplate(): RestTemplate {
        val restTemplate = RestTemplate()
        restTemplate.interceptors.add(ClientRequestMetricsInterceptor(meterRegistry))
        return restTemplate
    }
}

/**
 * Records client_request_duration_seconds around every outbound RestTemplate call.
 * Mesh-independent: measured by the app itself, so it exists whether or not an
 * Istio/Linkerd sidecar is present, unlike istio_request_duration_milliseconds.
 */
class ClientRequestMetricsInterceptor(private val meterRegistry: MeterRegistry) : ClientHttpRequestInterceptor {

    override fun intercept(
        request: HttpRequest,
        body: ByteArray,
        execution: ClientHttpRequestExecution
    ): ClientHttpResponse {
        val sample = Timer.start(meterRegistry)
        var status = "error"
        try {
            val response = execution.execute(request, body)
            status = response.statusCode.value().toString()
            return response
        } finally {
            sample.stop(
                Timer.builder("client_request_duration_seconds")
                    .description("Duration of outbound HTTP requests to downstream services, as observed by the calling application (mesh-independent)")
                    .tag("destination", request.uri.host ?: "unknown")
                    .tag("method", request.method.toString())
                    .tag("status", status)
                    .publishPercentileHistogram()
                    .register(meterRegistry)
            )
        }
    }
}
