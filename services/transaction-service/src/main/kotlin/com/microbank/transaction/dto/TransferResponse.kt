package com.microbank.transaction.dto

import java.math.BigDecimal
import java.time.LocalDateTime
import java.util.UUID

data class TransferResponse(
    val id: UUID?,
    val fromAccountId: UUID,
    val toAccountId: UUID,
    val amount: BigDecimal,
    val currency: String,
    val originalAmount: BigDecimal?,
    val originalCurrency: String?,
    val exchangeRate: BigDecimal?,
    val status: String,
    val fraudCheck: String,
    val failureReason: String?,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime
)
