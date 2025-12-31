package com.bitwarelabs.luna.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesScreen
import com.bitwarelabs.luna.presentation.screens.chat.ChatScreen
import com.bitwarelabs.luna.presentation.screens.login.LoginScreen
import com.bitwarelabs.luna.presentation.screens.login.LoginViewModel
import com.bitwarelabs.luna.presentation.screens.settings.SettingsScreen
import com.bitwarelabs.luna.presentation.screens.trading.TradingScreen
import com.bitwarelabs.luna.presentation.screens.notifications.NotificationsScreen
import com.bitwarelabs.luna.presentation.screens.activity.ActivityScreen

@Composable
fun LunaNavHost(
    navController: NavHostController = rememberNavController(),
    loginViewModel: LoginViewModel = hiltViewModel()
) {
    val isLoggedIn by loginViewModel.isLoggedIn.collectAsState()
    val startDestination = if (isLoggedIn) NavRoutes.Chat.route else NavRoutes.Login.route

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(NavRoutes.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(NavRoutes.Chat.route) {
                        popUpTo(NavRoutes.Login.route) { inclusive = true }
                    }
                }
            )
        }

        composable(NavRoutes.Chat.route) {
            ChatScreen(
                onNavigateToSettings = {
                    navController.navigate(NavRoutes.Settings.route)
                },
                onNavigateToAbilities = {
                    navController.navigate(NavRoutes.Abilities.route)
                },
                onNavigateToTrading = {
                    navController.navigate(NavRoutes.Trading.route)
                },
                onNavigateToNotifications = {
                    navController.navigate(NavRoutes.Notifications.route)
                },
                onNavigateToActivity = {
                    navController.navigate(NavRoutes.Activity.route)
                },
                onLogout = {
                    navController.navigate(NavRoutes.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = NavRoutes.ChatWithSession.route,
            arguments = listOf(
                navArgument("sessionId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString("sessionId")
            ChatScreen(
                initialSessionId = sessionId,
                onNavigateToSettings = {
                    navController.navigate(NavRoutes.Settings.route)
                },
                onNavigateToAbilities = {
                    navController.navigate(NavRoutes.Abilities.route)
                },
                onNavigateToTrading = {
                    navController.navigate(NavRoutes.Trading.route)
                },
                onNavigateToNotifications = {
                    navController.navigate(NavRoutes.Notifications.route)
                },
                onNavigateToActivity = {
                    navController.navigate(NavRoutes.Activity.route)
                },
                onLogout = {
                    navController.navigate(NavRoutes.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(NavRoutes.Settings.route) {
            SettingsScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(NavRoutes.Abilities.route) {
            AbilitiesScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(NavRoutes.Trading.route) {
            TradingScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(NavRoutes.Notifications.route) {
            NotificationsScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(NavRoutes.Activity.route) {
            ActivityScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
