package com.microbank.transaction.model

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.LocalDateTime
import java.util.UUID

@Entity
@Table(name = "transactions")
data class Transaction(
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(name = "from_account_id", nullable = false)
    val fromAccountId: UUID,

    @Column(name = "to_account_id", nullable = false)
    val toAccountId: UUID,

    @Column(nullable = false, precision = 15, scale = 2)
    val amount: BigDecimal,

    @Column(nullable = false, length = 3)
    val currency: String,

    @Column(name = "original_amount", precision = 15, scale = 2)
    var originalAmount: BigDecimal? = null,

    @Column(name = "original_currency", length = 3)
    var originalCurrency: String? = null,

    @Column(name = "exchange_rate", precision = 10, scale = 6)
    var exchangeRate: BigDecimal? = null,

    @Column(nullable = false, length = 20)
    var status: String = "PENDING",

    @Column(name = "fraud_check", length = 20)
    var fraudCheck: String = "PENDING",

    @Column(name = "failure_reason", length = 500)
    var failureReason: String? = null,

    @Column(name = "created_at")
    val createdAt: LocalDateTime = LocalDateTime.now(),

    @Column(name = "updated_at")
    var updatedAt: LocalDateTime = LocalDateTime.now()
)
