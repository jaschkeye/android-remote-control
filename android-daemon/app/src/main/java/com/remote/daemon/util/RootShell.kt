package com.remote.daemon.util

import com.topjohnwu.superuser.Shell

object RootShell {

    @Volatile
    private var initialized = false

    fun init() {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            Shell.enableVerboseLogging = true
            Shell.setDefaultBuilder(
                Shell.Builder.create()
                    .setFlags(Shell.FLAG_REDIRECT_STDERR)
                    .setTimeout(10)
            )
            initialized = true
            println("[RootShell] libsu initialized. Root available: ${Shell.getShell().isRoot}")
        }
    }

    fun exec(cmd: String): Shell.Result {
        return Shell.cmd(cmd).exec()
    }

    fun execAsync(cmd: String, callback: (Shell.Result) -> Unit) {
        Shell.cmd(cmd).submit { result -> callback(result) }
    }

    fun isRoot(): Boolean {
        return Shell.getShell().isRoot
    }
}
