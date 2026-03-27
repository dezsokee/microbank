package com.microbank.account.dto

import com.microbank.account.model.Account
import java.math.BigDecimal
import java.time.LocalDateTime
import java.util.UUID

data class AccountResponse(
    val id: UUID,
    val userId: UUID,
    val currency: String,
    val balance: BigDecimal,
    val status: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime
) {
    companion object {
        fun from(account: Account) = AccountResponse(
            id = account.id!!,
            userId = account.userId,
            currency = account.currency,
            balance = account.balance,
            status = account.status,
            createdAt = account.createdAt,
            updatedAt = account.updatedAt
        )
    }
}
