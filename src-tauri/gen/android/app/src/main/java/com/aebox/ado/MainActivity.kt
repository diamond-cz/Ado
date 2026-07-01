package com.aebox.ado

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    val darkStatusBarColor = Color.rgb(71, 85, 105)
    val lightSystemBarColor = Color.rgb(232, 238, 246)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(darkStatusBarColor),
      navigationBarStyle = SystemBarStyle.light(lightSystemBarColor, lightSystemBarColor),
    )
    super.onCreate(savedInstanceState)
    window.statusBarColor = darkStatusBarColor
    window.navigationBarColor = lightSystemBarColor
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = true
    }
    window.decorView.systemUiVisibility =
      window.decorView.systemUiVisibility or
        View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
  }
}
