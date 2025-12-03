package com.bitwarelabs.luna.presentation.screens.settings.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.ThemeType
import com.bitwarelabs.luna.presentation.theme.DarkColors
import com.bitwarelabs.luna.presentation.theme.LunaTheme
import com.bitwarelabs.luna.presentation.theme.RetroColors

@Composable
fun AppearanceTab(
    currentTheme: ThemeType,
    crtFlicker: Boolean,
    onThemeChange: (ThemeType) -> Unit,
    onCrtFlickerChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text(
            text = "Theme",
            style = MaterialTheme.typography.titleMedium,
            color = LunaTheme.colors.textPrimary,
            fontWeight = FontWeight.SemiBold
        )

        Spacer(modifier = Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ThemeCard(
                title = "Modern Dark",
                description = "Clean, modern interface",
                isSelected = currentTheme == ThemeType.DARK,
                backgroundColor = DarkColors.bgPrimary,
                accentColor = DarkColors.accentPrimary,
                textColor = DarkColors.textPrimary,
                onClick = { onThemeChange(ThemeType.DARK) },
                modifier = Modifier.weight(1f)
            )

            ThemeCard(
                title = "Retro BBS",
                description = "Terminal style with CRT effects",
                isSelected = currentTheme == ThemeType.RETRO,
                backgroundColor = RetroColors.bgPrimary,
                accentColor = RetroColors.accentPrimary,
                textColor = RetroColors.textPrimary,
                onClick = { onThemeChange(ThemeType.RETRO) },
                modifier = Modifier.weight(1f)
            )
        }

        // CRT Flicker option (only visible for Retro theme)
        if (currentTheme == ThemeType.RETRO) {
            Spacer(modifier = Modifier.height(24.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(LunaTheme.colors.bgSecondary)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "CRT Flicker",
                        style = MaterialTheme.typography.bodyLarge,
                        color = LunaTheme.colors.textPrimary,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "Enable screen flicker effect",
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textMuted
                    )
                }

                Switch(
                    checked = crtFlicker,
                    onCheckedChange = onCrtFlickerChange,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = LunaTheme.colors.accentPrimary,
                        checkedTrackColor = LunaTheme.colors.accentPrimary.copy(alpha = 0.3f),
                        uncheckedThumbColor = LunaTheme.colors.textMuted,
                        uncheckedTrackColor = LunaTheme.colors.bgTertiary
                    )
                )
            }
        }
    }
}

@Composable
private fun ThemeCard(
    title: String,
    description: String,
    isSelected: Boolean,
    backgroundColor: Color,
    accentColor: Color,
    textColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val borderColor = if (isSelected) LunaTheme.colors.accentPrimary else LunaTheme.colors.border

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .border(
                width = if (isSelected) 2.dp else 1.dp,
                color = borderColor,
                shape = RoundedCornerShape(12.dp)
            )
            .clickable(onClick = onClick)
            .padding(16.dp)
    ) {
        // Preview box
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(80.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(backgroundColor)
                .padding(8.dp)
        ) {
            Column {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.7f)
                        .height(12.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(accentColor.copy(alpha = 0.3f))
                )
                Spacer(modifier = Modifier.height(4.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.5f)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(textColor.copy(alpha = 0.5f))
                )
            }

            if (isSelected) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(LunaTheme.colors.accentPrimary),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = LunaTheme.colors.textPrimary,
            fontWeight = FontWeight.SemiBold
        )

        Text(
            text = description,
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )
    }
}
