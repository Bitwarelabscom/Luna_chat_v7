package com.bitwarelabs.luna.presentation.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.ThemeType

val LocalThemeType = staticCompositionLocalOf { ThemeType.DARK }
val LocalCrtFlicker = staticCompositionLocalOf { false }

private val DarkMaterialColorScheme = darkColorScheme(
    primary = DarkColors.accentPrimary,
    onPrimary = Color.White,
    primaryContainer = DarkColors.accentHover,
    onPrimaryContainer = Color.White,
    secondary = DarkColors.bgTertiary,
    onSecondary = DarkColors.textPrimary,
    secondaryContainer = DarkColors.bgSecondary,
    onSecondaryContainer = DarkColors.textPrimary,
    tertiary = DarkColors.accentPrimary,
    onTertiary = Color.White,
    background = DarkColors.bgPrimary,
    onBackground = DarkColors.textPrimary,
    surface = DarkColors.bgSecondary,
    onSurface = DarkColors.textPrimary,
    surfaceVariant = DarkColors.bgTertiary,
    onSurfaceVariant = DarkColors.textSecondary,
    error = DarkColors.error,
    onError = Color.White,
    outline = DarkColors.border
)

private val RetroMaterialColorScheme = darkColorScheme(
    primary = RetroColors.accentPrimary,
    onPrimary = RetroColors.bgPrimary,
    primaryContainer = RetroColors.bgSecondary,
    onPrimaryContainer = RetroColors.textPrimary,
    secondary = RetroColors.bgTertiary,
    onSecondary = RetroColors.textPrimary,
    secondaryContainer = RetroColors.bgSecondary,
    onSecondaryContainer = RetroColors.textPrimary,
    tertiary = RetroColors.accentPrimary,
    onTertiary = RetroColors.bgPrimary,
    background = RetroColors.bgPrimary,
    onBackground = RetroColors.textPrimary,
    surface = RetroColors.bgSecondary,
    onSurface = RetroColors.textPrimary,
    surfaceVariant = RetroColors.bgTertiary,
    onSurfaceVariant = RetroColors.textSecondary,
    error = RetroColors.error,
    onError = RetroColors.bgPrimary,
    outline = RetroColors.border
)

@Composable
fun LunaChatTheme(
    themeViewModel: ThemeViewModel = hiltViewModel(),
    content: @Composable () -> Unit
) {
    val themeType by themeViewModel.themeType.collectAsState()
    val crtFlicker by themeViewModel.crtFlicker.collectAsState()

    val lunaColors = when (themeType) {
        ThemeType.DARK -> DarkColorScheme
        ThemeType.RETRO -> RetroColorScheme
    }

    val materialColorScheme = when (themeType) {
        ThemeType.DARK -> DarkMaterialColorScheme
        ThemeType.RETRO -> RetroMaterialColorScheme
    }

    val typography = when (themeType) {
        ThemeType.DARK -> ModernTypography
        ThemeType.RETRO -> RetroTypography
    }

    CompositionLocalProvider(
        LocalLunaColors provides lunaColors,
        LocalThemeType provides themeType,
        LocalCrtFlicker provides crtFlicker
    ) {
        MaterialTheme(
            colorScheme = materialColorScheme,
            typography = typography
        ) {
            if (themeType == ThemeType.RETRO) {
                Box(modifier = Modifier.fillMaxSize()) {
                    content()
                    CrtOverlay(flickerEnabled = crtFlicker)
                }
            } else {
                content()
            }
        }
    }
}

object LunaTheme {
    val colors: LunaColorScheme
        @Composable
        get() = LocalLunaColors.current

    val themeType: ThemeType
        @Composable
        get() = LocalThemeType.current

    val crtFlicker: Boolean
        @Composable
        get() = LocalCrtFlicker.current
}
