package com.remote.daemon.server

import com.remote.daemon.modules.InputInjectModule
import com.remote.daemon.modules.ScreenCastModule
import com.remote.daemon.protocol.JsonRpcRequest
import com.remote.daemon.protocol.JsonRpcResponse
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress

class WebSocketServer(port: Int) : WebSocketServer(InetSocketAddress(port)) {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val screenCastModule = ScreenCastModule()
    private val inputInjectModule = InputInjectModule()

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        println("[WSServer] Client connected: ${conn.remoteSocketAddress}")
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        println("[WSServer] Client disconnected: ${conn.remoteSocketAddress} (code=$code, reason=$reason)")
        screenCastModule.stop(conn)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        println("[WSServer] Received: $message")
        try {
            val request = json.decodeFromString<JsonRpcRequest>(message)
            handleRequest(conn, request)
        } catch (e: Exception) {
            val error = JsonRpcResponse(
                id = null,
                error = JsonRpcResponse.Error(code = -32700, message = "Parse error: ${e.message}"),
                result = null
            )
            conn.send(json.encodeToString(error))
        }
    }

    private fun handleRequest(conn: WebSocket, request: JsonRpcRequest) {
        when (request.method) {
            "startScreenCast" -> {
                screenCastModule.start(conn) { result ->
                    respond(conn, request.id, result)
                }
            }
            "stopScreenCast" -> {
                screenCastModule.stop(conn)
                respond(conn, request.id, "ok")
            }
            "injectInput" -> {
                val params = request.params ?: emptyMap()
                inputInjectModule.inject(params)
                respond(conn, request.id, "ok")
            }
            "ping" -> {
                respond(conn, request.id, "pong")
            }
            else -> {
                val error = JsonRpcResponse(
                    id = request.id,
                    error = JsonRpcResponse.Error(code = -32601, message = "Method not found: ${request.method}"),
                    result = null
                )
                conn.send(json.encodeToString(error))
            }
        }
    }

    private fun respond(conn: WebSocket, id: String?, result: Any?) {
        val response = JsonRpcResponse(id = id, result = result, error = null)
        conn.send(json.encodeToString(response))
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        println("[WSServer] Error: ${ex.message}")
        ex.printStackTrace()
    }

    override fun onStart() {
        println("[WSServer] Server started on port $port")
    }
}
