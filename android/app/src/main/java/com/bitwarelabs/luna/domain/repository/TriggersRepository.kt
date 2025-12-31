package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.domain.model.*

interface TriggersRepository {

    // Notification Preferences
    suspend fun getPreferences(): Result<NotificationPreferences>
    suspend fun updatePreferences(request: UpdatePreferencesRequest): Result<NotificationPreferences>

    // Check-in Schedules
    suspend fun getSchedules(): Result<List<CheckinSchedule>>
    suspend fun getBuiltinSchedules(): Result<List<BuiltinSchedule>>
    suspend fun createSchedule(request: CreateScheduleRequest): Result<CheckinSchedule>
    suspend fun updateSchedule(scheduleId: String, request: UpdateScheduleRequest): Result<CheckinSchedule>
    suspend fun deleteSchedule(scheduleId: String): Result<Boolean>

    // Trigger History
    suspend fun getHistory(limit: Int = 20): Result<List<TriggerHistoryItem>>
    suspend fun getPendingCount(): Result<Int>

    // Push Subscriptions
    suspend fun subscribePush(request: PushSubscribeRequest): Result<Boolean>
    suspend fun unsubscribePush(endpoint: String): Result<Boolean>
    suspend fun getPushSubscriptions(): Result<List<PushSubscription>>

    // Test Notifications
    suspend fun sendTestTrigger(message: String?, deliveryMethod: String?): Result<Boolean>
    suspend fun sendNotification(request: SendNotificationRequest): Result<Boolean>

    // Telegram Integration
    suspend fun getTelegramStatus(): Result<TelegramStatusResponse>
    suspend fun generateTelegramLinkCode(): Result<TelegramLinkResponse>
    suspend fun unlinkTelegram(): Result<Boolean>
    suspend fun testTelegram(): Result<Boolean>

    // Trading Telegram Integration
    suspend fun getTradingTelegramStatus(): Result<TelegramStatusResponse>
    suspend fun generateTradingTelegramLinkCode(): Result<TelegramLinkResponse>
    suspend fun unlinkTradingTelegram(): Result<Boolean>
    suspend fun testTradingTelegram(): Result<Boolean>
}
