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

    companion object {
        // MVP 配对码：生产环境应从配置文件读取，此处仅作演示
        private const val PAIR_CODE = "000000"
        private const val AUTH_KEY = "authenticated"
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val screenCastModule = ScreenCastModule()
    private val inputInjectModule = InputInjectModule()

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        println("[WSServer] Client connected: ${conn.remoteSocketAddress}")
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        println("[WSServer] Client disconnected: ${conn.remoteSocketAddress} (code=$code)")
        screenCastModule.stop(conn)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        try {
            val request = json.decodeFromString<JsonRpcRequest>(message)
            handleRequest(conn, request)
        } catch (e: Exception) {
            sendError(conn, null, -32700, "Parse error: ${e.message}")
        }
    }

    private fun handleRequest(conn: WebSocket, request: JsonRpcRequest) {
        // auth 方法不需要认证
        if (request.method == "auth") {
            val code = request.params?.get("code")?.toString()?.trim('"')
            if (code == PAIR_CODE) {
                conn.setAttachment(AUTH_KEY, true)
                respond(conn, request.id, "authenticated")
            } else {
                sendError(conn, request.id, -32001, "Invalid pair code")
            }
            return
        }

        // ping 也不需要认证（用于延迟测试）
        if (request.method == "ping") {
            respond(conn, request.id, "pong")
            return
        }

        // 其他方法需要认证
        val authenticated = conn.getAttachment<Boolean>(AUTH_KEY) ?: false
        if (!authenticated) {
            sendError(conn, request.id, -32000, "Not authenticated. Send 'auth' with pair code first.")
            return
        }

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
            else -> {
                sendError(conn, request.id, -32601, "Method not found: ${request.method}")
            }
        }
    }

    private fun respond(conn: WebSocket, id: String?, result: Any?) {
        val response = JsonRpcResponse(id = id, result = result, error = null)
        conn.send(json.encodeToString(response))
    }

    private fun sendError(conn: WebSocket, id: String?, code: Int, message: String) {
        val response = JsonRpcResponse(
            id = id,
            error = JsonRpcResponse.Error(code = code, message = message),
            result = null
        )
        conn.send(json.encodeToString(response))
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        println("[WSServer] Error: ${ex.message}")
        ex.printStackTrace()
    }

    override fun onStart() {
        println("[WSServer] Server started on port $address")
        println("[WSServer] Pair code: $PAIR_CODE")
    }
}
