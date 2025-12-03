package com.bitwarelabs.luna.di

import com.bitwarelabs.luna.BuildConfig
import com.bitwarelabs.luna.data.api.AbilitiesApi
import com.bitwarelabs.luna.data.api.AuthApi
import com.bitwarelabs.luna.data.api.ChatApi
import com.bitwarelabs.luna.data.api.SettingsApi
import com.bitwarelabs.luna.data.local.TokenStorage
import com.bitwarelabs.luna.data.network.AuthInterceptor
import com.bitwarelabs.luna.data.network.SSEClient
import com.bitwarelabs.luna.data.network.TokenRefreshAuthenticator
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Provider
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Provides
    @Singleton
    fun provideAuthInterceptor(tokenStorage: TokenStorage): AuthInterceptor {
        return AuthInterceptor(tokenStorage)
    }

    @Provides
    @Singleton
    fun provideTokenRefreshAuthenticator(
        tokenStorage: TokenStorage,
        authApiProvider: Provider<AuthApi>
    ): TokenRefreshAuthenticator {
        return TokenRefreshAuthenticator(tokenStorage, authApiProvider)
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        tokenRefreshAuthenticator: TokenRefreshAuthenticator
    ): OkHttpClient {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .authenticator(tokenRefreshAuthenticator)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        json: Json
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi {
        return retrofit.create(AuthApi::class.java)
    }

    @Provides
    @Singleton
    fun provideChatApi(retrofit: Retrofit): ChatApi {
        return retrofit.create(ChatApi::class.java)
    }

    @Provides
    @Singleton
    fun provideSettingsApi(retrofit: Retrofit): SettingsApi {
        return retrofit.create(SettingsApi::class.java)
    }

    @Provides
    @Singleton
    fun provideAbilitiesApi(retrofit: Retrofit): AbilitiesApi {
        return retrofit.create(AbilitiesApi::class.java)
    }

    @Provides
    @Singleton
    fun provideSSEClient(
        okHttpClient: OkHttpClient,
        tokenStorage: TokenStorage,
        json: Json
    ): SSEClient {
        return SSEClient(okHttpClient, tokenStorage, json)
    }
}
