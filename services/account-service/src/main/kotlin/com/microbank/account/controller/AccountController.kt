package com.microbank.account.controller

import com.microbank.account.dto.BalanceUpdateRequest
import com.microbank.account.dto.CreateAccountRequest
import com.microbank.account.service.AccountService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.time.LocalDateTime
import java.util.UUID

@RestController
class AccountController(private val accountService: AccountService) {

    @PostMapping("/api/v1/accounts")
    fun createAccount(
        @RequestHeader("X-User-Id") userId: String,
        @RequestBody request: CreateAccountRequest
    ): ResponseEntity<Any> {
        return try {
            val uid = UUID.fromString(userId)
            val response = accountService.createAccount(uid, request)
            ResponseEntity.status(HttpStatus.CREATED).body(response)
        } catch (e: IllegalArgumentException) {
            ResponseEntity.badRequest().body(errorBody("BAD_REQUEST", e.message ?: "Invalid request"))
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @GetMapping("/api/v1/accounts/me")
    fun getMyAccounts(@RequestHeader("X-User-Id") userId: String): ResponseEntity<Any> {
        return try {
            val uid = UUID.fromString(userId)
            val accounts = accountService.getAccountsByUserId(uid)
            ResponseEntity.ok(accounts)
        } catch (e: IllegalArgumentException) {
            ResponseEntity.badRequest().body(errorBody("BAD_REQUEST", "Invalid user ID format"))
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @GetMapping("/api/v1/accounts/me/balance")
    fun getMyBalances(@RequestHeader("X-User-Id") userId: String): ResponseEntity<Any> {
        return try {
            val uid = UUID.fromString(userId)
            val balances = accountService.getBalancesByUserId(uid)
            ResponseEntity.ok(balances)
        } catch (e: IllegalArgumentException) {
            ResponseEntity.badRequest().body(errorBody("BAD_REQUEST", "Invalid user ID format"))
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @GetMapping("/api/v1/accounts/{id}")
    fun getAccount(@PathVariable id: UUID): ResponseEntity<Any> {
        return try {
            val account = accountService.getAccountById(id)
            ResponseEntity.ok(account)
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(errorBody("NOT_FOUND", e.message ?: "Account not found"))
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @GetMapping("/api/v1/accounts/{id}/exists")
    fun accountExists(@PathVariable id: UUID): ResponseEntity<Any> {
        return try {
            val result = accountService.accountExists(id)
            ResponseEntity.ok(result)
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @PutMapping("/api/v1/accounts/{id}/balance")
    fun updateBalance(
        @PathVariable id: UUID,
        @RequestBody request: BalanceUpdateRequest
    ): ResponseEntity<Any> {
        return try {
            val result = accountService.updateBalance(id, request)
            ResponseEntity.ok(result)
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(errorBody("NOT_FOUND", e.message ?: "Account not found"))
        } catch (e: IllegalArgumentException) {
            ResponseEntity.badRequest().body(errorBody("INSUFFICIENT_FUNDS", e.message ?: "Insufficient funds"))
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(errorBody("INTERNAL_ERROR", e.message ?: "Unexpected error"))
        }
    }

    @GetMapping("/healthz")
    fun healthCheck(): ResponseEntity<Map<String, String>> {
        return ResponseEntity.ok(mapOf("status" to "UP", "service" to "account-service"))
    }

    private fun errorBody(error: String, message: String): Map<String, String> {
        return mapOf(
            "error" to error,
            "message" to message,
            "timestamp" to LocalDateTime.now().toString()
        )
    }
}
