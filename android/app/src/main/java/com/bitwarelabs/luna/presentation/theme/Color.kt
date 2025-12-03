package com.bitwarelabs.luna.presentation.theme

import androidx.compose.ui.graphics.Color

// Modern Dark Theme Colors
object DarkColors {
    val bgPrimary = Color(0xFF030712)       // gray-950
    val bgSecondary = Color(0xFF111827)     // gray-900
    val bgTertiary = Color(0xFF1F2937)      // gray-800
    val bgInput = Color(0xFF111827)

    val textPrimary = Color(0xFFF9FAFB)     // gray-50
    val textSecondary = Color(0xFFE5E7EB)   // gray-200
    val textMuted = Color(0xFF9CA3AF)       // gray-400

    val border = Color(0xFF374151)          // gray-700
    val borderFocus = Color(0xFF6366F1)     // indigo-500

    val accentPrimary = Color(0xFF4F46E5)   // indigo-600
    val accentSecondary = Color(0xFF8B5CF6) // violet-500
    val accentHover = Color(0xFF4338CA)     // indigo-700

    val warning = Color(0xFFF59E0B)          // amber-500

    val messageUser = Color(0xFF4F46E5)
    val messageAssistant = Color(0xFF1F2937)
    val messageUserText = Color.White
    val messageAssistantText = Color(0xFFF3F4F6)

    val error = Color(0xFFEF4444)
    val success = Color(0xFF22C55E)
}

// Retro/BBS Theme Colors
object RetroColors {
    val bgPrimary = Color(0xFF0A0A0A)
    val bgSecondary = Color(0xFF0D1A0D)
    val bgTertiary = Color(0xFF0F1F0F)
    val bgInput = Color(0xFF050805)

    val textPrimary = Color(0xFF33FF33)     // Phosphor green
    val textSecondary = Color(0xFF22CC22)
    val textMuted = Color(0xFF1A991A)

    val border = Color(0xFF1A4D1A)
    val borderFocus = Color(0xFF33FF33)

    val accentPrimary = Color(0xFF33FF33)
    val accentSecondary = Color(0xFF00FFFF)  // Cyan
    val accentHover = Color(0xFF44FF44)

    val warning = Color(0xFFFFB000)          // Amber

    val messageUser = Color(0x1AFFB000)     // Amber tint
    val messageAssistant = Color(0x0D33FF33)
    val messageUserText = Color(0xFFFFB000) // Amber
    val messageAssistantText = Color(0xFF00FFFF) // Cyan

    val error = Color(0xFFFF4444)
    val success = Color(0xFF33FF33)

    // Glow colors
    val textGlow = Color(0x8033FF33)
    val amberGlow = Color(0x80FFB000)
    val cyanGlow = Color(0x8000FFFF)
}
