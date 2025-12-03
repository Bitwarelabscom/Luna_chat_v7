package com.bitwarelabs.luna.domain.model

data class AuthTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int
)

data class LoginCredentials(
    val email: String,
    val password: String
)
