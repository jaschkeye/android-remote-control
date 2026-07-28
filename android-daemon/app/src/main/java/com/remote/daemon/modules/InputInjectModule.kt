package com.remote.daemon.modules

import android.hardware.input.InputManager
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

class InputInjectModule {

    private var inputManager: InputManager? = null
    private var injectInputEventMethod: java.lang.reflect.Method? = null

    init {
        try {
            inputManager = android.app.ActivityThread.currentApplication()
                ?.getSystemService(android.content.Context.INPUT_SERVICE) as? InputManager
            if (inputManager == null) {
                // Fallback: get InputManager via reflection
                val imClass = Class.forName("android.hardware.input.InputManager")
                val getInstance = imClass.getMethod("getInstance")
                inputManager = getInstance.invoke(null) as InputManager
            }
            // InputManager.injectInputEvent is hidden API
            injectInputEventMethod = InputManager::class.java.getMethod(
                "injectInputEvent", android.view.InputEvent::class.java, Int::class.java
            )
        } catch (e: Exception) {
            e.printStackTrace()
            println("[InputInject] Failed to get InputManager via reflection: ${e.message}")
        }
    }

    fun inject(params: Map<String, JsonElement>) {
        val type = params["type"]?.jsonPrimitive?.content ?: return
        when (type) {
            "touch" -> injectTouch(params)
            "key" -> injectKey(params)
            else -> println("[InputInject] Unknown input type: $type")
        }
    }

    private fun injectTouch(params: Map<String, JsonElement>) {
        val action = params["action"]?.jsonPrimitive?.int ?: MotionEvent.ACTION_DOWN
        val x = params["x"]?.jsonPrimitive?.int?.toFloat() ?: 0f
        val y = params["y"]?.jsonPrimitive?.int?.toFloat() ?: 0f

        val downTime = SystemClock.uptimeMillis()
        val eventTime = SystemClock.uptimeMillis()

        val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val coords = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }

        val event = MotionEvent.obtain(
            downTime, eventTime, action, 1,
            arrayOf(properties), arrayOf(coords),
            0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0
        )

        val success = injectEvent(event, 0)
        println("[InputInject] Touch action=$action x=$x y=$y success=$success")
        event.recycle()
    }

    private fun injectKey(params: Map<String, JsonElement>) {
        val keyCode = params["keyCode"]?.jsonPrimitive?.int ?: return
        val action = params["action"]?.jsonPrimitive?.int ?: KeyEvent.ACTION_DOWN
        val metaState = params["metaState"]?.jsonPrimitive?.int ?: 0

        val eventTime = SystemClock.uptimeMillis()
        val event = KeyEvent(
            eventTime, eventTime, action, keyCode, 0,
            metaState, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0,
            InputDevice.SOURCE_KEYBOARD
        )

        val success = injectEvent(event, 0)
        println("[InputInject] Key action=$action keyCode=$keyCode success=$success")
    }

    private fun injectEvent(event: android.view.InputEvent, mode: Int): Boolean {
        return try {
            injectInputEventMethod?.invoke(inputManager, event, mode) as? Boolean ?: false
        } catch (e: Exception) {
            // Fallback to shell command if reflection fails
            shellInjectFallback(event)
            false
        }
    }

    private fun shellInjectFallback(event: android.view.InputEvent) {
        when (event) {
            is MotionEvent -> {
                val actionStr = when (event.action) {
                    MotionEvent.ACTION_DOWN -> "tap"
                    else -> "tap"
                }
                if (actionStr == "tap") {
                    val x = event.rawX.toInt()
                    val y = event.rawY.toInt()
                    Runtime.getRuntime().exec("su -c input tap $x $y")
                }
            }
            is KeyEvent -> {
                val actionStr = if (event.action == KeyEvent.ACTION_DOWN) "keyevent" else null
                if (actionStr != null) {
                    Runtime.getRuntime().exec("su -c input $actionStr ${event.keyCode}")
                }
            }
        }
    }
}
