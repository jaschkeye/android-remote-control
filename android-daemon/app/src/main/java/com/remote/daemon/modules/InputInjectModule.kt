package com.remote.daemon.modules

import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

class InputInjectModule {

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

        // TODO: Use InputManager.hidden_methods or /dev/input/event* injection for root mode
        // Skeleton placeholder:
        val event = MotionEvent.obtain(
            downTime,
            eventTime,
            action,
            1,
            arrayOf(MotionEvent.PointerProperties().apply { id = 0 }),
            arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y }),
            0,
            0,
            1f,
            1f,
            0,
            0,
            InputDevice.SOURCE_TOUCHSCREEN,
            0
        )

        // In production, inject via InputManager.injectInputEvent or shell input tap
        println("[InputInject] Touch action=$action x=$x y=$y")
        event.recycle()
    }

    private fun injectKey(params: Map<String, JsonElement>) {
        val keyCode = params["keyCode"]?.jsonPrimitive?.int ?: return
        val action = params["action"]?.jsonPrimitive?.int ?: KeyEvent.ACTION_DOWN

        val eventTime = SystemClock.uptimeMillis()
        val event = KeyEvent(
            eventTime,
            eventTime,
            action,
            keyCode,
            0,
            0,
            KeyCharacterMap.VIRTUAL_KEYBOARD,
            0,
            0,
            InputDevice.SOURCE_KEYBOARD
        )

        println("[InputInject] Key action=$action keyCode=$keyCode")
        // TODO: Inject via InputManager or shell input keyevent
    }
}
