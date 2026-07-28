package com.remote.daemon

import android.os.Looper
import com.remote.daemon.server.WebSocketServer
import com.remote.daemon.util.RootShell
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

object Main {

    @JvmStatic
    fun main(args: Array<String>) {
        println("[Daemon] Android Remote Control Daemon starting...")

        // Prepare Android main looper (required for some Android APIs)
        Looper.prepareMainLooper()

        // Initialize root shell
        RootShell.init()

        // Start WebSocket server on port 27183
        val server = WebSocketServer(27183)

        CoroutineScope(Dispatchers.IO).launch {
            server.start()
        }

        println("[Daemon] Server started. Waiting for connections...")

        // Keep main thread alive
        Looper.loop()
    }
}
