package com.bitwarelabs.luna

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.bitwarelabs.luna.domain.repository.ChatRepository
import com.bitwarelabs.luna.presentation.navigation.LunaNavHost
import com.bitwarelabs.luna.presentation.screens.chat.ChatViewModel
import com.bitwarelabs.luna.presentation.theme.LunaChatTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject
    lateinit var chatRepository: ChatRepository

    private var chatViewModel: ChatViewModel? = null
    private var currentSessionId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            LunaChatTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    LunaNavHost()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (isFinishing) {
            currentSessionId?.let { sessionId ->
                lifecycleScope.launch {
                    chatRepository.endSession(sessionId)
                }
            }
        }
    }

    fun setCurrentSession(sessionId: String?) {
        currentSessionId = sessionId
    }
}
