package com.bitwarelabs.luna.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================
// Notification Preferences
// ============================================

@Serializable
data class NotificationPreferences(
    val id: String? = null,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("enable_chat_notifications") val enableChatNotifications: Boolean = true,
    @SerialName("enable_push_notifications") val enablePushNotifications: Boolean = false,
    @SerialName("enable_email_digest") val enableEmailDigest: Boolean = false,
    @SerialName("enable_telegram") val enableTelegram: Boolean = false,
    @SerialName("persist_telegram_to_chat") val persistTelegramToChat: Boolean = false,
    @SerialName("quiet_hours_enabled") val quietHoursEnabled: Boolean = false,
    @SerialName("quiet_hours_start") val quietHoursStart: String? = null,
    @SerialName("quiet_hours_end") val quietHoursEnd: String? = null,
    val timezone: String? = null,
    @SerialName("enable_reminders") val enableReminders: Boolean = true,
    @SerialName("enable_checkins") val enableCheckins: Boolean = true,
    @SerialName("enable_insights") val enableInsights: Boolean = true,
    @SerialName("enable_achievements") val enableAchievements: Boolean = true
)

@Serializable
data class UpdatePreferencesRequest(
    val enableChatNotifications: Boolean? = null,
    val enablePushNotifications: Boolean? = null,
    val enableEmailDigest: Boolean? = null,
    val enableTelegram: Boolean? = null,
    val persistTelegramToChat: Boolean? = null,
    val quietHoursEnabled: Boolean? = null,
    val quietHoursStart: String? = null,
    val quietHoursEnd: String? = null,
    val timezone: String? = null,
    val enableReminders: Boolean? = null,
    val enableCheckins: Boolean? = null,
    val enableInsights: Boolean? = null,
    val enableAchievements: Boolean? = null
)

// ============================================
// Check-in Schedules (Triggers)
// ============================================

@Serializable
data class TriggerConfig(
    val cron: String? = null,
    val timezone: String? = null,
    val pattern: String? = null,
    val conditions: Map<String, String>? = null,
    val eventType: String? = null
)

@Serializable
data class CheckinSchedule(
    val id: String,
    @SerialName("user_id") val userId: String? = null,
    val name: String,
    @SerialName("trigger_type") val triggerType: String, // 'time', 'pattern', 'event'
    @SerialName("trigger_config") val triggerConfig: TriggerConfig,
    @SerialName("prompt_template") val promptTemplate: String,
    @SerialName("is_enabled") val isEnabled: Boolean = true,
    @SerialName("last_triggered_at") val lastTriggeredAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class SchedulesResponse(
    val schedules: List<CheckinSchedule>
)

@Serializable
data class BuiltinSchedule(
    val id: String,
    val name: String,
    val description: String,
    val triggerType: String,
    val triggerConfig: TriggerConfig,
    val promptTemplate: String
)

@Serializable
data class BuiltinSchedulesResponse(
    val builtins: List<BuiltinSchedule>
)

@Serializable
data class CreateScheduleRequest(
    val name: String,
    val triggerType: String,
    val triggerConfig: TriggerConfig,
    val promptTemplate: String,
    val isEnabled: Boolean? = true
)

@Serializable
data class UpdateScheduleRequest(
    val name: String? = null,
    val triggerConfig: TriggerConfig? = null,
    val promptTemplate: String? = null,
    val isEnabled: Boolean? = null
)

// ============================================
// Trigger History
// ============================================

@Serializable
data class TriggerHistoryItem(
    val id: String,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("schedule_id") val scheduleId: String? = null,
    @SerialName("schedule_name") val scheduleName: String? = null,
    @SerialName("trigger_type") val triggerType: String,
    @SerialName("delivery_method") val deliveryMethod: String,
    val status: String, // 'delivered', 'failed', 'pending'
    val message: String? = null,
    @SerialName("response_session_id") val responseSessionId: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("delivered_at") val deliveredAt: String? = null
)

@Serializable
data class TriggerHistoryResponse(
    val history: List<TriggerHistoryItem>
)

@Serializable
data class PendingCountResponse(
    val count: Int
)

// ============================================
// Push Subscriptions
// ============================================

@Serializable
data class PushKeys(
    val p256dh: String,
    val auth: String
)

@Serializable
data class PushSubscription(
    val id: String? = null,
    @SerialName("user_id") val userId: String? = null,
    val endpoint: String,
    val keys: PushKeys? = null,
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("user_agent") val userAgent: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used_at") val lastUsedAt: String? = null
)

@Serializable
data class PushSubscriptionsResponse(
    val subscriptions: List<PushSubscription>
)

@Serializable
data class PushSubscribeRequest(
    val endpoint: String,
    val keys: PushKeys,
    val deviceName: String? = null
)

@Serializable
data class PushUnsubscribeRequest(
    val endpoint: String
)

// ============================================
// Test Notifications
// ============================================

@Serializable
data class TestTriggerRequest(
    val message: String? = null,
    val deliveryMethod: String? = null
)

@Serializable
data class SendNotificationRequest(
    val category: String, // 'trading', 'reminders', 'email', 'autonomous'
    val title: String,
    val message: String,
    val priority: Int? = null,
    val eventType: String? = null
)

// ============================================
// Telegram Integration
// ============================================

@Serializable
data class TelegramBotInfo(
    val id: Long? = null,
    val username: String? = null,
    @SerialName("first_name") val firstName: String? = null
)

@Serializable
data class TelegramConnection(
    @SerialName("chat_id") val chatId: String? = null,
    val username: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("is_active") val isActive: Boolean = false,
    @SerialName("linked_at") val linkedAt: String? = null,
    @SerialName("last_message_at") val lastMessageAt: String? = null
)

@Serializable
data class TelegramStatusResponse(
    val isConfigured: Boolean,
    val connection: TelegramConnection? = null,
    val botInfo: TelegramBotInfo? = null,
    val setupInstructions: String? = null
)

@Serializable
data class TelegramLinkResponse(
    val code: String,
    val expiresInMinutes: Int,
    val botUsername: String? = null,
    val linkUrl: String? = null
)

@Serializable
data class TelegramUnlinkResponse(
    val success: Boolean,
    val message: String? = null,
    val error: String? = null
)

@Serializable
data class TelegramTestResponse(
    val success: Boolean,
    val message: String? = null,
    val error: String? = null
)

// ============================================
// Generic Responses
// ============================================

@Serializable
data class SuccessResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class DeleteResponse(
    val success: Boolean
)
