package com.microbank.transaction.service

import com.microbank.transaction.client.*
import com.microbank.transaction.dto.TransferRequest
import com.microbank.transaction.dto.TransferResponse
import com.microbank.transaction.model.Transaction
import com.microbank.transaction.repository.TransactionRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDateTime
import java.util.UUID

@Service
class TransferService(
    private val transactionRepository: TransactionRepository,
    private val accountClient: AccountClient,
    private val fraudClient: FraudClient,
    private val exchangeClient: ExchangeClient,
    private val notificationClient: NotificationClient,
    private val auditClient: AuditClient
) {

    private val logger = LoggerFactory.getLogger(TransferService::class.java)

    fun transfer(request: TransferRequest, userId: String): TransferResponse {
        // Step 1: Save transaction with PENDING status
        var transaction = Transaction(
            fromAccountId = request.fromAccountId,
            toAccountId = request.toAccountId,
            amount = request.amount,
            currency = request.currency
        )
        transaction = transactionRepository.save(transaction)
        val transactionId = transaction.id!!

        try {
            // Step 2: Check sender account exists and has sufficient balance
            val fromAccount = accountClient.getAccount(request.fromAccountId)
                ?: return failTransaction(transaction, "ACCOUNT_NOT_FOUND", "Sender account not found")

            val balance = when (val bal = fromAccount["balance"]) {
                is Number -> BigDecimal(bal.toString())
                is String -> BigDecimal(bal)
                else -> return failTransaction(transaction, "INVALID_ACCOUNT", "Could not read sender account balance")
            }

            if (balance < request.amount) {
                return failTransaction(transaction, "INSUFFICIENT_FUNDS", "Insufficient balance in sender account")
            }

            val fromCurrency = fromAccount["currency"] as? String ?: request.currency

            // Step 3: Check recipient account exists
            val recipientExists = accountClient.checkAccountExists(request.toAccountId)
            if (!recipientExists) {
                return failTransaction(transaction, "ACCOUNT_NOT_FOUND", "Recipient account not found")
            }

            // Step 4: Fraud check
            val fraudResult = fraudClient.checkFraud(
                transactionId = transactionId,
                fromAccountId = request.fromAccountId,
                toAccountId = request.toAccountId,
                amount = request.amount,
                currency = request.currency
            )

            val fraudStatus = fraudResult?.get("status") as? String ?: "UNKNOWN"
            transaction.fraudCheck = fraudStatus
            transaction.updatedAt = LocalDateTime.now()

            if (fraudStatus == "REJECTED") {
                transaction.status = "REJECTED"
                transaction.failureReason = fraudResult?.get("reason") as? String ?: "Transaction rejected by fraud check"
                transaction = transactionRepository.save(transaction)
                return toResponse(transaction)
            }

            transaction.status = "FRAUD_CHECKED"
            transaction = transactionRepository.save(transaction)

            // Step 5: Currency conversion if needed
            var convertedAmount = request.amount

            // Get recipient account to check currency
            val toAccount = accountClient.getAccount(request.toAccountId)
            val toCurrency = toAccount?.get("currency") as? String ?: request.currency

            if (fromCurrency != toCurrency) {
                val rate = exchangeClient.getRate(fromCurrency, toCurrency)
                convertedAmount = request.amount.multiply(rate).setScale(2, RoundingMode.HALF_UP)
                transaction.originalAmount = request.amount
                transaction.originalCurrency = fromCurrency
                transaction.exchangeRate = rate
                transaction.updatedAt = LocalDateTime.now()
                transaction = transactionRepository.save(transaction)
            }

            // Step 6: Debit sender and credit recipient
            accountClient.updateBalance(request.fromAccountId, request.amount.negate(), transactionId)
            accountClient.updateBalance(request.toAccountId, convertedAmount, transactionId)

            // Update status to COMPLETED
            transaction.status = "COMPLETED"
            transaction.updatedAt = LocalDateTime.now()
            transaction = transactionRepository.save(transaction)

            // Step 7: Send notification (fire-and-forget)
            try {
                notificationClient.sendNotification(
                    type = "TRANSFER_COMPLETED",
                    userId = userId,
                    transactionId = transactionId,
                    message = "Transfer of ${request.amount} ${request.currency} completed successfully"
                )
            } catch (e: Exception) {
                logger.warn("Failed to send notification for transaction $transactionId: ${e.message}")
            }

            // Step 8: Log audit (fire-and-forget)
            try {
                auditClient.logAudit(
                    action = "TRANSFER_COMPLETED",
                    entityType = "TRANSACTION",
                    entityId = transactionId,
                    userId = userId,
                    details = mapOf(
                        "fromAccountId" to request.fromAccountId.toString(),
                        "toAccountId" to request.toAccountId.toString(),
                        "amount" to request.amount,
                        "currency" to request.currency,
                        "convertedAmount" to convertedAmount,
                        "toCurrency" to toCurrency
                    ),
                    sourceService = "transaction-service"
                )
            } catch (e: Exception) {
                logger.warn("Failed to log audit for transaction $transactionId: ${e.message}")
            }

            // Step 9: Return completed transaction
            return toResponse(transaction)

        } catch (e: Exception) {
            logger.error("Transfer failed for transaction $transactionId: ${e.message}", e)
            return failTransaction(transaction, "TRANSFER_FAILED", e.message ?: "Unexpected error during transfer")
        }
    }

    fun getTransaction(id: UUID): Transaction? {
        return transactionRepository.findById(id).orElse(null)
    }

    fun getTransactionsByAccountId(accountId: UUID): List<Transaction> {
        return transactionRepository.findByFromAccountIdOrToAccountId(accountId, accountId)
    }

    fun getAllTransactions(): List<Transaction> {
        return transactionRepository.findAll()
    }

    private fun failTransaction(transaction: Transaction, error: String, message: String): TransferResponse {
        transaction.status = "FAILED"
        transaction.failureReason = "$error: $message"
        transaction.updatedAt = LocalDateTime.now()
        val saved = transactionRepository.save(transaction)
        return toResponse(saved)
    }

    private fun toResponse(transaction: Transaction): TransferResponse {
        return TransferResponse(
            id = transaction.id,
            fromAccountId = transaction.fromAccountId,
            toAccountId = transaction.toAccountId,
            amount = transaction.amount,
            currency = transaction.currency,
            originalAmount = transaction.originalAmount,
            originalCurrency = transaction.originalCurrency,
            exchangeRate = transaction.exchangeRate,
            status = transaction.status,
            fraudCheck = transaction.fraudCheck,
            failureReason = transaction.failureReason,
            createdAt = transaction.createdAt,
            updatedAt = transaction.updatedAt
        )
    }
}
