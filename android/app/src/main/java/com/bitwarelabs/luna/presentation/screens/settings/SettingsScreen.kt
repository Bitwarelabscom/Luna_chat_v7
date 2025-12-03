package com.bitwarelabs.luna.presentation.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.settings.tabs.AppearanceTab
import com.bitwarelabs.luna.presentation.screens.settings.tabs.DataTab
import com.bitwarelabs.luna.presentation.screens.settings.tabs.ModelsTab
import com.bitwarelabs.luna.presentation.screens.settings.tabs.PromptsTab
import com.bitwarelabs.luna.presentation.screens.settings.tabs.StatsTab
import com.bitwarelabs.luna.presentation.theme.LunaTheme
import com.bitwarelabs.luna.presentation.theme.ThemeViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    themeViewModel: ThemeViewModel = hiltViewModel()
) {
    val themeType by themeViewModel.themeType.collectAsState()
    val crtFlicker by themeViewModel.crtFlicker.collectAsState()

    var selectedTabIndex by remember { mutableIntStateOf(0) }
    val tabs = listOf("Appearance", "Prompts", "Models", "Stats", "Data")

    Scaffold(
        containerColor = LunaTheme.colors.bgPrimary,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Settings",
                        color = LunaTheme.colors.textPrimary
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = LunaTheme.colors.textPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = LunaTheme.colors.bgSecondary
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(LunaTheme.colors.bgPrimary)
        ) {
            TabRow(
                selectedTabIndex = selectedTabIndex,
                containerColor = LunaTheme.colors.bgSecondary,
                contentColor = LunaTheme.colors.textPrimary,
                indicator = { tabPositions ->
                    if (selectedTabIndex < tabPositions.size) {
                        TabRowDefaults.SecondaryIndicator(
                            modifier = Modifier.tabIndicatorOffset(tabPositions[selectedTabIndex]),
                            color = LunaTheme.colors.accentPrimary
                        )
                    }
                }
            ) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTabIndex == index,
                        onClick = { selectedTabIndex = index },
                        text = {
                            Text(
                                text = title,
                                style = MaterialTheme.typography.labelMedium,
                                color = if (selectedTabIndex == index) {
                                    LunaTheme.colors.accentPrimary
                                } else {
                                    LunaTheme.colors.textMuted
                                }
                            )
                        }
                    )
                }
            }

            when (selectedTabIndex) {
                0 -> AppearanceTab(
                    currentTheme = themeType,
                    crtFlicker = crtFlicker,
                    onThemeChange = themeViewModel::setTheme,
                    onCrtFlickerChange = themeViewModel::setCrtFlicker
                )
                1 -> PromptsTab()
                2 -> ModelsTab()
                3 -> StatsTab()
                4 -> DataTab()
            }
        }
    }
}
