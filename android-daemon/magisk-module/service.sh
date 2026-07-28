#!/system/bin/sh
# Magisk service.sh — runs in late_start service mode

MODDIR=${0%/*}
DAEMON_APK="/data/local/tmp/android-daemon.apk"
DEX_PATH="/data/local/tmp/android-daemon.dex"
PORT=27183

# Wait for boot completion
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done

sleep 5

# Ensure APK/DEX exists
if [ ! -f "$DAEMON_APK" ]; then
    log -t RemoteDaemon "APK not found at $DAEMON_APK"
    exit 1
fi

# Extract classes.dex if not already extracted
if [ ! -f "$DEX_PATH" ]; then
    unzip -p "$DAEMON_APK" classes.dex > "$DEX_PATH"
    chmod 644 "$DEX_PATH"
fi

# Start daemon via app_process
# CLASSPATH must point to the dex or apk
log -t RemoteDaemon "Starting android-remote-daemon on port $PORT..."

export CLASSPATH="$DEX_PATH"
exec app_process \
    /system/bin \
    com.remote.daemon.Main \
    --nice-name=remote_daemon \
    &

log -t RemoteDaemon "Daemon started (PID=$!)"
