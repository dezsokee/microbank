package com.microbank.account.dto

import java.math.BigDecimal
import java.util.UUID

data class AccountBalanceEntry(
    val id: UUID,
    val currency: String,
    val balance: BigDecimal
)

data class BalanceResponse(
    val accounts: List<AccountBalanceEntry>
)
