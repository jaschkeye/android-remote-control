package com.remote.daemon

import android.os.Looper
import com.remote.daemon.server.WebSocketServer
import com.remote.daemon.util.RootShell

object Main {

    @JvmStatic
    fun main(args: Array<String>) {
        println("[Daemon] Starting android-remote-daemon...")

        // Ensure Looper is prepared for threads that need a message queue
        if (Looper.myLooper() == null) {
            Looper.prepare()
        }

        // Initialize root shell via libsu
        RootShell.init()

        // Start WebSocket server on port 27183
        val server = WebSocketServer(port = 27183)
        server.start()

        println("[Daemon] WebSocket server listening on port ${server.port}")

        // Keep the daemon alive
        Looper.loop()
    }
}
