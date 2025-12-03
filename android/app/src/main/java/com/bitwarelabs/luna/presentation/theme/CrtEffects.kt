package com.bitwarelabs.luna.presentation.theme

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun CrtOverlay(
    flickerEnabled: Boolean,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "crt")

    val flickerAlpha by if (flickerEnabled) {
        infiniteTransition.animateFloat(
            initialValue = 0.97f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = keyframes {
                    durationMillis = 150
                    0.97f at 0 using LinearEasing
                    0.98f at 15 using LinearEasing
                    0.96f at 30 using LinearEasing
                    0.99f at 45 using LinearEasing
                    0.97f at 60 using LinearEasing
                    1f at 75 using LinearEasing
                    0.98f at 90 using LinearEasing
                    0.96f at 105 using LinearEasing
                    0.99f at 120 using LinearEasing
                    0.97f at 135 using LinearEasing
                },
                repeatMode = RepeatMode.Restart
            ),
            label = "flicker"
        )
    } else {
        infiniteTransition.animateFloat(
            initialValue = 1f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = keyframes {
                    durationMillis = 1000
                    1f at 0
                },
                repeatMode = RepeatMode.Restart
            ),
            label = "no-flicker"
        )
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .alpha(flickerAlpha)
    ) {
        // Scanlines effect
        Canvas(modifier = Modifier.fillMaxSize()) {
            val lineHeight = 4.dp.toPx()
            var y = 0f
            while (y < size.height) {
                drawRect(
                    color = Color.Black.copy(alpha = 0.25f),
                    topLeft = Offset(0f, y + 2.dp.toPx()),
                    size = Size(size.width, 2.dp.toPx())
                )
                y += lineHeight
            }
        }

        // Vignette effect
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.4f)
                        ),
                        radius = 1200f
                    )
                )
        )
    }
}
