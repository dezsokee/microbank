package com.microbank.account.dto

import java.math.BigDecimal

data class BalanceUpdateRequest(
    val amount: BigDecimal,
    val transactionId: String
)
