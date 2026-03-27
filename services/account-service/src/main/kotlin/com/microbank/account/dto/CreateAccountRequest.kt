package com.microbank.account.dto

import java.math.BigDecimal

data class CreateAccountRequest(
    val currency: String = "EUR",
    val initialBalance: BigDecimal = BigDecimal.ZERO
)
