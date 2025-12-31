package com.bitwarelabs.luna.presentation.navigation

sealed class NavRoutes(val route: String) {
    data object Login : NavRoutes("login")
    data object Chat : NavRoutes("chat")
    data object Settings : NavRoutes("settings")
    data object Abilities : NavRoutes("abilities")
    data object Trading : NavRoutes("trading")
    data object Notifications : NavRoutes("notifications")
    data object Activity : NavRoutes("activity")

    // Chat with optional session ID
    data object ChatWithSession : NavRoutes("chat/{sessionId}") {
        fun createRoute(sessionId: String) = "chat/$sessionId"
    }
}
