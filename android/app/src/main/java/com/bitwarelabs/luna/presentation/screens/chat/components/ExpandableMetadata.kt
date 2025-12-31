package com.bitwarelabs.luna.presentation.screens.chat.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Token
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bitwarelabs.luna.domain.model.StreamMetrics
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExpandableMetadata(
    isExpanded: Boolean,
    metrics: StreamMetrics?,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isExpanded && metrics != null,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier
    ) {
        metrics?.let { m ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
            ) {
                Spacer(modifier = Modifier.height(4.dp))

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Processing time
                    if (m.processingTimeMs > 0) {
                        MetricChip(
                            icon = Icons.Default.Timer,
                            value = formatTime(m.processingTimeMs)
                        )
                    }

                    // Tokens per second
                    if (m.tokensPerSecond > 0) {
                        MetricChip(
                            icon = Icons.Default.Speed,
                            value = String.format("%.1f tok/s", m.tokensPerSecond)
                        )
                    }

                    // Token counts
                    val totalTokens = m.promptTokens + m.completionTokens
                    if (totalTokens > 0) {
                        MetricChip(
                            icon = Icons.Default.Token,
                            value = "$totalTokens (${m.promptTokens}/${m.completionTokens})"
                        )
                    }

                    // Cost
                    m.totalCost?.let { cost ->
                        if (cost > 0) {
                            MetricChip(
                                icon = Icons.Default.AttachMoney,
                                value = String.format("$%.4f", cost)
                            )
                        }
                    }
                }

                // Tools used
                if (m.toolsUsed.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Build,
                            contentDescription = null,
                            tint = LunaTheme.colors.textMuted,
                            modifier = Modifier.size(12.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = m.toolsUsed.joinToString(", "),
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.textMuted,
                            fontSize = 10.sp
                        )
                    }
                }

                // Model name
                if (m.model.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = m.model,
                        style = MaterialTheme.typography.labelSmall,
                        color = LunaTheme.colors.textMuted,
                        fontSize = 10.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun MetricChip(
    icon: ImageVector,
    value: String
) {
    Row(
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = LunaTheme.colors.textMuted,
            modifier = Modifier.size(12.dp)
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.labelSmall,
            color = LunaTheme.colors.textSecondary,
            fontSize = 11.sp
        )
    }
}

private fun formatTime(ms: Long): String {
    return when {
        ms >= 1000 -> String.format("%.1fs", ms / 1000.0)
        else -> "${ms}ms"
    }
}
