package com.microbank.transaction.controller

import com.microbank.transaction.dto.ErrorResponse
import com.microbank.transaction.dto.TransferRequest
import com.microbank.transaction.dto.TransferResponse
import com.microbank.transaction.service.TransferService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.util.UUID

@RestController
class TransactionController(
    private val transferService: TransferService
) {

    @PostMapping("/api/v1/transactions/transfer")
    fun transfer(
        @RequestBody request: TransferRequest,
        @RequestHeader("X-User-Id", required = false, defaultValue = "unknown") userId: String
    ): ResponseEntity<Any> {
        val response = transferService.transfer(request, userId)
        return when (response.status) {
            "COMPLETED" -> ResponseEntity.ok(response)
            "REJECTED" -> ResponseEntity.status(HttpStatus.FORBIDDEN).body(
                ErrorResponse(
                    error = "FRAUD_REJECTED",
                    message = response.failureReason ?: "Transaction rejected by fraud check"
                )
            )
            "FAILED" -> ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                ErrorResponse(
                    error = "TRANSFER_FAILED",
                    message = response.failureReason ?: "Transfer failed"
                )
            )
            else -> ResponseEntity.ok(response)
        }
    }

    @GetMapping("/api/v1/transactions")
    fun listTransactions(
        @RequestParam(required = false) accountId: UUID?
    ): ResponseEntity<Any> {
        val transactions = if (accountId != null) {
            transferService.getTransactionsByAccountId(accountId)
        } else {
            transferService.getAllTransactions()
        }
        return ResponseEntity.ok(transactions)
    }

    @GetMapping("/api/v1/transactions/{id}")
    fun getTransaction(@PathVariable id: UUID): ResponseEntity<Any> {
        val transaction = transferService.getTransaction(id)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                ErrorResponse(
                    error = "TRANSACTION_NOT_FOUND",
                    message = "Transaction with id $id not found"
                )
            )
        return ResponseEntity.ok(transaction)
    }

    @GetMapping("/healthz")
    fun healthCheck(): ResponseEntity<Map<String, String>> {
        return ResponseEntity.ok(mapOf("status" to "UP", "service" to "transaction-service"))
    }
}
