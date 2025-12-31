package com.bitwarelabs.luna.presentation.screens.activity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.domain.model.ActivityLog
import com.bitwarelabs.luna.domain.repository.ActivityRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ActivityUiState(
    val isLoading: Boolean = false,
    val activities: List<ActivityLog> = emptyList(),
    val selectedCategory: String? = null,
    val selectedLevel: String? = null,
    val error: String? = null,
    val successMessage: String? = null
)

@HiltViewModel
class ActivityViewModel @Inject constructor(
    private val activityRepository: ActivityRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ActivityUiState())
    val uiState: StateFlow<ActivityUiState> = _uiState.asStateFlow()

    init {
        loadActivity()
    }

    fun loadActivity() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            activityRepository.getRecentActivity(
                limit = 100,
                category = _uiState.value.selectedCategory,
                level = _uiState.value.selectedLevel
            ).fold(
                onSuccess = { activities ->
                    _uiState.value = _uiState.value.copy(
                        activities = activities,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isLoading = false
                    )
                }
            )
        }
    }

    fun filterByCategory(category: String?) {
        _uiState.value = _uiState.value.copy(selectedCategory = category)
        loadActivity()
    }

    fun filterByLevel(level: String?) {
        _uiState.value = _uiState.value.copy(selectedLevel = level)
        loadActivity()
    }

    fun clearActivity() {
        viewModelScope.launch {
            activityRepository.clearActivity().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        activities = emptyList(),
                        successMessage = "Activity cleared"
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun clearSuccessMessage() {
        _uiState.value = _uiState.value.copy(successMessage = null)
    }
}
