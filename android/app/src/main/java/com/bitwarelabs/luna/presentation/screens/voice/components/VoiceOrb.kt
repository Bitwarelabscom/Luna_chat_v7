package com.bitwarelabs.luna.presentation.screens.voice.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.VoiceState

@Composable
fun VoiceOrb(
    voiceState: VoiceState,
    amplitude: Float,
    modifier: Modifier = Modifier,
    size: Dp = 200.dp
) {
    val infiniteTransition = rememberInfiniteTransition(label = "orb")

    // Breathing animation for idle/thinking
    val breathingScale by infiniteTransition.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = when (voiceState) {
                    VoiceState.THINKING -> 1200
                    else -> 2400
                },
                easing = LinearEasing
            ),
            repeatMode = RepeatMode.Reverse
        ),
        label = "breathing"
    )

    // Glow pulse
    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.15f,
        targetValue = 0.4f,
        animationSpec = infiniteRepeatable(
            animation = tween(1600, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )

    // Amplitude-driven scale (for listening/speaking)
    val amplitudeScale by animateFloatAsState(
        targetValue = 1f + (amplitude * 0.3f),
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 300f),
        label = "amplitude"
    )

    val scale = when (voiceState) {
        VoiceState.IDLE -> breathingScale
        VoiceState.LISTENING -> amplitudeScale
        VoiceState.THINKING -> breathingScale
        VoiceState.SPEAKING -> amplitudeScale
    }

    // State-driven colors
    val (coreColor, glowColor) = when (voiceState) {
        VoiceState.IDLE -> Color(0xFF6B7280) to Color(0xFF4B5563)
        VoiceState.LISTENING -> Color(0xFF3B82F6) to Color(0xFF1D4ED8)
        VoiceState.THINKING -> Color(0xFFF59E0B) to Color(0xFFD97706)
        VoiceState.SPEAKING -> Color(0xFF10B981) to Color(0xFF059669)
    }

    Canvas(modifier = modifier.size(size)) {
        val center = Offset(this.size.width / 2f, this.size.height / 2f)
        val baseRadius = this.size.minDimension / 2f * 0.6f
        val scaledRadius = baseRadius * scale

        // Outer glow
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    glowColor.copy(alpha = glowAlpha * 0.6f),
                    glowColor.copy(alpha = glowAlpha * 0.2f),
                    Color.Transparent
                ),
                center = center,
                radius = scaledRadius * 1.8f
            ),
            radius = scaledRadius * 1.8f,
            center = center
        )

        // Mid glow
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    coreColor.copy(alpha = 0.4f),
                    coreColor.copy(alpha = 0.1f),
                    Color.Transparent
                ),
                center = center,
                radius = scaledRadius * 1.3f
            ),
            radius = scaledRadius * 1.3f,
            center = center
        )

        // Core orb
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    coreColor.copy(alpha = 0.9f),
                    coreColor.copy(alpha = 0.7f),
                    glowColor.copy(alpha = 0.5f)
                ),
                center = center,
                radius = scaledRadius
            ),
            radius = scaledRadius,
            center = center
        )

        // Inner highlight
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    Color.White.copy(alpha = 0.15f),
                    Color.Transparent
                ),
                center = Offset(center.x - scaledRadius * 0.2f, center.y - scaledRadius * 0.2f),
                radius = scaledRadius * 0.6f
            ),
            radius = scaledRadius * 0.6f,
            center = Offset(center.x - scaledRadius * 0.2f, center.y - scaledRadius * 0.2f)
        )
    }
}
