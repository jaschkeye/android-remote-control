package com.remote.daemon.modules

import android.hardware.input.InputManager
import android.os.SystemClock
import android.view.InputDevice
import android.view.InputEvent
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
                val imClass = Class.forName("android.hardware.input.InputManager")
                val getInstance = imClass.getMethod("getInstance")
                inputManager = getInstance.invoke(null) as InputManager
            }
            injectInputEventMethod = InputManager::class.java.getMethod(
                "injectInputEvent", InputEvent::class.java, Int::class.java
            )
        } catch (e: Exception) {
            e.printStackTrace()
            println("[InputInject] InputManager reflection failed: ${e.message}")
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
        if (!success) {
            shellInjectTouch(action, x.toInt(), y.toInt())
        }
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
        if (!success) {
            shellInjectKey(action, keyCode)
        }
    }

    private fun injectEvent(event: InputEvent, mode: Int): Boolean {
        return try {
            injectInputEventMethod?.invoke(inputManager, event, mode) as? Boolean ?: false
        } catch (e: Exception) {
            false
        }
    }

    private fun shellInjectTouch(action: Int, x: Int, y: Int) {
        try {
            when (action) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP -> {
                    Runtime.getRuntime().exec(arrayOf("su", "-c", "input", "tap", x.toString(), y.toString()))
                }
                else -> {
                    println("[InputInject] Shell fallback only supports tap, ignoring action=$action")
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun shellInjectKey(action: Int, keyCode: Int) {
        try {
            if (action == KeyEvent.ACTION_DOWN) {
                Runtime.getRuntime().exec(arrayOf("su", "-c", "input", "keyevent", keyCode.toString()))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
