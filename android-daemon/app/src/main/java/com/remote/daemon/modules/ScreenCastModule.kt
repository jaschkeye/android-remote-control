package com.remote.daemon.modules

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.view.Surface
import org.java_websocket.WebSocket
import java.lang.reflect.Method

class ScreenCastModule {

    companion object {
        private const val WIDTH = 1280
        private const val HEIGHT = 720
        private const val DPI = 320
        private const val BIT_RATE = 4_000_000
        private const val FRAME_RATE = 30
        private const val I_FRAME_INTERVAL = 1
    }

    private var mediaCodec: MediaCodec? = null
    private var mediaProjection: MediaProjection? = null
    private val handlerThread = HandlerThread("ScreenCast").apply { start() }
    private val handler = Handler(handlerThread.looper)
    private var activeConn: WebSocket? = null
    private var running = false

    fun start(conn: WebSocket, onResult: (String) -> Unit) {
        if (running) {
            onResult("already running")
            return
        }
        try {
            activeConn = conn
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, WIDTH, HEIGHT)
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            format.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
            format.setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE)
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL)

            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val inputSurface = codec.createInputSurface()
            codec.start()
            mediaCodec = codec

            createDisplayViaSurfaceControl(inputSurface)

            running = true
            startEncodingLoop()
            onResult("started")
        } catch (e: Exception) {
            e.printStackTrace()
            stop(conn)
            onResult("error: ${e.message}")
        }
    }

    private fun createDisplayViaSurfaceControl(surface: Surface) {
        try {
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
            val layerStackRect = android.graphics.Rect(0, 0, WIDTH, HEIGHT)
            val displayRect = android.graphics.Rect(0, 0, WIDTH, HEIGHT)
            setDisplayProjection.invoke(null, displayToken, 0, layerStackRect, displayRect)

            val setDisplayLayerStack: Method = scClass.getMethod(
                "setDisplayLayerStack", IBinder::class.java, Int::class.java
            )
            setDisplayLayerStack.invoke(null, displayToken, 0)

            println("[ScreenCast] SurfaceControl display created (${WIDTH}x${HEIGHT})")
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
