package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.domain.model.ActivityLog

interface ActivityRepository {
    suspend fun getRecentActivity(
        limit: Int = 50,
        category: String? = null,
        level: String? = null,
        after: String? = null
    ): Result<List<ActivityLog>>

    suspend fun getSessionActivity(
        sessionId: String,
        limit: Int = 100
    ): Result<List<ActivityLog>>

    suspend fun getArchivedActivity(
        startDate: String? = null,
        endDate: String? = null,
        limit: Int = 100
    ): Result<List<ActivityLog>>

    suspend fun clearActivity(): Result<Boolean>

    suspend fun archiveNow(daysToKeep: Int = 7): Result<Int>
}
