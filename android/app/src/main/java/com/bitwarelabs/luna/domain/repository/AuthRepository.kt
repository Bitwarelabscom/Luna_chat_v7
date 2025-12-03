package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.domain.model.AuthTokens
import com.bitwarelabs.luna.domain.model.User

interface AuthRepository {
    suspend fun login(email: String, password: String): Result<Pair<User, AuthTokens>>
    suspend fun logout(): Result<Unit>
    suspend fun getCurrentUser(): Result<User>
    suspend fun refreshToken(): Result<AuthTokens>
    fun isLoggedIn(): Boolean
    fun clearSession()
}
