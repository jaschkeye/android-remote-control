package com.remote.daemon.modules

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.view.Surface
import android.view.SurfaceControl
import org.java_websocket.WebSocket
import java.lang.reflect.Method
import java.nio.ByteBuffer

class ScreenCastModule {

    private var mediaCodec: MediaCodec? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var mediaProjection: MediaProjection? = null
    private val handlerThread = HandlerThread("ScreenCast").apply { start() }
    private val handler = Handler(handlerThread.looper)
    private var activeConn: WebSocket? = null
    private var running = false

    private val width = 1280
    private val height = 720
    private val dpi = 320

    fun start(conn: WebSocket, onResult: (String) -> Unit) {
        if (running) {
            onResult("already running")
            return
        }
        try {
            activeConn = conn
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            format.setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000)
            format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)

            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val inputSurface = codec.createInputSurface()
            codec.start()
            mediaCodec = codec

            // Root mode: try to create VirtualDisplay via reflection or SurfaceControl
            createDisplay(inputSurface)

            running = true
            startEncodingLoop()
            onResult("started")
        } catch (e: Exception) {
            e.printStackTrace()
            stop(conn)
            onResult("error: ${e.message}")
        }
    }

    private fun createDisplay(surface: Surface) {
        try {
            // Method 1: Use DisplayManager.createVirtualDisplay via reflection with shell/root context
            val dmClass = Class.forName("android.hardware.display.DisplayManager")
            val createVirtualDisplay = dmClass.getMethod(
                "createVirtualDisplay",
                String::class.java, Int::class.java, Int::class.java,
                Int::class.java, Surface::class.java, Int::class.java
            )
            // We need a DisplayManager instance; in root daemon context this may not be available
            // Fallback to SurfaceControl for root mode
            createDisplayViaSurfaceControl(surface)
        } catch (e: Exception) {
            e.printStackTrace()
            createDisplayViaSurfaceControl(surface)
        }
    }

    private fun createDisplayViaSurfaceControl(surface: Surface) {
        try {
            // SurfaceControl.createDisplay is hidden API, available to shell/root
            val scClass = Class.forName("android.view.SurfaceControl")
            val createDisplay: Method = scClass.getMethod("createDisplay", String::class.java, Boolean::class.java)
            val displayToken: IBinder = createDisplay.invoke(null, "RemoteControl", false) as IBinder

            val setDisplaySurface: Method = scClass.getMethod(
                "setDisplaySurface", IBinder::class.java, Surface::class.java
            )
            setDisplaySurface.invoke(null, displayToken, surface)

            val setDisplayProjection: Method = scClass.getMethod(
                "setDisplayProjection", IBinder::class.java, Int::class.java,
                android.graphics.Rect::class.java, android.graphics.Rect::class.java
            )
            val layerStackRect = android.graphics.Rect(0, 0, width, height)
            val displayRect = android.graphics.Rect(0, 0, width, height)
            setDisplayProjection.invoke(null, displayToken, 0, layerStackRect, displayRect)

            val setDisplayLayerStack: Method = scClass.getMethod(
                "setDisplayLayerStack", IBinder::class.java, Int::class.java
            )
            setDisplayLayerStack.invoke(null, displayToken, 0)

            println("[ScreenCast] SurfaceControl display created")
        } catch (e: Exception) {
            e.printStackTrace()
            println("[ScreenCast] SurfaceControl failed, fallback to MediaProjection")
        }
    }

    private fun startEncodingLoop() {
        handler.post {
            val codec = mediaCodec ?: return@post
            val bufferInfo = MediaCodec.BufferInfo()
            while (running) {
                try {
                    val outputBufferId = codec.dequeueOutputBuffer(bufferInfo, 10_000)
                    if (outputBufferId >= 0) {
                        val outputBuffer = codec.getOutputBuffer(outputBufferId)
                        outputBuffer?.let {
                            val data = ByteArray(bufferInfo.size)
                            it.get(data)
                            activeConn?.let { conn ->
                                if (conn.isOpen) {
                                    conn.send(data)
                                }
                            }
                        }
                        codec.releaseOutputBuffer(outputBufferId, false)
                    }
                } catch (e: Exception) {
                    if (running) e.printStackTrace()
                }
            }
        }
    }

    fun stop(conn: WebSocket) {
        running = false
        if (activeConn === conn) {
            activeConn = null
        }
        try {
            virtualDisplay?.release()
            virtualDisplay = null
            mediaCodec?.stop()
            mediaCodec?.release()
            mediaCodec = null
            mediaProjection?.stop()
            mediaProjection = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
