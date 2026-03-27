package com.microbank.transaction.dto

import java.time.LocalDateTime

data class ErrorResponse(
    val error: String,
    val message: String,
    val timestamp: String = LocalDateTime.now().toString()
)
