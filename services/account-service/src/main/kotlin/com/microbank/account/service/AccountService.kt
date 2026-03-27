package com.microbank.account.service

import com.microbank.account.dto.*
import com.microbank.account.model.Account
import com.microbank.account.repository.AccountRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.LocalDateTime
import java.util.UUID

@Service
class AccountService(private val accountRepository: AccountRepository) {

    @Transactional
    fun createAccount(userId: UUID, request: CreateAccountRequest): AccountResponse {
        if (request.initialBalance < BigDecimal.ZERO) {
            throw IllegalArgumentException("Initial balance cannot be negative")
        }
        val account = Account(
            userId = userId,
            currency = request.currency.uppercase(),
            balance = request.initialBalance
        )
        val saved = accountRepository.save(account)
        return AccountResponse.from(saved)
    }

    fun getAccountsByUserId(userId: UUID): List<AccountResponse> {
        return accountRepository.findByUserId(userId).map { AccountResponse.from(it) }
    }

    fun getBalancesByUserId(userId: UUID): BalanceResponse {
        val accounts = accountRepository.findByUserId(userId)
        val entries = accounts.map { account ->
            AccountBalanceEntry(
                id = account.id!!,
                currency = account.currency,
                balance = account.balance
            )
        }
        return BalanceResponse(accounts = entries)
    }

    fun getAccountById(id: UUID): AccountResponse {
        val account = accountRepository.findById(id)
            .orElseThrow { NoSuchElementException("Account not found: $id") }
        return AccountResponse.from(account)
    }

    fun accountExists(id: UUID): Map<String, Any> {
        val optional = accountRepository.findById(id)
        return if (optional.isPresent) {
            val account = optional.get()
            mapOf("exists" to true, "id" to account.id!!, "currency" to account.currency)
        } else {
            mapOf("exists" to false)
        }
    }

    @Transactional
    fun updateBalance(id: UUID, request: BalanceUpdateRequest): Map<String, Any> {
        val account = accountRepository.findById(id)
            .orElseThrow { NoSuchElementException("Account not found: $id") }

        val newBalance = account.balance.add(request.amount)
        if (newBalance < BigDecimal.ZERO) {
            throw IllegalArgumentException("Insufficient funds. Current balance: ${account.balance}, requested: ${request.amount}")
        }

        account.balance = newBalance
        account.updatedAt = LocalDateTime.now()
        val saved = accountRepository.save(account)

        return mapOf("id" to saved.id!!, "newBalance" to saved.balance)
    }
}
