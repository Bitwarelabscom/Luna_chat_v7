package com.bitwarelabs.luna.presentation.screens.chat.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.ChatMode
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun ModeSelector(
    selectedMode: ChatMode,
    onModeSelected: (ChatMode) -> Unit,
    modifier: Modifier = Modifier
) {
    val modes = listOf(
        ChatMode.ASSISTANT to "Assistant",
        ChatMode.COMPANION to "Companion"
    )

    Row(
        modifier = modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        modes.forEach { (mode, label) ->
            FilterChip(
                selected = selectedMode == mode,
                onClick = { onModeSelected(mode) },
                label = {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = {
                    ModeIcon(mode = mode, size = 14.dp)
                },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = LunaTheme.colors.accentPrimary.copy(alpha = 0.2f),
                    selectedLabelColor = LunaTheme.colors.accentPrimary,
                    containerColor = LunaTheme.colors.bgTertiary,
                    labelColor = LunaTheme.colors.textMuted
                )
            )
        }
    }
}
