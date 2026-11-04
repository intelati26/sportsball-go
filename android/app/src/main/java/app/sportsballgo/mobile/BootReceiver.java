package app.sportsballgo.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** Brings the watcher back after a reboot if the user had it switched on. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean on = context.getSharedPreferences(WatcherService.PREFS, Context.MODE_PRIVATE)
                .getBoolean("enabled", false);
        if (on) {
            ContextCompat.startForegroundService(context, new Intent(context, WatcherService.class));
        }
    }
}
