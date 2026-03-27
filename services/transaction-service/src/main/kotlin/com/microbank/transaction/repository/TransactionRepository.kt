package com.microbank.transaction.repository

import com.microbank.transaction.model.Transaction
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.UUID

@Repository
interface TransactionRepository : JpaRepository<Transaction, UUID> {
    fun findByFromAccountIdOrToAccountId(fromAccountId: UUID, toAccountId: UUID): List<Transaction>
}
