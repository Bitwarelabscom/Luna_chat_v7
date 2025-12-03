package com.bitwarelabs.luna.presentation.theme

import androidx.lifecycle.ViewModel
import com.bitwarelabs.luna.data.local.ThemePreferences
import com.bitwarelabs.luna.domain.model.ThemeType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

@HiltViewModel
class ThemeViewModel @Inject constructor(
    private val themePreferences: ThemePreferences
) : ViewModel() {

    val themeType: StateFlow<ThemeType> = themePreferences.themeType
    val crtFlicker: StateFlow<Boolean> = themePreferences.crtFlicker

    fun setTheme(theme: ThemeType) {
        themePreferences.setTheme(theme)
    }

    fun setCrtFlicker(enabled: Boolean) {
        themePreferences.setCrtFlicker(enabled)
    }
}
