package com.microbank.transaction.dto

import java.math.BigDecimal
import java.util.UUID

data class TransferRequest(
    val fromAccountId: UUID,
    val toAccountId: UUID,
    val amount: BigDecimal,
    val currency: String
)
