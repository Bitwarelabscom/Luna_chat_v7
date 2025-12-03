package com.bitwarelabs.luna.presentation.navigation

sealed class NavRoutes(val route: String) {
    data object Login : NavRoutes("login")
    data object Chat : NavRoutes("chat")
    data object Settings : NavRoutes("settings")
    data object Abilities : NavRoutes("abilities")

    // Chat with optional session ID
    data object ChatWithSession : NavRoutes("chat/{sessionId}") {
        fun createRoute(sessionId: String) = "chat/$sessionId"
    }
}
