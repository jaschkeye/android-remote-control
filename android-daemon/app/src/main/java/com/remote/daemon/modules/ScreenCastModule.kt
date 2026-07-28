package com.remote.daemon.modules

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import org.java_websocket.WebSocket
import java.nio.ByteBuffer

class ScreenCastModule {

    private var mediaCodec: MediaCodec? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var mediaProjection: MediaProjection? = null
    private val handlerThread = HandlerThread("ScreenCast").apply { start() }
    private val handler = Handler(handlerThread.looper)

    fun start(conn: WebSocket, onResult: (String) -> Unit) {
        try {
            // TODO: Obtain MediaProjection via shell / system service hook
            // For skeleton, we prepare the encoder only
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1280, 720)
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            format.setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000)
            format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)

            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val inputSurface = codec.createInputSurface()
            codec.start()
            mediaCodec = codec

            // TODO: Create VirtualDisplay bound to inputSurface
            // virtualDisplay = mediaProjection?.createVirtualDisplay(...)

            startEncodingLoop(conn)
            onResult("started")
        } catch (e: Exception) {
            e.printStackTrace()
            onResult("error: ${e.message}")
        }
    }

    private fun startEncodingLoop(conn: WebSocket) {
        handler.post {
            val codec = mediaCodec ?: return@post
            val bufferInfo = MediaCodec.BufferInfo()
            while (mediaCodec != null) {
                val outputBufferId = codec.dequeueOutputBuffer(bufferInfo, 10_000)
                if (outputBufferId >= 0) {
                    val outputBuffer = codec.getOutputBuffer(outputBufferId)
                    outputBuffer?.let {
                        val data = ByteArray(bufferInfo.size)
                        it.get(data)
                        // Send H.264 NAL unit to client
                        conn.send(data)
                    }
                    codec.releaseOutputBuffer(outputBufferId, false)
                }
            }
        }
    }

    fun stop(conn: WebSocket) {
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
