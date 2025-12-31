package com.bitwarelabs.luna.di

import com.bitwarelabs.luna.data.repository.AbilitiesRepositoryImpl
import com.bitwarelabs.luna.data.repository.ActivityRepositoryImpl
import com.bitwarelabs.luna.data.repository.AuthRepositoryImpl
import com.bitwarelabs.luna.data.repository.ChatRepositoryImpl
import com.bitwarelabs.luna.data.repository.SettingsRepositoryImpl
import com.bitwarelabs.luna.data.repository.TradingRepositoryImpl
import com.bitwarelabs.luna.data.repository.TriggersRepositoryImpl
import com.bitwarelabs.luna.domain.repository.AbilitiesRepository
import com.bitwarelabs.luna.domain.repository.ActivityRepository
import com.bitwarelabs.luna.domain.repository.AuthRepository
import com.bitwarelabs.luna.domain.repository.ChatRepository
import com.bitwarelabs.luna.domain.repository.SettingsRepository
import com.bitwarelabs.luna.domain.repository.TradingRepository
import com.bitwarelabs.luna.domain.repository.TriggersRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindAuthRepository(
        authRepositoryImpl: AuthRepositoryImpl
    ): AuthRepository

    @Binds
    @Singleton
    abstract fun bindChatRepository(
        chatRepositoryImpl: ChatRepositoryImpl
    ): ChatRepository

    @Binds
    @Singleton
    abstract fun bindSettingsRepository(
        settingsRepositoryImpl: SettingsRepositoryImpl
    ): SettingsRepository

    @Binds
    @Singleton
    abstract fun bindAbilitiesRepository(
        abilitiesRepositoryImpl: AbilitiesRepositoryImpl
    ): AbilitiesRepository

    @Binds
    @Singleton
    abstract fun bindTradingRepository(
        tradingRepositoryImpl: TradingRepositoryImpl
    ): TradingRepository

    @Binds
    @Singleton
    abstract fun bindTriggersRepository(
        triggersRepositoryImpl: TriggersRepositoryImpl
    ): TriggersRepository

    @Binds
    @Singleton
    abstract fun bindActivityRepository(
        activityRepositoryImpl: ActivityRepositoryImpl
    ): ActivityRepository
}
