package com.microbank.account

import com.microbank.account.model.Account
import com.microbank.account.repository.AccountRepository
import org.slf4j.LoggerFactory
import org.springframework.boot.CommandLineRunner
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import java.math.BigDecimal
import java.util.UUID

@SpringBootApplication
class AccountApplication {

    private val logger = LoggerFactory.getLogger(AccountApplication::class.java)

    @Bean
    fun seedData(accountRepository: AccountRepository) = CommandLineRunner {
        if (accountRepository.count() == 0L) {
            logger.info("Seeding initial account data...")

            val aliceId = UUID.fromString("00000000-0000-0000-0000-000000000001")
            val bobId = UUID.fromString("00000000-0000-0000-0000-000000000002")
            val charlieId = UUID.fromString("00000000-0000-0000-0000-000000000003")

            val accounts = listOf(
                Account(
                    userId = aliceId,
                    currency = "EUR",
                    balance = BigDecimal("10000.00")
                ),
                Account(
                    userId = aliceId,
                    currency = "USD",
                    balance = BigDecimal("5000.00")
                ),
                Account(
                    userId = bobId,
                    currency = "EUR",
                    balance = BigDecimal("5000.00")
                ),
                Account(
                    userId = charlieId,
                    currency = "HUF",
                    balance = BigDecimal("2000000.00")
                )
            )

            accountRepository.saveAll(accounts)
            logger.info("Seeded ${accounts.size} accounts successfully.")
        } else {
            logger.info("Accounts table already has data, skipping seed.")
        }
    }
}

fun main(args: Array<String>) {
    runApplication<AccountApplication>(*args)
}
